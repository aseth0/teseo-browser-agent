// Decides whether a tool call may run: per-site policy, else ask the user (see authorize).
import type { ActionDetail, Authorization, CallSeen, EditedValue, TabSeen, Tool, ToolContext } from '../core/types';
import { errorText } from '../core/errors';
import { text } from '../core/model-texts';
import { lineDiff } from '../tools/line-diff';
import { hostOf } from '../core/util';
import { isMcpPolicyHost } from '../core/mcp-keys';
import type { SitePolicy } from './store';

// allow: this call; always: the site goes to auto; session: the site acts without asking in this
// conversation only; deny.
export type Decision = 'allow' | 'always' | 'session' | 'deny';

// The user's answer to a confirmation card: the decision, an optional comment for the model, and the
// values they edited (ActionDetail.edit), by field.
export interface Answer {
  decision: Decision;
  comment?: string;
  edits?: Record<string, string>;
}

// A card asked again after the user's edits could not be saved: why, and their values.
interface ConfirmRequest {
  summary: string;
  details?: ActionDetail[];
  host: string;
  problem?: string;
  edited?: Record<string, string>;
}

// Where a policy the user chooses from the card is kept: the site's (always) or this conversation's.
type PolicyScope = 'site' | 'conversation';
const SCOPE_OF: Partial<Record<Decision, PolicyScope>> = { always: 'site', session: 'conversation' };

export interface PolicyDeps {
  getPolicy(host: string): Promise<SitePolicy>; // in force: the conversation's, else the site's
  setPolicy(host: string, policy: SitePolicy, scope: PolicyScope): Promise<void>;
  tabUrl(tabId: number | undefined): Promise<string | undefined>;
  tabOf?(tabId: number): Promise<TabSeen | undefined>; // a tab a call names, for the card to say which
  confirm(req: ConfirmRequest): Promise<Answer>;
  // An agent other than Browser: only the hosts it was given (agents/profiles).
  agent?: { name: string; allows(host: string): boolean | Promise<boolean> }; // as saved now
}

// Tools that never act on a page or a site: an agent may use them anywhere.
const SITELESS = new Set<Tool['source']>(['history', 'skill', 'user', 'agent']);

// Whether the call may run (asking the user when the site policy says so), with their comment.
// Judged by the site of the tab the call targets (tool.tabOf), or of the URL it opens. A read tool
// runs freely on the panel's tab; on another tab it is confirmed like an action, since the user did
// not choose that tab. A tool that always asks (for every call, or those its function says) is
// confirmed without a site policy: it is not a site action (saving a skill, reading a saved
// conversation in full), so no "always" is offered.
// An agent (deps.agent) is held to its hosts on every call, reads too, except for the tools that
// never touch a site (or none the call chooses), those confirmed every time, and an MCP server's (its
// tools are the agent's choice).
// `seen` gets what it looked at and the user's answer, for the action log.
export async function authorize(deps: PolicyDeps, tool: Tool, args: unknown, ctx: ToolContext, seen: CallSeen = {}): Promise<Authorization> {
  const asks = typeof tool.alwaysAsk === 'function' ? tool.alwaysAsk(args) : tool.alwaysAsk === true;
  const target = tool.tabOf?.(args);
  const otherTab = target !== undefined && target !== ctx.tabId;
  const agent = deps.agent;
  const heldToSites = !!agent && !asks && !tool.siteless && !SITELESS.has(tool.source) && !isMcpPolicyHost(tool.policyHost);
  if (!asks && tool.effect !== 'write' && !otherTab && !heldToSites) return {};
  const described = tool.describe ? await tool.describe(args, ctx) : { summary: tool.name, url: undefined, details: undefined };
  const { summary, url } = described;
  // On another tab: which one, by its title.
  const tab = otherTab ? await deps.tabOf?.(target).catch(() => undefined) : undefined;
  const details = tab ? [...(described.details ?? []), { label: 'Tab', value: `${tab.title}${tab.url ? `\n${tab.url}` : ''}` }] : described.details;
  seen.summary = summary;
  // Allowed with edits, the call runs with them (tool.withEdits); one that cannot be saved asks again,
  // saying why, with the user's values.
  const confirm = async (host: string): Promise<{ answer: Answer; revised?: Pick<Authorization, 'args' | 'edited'> }> => {
    let answer = await deps.confirm({ summary, details, host });
    for (;;) {
      seen.asked = answer.decision;
      const edits = answer.decision === 'deny' ? {} : changedFields(details, answer.edits);
      if (!tool.withEdits || !Object.keys(edits).length) return { answer };
      try {
        return { answer, revised: { args: await tool.withEdits(args, edits, ctx), edited: editedValues(details, edits) } };
      } catch (e) {
        answer = await deps.confirm({ summary, details, host, problem: errorText(e), edited: edits });
      }
    }
  };
  if (asks) {
    const { answer, revised } = await confirm('');
    return { ...fromAnswer(answer), ...revised };
  }
  const actionUrl = url ?? (tool.policyHost ? undefined : await deps.tabUrl(target ?? ctx.tabId));
  const host = tool.policyHost ?? hostOf(actionUrl);
  if (host) seen.host = host;
  if (heldToSites && agent && !(host && (await agent.allows(host)))) return { refused: text('refusal.agent_site', { agent: agent.name, host: host || 'this page' }) };
  // A write judged by the tab's site: the tab may go elsewhere while the user is asked, so the call
  // carries the site it was allowed on (ctx.approvedHost) and acts only while the tab is still there.
  const approved = tool.effect === 'write' && !tool.policyHost && !url && host ? { approvedHost: host } : {};
  if (tool.effect !== 'write' && !otherTab) return approved;
  const kept = host ? await deps.getPolicy(host) : 'ask';
  // Policies go by host, whatever the scheme: a site's "auto" does not reach its plain http pages
  // (anyone on the network could serve them), except on the machine itself.
  const policy = kept === 'auto' && plainHttp(actionUrl) ? 'ask' : kept;
  if (policy === 'read-only') return tool.effect === 'write' ? { refused: text('refusal.read_only', { host }) } : approved;
  if (policy === 'auto') return approved;
  const { answer, revised } = await confirm(host);
  const scope = SCOPE_OF[answer.decision];
  if (scope && host) await deps.setPolicy(host, 'auto', scope);
  const decided = fromAnswer(answer);
  return decided.refused ? decided : { ...decided, ...revised, ...approved };
}

// Whether the URL is plain http on a host other than this machine (localhost, loopback addresses).
function plainHttp(url: string | undefined): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url ?? '');
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:') return false;
  const name = parsed.hostname;
  return !(name === 'localhost' || name.endsWith('.localhost') || name === '[::1]' || /^127(\.\d{1,3}){3}$/.test(name));
}

// The user's values that differ from the card's, of the fields it let them edit.
function changedFields(details: ActionDetail[] | undefined, edits: Record<string, string> | undefined): Record<string, string> {
  const changed: Record<string, string> = {};
  for (const { edit } of details ?? []) {
    const value = edit && edits?.[edit.field];
    if (edit && value !== undefined && value !== edit.value) changed[edit.field] = value;
  }
  return changed;
}

// What the user changed, by the card's labels, each as a line diff from the model's value, for the model.
const editedValues = (details: ActionDetail[] | undefined, edits: Record<string, string>): EditedValue[] =>
  (details ?? []).flatMap(({ label, edit }) => {
    const value = edit && edits[edit.field];
    return edit && value !== undefined ? [{ label, diff: lineDiff(edit.value, value) }] : [];
  });

function fromAnswer(answer: Answer): Authorization {
  const comment = answer.comment?.trim();
  const said = comment ? { comment } : {};
  if (answer.decision !== 'deny') return said;
  return { refused: comment ? text('refusal.denied_comment', { comment }) : text('refusal.denied'), ...said };
}

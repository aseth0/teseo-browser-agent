// The Agents Panel's tools, for the chats the user starts there (never for the agents those start: one
// level only, as an orchestrator and its workers): panel.start starts an agent that "Can be asked" in a
// new row of the panel, on a new tab, with a task, and returns at once; panel.wait waits for those
// agents' answers; panel.send gives one of them another message. The background runs them; the panel's
// page (entrypoints/manager) makes the rows, says how they are and hands the messages over
// (PANEL_START, PANEL_ROWS, PANEL_SEND). What an agent answers comes back as untrusted content.
import type { JSONSchema, Tool, ToolResult } from '../core/types';
import type { AgentProfile } from './profiles';
import { markValue, text } from '../core/model-texts';
import { toWireName } from '../core/tool-registry';
import { fields, optString } from '../tools/define';
import type { PanelMessage, PanelRow } from '../manager/protocol';
import { ASK_TOOL } from './ask';

export const PANEL_START = 'panel.start';
export const PANEL_WAIT = 'panel.wait';
export const PANEL_SEND = 'panel.send';
export const PANEL_TOOLS = [PANEL_START, PANEL_WAIT, PANEL_SEND];
const AGENT_LIST = '{agent_list}';

export const WAIT_DEFAULT_S = 300;
export const WAIT_MAX_S = 1800;

const START_DESCRIPTION =
  'Starts another agent in a new row of the Agents Panel, on a new tab opened at url, with a task. It works on its own and in ' +
  'parallel, and does not see this conversation: put in the task everything it needs. Returns its row at once; call panel__wait ' +
  'for its answer. Agents you may start:\n' +
  AGENT_LIST;
const WAIT_DESCRIPTION =
  "Waits until the agents you started have finished, or wait_seconds have passed, and returns each one's state and its last " +
  'answer. 0 only checks.';
const SEND_DESCRIPTION =
  'Sends a message to an agent you started, as its next message (once its current turn ends, if it is working). Call panel__wait ' +
  'for its answer.';

const startSchema = (names: string[]): JSONSchema => ({
  type: 'object',
  properties: {
    agent: { type: 'string', enum: names, description: "The agent's name, one of those listed." },
    task: { type: 'string', description: 'What it should do or find out, with every detail it needs: it sees nothing else.' },
    url: { type: 'string', description: 'The page its new tab opens at (http or https).' },
  },
  required: ['agent', 'task', 'url'],
});
const WAIT_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    rows: { type: 'array', items: { type: 'string' }, description: 'The rows to wait for, as panel__start named them; none: all you started.' },
    wait_seconds: { type: 'number', description: `How long to wait at most (default ${WAIT_DEFAULT_S}, at most ${WAIT_MAX_S}); 0 only checks.` },
  },
};
const SEND_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    row: { type: 'string', description: 'The row of the agent, as panel__start named it.' },
    message: { type: 'string', description: 'What to tell it, with every detail it needs.' },
  },
  required: ['row', 'message'],
};

const fillAgents = (description: string, callable: Pick<AgentProfile, 'name' | 'description'>[]) =>
  description.replace(AGENT_LIST, callable.map((a) => `- ${a.name}: ${a.description.trim() || '(no description)'}`).join('\n'));

const notHere = async (): Promise<ToolResult> => ({ type: 'text', text: text('error.panel_closed'), isError: true });

// The tools as Settings → Tools lists them (their descriptions editable there), before a run fills them in.
const START_TOOL: Tool = { name: PANEL_START, description: START_DESCRIPTION, inputSchema: startSchema([]), source: 'agent', effect: 'read', alwaysAsk: true, run: notHere };
const WAIT_TOOL: Tool = { name: PANEL_WAIT, description: WAIT_DESCRIPTION, inputSchema: WAIT_SCHEMA, source: 'agent', effect: 'read', run: notHere };
const SEND_TOOL: Tool = { name: PANEL_SEND, description: SEND_DESCRIPTION, inputSchema: SEND_SCHEMA, source: 'agent', effect: 'read', run: notHere };
export const panelTools = (): Tool[] => [START_TOOL, WAIT_TOOL, SEND_TOOL];

// The tools a request offers: the panel's only in a chat of the panel the user started, with an agent
// to start, and there in place of agents.ask (two ways to hand out work, the model would pick either).
export function withPanel<T extends { name: string }>(tools: T[], offered: boolean): T[] {
  return tools.filter((t) => (offered ? t.name !== ASK_TOOL : !PANEL_TOOLS.includes(t.name)));
}

// The same for a tool spec the views build (ui/request-parts toSpec): panel.start's description and enum filled.
export function panelSpec<T extends { name: string; description: string; inputSchema: JSONSchema }>(spec: T, callable: AgentProfile[]): T {
  return spec.name === toWireName(PANEL_START) ? { ...spec, description: fillAgents(spec.description, callable), inputSchema: startSchema(callable.map((a) => a.name)) } : spec;
}

// How the page is reached, from the background: each undefined when no page of the panel answered
// (none open, or none with that row).
export interface PanelPage {
  start(req: { agent: AgentProfile; message: PanelMessage; url: string; max: number }): Promise<{ row: string } | { tooMany: number } | undefined>;
  rows(rows?: string[]): Promise<PanelRow[] | undefined>;
  send(row: string, message: PanelMessage): Promise<{ when: 'now' | 'later' } | { noRow: string[] } | { stopped: string } | undefined>;
}

const POLL_MS = 1500; // how often panel.wait asks the page again

const stateText = (r: PanelRow) =>
  r.state === 'working' ? text('result.panel_state_working', { step: String(r.step ?? 0), max_steps: String(r.maxSteps ?? 0) }) : text(`result.panel_state_${r.state}`);

// What panel.wait answers: each row, its answer when it has one, then a note when some still work.
export function rowsResult(rows: PanelRow[], stillWorkingAfter?: number): string {
  const lines = rows.flatMap((r) => [
    text('result.panel_row', { row: r.row, agent: r.agent, state: stateText(r) }),
    ...(r.answer !== undefined ? [text('result.agent_answer', { agent: r.agent, answer: markValue(r.answer || text('result.agent_no_answer'), 'tool') })] : []),
  ]);
  return [...lines, ...(stillWorkingAfter !== undefined ? [text('result.panel_wait_timeout', { seconds: String(stillWorkingAfter) })] : [])].join('\n');
}

// Done waiting for it: it answered, waits for the user, or will not go on (stopped).
const settled = (r: PanelRow) => r.state !== 'working';

// A full http(s) URL, or none.
export function httpUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

const error = (t: string): ToolResult => ({ type: 'text', text: t, isError: true });

// The tools for one run of a chat the user started in the panel: the agents it may start, its name
// as theirs see it, the page, and the most it may start (Settings → Limits).
export function panelToolsFor(callable: AgentProfile[], caller: string, page: PanelPage, max: number, sleep = wait): Tool[] {
  return [
    {
      ...START_TOOL,
      inputSchema: startSchema(callable.map((a) => a.name)),
      fillDescription: (d) => fillAgents(d, callable),
      describe: async (args) => {
        const f = fields(args);
        return { summary: `Start ${String(f.agent)} in the Agents Panel on ${String(f.url)}`, url: undefined, details: [{ label: 'Task', value: String(f.task ?? '') }] };
      },
      run: async (args) => {
        const f = fields(args);
        const name = optString(f.agent);
        const agent = callable.find((a) => a.name === name);
        if (!agent) return error(text('error.agent_not_askable', { agent_name: String(name), agents: callable.map((a) => a.name).join(', ') }));
        const task = optString(f.task)?.trim();
        if (!task) return error(text('error.agent_no_task'));
        const url = httpUrl(f.url);
        if (!url) return error(text('error.panel_bad_url'));
        const started = await page.start({ agent, message: { text: text('panel.task', { caller, task }), shown: task }, url, max });
        if (!started) return notHere();
        if ('tooMany' in started) return error(started.tooMany === 1 ? text('error.panel_too_many_one') : text('error.panel_too_many', { count: String(started.tooMany) }));
        return { type: 'text', text: text('result.panel_started', { agent: agent.name, row: started.row, url }) };
      },
    },
    {
      ...WAIT_TOOL,
      run: async (args, ctx) => {
        const f = fields(args);
        const asked = Array.isArray(f.rows) ? f.rows.filter((r): r is string => typeof r === 'string') : undefined;
        const seconds = Math.min(Math.max(0, typeof f.wait_seconds === 'number' && Number.isFinite(f.wait_seconds) ? f.wait_seconds : WAIT_DEFAULT_S), WAIT_MAX_S);
        const until = Date.now() + seconds * 1000;
        for (;;) {
          const rows = await page.rows(asked?.length ? asked : undefined);
          if (!rows) return notHere();
          const missing = asked?.filter((r) => !rows.some((x) => x.row === r)) ?? [];
          if (missing.length) return error(text('error.panel_no_row', { row: missing.join(', '), rows: rows.map((r) => r.row).join(', ') || 'none' }));
          if (rows.every(settled) || Date.now() >= until || ctx.signal.aborted) return { type: 'text', text: rowsResult(rows, rows.every(settled) ? undefined : seconds) };
          await sleep(Math.min(POLL_MS, until - Date.now()), ctx.signal);
        }
      },
    },
    {
      ...SEND_TOOL,
      run: async (args) => {
        const f = fields(args);
        const row = optString(f.row);
        const message = optString(f.message)?.trim();
        if (!row || !message) return error(text('error.panel_no_message'));
        const sent = await page.send(row, { text: text('panel.message', { caller, message }), shown: message });
        if (!sent) return notHere();
        if ('noRow' in sent) return error(text('error.panel_no_row', { row, rows: sent.noRow.join(', ') || 'none' }));
        if ('stopped' in sent) return error(text('error.panel_stopped', { row, title: sent.stopped }));
        return { type: 'text', text: text('result.panel_sent', { row, when: text(`result.panel_when_${sent.when}`) }) };
      },
    },
  ];
}

// A pause between asks, cut short when the turn stops; whichever comes first takes the other away, so a
// long panel.wait leaves no listener behind on the turn's signal per ask.
export const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const t = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });

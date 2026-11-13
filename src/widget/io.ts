// Page widget actions as JSON, to back them up or share them (Settings → Actions): { "actions": [...] }.
// An action's agent goes by its name (ids are per browser). Imported checked like the editor checks
// them, and off until the user switches them on: they run on pages, and may change things (asked in
// the card first). Their model goes only when a provider of that id is set up here.
import type { ThinkingLevel } from '../core/types';
import type { AgentProfile } from '../agents/profiles';
import { importNamed, listFrom, sameName, stringList, type ImportRow } from '../storage/import';
import { ACTION_INPUTS, actionProblems, actionSpeakOf, newAction, type ActionOutput, type WidgetAction } from './actions';

type Shared = Omit<WidgetAction, 'id' | 'enabled' | 'builtin' | 'agent'> & { agent?: string };

export function exportActions(actions: WidgetAction[], agents: AgentProfile[]): string {
  const shared = actions.map(({ id: _id, enabled: _enabled, builtin: _builtin, agent, ...a }): Shared => {
    const name = agents.find((g) => g.id === agent)?.name;
    return { ...a, ...(name && { agent: name }) };
  });
  return JSON.stringify({ actions: shared }, null, 2);
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const LEVELS: ThinkingLevel[] = ['off', 'low', 'medium', 'high'];
// The values it reads from the page, by name (checked with the rest by actionProblems); none: undefined.
const reads = (v: unknown) => {
  const entries = Object.entries((v as Record<string, unknown>) ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string');
  return entries.length ? Object.fromEntries(entries) : undefined;
};

function outputsOf(v: unknown): ActionOutput[] {
  if (!Array.isArray(v)) return [];
  return v.map((o: Record<string, unknown>) => ({
    label: str(o?.label),
    ...(str(o?.from) && { from: str(o.from) }),
    ...(str(o?.text) && { text: str(o.text) }),
    ...(str(o?.link) && { link: str(o.link) }),
  }));
}

// The actions in the JSON ({ "actions": [...] }, a list, or one), each new or replacing the one of
// its name, those left out, with why, and a row each. `providers`: the ids set up here.
export function importActions(json: string, existing: WidgetAction[], agents: AgentProfile[], providers: string[]): { actions: WidgetAction[]; skipped: string[]; rows: ImportRow<WidgetAction>[] } {
  const { items: actions, skipped, rows } = importNamed<WidgetAction>({
    list: listFrom(json, 'actions'),
    existing,
    build: (item, old) => {
      const name = str(item.name).trim();
      const agentName = str(item.agent).trim();
      const agent = agentName ? agents.find((g) => sameName(g.name, agentName)) : undefined;
      const providerId = str(item.providerId);
      const { id: _id, ...blank } = newAction();
      const action: Omit<WidgetAction, 'id'> = {
        ...blank,
        enabled: false,
        name,
        ...(str(item.icon).trim() && { icon: str(item.icon).trim() }),
        where: stringList(item.where),
        input: ACTION_INPUTS.some((i) => i.value === item.input) ? (item.input as WidgetAction['input']) : 'text',
        ...(str(item.placeholder) && { placeholder: str(item.placeholder) }),
        tool: str(item.tool),
        args: Object.fromEntries(Object.entries((item.args as Record<string, unknown>) ?? {}).filter(([, v]) => typeof v === 'string')) as Record<string, string>,
        outputs: outputsOf(item.outputs),
        ...(str(item.prompt).trim() && { prompt: str(item.prompt) }),
        ...(providers.includes(providerId) && str(item.model) && { providerId, model: str(item.model) }),
        ...(LEVELS.includes(item.thinking as ThinkingLevel) && { thinking: item.thinking as ThinkingLevel }),
        ...(agent && { agent: agent.id }),
        ...(item.when === 'load' && { when: 'load' as const }),
        ...(item.openChat === true && { openChat: true }),
        ...(reads(item.reads) && { reads: reads(item.reads) }),
        ...(item.createdBy === 'model' && { createdBy: 'model' as const }),
        ...(actionSpeakOf(item.speak) && { speak: actionSpeakOf(item.speak) }),
        ...(item.besideSelection === true && { besideSelection: true as const }),
      };
      // An agent named but not here: left out, with whatever else is wrong with it.
      if (agentName && !agent) return { skip: `${name || '(no name)'}: ${[`no agent named "${agentName}" here.`, ...actionProblems({ ...action, id: old?.id ?? '' }, existing)].join(' ')}` };
      return action;
    },
    problems: (action, others) => actionProblems(action, others),
  });
  return { actions, skipped, rows };
}

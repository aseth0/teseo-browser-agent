// Memory as JSON, to back it up or move it to another browser (Settings → Memory): { "memory": [...] }.
// Agents go by name, as their ids are this browser's. Importing merges by id: an item of an id
// already here replaces it, any other is added. Imported checked as the editor checks them, and off
// until the user switches them on (their text reaches the model as trusted, and the file comes from
// elsewhere), like skills (skills/io).
import { agentNameById, type AgentProfile } from '../agents/profiles';
import { isHost } from '../core/hosts';
import { finiteOr, listFrom, stringList, type ImportRow } from '../storage/import';
import { domainOf, memoryLabel, newMemoryId, type MemoryItem } from './store';
import { agentIdsByNames, memoryProblems } from './items';

interface Shared {
  id: string;
  title?: string;
  text: string;
  pinned?: boolean;
  enabled?: boolean;
  domains?: string[];
  agents?: string[]; // names; "Browser" too ("Default", its name before)
  createdAt?: number;
  updatedAt?: number;
}

export function exportMemory(items: MemoryItem[], agents: AgentProfile[]): string {
  const shared = items.map((m): Shared => ({
    id: m.id,
    ...(m.title && { title: m.title }),
    text: m.text,
    pinned: m.pinned,
    enabled: m.enabled,
    domains: m.domains,
    agents: m.agents.flatMap((id) => agentNameById(agents, id) ?? []),
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  }));
  return JSON.stringify({ memory: shared }, null, 2);
}

// The items in the JSON ({ "memory": [...] }, a list, or one), what was left out of them, with why (an
// item without text, or one the editor would not save), notes on those that came in (an agent not
// here), and a row each (one of an id already here replaces it).
export function importMemory(json: string, existing: MemoryItem[], agents: AgentProfile[]): { items: MemoryItem[]; skipped: string[]; notes: string[]; rows: ImportRow<MemoryItem>[] } {
  const list = listFrom(json, 'memory') as Partial<Shared>[];
  const items: MemoryItem[] = [];
  const skipped: string[] = [];
  const notes: string[] = [];
  const rows: ImportRow<MemoryItem>[] = [];
  const leftOut = (name: string, why: string) => {
    skipped.push(why);
    rows.push({ name, status: 'left-out', why });
  };
  const now = Date.now();
  for (const raw of list) {
    const body = typeof raw?.text === 'string' ? raw.text.trim() : '';
    if (!body) {
      leftOut(String(raw?.id ?? '(no id)'), `${raw?.id ?? '(no id)'}: it has no text.`);
      continue;
    }
    const given = typeof raw.id === 'string' && /^[\w-]{1,40}$/.test(raw.id) ? raw.id : '';
    const id = given && !items.some((m) => m.id === given) ? given : newMemoryId([...existing, ...items]);
    const { ids: agentIds, missing } = agentIdsByNames(agents, stringList(raw.agents));
    for (const name of missing) notes.push(`${id}: no agent is named "${name}" here, so it goes without it.`);
    // For agents of which none is here: switched on, it would be for every agent.
    if (stringList(raw.agents).length > 0 && !agentIds.length) notes.push(`${id}: none of its agents is here, so it would be for every agent.`);
    const old = existing.find((m) => m.id === id);
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const item: MemoryItem = {
      id,
      enabled: false,
      ...(title && { title }),
      text: body,
      pinned: raw.pinned === true,
      domains: [...new Set(stringList(raw.domains).map(domainOf).filter(isHost))],
      agents: agentIds,
      source: old?.source ?? 'user',
      ...(old?.conversationId && { conversationId: old.conversationId }),
      createdAt: finiteOr(raw.createdAt, old?.createdAt ?? now),
      updatedAt: finiteOr(raw.updatedAt, now),
    };
    const problems = memoryProblems(item);
    if (problems.length) leftOut(memoryLabel(item, 40), `${id}: ${problems.join(' ')}`);
    else {
      items.push(item);
      rows.push({ name: memoryLabel(item, 40), status: old ? 'replaces' : 'new', item });
    }
  }
  return { items, skipped, notes, rows };
}

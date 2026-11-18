// The tools on memory (memory/store): search, list and read the items of the agent running, and save or
// delete one, which the user reviews every time (a card with the whole item; for a change, what
// changes). Reading touches no site (`siteless`): an agent held to its sites reads its own items from any
// page, a full-tab chat too; saving and deleting are confirmed every time, so they need no site either.
import { countArg, fields, optBoolean } from '../tools/define';
import { agentNameById, agentStore, type AgentProfile } from '../agents/profiles';
import { text } from '../core/model-texts';
import type { ActionDescription, Tool, ToolContext } from '../core/types';
import { listArg, reviewedDeleteTool, reviewedSaveTool, withChanges } from '../tools/reviewed-save';
import { agentIdsByNames, domainsFrom, memoryProblems, searchMemoryAbove } from './items';
import { BROWSER_AGENT } from '../agents/registry';
import { MEMORY_DELETE, MEMORY_LIST, MEMORY_READ, MEMORY_SAVE, MEMORY_SEARCH } from '../core/memory-names';
import { domainOf, latestFirst, loadMemory, MAX_TITLE, memoryFor, memoryLabel, memoryStore, newMemoryItem, onDomain, type MemoryItem } from './store';

const MAX_RESULTS = 10;
const LIST_PAGE = 20; // items memory.list lists unless told
const MAX_LIST = 50;

const agentName = (agents: AgentProfile[], id: string) => agentNameById(agents, id) ?? id;
const domainsText = (m: MemoryItem) => (m.domains.length ? m.domains.join(', ') : text('memory.any_site'));
const agentsText = (m: MemoryItem, agents: AgentProfile[]) => (m.agents.length ? m.agents.map((id) => agentName(agents, id)).join(', ') : text('memory.any_agent'));

const idOf = (args: unknown) => String(fields(args).id ?? '').trim();
const mine = async (ctx: ToolContext) => memoryFor(await loadMemory(), ctx.agentId);

interface Draft {
  item: MemoryItem;
  existing?: MemoryItem;
  agents: AgentProfile[];
  problems: string[];
}

// The item a memory.save call would store: new, or a change of the one with that id (what it does
// not say stays as it was), and what keeps it from being saved.
async function draftItem(raw: unknown, ctx: ToolContext): Promise<Draft> {
  const args = fields(raw);
  const pinned = optBoolean(args.pinned);
  const [all, agents] = await Promise.all([loadMemory(), agentStore.load()]);
  const problems: string[] = [];
  const id = idOf(raw);
  // Only one of its own: another agent's internal item is not the agent's to change.
  const existing = id ? memoryFor(all, ctx.agentId).find((m) => m.id === id) : undefined;
  if (id && !existing) problems.push(`No memory item has the id "${id}".`);
  // Not given: an update keeps its own; empty: none, so its text's first line stands in (memoryLabel).
  const title = args.title === undefined ? existing?.title : String(args.title).trim() || undefined;
  if (!id && !title) problems.push('A new item needs a title.');
  const body = args.text === undefined ? (existing?.text ?? '') : String(args.text).trim();
  const domains = args.domains === undefined ? (existing?.domains ?? []) : domainsFrom(listArg(args.domains));
  let agentIds = existing?.agents ?? [];
  if (args.agents !== undefined) {
    const named = agentIdsByNames(agents, listArg(args.agents));
    agentIds = named.ids;
    problems.push(...named.missing.map((name) => `No agent is named "${name}".`));
  } else if (!existing && (ctx.agentId && ctx.agentId !== BROWSER_AGENT ? agents.find((a) => a.id === ctx.agentId)?.memory : ctx.settings.browserAgent?.memory) === 'internal') {
    agentIds = [ctx.agentId ?? BROWSER_AGENT]; // an agent with internal memory keeps what it saves to itself
  }
  const now = Date.now();
  const item: MemoryItem = existing
    ? { ...existing, title, text: body, pinned: pinned ?? existing.pinned, domains, agents: agentIds, updatedAt: now }
    : newMemoryItem(all, { title, text: body, pinned: pinned === true, domains, agents: agentIds, source: 'model', ...(ctx.conversationId && { conversationId: ctx.conversationId }) });
  return { item, existing, agents, problems: [...problems, ...memoryProblems(item)] };
}

// The card the user reviews: the item whole, and for an update what changes.
function itemDescription({ item, existing, agents }: Draft): ActionDescription {
  return withChanges(itemCard(item, agents, Boolean(existing)), existing && itemCard(existing, agents, true));
}

function itemCard(item: MemoryItem, agents: AgentProfile[], update: boolean): ActionDescription {
  return {
    summary: update ? `Update the memory item ${item.id}` : 'Save to memory',
    details: [
      { label: 'Title', value: memoryLabel(item) },
      { label: 'Text', value: item.text },
      { label: 'Pinned', value: item.pinned ? (item.domains.length ? 'Yes: sent whole while one of its sites is open' : 'Yes: sent whole with every request') : 'No' },
      { label: 'Sites', value: item.domains.length ? `${item.domains.join(', ')} (reaches the model while one is open)` : 'Every site' },
      { label: 'Agents', value: item.agents.length ? item.agents.map((id) => agentName(agents, id)).join(', ') : 'Every agent' },
    ],
  };
}

export function memoryTools(): Tool[] {
  return [
    {
      name: MEMORY_SEARCH,
      description:
        "Searches the user's memory items and lists the best matches first (by relevance), each with its id, domains and title (memory__read gives the whole text). Put words in quotes for an exact phrase.",
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words to look for; "a phrase in quotes" must appear as written' },
          limit: { type: 'number', description: `How many to list (default 5, at most ${MAX_RESULTS})` },
        },
        required: ['query'],
      },
      source: 'memory',
      effect: 'read',
      siteless: true,
      run: async (args, ctx) => {
        const { query: asked, limit } = fields(args);
        const query = String(asked ?? '');
        const n = countArg(limit, 5, MAX_RESULTS);
        const found = searchMemoryAbove(await mine(ctx), query, ctx.settings.memory?.minMatch ?? 0).slice(0, n);
        if (!found.length) return { type: 'text', text: text('result.memory_no_match', { query }) };
        const results = found.map((m) => text('result.memory_result_line', { memory_id: m.id, memory_domains: domainsText(m), memory_title: memoryLabel(m) }));
        return { type: 'text', text: text('result.memory_results', { query, results: results.join('\n') }) };
      },
    },
    {
      name: MEMORY_LIST,
      description:
        'Lists the memory items you are given, latest first: each with its id, whether it is pinned, its sites and its title. ' +
        `Optional: site (a host: the items linked to it and those for every site), pinned (true: only pinned; false: only the others), offset and limit (default ${LIST_PAGE}, at most ${MAX_LIST}).`,
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string', description: 'A host, e.g. "example.com"' },
          pinned: { type: 'boolean' },
          offset: { type: 'number', description: 'How many to skip (default 0)' },
          limit: { type: 'number', description: `How many to list (default ${LIST_PAGE}, at most ${MAX_LIST})` },
        },
      },
      source: 'memory',
      effect: 'read',
      siteless: true,
      run: async (args, ctx) => {
        const { site, pinned: asked, offset: from, limit } = fields(args);
        const host = site ? domainOf(String(site)) : undefined;
        const pinned = optBoolean(asked);
        const listed = (await mine(ctx))
          .filter((m) => (host === undefined || !m.domains.length || onDomain(m, host)) && (pinned === undefined || m.pinned === pinned))
          .sort(latestFirst);
        const offset = Math.max(0, Math.round(Number(from) || 0));
        const page = listed.slice(offset, offset + countArg(limit, LIST_PAGE, MAX_LIST));
        if (!page.length) return { type: 'text', text: text('result.memory_list_empty') };
        const items = page.map((m) => text('result.memory_list_line', { memory_id: m.id, pinned: m.pinned ? 'yes' : 'no', memory_domains: domainsText(m), memory_title: memoryLabel(m) }));
        const next = offset + page.length;
        const list = text('result.memory_list', { from: String(offset + 1), to: String(next), total: String(listed.length), items: items.join('\n') });
        const more = listed.length - next;
        return { type: 'text', text: more ? `${list}\n${text('result.memory_list_more', { count: String(more), offset: String(next) })}` : list };
      },
    },
    {
      name: MEMORY_READ,
      description: 'Reads a memory item in full by its id.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      source: 'memory',
      effect: 'read',
      siteless: true,
      run: async (args, ctx) => {
        const id = idOf(args);
        const m = (await mine(ctx)).find((x) => x.id === id);
        if (!m) return { type: 'text', text: text('result.memory_not_found', { memory_id: id }), isError: true };
        const agents = await agentStore.load();
        return {
          type: 'text',
          text: text(m.title?.trim() ? 'result.memory_read' : 'result.memory_read_untitled', { memory_id: m.id, memory_title: memoryLabel(m), pinned: m.pinned ? 'yes' : 'no', memory_domains: domainsText(m), memory_agents: agentsText(m, agents), memory_text: m.text }),
        };
      },
    },
    reviewedSaveTool(
      {
        name: MEMORY_SAVE,
        description:
          'Saves a memory item: a rule or fact the user wants kept across conversations. Without id: a new one (title and text required); ' +
          'with id: that item updated, what you leave out unchanged. ' +
          'If an item already covers this, or this contradicts or outdates it, update that item instead of adding another. The user reviews it before it is saved.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The item to update; none: a new one' },
            title: { type: 'string', description: `A short title (at most ${MAX_TITLE} characters) that says what the item is about: the index and searches show only it` },
            text: { type: 'string', description: 'One rule or fact, in full' },
            pinned: { type: 'boolean', description: 'Sent in full with every request; with domains, while one of them is open' },
            domains: { type: 'array', items: { type: 'string' }, description: 'Hosts, e.g. "example.com" (its subdomains too); none: every site' },
            agents: { type: 'array', items: { type: 'string' }, description: 'Agent names ("Browser" too) that see it; none: as your memory is set (only you with internal memory, every agent with external)' },
          },
        },
        source: 'memory',
      },
      {
        draft: draftItem,
        review: itemDescription,
        save: async ({ item }) => {
          await memoryStore.save(item);
          return text('result.memory_saved', { memory_id: item.id, memory_title: memoryLabel(item) });
        },
        edit: {
          isUpdate: ({ existing }) => Boolean(existing),
          fields: ({ item }) => [
            { field: 'title', label: 'Title', value: item.title ?? '' },
            { field: 'text', label: 'Text', value: item.text, lines: 'text' },
            { field: 'domains', label: 'Sites', value: item.domains.join('\n'), lines: 'list' },
          ],
        },
      },
    ),
    reviewedDeleteTool({
      name: MEMORY_DELETE,
      description: 'Deletes a memory item by id. The user confirms it first.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      source: 'memory',
    }, {
      find: async (args, ctx) => {
        const id = idOf(args);
        const m = (await mine(ctx)).find((x) => x.id === id);
        if (!m) throw new Error(text('result.memory_not_found', { memory_id: id }));
        return m;
      },
      review: (m) => ({ summary: `Delete the memory item ${m.id}`, details: [{ label: 'Title', value: memoryLabel(m) }, { label: 'Text', value: m.text }] }),
      remove: async (m) => {
        await memoryStore.remove(m.id);
        return text('result.memory_deleted', { memory_id: m.id });
      },
    }),
  ];
}

// Memory (Settings → Memory, and the 🧠 button of the side panel): rules and facts the user keeps for
// the model across conversations. Each item goes to the agents it is for (all, when none is named):
// pinned, whole in every request (linked to sites, while one of them is open); linked to sites, while
// one is open, whole if your message matches it, else as a line of an index; any other, as a line of
// an index the model reads from (memory/prompt). The model saves and deletes them only with
// the user's review (memory/tools).
import { createCollection, type Collection, type CollectionItem } from '../storage/collection';
import { BROWSER_AGENT, EMPTY_AGENT_ID } from '../agents/registry';

export interface MemoryItem extends CollectionItem {
  title?: string; // none: the text's first line (memoryLabel)
  text: string;
  pinned: boolean;
  domains: string[]; // hosts ("example.com", its subdomains too); none: every site
  agents: string[]; // agent ids (BROWSER_AGENT for Browser); none: every agent
  source: 'user' | 'model'; // who wrote it
  conversationId?: string; // the model: in which conversation
  createdAt: number;
  updatedAt: number;
}

// Short, so the index the model gets stays small: "m-" and 6 letters or digits.
export function newMemoryId(taken: { id: string }[]): string {
  const ids = new Set(taken.map((t) => t.id));
  for (;;) {
    const id = `m-${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;
    if (!ids.has(id)) return id;
  }
}

export const newMemoryItem = (taken: { id: string }[], change: Partial<MemoryItem> = {}): MemoryItem => {
  const now = Date.now();
  return { id: newMemoryId(taken), enabled: true, text: '', pinned: false, domains: [], agents: [], source: 'user', createdAt: now, updatedAt: now, ...change };
};

// A host as an item links it: lowercase, without a scheme, path or "www.".
export function domainOf(raw: string): string {
  let host = raw.trim().toLowerCase();
  try {
    if (/^[a-z]+:\/\//.test(host)) host = new URL(host).host;
  } catch {
    return '';
  }
  return host.replace(/\/.*$/, '').replace(/^www\./, '');
}

// Items saved before a field existed get it.
export const memoryStore: Collection<MemoryItem> = createCollection<MemoryItem>('memory', [], (m) => ({
  ...m,
  title: typeof m.title === 'string' ? m.title : undefined,
  text: String(m.text ?? ''),
  pinned: m.pinned === true,
  domains: Array.isArray(m.domains) ? m.domains : [],
  agents: Array.isArray(m.agents) ? m.agents : [],
  source: m.source === 'model' ? 'model' : 'user',
  createdAt: m.createdAt ?? Date.now(),
  updatedAt: m.updatedAt ?? m.createdAt ?? Date.now(),
}));

export const loadMemory = () => memoryStore.load();

export const MAX_TITLE = 80; // characters of an item's title

// A text's first line, cut: the title of an item without its own.
export function memoryTitle(text: string, max = MAX_TITLE): string {
  const line = text.trim().split('\n')[0]!.trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// How an item is named, to the model (memory__list, memory__search, the prompt's index and items, the
// auto-attached block's source) and in the lists: its title, else its text's first line; one line, cut.
export const memoryLabel = (m: Pick<MemoryItem, 'title' | 'text'>, max = MAX_TITLE) => memoryTitle(m.title?.trim() || m.text, max);

export const latestFirst = (a: Pick<MemoryItem, 'updatedAt'>, b: Pick<MemoryItem, 'updatedAt'>) => b.updatedAt - a.updatedAt;

// For that agent (none: Browser), switched on; none for EmptyAgent.
export const memoryFor = (items: MemoryItem[], agentId: string | undefined) =>
  agentId === EMPTY_AGENT_ID ? [] : items.filter((m) => m.enabled && m.text.trim() && (!m.agents.length || m.agents.includes(agentId ?? BROWSER_AGENT)));

// Whether it is linked to that host ("shop.test:8080"): one of its domains, or a subdomain of one; a
// domain without a port, on any port.
export function onDomain(m: Pick<MemoryItem, 'domains'>, host: string | undefined): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, '');
  return m.domains.some((d) => {
    const h = d.includes(':') ? host : name;
    return h === d || h.endsWith(`.${d}`);
  });
}

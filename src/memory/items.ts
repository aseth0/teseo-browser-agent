// What the memory tools, its import and the views need of the items: searching them, checking one,
// and the agents they name.
import { agentIdByName, type AgentProfile } from '../agents/profiles';
import { isHost } from '../core/hosts';
import { escapeRegExp } from '../core/util';
import { indexTexts, scored, type MatchOptions } from '../search/bm25';
import { MATCH_THRESHOLD, type AttachDefaults } from '../storage/settings-types';
import { fuseRanks } from './semantic';
import { domainOf, MAX_TITLE, memoryLabel, type MemoryItem } from './store';

const MAX_TEXT = 2000; // characters of an item

// The items that match, best first, each with how much of the query it covers (search/bm25): the
// title (its own, else the text's first line) weighs more than the text.
export function memoryMatches(items: MemoryItem[], query: string, options?: MatchOptions): { item: MemoryItem; match: number }[] {
  return bestFirst(scored(query, items.map((m) => indexTexts(m, [...contentOf(m), [m.domains.join(' '), 1]])), options));
}

const contentOf = (m: MemoryItem): [string, number][] => [[memoryLabel(m, Infinity), 3], [m.text, 1]];
const bestFirst = (found: { item: MemoryItem; score: number; match: number }[]) =>
  found.sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt).map(({ item, match }) => ({ item, match }));

// The same for the items of a site open at `host`: on their title and text only, and for a message
// without the site's name, as naming it would match them all, by their domains or by a word ("com"
// finds "come"), and says nothing of which one you mean. How rare a word is comes from all the agent's
// items: among a site's few, any word in common would be a full match, the words no item has not counting.
export function siteMemoryMatches(site: MemoryItem[], all: MemoryItem[], query: string, host: string): { item: MemoryItem; match: number }[] {
  const names = [...new Set([host.replace(/:\d+$/, ''), ...site.flatMap((m) => m.domains)])].sort((a, b) => b.length - a.length);
  const asked = names.reduce((q, name) => q.replace(new RegExp(escapeRegExp(name), 'gi'), ' '), query);
  const doc = (m: MemoryItem) => indexTexts(m, contentOf(m));
  return bestFirst(scored(asked, site.map(doc), { corpus: all.map(doc) }));
}

// Each item's closeness in meaning to a text (memory/query-meaning, 0 to 1) and the % it needs.
export type MeaningMatch = { scores: ReadonlyMap<string, number>; threshold: number };
export const reachesMeaning = (score: number | undefined, threshold: number) => score !== undefined && score * 100 >= threshold;

// A ranking by words with what meaning adds: those only it finds (no match by words), each with both
// scores, in one order made of both (memory/semantic fuseRanks).
export function withMeaning(ranked: { item: MemoryItem; match: number }[], all: MemoryItem[], meaning: MeaningMatch | undefined): { item: MemoryItem; match: number; meaning?: number }[] {
  if (!meaning) return ranked;
  const byId = new Map(all.map((m) => [m.id, m]));
  const matchOf = new Map(ranked.map((r) => [r.item.id, r.match]));
  const closest = [...meaning.scores].filter(([id]) => byId.has(id)).sort(([, a], [, b]) => b - a).map(([id]) => id);
  return fuseRanks([ranked.map((r) => r.item.id), closest]).map((id) => ({ item: byId.get(id)!, match: matchOf.get(id) ?? 0, meaning: meaning.scores.get(id) }));
}

export const searchMemory = (items: MemoryItem[], query: string, options?: MatchOptions) => memoryMatches(items, query, options).map((r) => r.item);

// Settings → Memory → Auto-attach (memory/prompt memoryAutoPicks), when not set, and the most per message.
export const MEMORY_AUTO_DEFAULTS: AttachDefaults = { threshold: MATCH_THRESHOLD, max: 2, most: 5 };
// The items that may go on their own: not pinned (they are in the system prompt already) and linked to
// no site (those go with their site).
export const autoAttachable = (m: MemoryItem) => !m.pinned && !m.domains.length;

// As memory__search finds them: whole words, those covering at least `minMatch` % of the query.
export const searchMemoryAbove = (items: MemoryItem[], query: string, minMatch = 0) =>
  memoryMatches(items, query).filter((r) => r.match * 100 >= minMatch).map((r) => r.item);

// The hosts as an item keeps them, each once.
export const domainsFrom = (raw: string[]) => [...new Set(raw.map(domainOf).filter(Boolean))];

// What keeps an item from being saved.
export function memoryProblems(item: Pick<MemoryItem, 'title' | 'text' | 'domains'>): string[] {
  const problems: string[] = [];
  if ((item.title?.trim().length ?? 0) > MAX_TITLE) problems.push(`The title is longer than ${MAX_TITLE} characters.`);
  if (!item.text.trim()) problems.push('The item needs a text.');
  if (item.text.length > MAX_TEXT) problems.push(`The text is longer than ${MAX_TEXT.toLocaleString('en-US')} characters: keep one rule or fact per item.`);
  const bad = item.domains.filter((d) => !isHost(d));
  if (bad.length) problems.push(`Not a site's host: ${bad.join(', ')} (e.g. "example.com").`);
  return problems;
}

// The ids of the agents named (each once), and the names no agent here has.
export function agentIdsByNames(agents: AgentProfile[], names: string[]): { ids: string[]; missing: string[] } {
  const ids: string[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const found = agentIdByName(agents, name);
    if (found) ids.push(found);
    else missing.push(name);
  }
  return { ids: [...new Set(ids)], missing };
}

// What the model sees of memory (memory/store): in the system prompt, the items pinned and for every
// site whole (as many as fit in Settings → Limits), and an index of the others (cut to Settings →
// Limits), kept with the conversation as it started (keepMemory), what changed since going with your
// message (memoryChanges); with each message, the items linked to the open site: in a <memory> block
// those pinned or that your message matches (at most Settings → Limits' count), in an index those
// left, for the model to read. Each goes once while the model still sees it whole
// (context/compaction seenWhole): again after a compaction left it out, or once edited.
import { MEMORY_CHANGES_SOURCE, MEMORY_SOURCE, memoryIndexSource, memoryMatchSource, type AttachOrigin } from '../core/sources';
import { limit, limitText } from '../core/limits';
import { attachedParts, type ContextItem } from '../core/messages';
import { cutNote, markValue, stripMarks, text } from '../core/model-texts';
import type { Message, SystemMemory } from '../core/types';
import { autoAttachable, memoryMatches, MEMORY_AUTO_DEFAULTS, reachesMeaning, siteMemoryMatches, withMeaning, type MeaningMatch } from './items';
import { fuseRanks } from './semantic';
import { latestFirst, memoryLabel, onDomain, type MemoryItem } from './store';
import { autoPicks } from '../storage/auto-picks';
import type { StepAttach } from '../storage/settings-types';
import { escapeRegExp, linesThatFit } from '../core/util';

// An item without its own title goes as its text alone: its first line would say the same twice.
const memoryLine = (m: MemoryItem) =>
  text(m.title?.trim() ? 'memory.item' : 'memory.item_untitled', { memory_id: m.id, memory_title: markValue(memoryLabel(m), 'memory'), memory_text: markValue(m.text.trim(), 'memory') });
const indexLine = (m: MemoryItem) => text('memory.index_item', { memory_id: m.id, memory_title: markValue(memoryLabel(m), 'memory') });

// What the items switched on and for every site take of the system prompt, as Settings → Memory shows
// it against its limits: the pinned ones whole, and the index of the others' titles (any agent's).
export function memoryBudget(items: MemoryItem[]): { pinned: number; index: number } {
  const everywhere = items.filter((m) => m.enabled && !m.domains.length);
  const size = (lines: string[]) => lines.reduce((n, l) => n + stripMarks(l).length + 1, 0);
  return { pinned: size(everywhere.filter((m) => m.pinned).map(memoryLine)), index: size(everywhere.filter((m) => !m.pinned).map(indexLine)) };
}

// How the memory part of the system prompt is built for an agent (memoryInstructions).
export type MemoryPromptOptions = { reads: boolean; searches?: boolean; lists?: boolean; saves: boolean; internal?: boolean };

// `items`: those for the agent (memoryFor). `reads`: it may read them (memory.read), else no index;
// `searches`: it may search them (memory.search); `lists`: list them (memory.list); `saves`: save
// them (memory.save), so it is told about memory even without any. Only the tools it is offered are
// named. `internal`: what it saves is its alone (Settings → Agents), which it is told.
export function memoryInstructions(items: MemoryItem[], { reads, searches = false, lists = false, saves, internal = false }: MemoryPromptOptions): string {
  if (!items.length && !saves) return '';
  const everywhere = items.filter((m) => !m.domains.length).sort(latestFirst);
  // The pinned ones in full, the latest first, within Settings → Limits: those that do not fit go in the index.
  const pinned = everywhere.filter((m) => m.pinned);
  const pinnedLines = pinned.map(memoryLine);
  const whole = pinnedLines.slice(0, linesThatFit(pinnedLines, limit('pinnedMemory'), true));
  const overflow = pinned.slice(whole.length);
  if (overflow.length) whole[whole.length - 1] += cutNote(`Pinned memory: ${overflow.length} of ${pinned.length} items in the index instead (limit ${limitText('pinnedMemory')})`);
  const tools = ([[reads, 'system.memory_read'], [searches, 'system.memory_search'], [lists, 'system.memory_list'], [saves, 'system.memory_save']] as const).flatMap(([on, id]) => (on ? [text(id)] : []));
  const parts = [[text('system.memory'), ...tools].join(' '), ...(internal && saves ? [text('system.memory_internal')] : []), ...whole];
  const others = reads ? [...overflow, ...everywhere.filter((m) => !m.pinned)] : [];
  if (others.length) parts.push(text('system.memory_index', { memory_index: indexLines(others, 'Memory index', { searches, lists }).join('\n') }));
  return parts.join('\n');
}

// An index's lines, cut to Settings → Limits, with what the model can do about those left out.
function indexLines(items: MemoryItem[], name: string, { searches, lists }: Pick<MemoryPromptOptions, 'searches' | 'lists'>): string[] {
  const all = items.map(indexLine);
  const lines = all.slice(0, linesThatFit(all, limit('memory'), true));
  const more = items.length - lines.length;
  if (more) lines.push(cutNote(`${name}: ${more} of ${items.length} items left out (limit ${limitText('memory')})`) + text('memory.index_more', { count: String(more) }) + (searches ? text('memory.index_more_search') : lists ? text('memory.index_more_list') : ''));
  return lines;
}

// What memory the conversation has had already, as sent (with a message, or between the model's steps).
const sentIn = (history: Message[]) => attachedParts(history).flatMap((p) => (p.context === 'memory' ? [stripMarks(p.text)] : []));
// Whether an item's line went in one of those blocks as it is now: a whole item, so that one edited
// to a shorter text (its first lines, or the start of a line) goes again. An item ends where the next
// one starts, or where its block's text goes on after the items.
const wentIn = (sent: string[], line: string, { starts, ends }: ItemBounds) => {
  const own = stripMarks(line);
  return sent.some((s) => {
    for (let at = s.indexOf(own); at >= 0; at = s.indexOf(own, at + 1)) {
      if (at > 0 && s[at - 1] !== '\n') continue;
      const rest = s.slice(at + own.length);
      if (!rest || ends.includes(rest) || (rest.startsWith('\n') && starts.some((r) => r.test(rest.slice(1))))) return true;
    }
    return false;
  });
};

// How the items show in the blocks, as the texts are now (Options → Prompt preview may change them):
// the start of an item's line, whatever its id, and what each block says after its items. Made once
// per check of a conversation's items, not per item.
type ItemBounds = ReturnType<typeof itemBounds>;
const ID = '\u0001';
const VALUE = '\u0002';
function itemBounds() {
  const starts = (['memory.item', 'memory.item_untitled', 'memory.index_item', 'memory.deleted_item', 'memory.index_more'] as const).map((id) => {
    const head = stripMarks(text(id, { memory_id: ID, memory_text: VALUE, memory_title: VALUE, count: VALUE })).split(VALUE)[0]!;
    return new RegExp(`^${escapeRegExp(head).replace(ID, '[^\\s\\]]+')}`);
  });
  const ends = (['memory.site_block', 'memory.site_index_block', 'memory.changes_block', 'memory.auto_block', 'memory.meaning_block', 'memory.step_block'] as const).map(
    (id) => stripMarks(text(id, { host: ID, memory_items: VALUE })).split(VALUE)[1] ?? '',
  );
  return { starts, ends };
}

// The items the system prompt's memory part covers: those for every site, pinned or in the index.
const covered = (items: MemoryItem[], reads: boolean) => items.filter((m) => !m.domains.length && (m.pinned || reads)).sort(latestFirst);

// The memory part of the system prompt, to keep with the conversation (Message.systemMemory).
export function keepMemory(items: MemoryItem[], opts: MemoryPromptOptions, key: string): SystemMemory {
  return { key, text: memoryInstructions(items, opts), items: covered(items, opts.reads).map((m) => ({ id: m.id, at: m.updatedAt, pinned: m.pinned })) };
}

// The one the conversation keeps, while built the same way (`key`); none: it is built again.
export const keptMemory = (history: Message[], key: string): SystemMemory | undefined => {
  const kept = history.findLast((m) => m.systemMemory)?.systemMemory;
  return kept?.key === key ? kept : undefined;
};

// What changed since the kept one was built, with your message: the items saved or edited since (pinned
// ones whole, the others as an index line) and those deleted, each change once. `seen`: what the model
// still sees whole (context/compaction seenWhole), so a change a summary left out goes again.
export function memoryChanges(items: MemoryItem[], kept: SystemMemory, opts: MemoryPromptOptions, seen: Message[]): ContextItem[] {
  const was = new Map(kept.items.map((e) => [e.id, e]));
  const changed = covered(items, opts.reads).filter((m) => {
    const then = was.get(m.id);
    return then?.at !== m.updatedAt || then.pinned !== m.pinned;
  });
  const ids = new Set(items.map((m) => m.id)); // one linked to a site since goes with that site's block
  const lines = [
    ...changed.map((m) => (m.pinned ? memoryLine(m) : indexLine(m))),
    ...kept.items.filter((e) => !ids.has(e.id)).map((e) => text('memory.deleted_item', { memory_id: e.id })),
  ];
  const sent = attachedParts(seen).flatMap((p) => (p.context === 'memory' && p.source === MEMORY_CHANGES_SOURCE ? [stripMarks(p.text)] : []));
  const bounds = itemBounds();
  const fresh = lines.filter((l) => !wentIn(sent, l, bounds));
  return fresh.length ? [{ kind: 'memory', source: MEMORY_CHANGES_SOURCE, text: text('memory.changes_block', { memory_items: fresh.join('\n') }) }] : [];
}

// Whether any text of the item went whole in those blocks: the start of its line, whatever comes after
// its id.
const wentWholeOnce = (sent: string[], id: string) =>
  (['memory.item', 'memory.item_untitled'] as const)
    .map((t) => stripMarks(text(t, { memory_id: id, memory_text: VALUE, memory_title: VALUE })).split(VALUE)[0]!)
    .some((head) => head.includes(id) && sent.some((s) => s.startsWith(head) || s.includes(`\n${head}`)));

// Going by what you wrote (Settings → Auto-inject): what you wrote, the match it needs, how close in
// meaning each item is (Settings → Memory → Semantic search), and the tools the agent has to find what
// an index leaves out.
export type SiteMatch = { typed: string; threshold: number; meaning?: MeaningMatch } & Pick<MemoryPromptOptions, 'searches' | 'lists'>;

// What goes for the open site, each item once while the model still sees it (one edited since, again).
// Without `match`, all its items whole, the latest first. With it, whole those pinned, then those your
// message matches (the best first), then those edited since going whole, which the model would
// otherwise keep as they were; the rest as index lines.
export function memorySiteItems(items: MemoryItem[], host: string | undefined, history: Message[], match?: SiteMatch): ContextItem[] {
  if (!host) return [];
  const sent = sentIn(history);
  const bounds = itemBounds();
  const unsent = (line: string) => !wentIn(sent, line, bounds);
  const mine = items.filter((m) => onDomain(m, host)).sort(latestFirst);
  const cap = limit('siteMemoryItems');
  if (!match) return siteBlock(host, mine.map(memoryLine).filter(unsent).slice(0, cap)); // the rest go with a later message
  const matching = siteMatching(mine, items, host, match);
  const wanted = new Set([...mine.filter((m) => m.pinned), ...matching, ...mine.filter((m) => wentWholeOnce(sent, m.id))]);
  const pending = [...wanted].filter((m) => unsent(memoryLine(m)));
  const whole = pending.slice(0, cap);
  const overflow = pending.slice(cap); // by title for now: whole with a later message
  const lines = whole.map(memoryLine);
  if (overflow.length) lines[lines.length - 1] += cutNote(`Memory for ${host}: ${overflow.length} of ${pending.length} items in the index instead (limit ${limitText('siteMemoryItems')})`);
  const rest = mine.filter((m) => !wanted.has(m) && unsent(memoryLine(m)));
  const byTitle = [...overflow, ...rest].filter((m) => unsent(indexLine(m)));
  return [...siteBlock(host, lines), ...siteIndexBlock(host, byTitle, match)];
}

// Those of the site your message matches, the best first: by its words, or by its meaning.
function siteMatching(mine: MemoryItem[], all: MemoryItem[], host: string, { typed, threshold, meaning }: SiteMatch): MemoryItem[] {
  const byWords = siteMemoryMatches(mine, all, typed, host).filter((r) => r.match * 100 >= threshold).map((r) => r.item);
  if (!meaning) return byWords;
  const scoreOf = (m: MemoryItem) => meaning.scores.get(m.id);
  const close = mine.filter((m) => reachesMeaning(scoreOf(m), meaning.threshold)).sort((a, b) => scoreOf(b)! - scoreOf(a)!);
  const byId = new Map(mine.map((m) => [m.id, m]));
  return fuseRanks([byWords.map((m) => m.id), close.map((m) => m.id)]).map((id) => byId.get(id)!);
}

const siteBlock = (host: string, lines: string[]): ContextItem[] =>
  lines.length ? [{ kind: 'memory', source: MEMORY_SOURCE + host, text: text('memory.site_block', { host: markValue(host), memory_items: lines.join('\n') }) }] : [];

const siteIndexBlock = (host: string, items: MemoryItem[], tools: SiteMatch): ContextItem[] =>
  items.length
    ? [{ kind: 'memory', source: memoryIndexSource(host, items.map((m) => memoryLabel(m))), text: text('memory.site_index_block', { host: markValue(host), memory_items: indexLines(items, `Memory index for ${host}`, tools).join('\n') }) }]
    : [];

// From the items ranked against a text (memoryMatches, withMeaning, as Settings → Memory's playground
// ranks them), those that go on their own (Settings → Memory → Auto-attach): neither pinned nor linked
// to a site, not sent in this conversation yet, the best first, at most `max`.
export function memoryPicks<R extends { item: MemoryItem; match: number; meaning?: number }>(ranked: R[], history: Message[], auto: StepAttach | undefined, meaning?: MeaningMatch): R[] {
  const sent = sentIn(history);
  const bounds = itemBounds();
  return autoPicks(ranked, auto, MEMORY_AUTO_DEFAULTS, (r) => autoAttachable(r.item) && !wentIn(sent, memoryLine(r.item), bounds), (r) => !!meaning && reachesMeaning(r.meaning, meaning.threshold));
}

// Those your message (or a reply of the model's, between its steps: context/step-attach, by its words
// only) matches, in their block; those your message's words would not attach, in one that says so.
export function memoryAutoItems(items: MemoryItem[], typed: string, history: Message[], auto: StepAttach | undefined, origin: AttachOrigin = 'message', meaning?: MeaningMatch): ContextItem[] {
  if (!auto?.enabled || !typed.trim()) return [];
  const byMeaning = origin === 'message' ? meaning : undefined;
  const picked = memoryPicks(withMeaning(memoryMatches(items, typed), items, byMeaning), history, auto, byMeaning);
  const threshold = auto.threshold ?? MEMORY_AUTO_DEFAULTS.threshold;
  const block = (id: 'memory.auto_block' | 'memory.step_block' | 'memory.meaning_block', these: MemoryItem[]): ContextItem[] =>
    these.length ? [{ kind: 'memory', source: memoryMatchSource(origin, these.map((m) => memoryLabel(m))), text: text(id, { memory_items: these.map(memoryLine).join('\n') }) }] : [];
  return [
    ...block(origin === 'step' ? 'memory.step_block' : 'memory.auto_block', picked.filter((r) => r.match * 100 >= threshold).map((r) => r.item)),
    ...block('memory.meaning_block', picked.filter((r) => r.match * 100 < threshold).map((r) => r.item)),
  ];
}

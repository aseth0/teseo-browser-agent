// Which groups of tools reach the model for a message (Settings → Tools → Matching), matched as memory
// is (search/bm25 by words, and by meaning with Memory's Semantic search, tools/match-meaning):
// - 'all' (the default): every tool, as before, and nothing matched;
// - 'recommend': every tool, and the groups the message matches named with it (tools.recommended);
// - 'matching': only the groups it matches; the others go to tools.load (tools/load), whose description
//   lists them, so the model still knows what else there is and loads it when the task needs it. None
//   matching: none of them is offered.
// Only some groups are matched (`filterable`): web, history, bookmarks, the custom tools (each section,
// and those without one) and each MCP server. The others are always offered: the browser's, the ones
// that ask the user, memory, skills, site templates, speech and the agents' (agents.ask, panel.*), as
// the system prompt or the loop rely on them; and so are the page's own (WebMCP), tools.load and
// tools.read_more, the tools that manage custom tools and page actions, a server set "on demand" (it
// has its own line in tools.load) and a tool the message mentions ($tool). A group offered for a
// message (matched, mentioned or loaded) stays offered for the rest of the conversation.
// `ToolMatch` (core/types) is what was decided, kept in the message for the views and the next turns.
import { toolDescription } from '../core/texts/registry';
import { text } from '../core/model-texts';
import { TOOL_MATCH_SOURCE } from '../core/sources';
import { toolGroup, toolGroupLabel } from '../core/tool-groups';
import { toWireName } from '../core/tool-registry';
import type { Message, Tool, ToolMatch } from '../core/types';
import type { ContextItem } from '../core/messages';
import { mcpGroup, mcpServerOf } from '../core/mcp-keys';
import { indexTexts, scored } from '../search/bm25';
import type { Settings } from '../storage/settings-types';
import { loadedGroups, mcpLine, someNames, type OnDemandGroup } from './load';

export type ToolMatchMode = 'all' | 'recommend' | 'matching';
// The match by words the message's best tool needs (the floor), in % of the message's words: lower lets one
// shared word of a message in another language through (measured: "…una nueva Meeting" 30%).
export const TOOL_MATCH_THRESHOLD = 40;
const MODES: ToolMatchMode[] = ['all', 'recommend', 'matching'];

// The mode set (an unknown one, from an imported or newer setting: the default) and the match needed.
export const toolMatchMode = (settings: Pick<Settings, 'tools'>): ToolMatchMode => {
  const mode = settings.tools?.match?.mode;
  return mode && MODES.includes(mode) ? mode : 'all';
};
export const toolMatchThreshold = (settings: Pick<Settings, 'tools'>) => settings.tools?.match?.threshold ?? TOOL_MATCH_THRESHOLD;
// By meaning, a tool matches relative to the others, not by an absolute cosine: each embeddings model has a
// scale of its own, and its scores bunch together (measured: 35 to 67% on one model, other ranges on others).
// For a message, the closest tool must stand out from all of them by MEANING_STAND_OUT spreads (standard
// deviations) above their mean; then a group passes when its closest tool is within a band of spreads of that
// best one: for Only matching, the level's (Offer more, the default, wide: it fails towards offering;
// Hold more, narrow: more held, which the model loads through tools.load when needed); to be recommended,
// MEANING_RECOMMEND_WITHIN. When nothing stands out, Only matching offers its groups and nothing is
// recommended. Measured on a generic catalog: Offer more held the right group 0 of 9 times, Balanced 1,
// Hold more 2, letting in 8, 5 and 3 others.
export const MEANING_STAND_OUT = 2;
export const MEANING_LEVELS = { 'offer-more': 1.5, balanced: 1, 'hold-more': 0.5 } as const;
export type MeaningLevel = keyof typeof MEANING_LEVELS;
export const MEANING_RECOMMEND_WITHIN = 0.5;
export const MEANING_MIN_TOOLS = 5; // fewer indexed tools: no spread to speak of, by words only
// The level set; one stored by a build before these levels (`meaningLevel`) as the nearest: strict, which
// asked for less, as Hold more; broad and moderate as Offer more.
export const toolMeaningLevel = (settings: Pick<Settings, 'tools'>): MeaningLevel => {
  const level = settings.tools?.match?.level;
  if (level && level in MEANING_LEVELS) return level;
  return settings.tools?.match?.meaningLevel === 'strict' ? 'hold-more' : 'offer-more';
};

// The cosine a group's closest tool needs for a message, per mode, from all the tools' scores; none when
// nothing stands out (or too few tools to tell).
export function meaningCuts(scores: number[], level: MeaningLevel): GroupMeaning['cut'] {
  if (scores.length < MEANING_MIN_TOOLS) return undefined;
  const mean = scores.reduce((n, s) => n + s, 0) / scores.length;
  const spread = Math.sqrt(scores.reduce((n, s) => n + (s - mean) ** 2, 0) / scores.length);
  const best = Math.max(...scores);
  if (!spread || (best - mean) / spread < MEANING_STAND_OUT) return undefined;
  return { matching: best - MEANING_LEVELS[level] * spread, recommend: best - MEANING_RECOMMEND_WITHIN * spread };
}

const FILTERABLE = new Set(['web', 'history', 'bookmarks', 'custom']);
export const filterable = (group: string) => FILTERABLE.has(group) || group.startsWith('custom:') || !!mcpServerOf(group);
// Listed under the custom tools, but they manage what you make (custom tools, page actions): not matched.
const manages = (name: string) => name.startsWith('custom_tools.') || name.startsWith('actions.');

type Listed = Pick<Tool, 'name' | 'source' | 'group' | 'description'>;

// A group as it is matched: its tools (dotted names) and, for each, what is compared: the group's
// label and the tool's name (as words: "create_issue" → "create issue") weighing more than its
// description (yours, when you changed one). By words, each tool is matched and the group goes by its
// best one, so a large group gains nothing from its size; by meaning too (tools/tool-index).
export interface MatchGroup {
  id: string;
  label: string;
  tools: string[];
  each: { name: string; words: string; about: string }[]; // in the order of `tools`
  names: string;
  about: string;
}

const shortName = (t: Listed) => {
  const server = mcpServerOf(toolGroup(t));
  return server && t.name.startsWith(`mcp.${server}.`) ? t.name.slice(`mcp.${server}.`.length) : t.name;
};
const asWords = (name: string) => name.replace(/[._-]+/g, ' ');

// The servers on demand (their own line in tools.load), never matched, by their groups ("mcp:<name>").
export const onDemandServers = (settings: Pick<Settings, 'mcpServers'>): Set<string> =>
  new Set((settings.mcpServers ?? []).filter((s) => s.onDemand).map((s) => mcpGroup(s.name)));
// The servers with a choice of their own (Settings → MCP servers), which Settings → Tools → Matching does not decide.
export const ownChoiceServers = (settings: Pick<Settings, 'mcpServers'>): Set<string> =>
  new Set((settings.mcpServers ?? []).filter((s) => !s.onDemand && s.matching).map((s) => mcpGroup(s.name)));

// A group's mode: its server's own choice ('always': all), else Settings → Tools → Matching's.
export function groupModes(settings: Pick<Settings, 'tools' | 'mcpServers'>): (group: string) => ToolMatchMode {
  const global = toolMatchMode(settings);
  const own = new Map((settings.mcpServers ?? []).flatMap((s): [string, ToolMatchMode][] => (!s.onDemand && s.matching && MODES_OF[s.matching] ? [[mcpGroup(s.name), MODES_OF[s.matching]!]] : [])));
  return (group) => own.get(group) ?? global;
}
const MODES_OF: Partial<Record<string, ToolMatchMode>> = { always: 'all', recommend: 'recommend', matching: 'matching' };
// Whether any group is matched: none (the default, and no server with a choice of its own), nothing to do.
export const matchesAny = (settings: Pick<Settings, 'tools' | 'mcpServers'>) =>
  toolMatchMode(settings) !== 'all' || (settings.mcpServers ?? []).some((s) => !s.onDemand && (s.matching === 'recommend' || s.matching === 'matching'));

// What each server is for, in your words (its panel in Settings → MCP servers), by its group.
export const serverAbouts = (settings: Pick<Settings, 'mcpServers'>): Map<string, string> =>
  new Map((settings.mcpServers ?? []).flatMap((s) => (s.about?.trim() ? [[mcpGroup(s.name), s.about.trim()] as [string, string]] : [])));
// The name a group's own description is matched under, as if one of its tools (never offered).
export const aboutName = (group: string) => `${group}#about`;
const isAbout = (name: string) => name.endsWith('#about');

// The groups of `tools` that are matched, but those in `skip` (the groups on demand: tools/load). With
// `every`, all the groups of the tools offered: what a message is matched against, to tell whether it
// points at a tool at all (the browser's too) before a matched group is held for not being that one.
// `about`: a group's own description (serverAbouts), matched along with its tools.
export function matchGroups(tools: Listed[], skip: ReadonlySet<string> = new Set(), { every = false, about }: { every?: boolean; about?: ReadonlyMap<string, string> } = {}): MatchGroup[] {
  const by = new Map<string, Listed[]>();
  for (const t of tools) {
    const id = toolGroup(t);
    if ((!every && (!filterable(id) || manages(t.name))) || skip.has(id)) continue;
    by.set(id, [...(by.get(id) ?? []), t]);
  }
  return [...by].map(([id, list]) => {
    const own = about?.get(id);
    const each = [...list.map((t) => ({ name: t.name, words: asWords(shortName(t)), about: toolDescription(t.name, t.description) })), ...(own ? [{ name: aboutName(id), words: '', about: own }] : [])];
    return { id, label: toolGroupLabel(id), tools: list.map((t) => t.name), each, names: each.map((t) => t.words).join('\n'), about: each.map((t) => t.about).join('\n') };
  });
}

// How much a word of the message that no tool has counts against a match: half a word only one tool has.
// One shared word ("meeting") in a message of words no tool knows (one in another language) is then no
// full match.
export const UNSEEN_WEIGHT = 0.5;

// How close in meaning each group is to the message (tools/match-meaning): cosine by group id (its
// closest tool's), by tool name, and the cosine a group needs per mode (meaningCuts); `cut` none: nothing
// stood out, or too few tools.
export interface GroupMeaning {
  scores: Map<string, number>;
  tools?: Map<string, number>;
  cut?: { matching: number; recommend: number };
}

// Each group's match (0 to 1) by words, its best tool's (the group's name counting too: "planner" in a
// message is about that server); its tools that match by their own words, best first (without the group's
// name, which every one of them has: it would match them all alike); and its match by meaning when given.
export function scoreGroups(text: string, groups: MatchGroup[], meaning?: GroupMeaning): { group: MatchGroup; match: number; tools: string[]; meaning?: number }[] {
  const typed = withoutCommon(text);
  const docs = groups.flatMap((g) => g.each.map((t) => indexTexts({ group: g.id, tool: t.name }, [[g.label, 2], [t.words, 2], [t.about, 1]])));
  const hits = scored(typed, docs, { unseen: UNSEEN_WEIGHT });
  const ownDocs = groups.flatMap((g) => g.each.map((t) => indexTexts({ group: g.id, tool: t.name }, [[withoutGroupName(g, t.words), 2], [t.about, 1]])));
  const ownHits = scored(typed, ownDocs, { unseen: UNSEEN_WEIGHT }).sort((a, b) => b.match - a.match);
  return groups.map((group) => {
    const best = Math.max(0, ...hits.filter((h) => h.item.group === group.id).map((h) => h.match));
    return { group, match: best, tools: ownHits.filter((h) => h.item.group === group.id && !isAbout(h.item.tool)).map((h) => h.item.tool), ...(meaning?.scores.has(group.id) && { meaning: meaning.scores.get(group.id) }) };
  });
}

// Words of a message that say nothing of a tool, left out before it is matched by words (on top of search's
// own stop words): a greeting or "is there…" would else match a tool that says "there" in its description,
// and stand out. Only here: memory and saved conversations match as they did.
const COMMON = new Set(
  ('there here hello hi hey please thanks thank can could would should do does did how me my our we they them ' +
    'their its about just also some any all much many very now then than these those want need like ok okay yes no ' +
    'hola gracias favor puedes podrías quiero necesito tengo tienes hay mí nos les eso esto ese esa aquí ahora muy más bien sí vale').split(' '),
);
const withoutCommon = (text: string) => text.replace(/[\p{L}\p{N}]+/gu, (w) => (COMMON.has(w.toLowerCase()) ? ' ' : w));

// A tool's name as words without its server's name, which many servers put first ("tasks add tasks").
export const withoutGroupName = (g: Pick<MatchGroup, 'id'>, words: string) => {
  const server = mcpServerOf(g.id);
  const name = server && asWords(server);
  return name && words.toLowerCase().startsWith(`${name.toLowerCase()} `) ? words.slice(name.length + 1) : words;
};

// A group's tools that match, best first: by meaning when it is known (the closest first, those that reach
// the meaning needed or match by their own words), else by their own words. What the recommendation names
// first, and what the views highlight.
export function matchingTools(r: { group: MatchGroup; tools: string[] }, meaning?: GroupMeaning): string[] {
  const by = meaning?.tools;
  if (!meaning || !by?.size) return r.tools;
  const order = (a: string, b: string) => (by.get(b) ?? -1) - (by.get(a) ?? -1) || r.tools.indexOf(a) - r.tools.indexOf(b);
  // Nothing stood out: the closest few, as the best guess.
  if (!meaning.cut) return [...r.group.tools].sort(order).slice(0, Math.max(3, r.tools.length));
  const cut = meaning.cut.matching;
  return r.group.tools.filter((t) => r.tools.includes(t) || (by.get(t) ?? -1) >= cut).sort(order);
}

// What stays offered for the rest of a conversation, once a group got it for a message: it matched, was
// loaded, mentioned or used, or stayed so. Not a group offered only because nothing stood out ('unsure'):
// after a greeting, every group would stay offered for good.
const stickyOutcomes = new Set<ToolMatch['groups'][number]['outcome']>(['matched', 'used', 'earlier', 'loaded', 'mentioned']);
const offeredBefore = (history: Message[]) =>
  new Set(history.slice(0, -1).flatMap((m) => (m.toolMatch?.groups ?? []).filter((g) => stickyOutcomes.has(g.outcome)).map((g) => g.id)));
// The groups whose tools were called in the conversation (by their names as the model calls them): a short
// follow-up ("and at 11, then") keeps what the task is using, and the tool list stays as it was.
export function usedGroups(history: Message[], groups: Pick<MatchGroup, 'id' | 'tools'>[]): Set<string> {
  const called = new Set(history.flatMap((m) => m.parts.flatMap((p) => (p.type === 'tool_call' ? [toWireName(p.name)] : []))));
  return new Set(groups.filter((g) => g.tools.some((t) => called.has(toWireName(t)))).map((g) => g.id));
}

// By words, a group passes relative to the best tool of the message too, above the match needed (the
// floor): within half of the best for Only matching, within 85% of it to be recommended. Below the floor
// nothing stands out by words: in another language than the tools' descriptions, nothing does.
export const WORDS_WITHIN = { matching: 0.5, recommend: 0.85 } as const;
export function wordCuts(best: number, floor: number): { matching: number; recommend: number } | undefined {
  if (pct(best) < floor) return undefined;
  return { matching: Math.max(floor / 100, best * WORDS_WITHIN.matching), recommend: Math.max(floor / 100, best * WORDS_WITHIN.recommend) };
}

export interface MatchInput {
  mode: ToolMatchMode; // Settings → Tools → Matching's, for the record
  modeOf?: (group: string) => ToolMatchMode; // each group's (groupModes); none: `mode`. Groups with 'all' are not given
  threshold: number;
  typed: string; // what the user wrote (not what goes with it)
  groups: MatchGroup[];
  always: string[]; // the groups offered that are never matched
  history: Message[]; // ending with the user's message
  mentioned: string[]; // the tools it mentions ($tool)
  meaning?: GroupMeaning;
  byWords?: boolean; // meaning was asked for and did not come
  reference?: MatchGroup[]; // every group offered, the message's best is looked for among them (none: `groups`)
}

const pct = (v: number) => Math.round(v * 100);

export function decideToolMatch({ mode, modeOf = () => mode, threshold, typed, groups, always, history, mentioned, meaning, byWords, reference = groups }: MatchInput): ToolMatch {
  const before = offeredBefore(history);
  const loaded = loadedGroups(history);
  const used = usedGroups(history, groups);
  const ids = new Set(groups.map((g) => g.id));
  const all = scoreGroups(typed, [...reference.filter((g) => !ids.has(g.id)), ...groups], meaning);
  const words = wordCuts(Math.max(0, ...all.map((r) => r.match)), threshold);
  // Neither the words nor the meaning point at any tool: Only matching offers rather than holds (a model not
  // offered the right tool does the task with another), and nothing is recommended.
  const unsure = !words && !meaning?.cut;
  const scoredGroups = all
    .filter((r) => ids.has(r.group.id))
    .map((r) => {
      const own: 'recommend' | 'matching' = modeOf(r.group.id) === 'recommend' ? 'recommend' : 'matching';
      const passes = (!!words && r.match >= words[own]) || (r.meaning !== undefined && !!meaning?.cut && r.meaning >= meaning.cut[own]);
      const outcome: ToolMatch['groups'][number]['outcome'] =
        passes ? 'matched'
        : own === 'recommend' ? 'unmatched'
        : r.group.tools.some((t) => mentioned.includes(t)) ? 'mentioned'
        : used.has(r.group.id) ? 'used'
        : before.has(r.group.id) ? 'earlier'
        : loaded.has(r.group.id) ? 'loaded'
        : unsure ? 'unsure'
        : 'held';
      const tools = matchingTools(r, meaning);
      return { id: r.group.id, label: r.group.label, mode: own, match: pct(r.match), ...(r.meaning !== undefined && { meaning: pct(r.meaning) }), ...(tools.length && { tools }), outcome };
    })
    .sort((a, b) => b.match - a.match || (b.meaning ?? 0) - (a.meaning ?? 0));
  const cut = meaning?.cut;
  return {
    mode, threshold, groups: scoredGroups, always,
    ...(byWords && { byWords: true }),
    ...(!meaning && { wordsOnly: true }),
    ...(words && { wordsNeeded: { matching: pct(words.matching), recommend: pct(words.recommend) } }),
    ...(cut && { meaningNeeded: { matching: pct(cut.matching), recommend: pct(cut.recommend) } }),
    ...(unsure && { unsure: true }),
  };
}

// The groups offered that are never matched, for the record.
export const alwaysGroups = (tools: Pick<Tool, 'source' | 'group'>[], matched: MatchGroup[]) => {
  const ids = new Set(matched.map((g) => g.id));
  return [...new Set(tools.map(toolGroup))].filter((id) => !ids.has(id));
};

const namesOf = (g: MatchGroup) => someNames(g.tools.map(toWireName));
// A recommended group's tools: those the message matches, best first, then the others; as declared when
// it passed by meaning only.
const recommendedNames = (g: MatchGroup, matched: string[] = []) => someNames([...matched, ...g.tools.filter((t) => !matched.includes(t))].map(toWireName));

// Recommended: the groups the message matched, named with it.
export function recommendationItem(match: ToolMatch, groups: MatchGroup[]): ContextItem | undefined {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const matched = match.groups.filter((g) => (g.mode ?? match.mode) === 'recommend' && g.outcome === 'matched' && byId.has(g.id));
  if (!matched.length) return undefined;
  const lines = matched.map((m) => text('tools.recommended_group', { label: m.label, tools: recommendedNames(byId.get(m.id)!, m.tools) })).join('\n');
  return { kind: 'tool', source: TOOL_MATCH_SOURCE + JSON.stringify(matched.map((g) => g.label)), text: text('tools.recommended', { groups: lines }) };
}

// Only matching: the groups held back, as groups on demand (tools/load withOnDemand): each a line in
// tools.load's description, offered once the model loads it.
export function heldGroups(match: ToolMatch | undefined, groups: MatchGroup[]): OnDemandGroup[] {
  if (!match) return [];
  const held = new Set(match.groups.filter((g) => g.outcome === 'held').map((g) => g.id));
  return groups
    .filter((g) => held.has(g.id))
    .map((g) => {
      const server = mcpServerOf(g.id);
      return { id: g.id, tools: g.tools, what: () => (server ? mcpLine(server, g.tools) : text('tools.load_builtin', { label: g.label, tools: namesOf(g) })) };
    });
}

// What you wrote in a message (not what goes with it).
export const typedIn = (m: Message | undefined) => (m?.parts ?? []).map((p) => (p.type === 'text' && !p.context ? p.text : '')).join('\n');

// The groups held back for the last of your messages, as it was decided (Message.toolMatch): for the
// previews, which build the request as the run did.
export function heldFor(history: Message[], tools: Listed[], onDemand: { id: string }[]): OnDemandGroup[] {
  const last = history.findLast((m) => m.role === 'user');
  return heldGroups(last?.toolMatch, matchGroups(tools, new Set(onDemand.map((g) => g.id))));
}

// A turn's tool matching (Settings → Tools → Matching, tools/match), for the chat's agent: the groups
// the message matches by words, and by meaning when Memory's Semantic search is on and the conversation
// did not leave it out; what was decided (kept in the message), the recommendation that goes with it
// (Recommended) and the groups held for tools.load (Only matching). Nothing with the default, 'all'.
import type { ContextItem } from '../core/messages';
import type { Message, Tool, ToolMatch } from '../core/types';
import type { Settings } from '../storage/settings-types';
import type { OnDemandGroup } from './load';
import { type MatchGroup, serverAbouts, alwaysGroups, decideToolMatch, groupModes, heldGroups, matchesAny, matchGroups, onDemandServers, recommendationItem, toolMatchMode, toolMatchThreshold, typedIn } from './match';
import { toolMeaning } from './match-meaning';

export interface TurnToolMatch {
  match?: ToolMatch;
  item?: ContextItem;
  held: OnDemandGroup[];
  failed?: boolean; // meaning was asked for and did not come: the message went by words
  toIndex?: MatchGroup[]; // meaning was on and some of their tools are not indexed yet (tools/tool-index indexToolsLater)
}

export async function turnToolMatch(input: {
  settings: Settings;
  tools: Pick<Tool, 'name' | 'source' | 'group' | 'description'>[]; // those offered to the agent
  history: Message[]; // ending with your message
  mentioned: string[];
  onDemand: { id: string }[]; // the groups already on demand (tools/load): left as they are
  meaningOn: () => Promise<boolean>; // asked only when a mode matches
  turn?: object; // the run's object for this turn (memory/query-meaning embedQuery)
}): Promise<TurnToolMatch> {
  if (!matchesAny(input.settings)) return { held: [] };
  // Not the groups already on demand, nor those whose mode is All tools (the setting's, or a server's own
  // "Always offered").
  const modeOf = groupModes(input.settings);
  const skip = new Set([...input.onDemand.map((g) => g.id), ...onDemandServers(input.settings)]);
  const about = serverAbouts(input.settings);
  const groups = matchGroups(input.tools, skip, { about }).filter((g) => modeOf(g.id) !== 'all');
  if (!groups.length) return { held: [] };
  // What the message is matched against: every tool offered, so that a group is held only when the message
  // points at another tool, never because it is the only one matched.
  const reference = matchGroups(input.tools, skip, { every: true, about });
  const typed = typedIn(input.history.at(-1));
  const { meaning, failed, unindexed } = (await input.meaningOn()) ? await toolMeaning(input.settings, typed, reference, input.turn) : {};
  const match = decideToolMatch({
    mode: toolMatchMode(input.settings),
    modeOf,
    threshold: toolMatchThreshold(input.settings),
    typed,
    groups,
    always: alwaysGroups(input.tools, groups),
    history: input.history,
    mentioned: input.mentioned,
    meaning,
    byWords: failed,
    reference,
  });
  return { match, item: recommendationItem(match, groups), held: heldGroups(match, groups), ...(failed && { failed }), ...(unindexed ? { toIndex: reference } : {}) };
}

// What the turn's phase says of it (background/agent-run, "Matching the tools"): how many groups were
// recommended or offered and how many held, and when meaning did not come.
export function toolMatchNote(r: TurnToolMatch): string | undefined {
  const groups = r.match?.groups ?? [];
  if (!groups.length) return 'nothing to match';
  const count = (o: string[]) => groups.filter((g) => o.includes(g.outcome)).length;
  const recommended = groups.filter((g) => g.mode === 'recommend' && g.outcome === 'matched').length;
  const offered = groups.filter((g) => g.mode !== 'recommend' && ['matched', 'unsure', 'used', 'earlier', 'loaded', 'mentioned'].includes(g.outcome)).length;
  const parts = [recommended && `${recommended} recommended`, offered && `${offered} offered`, `${count(['held'])} held`].filter(Boolean);
  return parts.join(', ') + (r.failed ? ' · by words only' : '');
}

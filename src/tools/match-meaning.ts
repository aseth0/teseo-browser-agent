// How close in meaning each tool, and so each group, is to a message (Settings → Tools → Matching), with
// Memory's Semantic search (its provider, model and prefixes; memory/semantic): the message's vector, the
// same one memory asks for in the turn (memory/query-meaning embedQuery), against the tools' vectors the
// indexer keeps (tools/tool-index), never asked for here. A group goes by its closest tool, judged against
// all the tools' scores for this message (tools/match meaningCuts). A tool not
// indexed yet goes by words only. All of it within the query's 2 seconds, the vectors database too: a
// failure is never the message's: it goes by words, and the user gets a notice.
import { stripMarks } from '../core/model-texts';
import { QUERY_TIMEOUT_MS, embedQuery } from '../memory/query-meaning';
import { cosine, semanticTarget } from '../memory/semantic';
import { hasAccess } from '../page/access';
import type { Settings } from '../storage/settings-types';
import { loadBlacklist } from '../word-blacklist/store';
import { meaningCuts, toolMeaningLevel, type GroupMeaning, type MatchGroup } from './match';
import { freshVectors, toolDocs } from './tool-index';

const DEADLINE_SLACK_MS = 200; // past the request's own timeout, which says why it failed first
type Meaning = { meaning?: GroupMeaning; failed?: boolean; unindexed?: number };

// `turn`: the run's object for this turn, so the message's vector is asked once (embedQuery).
export function toolMeaning(settings: Settings, typed: string, groups: MatchGroup[], turn?: object): Promise<Meaning> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Meaning>((resolve) => (timer = setTimeout(() => resolve({ failed: true }), QUERY_TIMEOUT_MS + DEADLINE_SLACK_MS)));
  return Promise.race([groupMeaning(settings, typed, groups, turn), late]).finally(() => clearTimeout(timer));
}

async function groupMeaning(settings: Settings, typed: string, groups: MatchGroup[], turn?: object): Promise<Meaning> {
  const target = semanticTarget(settings);
  if (!target || !typed.trim() || !groups.length) return {};
  try {
    const docs = await toolDocs(groups, target);
    const fresh = await freshVectors(docs, target);
    const unindexed = docs.length - fresh.size;
    if (!fresh.size) return { unindexed }; // nothing to compare yet: by words, and nothing sent
    if (!(await hasAccess(target.provider.baseURL))) return { failed: true, unindexed }; // never asked for here: Memory's Test does
    const mask = (await loadBlacklist())?.blacklist.mask ?? ((s: string) => s);
    const query = await embedQuery(target.provider, target.model, (target.semantic.queryPrefix ?? '') + mask(stripMarks(typed)), turn);
    const tools = new Map([...fresh].filter(([, r]) => r.vector.length === query.length).map(([name, r]) => [name, Math.max(0, cosine(query, r.vector))]));
    if (!tools.size) return { failed: true, unindexed };
    const scores = new Map(groups.flatMap((g): [string, number][] => {
      const best = Math.max(...g.each.map((t) => tools.get(t.name) ?? -1)); // its own description too
      return best >= 0 ? [[g.id, best]] : [];
    }));
    const cut = meaningCuts([...tools.values()], toolMeaningLevel(settings));
    return { meaning: { scores, tools, ...(cut && { cut }) }, unindexed };
  } catch {
    return { failed: true };
  }
}

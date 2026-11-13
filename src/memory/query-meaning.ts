// How close in meaning each memory item is to a text (Settings → Memory → Semantic search): the text's
// vector from the provider against those stored (memory/indexer). Worked out before the message's context,
// which is synchronous (context/site-context). A failure is never the message's: it says so, the message
// goes by words only, and the user gets a notice. Nothing is sent unless there is something to compare.
import type { AutoInjectKind } from '../context/auto-inject';
import { stripMarks } from '../core/model-texts';
import { hasAccess } from '../page/access';
import { embedTexts } from '../providers/embeddings';
import type { Settings } from '../storage/settings-types';
import { loadBlacklist } from '../word-blacklist/store';
import { autoAttachable, type MeaningMatch } from './items';
import { cosine, documentText, endpointHash, indexable, isFresh, semanticTarget, textHash } from './semantic';
import { onDomain, type MemoryItem } from './store';
import { readVectors } from './vector-db';

export const QUERY_TIMEOUT_MS = 2000; // a message waits at most this long
export const MEANING_FAILED_NOTICE = 'Matched by words only: the embeddings provider did not answer.';

// The items of this message that could pass by meaning: with none, nothing is asked for.
export function meaningCandidates(items: MemoryItem[], host: string | undefined, on: (kind: AutoInjectKind) => boolean, reads: boolean): MemoryItem[] {
  const auto = on('memoryAuto');
  const site = !!host && reads && on('memory') && on('memorySiteMatch');
  return items.filter((m) => indexable(m) && ((auto && autoAttachable(m)) || (site && onDomain(m, host))));
}

export async function queryMeaning(settings: Settings, text: string, candidates: MemoryItem[]): Promise<{ meaning?: MeaningMatch; failed?: boolean }> {
  const target = semanticTarget(settings);
  if (!target || !text.trim() || !candidates.length) return {};
  const { provider, model, threshold, semantic } = target;
  try {
    if (!(await hasAccess(provider.baseURL))) return { failed: true }; // never asked for here: Test does
    const mask = (await loadBlacklist())?.blacklist.mask ?? ((s: string) => s);
    const stored = new Map((await readVectors()).map((r) => [r.itemId, r]));
    const endpoint = await endpointHash(provider.baseURL);
    // Whatever their length: the query's vector says which can be compared (the indexer keeps them to the
    // length the model gives, which may not be the one Test found).
    const usable = await Promise.all(
      candidates.map(async (m) => {
        const r = stored.get(m.id);
        return r && isFresh(r, { providerId: provider.id, model, endpoint }, await textHash(documentText(m, semantic.documentPrefix, mask))) ? r : undefined;
      }),
    );
    const records = usable.filter((r) => !!r);
    if (!records.length) return {};
    const input = (semantic.queryPrefix ?? '') + mask(stripMarks(text));
    const [vector] = await embedTexts(provider, model, [input], AbortSignal.timeout(QUERY_TIMEOUT_MS));
    // Of other dimensions, as if not indexed: scoring them would only say 0.
    const comparable = records.filter((r) => r.vector.length === vector!.length);
    if (!comparable.length) return { failed: true };
    return { meaning: { threshold, scores: new Map(comparable.map((r) => [r.itemId, Math.max(0, cosine(vector!, r.vector))])) } };
  } catch {
    return { failed: true };
  }
}

// How close in meaning the items are to a text tried outside a chat (the playground, the previews):
// remembered by text, so moving a slider or typing a word back asks the provider nothing, and asked for
// only once the typing stops.
import { useEffect, useMemo, useState } from 'react';
import type { MeaningMatch } from '../memory/items';
import { queryMeaning } from '../memory/query-meaning';
import { indexable, semanticTarget } from '../memory/semantic';
import type { MemoryItem } from '../memory/store';
import type { Settings } from '../storage/settings';

const PREVIEW_DELAY_MS = 600;
const REMEMBERED = 50;
const remembered = new Map<string, MeaningMatch>();

// What the answer depends on: the model, the text, the items as they are. Not the threshold, applied as
// it is now.
function keyOf(settings: Settings, text: string, candidates: MemoryItem[]): string | undefined {
  const target = semanticTarget(settings);
  return target && JSON.stringify([target.provider.id, target.model, target.semantic.queryPrefix, target.semantic.documentPrefix, text, candidates.map((m) => [m.id, m.updatedAt])]);
}
const withThreshold = (m: MeaningMatch | undefined, settings: Settings): MeaningMatch | undefined => {
  const target = semanticTarget(settings);
  return m && target && { ...m, threshold: target.threshold };
};

export const rememberedMeaning = (settings: Settings, text: string, candidates: MemoryItem[]): MeaningMatch | undefined => {
  const key = keyOf(settings, text, candidates);
  return key ? withThreshold(remembered.get(key), settings) : undefined;
};

export async function previewMeaning(settings: Settings, text: string, candidates: MemoryItem[]): Promise<{ meaning?: MeaningMatch; failed?: boolean }> {
  const known = rememberedMeaning(settings, text, candidates);
  if (known) return { meaning: known };
  const result = await queryMeaning(settings, text, candidates);
  const key = keyOf(settings, text, candidates);
  // Whole answers only: a partial one, with items still being indexed, would stay until the page reloads.
  if (key && result.meaning?.scores.size === candidates.length) {
    if (remembered.size >= REMEMBERED) remembered.delete(remembered.keys().next().value!);
    remembered.set(key, result.meaning);
  }
  return result;
}

// For the previews: the meaning of each text, once it is known. A failure leaves them by words only, as
// the chat would go.
export function usePreviewMeaning(settings: Settings, texts: string[], items: MemoryItem[]): ReadonlyMap<string, MeaningMatch> {
  const candidates = items.filter(indexable);
  const key = JSON.stringify(texts.map((t) => keyOf(settings, t, candidates)));
  const [found, setFound] = useState<{ key: string; meaning: Map<string, MeaningMatch> }>();
  useEffect(() => {
    if (!semanticTarget(settings)) return;
    let current = true;
    const timer = setTimeout(() => {
      void Promise.all(texts.map(async (t) => [t, (await previewMeaning(settings, t, candidates)).meaning] as const)).then((all) => {
        if (current) setFound({ key, meaning: new Map(all.flatMap(([t, m]) => (m ? [[t, m]] : []))) });
      });
    }, PREVIEW_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` says everything these depend on
  }, [key]);
  const threshold = semanticTarget(settings)?.threshold;
  // The same map while nothing changed: the previews build their conversation from it, in a memo.
  return useMemo(() => new Map(found?.key === key && threshold !== undefined ? [...found.meaning].map(([t, m]) => [t, { ...m, threshold }]) : []), [found, key, threshold]);
}

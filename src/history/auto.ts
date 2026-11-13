// Saved conversations attached to your message on their own (Settings → History → Auto-attach): the
// ones your message matches well enough (search/bm25), the pinned ones by default, each once per
// chat, and not those you already mention with #.
import { attachedParts, type ContextItem } from '../core/messages';
import { text } from '../core/model-texts';
import { historyAutoOf, historyAutoSource, slugOf } from '../core/sources';
import type { AutoAttachCheck, Message } from '../core/types';
import { autoPicks } from '../storage/auto-picks';
import { MATCH_THRESHOLD, type AttachDefaults, type AutoAttach } from '../storage/settings-types';
import { historySlugs } from './mention';
import { readBlock } from './read';
import { rankSaved, wholeOf } from './search';
import type { ConversationMeta } from './store';

export const AUTO_DEFAULTS = { threshold: MATCH_THRESHOLD, max: 1, most: 3, scope: 'all' } as const satisfies AttachDefaults & { scope: 'all' };

// The conversations attached on their own earlier in this chat.
const attachedBefore = (history: Message[]) => new Set(attachedParts(history).map((p) => historyAutoOf(p.source)?.id ?? '').filter(Boolean));

// From the conversations ranked against a text (history/rank, how rare a word is from every saved
// one, as Settings → History's playground ranks them), those that go on their own, and the best
// candidate even under the match needed (for the views).
export function historyPicks<C extends ConversationMeta>(
  ranked: { conv: C; match: number }[],
  typed: string,
  history: Message[],
  settings: AutoAttach,
): { picks: { conv: C; match: number }[]; check: AutoAttachCheck } {
  const threshold = settings.threshold ?? AUTO_DEFAULTS.threshold;
  const scope = settings.scope ?? AUTO_DEFAULTS.scope;
  const skip = attachedBefore(history);
  const mentioned = new Set(historySlugs(typed));
  const candidates = ranked.filter(({ conv: c }) => (scope === 'all' || c.pinned) && !skip.has(c.id) && !mentioned.has(slugOf(c.title)));
  const best = candidates[0] && { title: candidates[0].conv.title, match: Math.round(candidates[0].match * 100) };
  const picks = autoPicks(candidates, settings, AUTO_DEFAULTS);
  return { picks, check: { threshold, scope, ...(best && { best }) } };
}

export async function autoAttachItems(
  typed: string,
  history: Message[],
  settings: AutoAttach,
  currentId?: string,
): Promise<{ items: ContextItem[]; check?: AutoAttachCheck }> {
  if (!settings.enabled || !typed.trim()) return { items: [] };
  const { ranked, loaded } = await rankSaved(typed, { except: currentId });
  const { picks, check } = historyPicks(ranked.map(({ meta, match }) => ({ conv: meta, match })), typed, history, settings);
  const whole = await wholeOf(picks.map((p) => p.conv.id), loaded); // only those that go are read whole
  const items = picks.flatMap(({ conv: { id }, match }) => {
    const conv = whole.get(id);
    if (!conv) return []; // deleted since
    const pct = Math.round(match * 100);
    return [{
      kind: 'page' as const,
      source: historyAutoSource(conv.id, pct, conv.title),
      text: `${text('history.auto_note', { score: String(pct) })}\n${readBlock(conv, false, true)}`,
    }];
  });
  return { items, check };
}

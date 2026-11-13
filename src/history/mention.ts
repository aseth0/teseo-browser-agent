// "#find-the-cheapest-cable" in a message attaches that saved conversation (its title as a slug;
// the latest one when several share it). Only slugs of saved conversations count: "#1" or a hashtag
// stays plain text.
import type { ContextItem } from '../core/messages';
import { historyMentionSource, slugsAfter } from '../core/sources';
import { text } from '../core/model-texts';
import { isoDate } from '../core/util';
import { conversationBySlug, readBlock } from './read';
import { loadConversation } from './store';

export const historySlugs = (typed: string) => slugsAfter('#', typed);

export async function historyMentionItems(typed: string, currentId?: string): Promise<ContextItem[]> {
  const items: ContextItem[] = [];
  for (const slug of historySlugs(typed)) {
    const meta = await conversationBySlug(slug, currentId);
    const conv = meta && (await loadConversation(meta.id));
    if (!conv) continue;
    const note = text('history.mention_note', { title: conv.title, date: isoDate(conv.createdAt) });
    items.push({ kind: 'page', source: historyMentionSource(slug, conv.title), text: `${note}\n${readBlock(conv, false, true)}` });
  }
  return items;
}

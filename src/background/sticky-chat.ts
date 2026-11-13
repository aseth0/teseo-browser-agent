// The conversation pinned on the floating chat's bar (widget/protocol STICKY_CHAT): written here only,
// from the pin of the chat floating on a tab, and removed once that conversation is deleted.
import { browser } from 'wxt/browser';
import { loadConversation } from '../history/store';
import { storageGet } from '../storage/area';
import { FLOATING_PREFIX, STICKY_CHAT, isStickyChat, type FloatingChat, type StickyChat } from '../widget/protocol';

// The pin on the floating chat's bar (WIDGET_STICKY). On: the conversation the chat floating on that
// tab shows becomes the pinned one, once saved in the history (a temporary one, or one not said yet,
// is not: the other tabs could not open it). Off: none is. Whether one is pinned now.
// Never from an incognito tab: its floating chat does not follow the pin.
export async function pinFloating(tab: { id: number; incognito?: boolean }, on: boolean): Promise<boolean> {
  const tabId = tab.id;
  if (tab.incognito) return false;
  if (!on) {
    await browser.storage.session.remove(STICKY_CHAT);
    return false;
  }
  const id = (await storageGet<FloatingChat>('session', FLOATING_PREFIX + tabId))?.conversationId;
  if (!id || !(await loadConversation(id))) return isStickyChat(await storageGet<unknown>('session', STICKY_CHAT));
  await browser.storage.session.set({ [STICKY_CHAT]: { conversationId: id } satisfies StickyChat });
  return true;
}
// Those conversations no longer pinned (deleted from the history, moved to the side panel): unpinned
// if one of them is the one pinned now, each tab back to its own; a newer pin stays.
export const unpinIf = (ids: string[]) =>
  storageGet<unknown>('session', STICKY_CHAT).then((sticky) => (isStickyChat(sticky) && ids.includes(sticky.conversationId) ? browser.storage.session.remove(STICKY_CHAT) : undefined));

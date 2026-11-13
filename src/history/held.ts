// The conversations open in a chat now (the side panel, the chat floating on a page, the chat in a tab,
// each chat of the Agents Panel): each chat holds a Web Lock named for the conversation it shows, which
// the browser lets go when the chat moves on or its page closes (also when it crashes). Another chat
// does not open one held: both would save it, and the last save would drop the other's turns. The one
// exception is the pinned conversation (widget/protocol STICKY_CHAT), shown by the chat floating on
// several tabs at once: those chats save it only over what they have seen (history/store `checked`) and
// run it one at a time (sidepanel/floating), and none of them shows it while any other chat holds it.
// `holder` says where it is open: in the Agents Panel, its row can be shown instead; 'floating': a chat
// floating on a page.
export type Holder = 'manager' | 'chat' | 'floating';

const PREFIX = 'browser-agent:held:';
const HOLDERS: readonly Holder[] = ['manager', 'chat', 'floating']; // when several hold one, the first named

export const heldName = (holder: Holder, conversationId: string) => `${PREFIX}${holder}:${conversationId}`;

// The conversations the locks named hold, and where (Agents Panel first, when both).
export function heldOf(names: readonly (string | undefined)[]): Map<string, Holder> {
  const held = new Map<string, Holder>();
  for (const name of names) {
    if (!name?.startsWith(PREFIX)) continue;
    const rest = name.slice(PREFIX.length);
    const holder = HOLDERS.find((h) => rest.startsWith(`${h}:`));
    const id = holder && rest.slice(holder.length + 1);
    const was = id ? held.get(id) : undefined;
    if (holder && id && (!was || HOLDERS.indexOf(holder) < HOLDERS.indexOf(was))) held.set(id, holder);
  }
  return held;
}

const locks = () => globalThis.navigator?.locks as LockManager | undefined;

// The conversations held now, by every chat of this browser profile (this one's too).
export async function heldConversations(): Promise<Map<string, Holder>> {
  const manager = locks();
  if (!manager) return new Map();
  const { held = [] } = await manager.query();
  return heldOf(held.map((l) => l.name));
}

// Holds it until the returned function is called. Shared: holding never waits, and the same chat
// may hold it twice for a moment (a render that shows it again).
export function holdConversation(holder: Holder, conversationId: string): () => void {
  const manager = locks();
  if (!manager) return () => {};
  let release = () => {};
  const until = new Promise<void>((resolve) => {
    release = resolve;
  });
  manager.request(heldName(holder, conversationId), { mode: 'shared' }, () => until).catch(() => undefined);
  return release;
}

// Opening `id` from a chat that shows `currentId`: refused when another chat holds it.
export const heldElsewhere = (held: ReadonlyMap<string, Holder>, id: string, currentId?: string): Holder | undefined =>
  id === currentId ? undefined : held.get(id);

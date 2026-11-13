// The pinned conversation of the chat floating on pages: which one each tab shows, whether a turn runs
// in another tab, and when the turns run there are shown here.
import { describe, expect, it } from 'vitest';
import { chooseConversation, runningElsewhere, showsSaved, stickyAgentId, type ChoiceSources } from '../src/entrypoints/sidepanel/sticky';
import type { Conversation } from '../src/history/store';
import type { Holder } from '../src/history/held';
import type { AgentProfile } from '../src/agents/profiles';

const conv = (id: string) => ({ id, history: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }], createdAt: 0, updatedAt: 0, title: id }) as unknown as Conversation;
const saved = new Map([['own', conv('own')], ['pinned', conv('pinned')]]);
const sources = (opening = false, held: Record<string, Holder> = {}, shownId?: string): ChoiceSources => ({ load: async (id) => saved.get(id), heldBy: async (id) => held[id], opening, shownId });
const pin = (conversationId: string) => ({ conversationId });

describe('the conversation a floating chat shows', () => {
  it('the pinned one, while one is', async () => {
    expect(await chooseConversation('own', pin('pinned'), sources())).toEqual({ id: 'pinned', conv: saved.get('pinned'), sticky: true });
    expect(await chooseConversation(undefined, pin('pinned'), sources(true))).toMatchObject({ id: 'pinned', sticky: true });
    expect(await chooseConversation('own', pin('pinned'), sources(false, { pinned: 'floating' }))).toMatchObject({ id: 'pinned', sticky: true }); // other tabs show it too
  });
  it("its tab's own when none is pinned, or a new one", async () => {
    expect(await chooseConversation('own', undefined, sources())).toEqual({ id: 'own', conv: saved.get('own'), sticky: false });
    expect(await chooseConversation(undefined, undefined, sources())).toEqual({ sticky: false });
    expect(await chooseConversation('own', { conversationId: '' }, sources())).toMatchObject({ id: 'own', sticky: false }); // not a pin
  });
  it('its own, its first turn not saved yet: opened by its id when the chat opens', async () => {
    expect(await chooseConversation('fresh', undefined, sources(true))).toEqual({ id: 'fresh', conv: undefined, sticky: false });
  });
  it('its own deleted while the chat is open (unpinned meanwhile): a new one, its key forgotten', async () => {
    expect(await chooseConversation('gone', undefined, sources())).toEqual({ sticky: false, dropOwn: true });
  });
  it('its own shown, not saved (a temporary one), when the pin changes elsewhere: kept as it is', async () => {
    expect(await chooseConversation('temp', undefined, sources(false, {}, 'temp'))).toEqual({ id: 'temp', sticky: false });
    expect(await chooseConversation('temp', pin('gone'), sources(false, {}, 'temp'))).toEqual({ id: 'temp', sticky: false, unpin: 'gone' });
  });
  it('a pinned one deleted from the history: unpinned, and its own instead', async () => {
    expect(await chooseConversation('own', pin('gone'), sources())).toEqual({ id: 'own', conv: saved.get('own'), sticky: false, unpin: 'gone' });
    expect(await chooseConversation(undefined, pin('gone'), sources())).toEqual({ sticky: false, unpin: 'gone' });
    // The tab that pinned it: its own was that one, deleted too.
    expect(await chooseConversation('gone', pin('gone'), sources(true))).toEqual({ sticky: false, unpin: 'gone', dropOwn: true });
  });
  it('a pinned one open in a chat not floating on a page (the side panel, the Agents Panel): unpinned', async () => {
    expect(await chooseConversation('own', pin('pinned'), sources(false, { pinned: 'chat' }))).toEqual({ id: 'own', conv: saved.get('own'), sticky: false, unpin: 'pinned' });
    expect(await chooseConversation('own', pin('pinned'), sources(false, { pinned: 'manager' }))).toMatchObject({ sticky: false, unpin: 'pinned' });
  });
});

describe('a turn of the conversation running in another tab', () => {
  it("another chat's: its tab, and this one waits", () => {
    expect(runningElsewhere({ c1: 4 }, 'c1', 7)).toBe(4);
    expect(runningElsewhere({ c1: -1 }, 'c1', 7)).toBe(-1); // a chat with no tab of its own
  });
  it('this chat, another conversation, or none: it does not', () => {
    expect(runningElsewhere({ c1: 7 }, 'c1', 7)).toBeUndefined();
    expect(runningElsewhere({ c2: 4 }, 'c1', 7)).toBeUndefined();
    expect(runningElsewhere(undefined, 'c1', 7)).toBeUndefined();
    expect(runningElsewhere('junk', 'c1', 7)).toBeUndefined();
  });
});

describe('the turns run in another tab, shown on return', () => {
  const chat = { shownId: 'p', stickyId: 'p', hidden: false, idle: true, elsewhere: false, known: 3, saved: { revision: 5 } };
  it('shown when saved by another chat since, its tab shown, between turns, none running elsewhere', () => {
    expect(showsSaved(chat)).toBe(true);
  });
  it('not its own save, nor while hidden, while a turn runs here or elsewhere, nor for one not pinned', () => {
    expect(showsSaved({ ...chat, saved: { revision: 3 } })).toBe(false);
    expect(showsSaved({ ...chat, hidden: true })).toBe(false);
    expect(showsSaved({ ...chat, idle: false })).toBe(false);
    expect(showsSaved({ ...chat, elsewhere: true })).toBe(false);
    expect(showsSaved({ ...chat, stickyId: undefined })).toBe(false);
    expect(showsSaved({ ...chat, shownId: 'other' })).toBe(false);
    expect(showsSaved({ ...chat, saved: undefined })).toBe(false); // deleted: unpinned instead
    expect(showsSaved({ ...chat, known: undefined })).toBe(false);
  });
});

describe('the agent a pinned conversation goes on with', () => {
  const agent = (id: string, sites: string[], enabled = true) => ({ id, name: id, enabled, sites: Object.fromEntries(sites.map((s) => [s, {}])) }) as unknown as AgentProfile;
  const agents = [agent('shop', ['shop.example.com']), agent('off', ['docs.example.com'], false)];
  it("the site's, else the one it last talked to", () => {
    expect(stickyAgentId(agents, 'shop.example.com', 'last')).toBe('shop');
    expect(stickyAgentId(agents, 'news.example.com', 'last')).toBe('last');
    expect(stickyAgentId(agents, 'docs.example.com', undefined)).toBeUndefined(); // switched off
    expect(stickyAgentId(agents, '', 'last')).toBe('last');
  });
});

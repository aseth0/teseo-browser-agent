import { afterEach, describe, expect, it, vi } from 'vitest';
import { heldConversations, heldElsewhere, heldName, heldOf, holdConversation } from '../src/history/held';

// The conversations open in a chat now: Web Locks named for them, taken and let go by each chat.
describe('conversations open in a chat', () => {
  it('reads them from the locks held, Agents Panel first, other locks left out', () => {
    const held = heldOf([heldName('chat', 'a'), heldName('manager', 'b'), heldName('chat', 'b'), heldName('manager', 'c:d'), 'history', undefined, 'browser-agent:held:other:x', 'browser-agent:held:chat:']);
    expect([...held]).toEqual([['a', 'chat'], ['b', 'manager'], ['c:d', 'manager']]);
  });
  it('a chat floating on a page counts after any other chat (the pinned conversation, floating on several tabs)', () => {
    const held = heldOf([heldName('floating', 'p'), heldName('chat', 'p'), heldName('floating', 'p'), heldName('floating', 'q'), heldName('manager', 'q')]);
    expect([...held]).toEqual([['p', 'chat'], ['q', 'manager']]);
    expect([...heldOf([heldName('floating', 'p')])]).toEqual([['p', 'floating']]);
  });
  it('the conversation a chat shows is never held from itself', () => {
    const held = new Map([['a', 'chat' as const]]);
    expect(heldElsewhere(held, 'a', 'a')).toBeUndefined();
    expect(heldElsewhere(held, 'a', 'b')).toBe('chat');
    expect(heldElsewhere(held, 'a')).toBe('chat');
    expect(heldElsewhere(held, 'z', 'b')).toBeUndefined();
  });

  describe('holding one', () => {
    afterEach(() => vi.unstubAllGlobals());
    // Web Locks as the browser keeps them: shared ones never wait; one is let go when its callback's promise settles.
    const fakeLocks = () => {
      const held: { name: string }[] = [];
      return {
        held,
        query: async () => ({ held: [...held] }),
        request: async (name: string, _opts: unknown, cb: () => Promise<void>) => {
          const lock = { name };
          held.push(lock);
          await cb();
          held.splice(held.indexOf(lock), 1);
        },
      };
    };
    it('is held until let go', async () => {
      const locks = fakeLocks();
      vi.stubGlobal('navigator', { locks });
      const release = holdConversation('manager', 'a');
      expect(await heldConversations()).toEqual(new Map([['a', 'manager']]));
      release();
      await Promise.resolve();
      await Promise.resolve();
      expect(await heldConversations()).toEqual(new Map());
    });
    it('without Web Locks, none is held', async () => {
      vi.stubGlobal('navigator', {});
      holdConversation('chat', 'a')();
      expect(await heldConversations()).toEqual(new Map());
    });
  });
});

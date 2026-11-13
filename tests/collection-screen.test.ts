// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { Collection } from '../src/storage/collection';
import { useCollectionScreen } from '../src/ui/useCollectionScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Thing = { id: string; enabled: boolean; name: string };
const stored: Thing[] = [{ id: 'a', enabled: true, name: 'A' }];
const store = { load: async () => stored, onChanged: () => () => undefined } as unknown as Collection<Thing>;
let made = 0;
const fresh = (items: Thing[]): Thing => ({ id: `new-${++made}`, enabled: true, name: `thing ${items.length + 1}` });

let screen!: ReturnType<typeof useCollectionScreen<Thing>>;
const Probe = () => {
  screen = useCollectionScreen(store, { route: 'things', fresh });
  return null;
};
const go = (hash: string) => act(async () => {
  location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
});

describe('useCollectionScreen', () => {
  it('opens the editor of the item the hash names, a new one at /new, and says when there is none', async () => {
    location.hash = 'things';
    await act(async () => createRoot(document.createElement('div')).render(h(Probe)));
    expect(screen).toMatchObject({ items: stored, loaded: true, target: '', editing: undefined, missing: false });

    await act(async () => void screen.open('a'));
    expect(location.hash).toBe('#things/a');
    await go('#things/a');
    expect(screen.editing).toBe(stored[0]);

    await go('#things/new');
    const draft = screen.editing;
    expect(draft).toMatchObject({ id: 'new-1', name: 'thing 2' });
    await go('#things/new');
    expect(screen.editing).toBe(draft); // made once while it stays open

    await go('#things/gone');
    expect(screen).toMatchObject({ target: 'gone', editing: undefined, missing: true });

    await act(async () => void screen.close());
    await go(location.hash);
    expect(location.hash).toBe('#things');
    expect(screen.editing).toBeUndefined();
  });
});

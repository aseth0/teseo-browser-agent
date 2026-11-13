// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { hiddenCount, pruneSelection, selectShown, useSelection } from '../src/ui/collection/selection';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('a selection of items', () => {
  it('drops the ids of items no longer there, the same set when none went', () => {
    expect([...pruneSelection(new Set(['a', 'b']), ['a'])]).toEqual(['a']);
    const same = new Set(['a']);
    expect(pruneSelection(same, ['a', 'b'])).toBe(same);
  });

  it('selects or unselects those shown, keeping the others', () => {
    expect([...selectShown(new Set(['x']), ['a', 'b'], true)].sort()).toEqual(['a', 'b', 'x']);
    expect([...selectShown(new Set(['x', 'a']), ['a', 'b'], false)]).toEqual(['x']);
  });

  it('counts the selected ones the filter hides', () => {
    expect(hiddenCount(new Set(['a', 'x']), ['a', 'b'])).toBe(1);
  });
});

describe('useSelection', () => {
  let host: HTMLDivElement;
  let root: Root;
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  let now: ReturnType<typeof useSelection>;
  const Probe = ({ ids }: { ids: string[] }) => {
    now = useSelection(ids);
    return null;
  };
  const render = (ids: string[]) => act(() => root.render(h(Probe, { ids })));

  it('starts and stops selecting, and forgets an item deleted meanwhile', () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    render(['a', 'b']);
    expect(now.selecting).toBe(false);
    act(() => now.start());
    act(() => now.toggle('a', true));
    act(() => now.setShown(['b'], true));
    expect([...now.selected].sort()).toEqual(['a', 'b']);
    render(['b']); // 'a' deleted in another page
    expect([...now.selected]).toEqual(['b']);
    act(() => now.stop());
    expect([now.selecting, now.selected.size]).toEqual([false, 0]);
  });
});

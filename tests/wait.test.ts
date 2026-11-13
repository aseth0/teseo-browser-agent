// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RefStore } from '../src/content/a11y';
import { waitFor } from '../src/content/wait';

beforeEach(() => {
  document.body.innerHTML = `<main><div id="answer">Hel</div><button id="stop">Stop generating</button></main>`;
});

describe('waitFor', () => {
  it('returns once the element is gone', async () => {
    setTimeout(() => document.getElementById('stop')!.remove(), 100);
    const res = await waitFor(document, new RefStore(), { gone: 'button stop', timeoutMs: 3000 });
    expect(res.done).toBe(true);
    expect(res.met).toEqual([{ kind: 'gone', query: 'button stop' }]);
    expect(res.ms).toBeGreaterThanOrEqual(90);
  });

  it('returns once the element appears', async () => {
    setTimeout(() => document.querySelector('main')!.insertAdjacentHTML('beforeend', '<button>Copy</button>'), 100);
    const res = await waitFor(document, new RefStore(), { appears: 'button copy', timeoutMs: 3000 });
    expect(res.done).toBe(true);
  });

  it('waits for the area to stop changing, and reads it', async () => {
    const answer = document.getElementById('answer')!;
    const growing = setInterval(() => (answer.textContent += 'l'), 50);
    setTimeout(() => clearInterval(growing), 300);
    const res = await waitFor(document, new RefStore(), { root: answer, stableMs: 300, timeoutMs: 3000, returnText: true });
    expect(res.done).toBe(true);
    expect(res.ms).toBeGreaterThanOrEqual(550);
    expect(res.text?.text).toMatch(/^Hel+$/);
  });

  it('does not say gone when the page has more than a search reads', async () => {
    document.body.innerHTML = '<p>line</p>'.repeat(5000) + '<button>Stop generating</button>';
    const res = await waitFor(document, new RefStore(), { gone: 'button stop', timeoutMs: 300 });
    expect(res.done).toBe(false);
    expect(res.pending).toEqual([{ kind: 'gone', query: 'button stop' }]);
  }, 30_000); // 5,000 nodes read in jsdom take seconds on a loaded machine

  it('reads the element it found again, not the whole page, while the page changes', async () => {
    document.body.innerHTML = '<main><div id="answer">Hel</div>' + '<button>Other</button>'.repeat(100) + '<button>Stop generating</button></main>';
    const refs = new RefStore();
    const refFor = vi.spyOn(refs, 'refFor'); // a search names every button on the page
    const answer = document.getElementById('answer')!;
    const growing = setInterval(() => (answer.textContent += 'l'), 50);
    const res = await waitFor(document, refs, { gone: 'button stop', timeoutMs: 1200 });
    clearInterval(growing);
    expect(res.done).toBe(false);
    expect(refFor.mock.calls.length).toBeLessThan(150); // one search (101), then the button alone
  });

  it('is gone once the element found no longer matches, though still on the page', async () => {
    setTimeout(() => (document.getElementById('stop')!.textContent = 'Regenerate'), 100);
    const res = await waitFor(document, new RefStore(), { gone: 'button stop', timeoutMs: 3000 });
    expect(res.done).toBe(true);
  });

  it('says what has not happened when the time is up', async () => {
    const res = await waitFor(document, new RefStore(), { gone: 'button stop', stableMs: 50, timeoutMs: 400 });
    expect(res.done).toBe(false);
    expect(res.pending).toEqual([{ kind: 'gone', query: 'button stop' }]);
    expect(res.met).toEqual([{ kind: 'stable', ms: 50 }]);
  });
});

describe('the conditions, in the model\'s words', async () => {
  const { conditionText } = await import('../src/watches/conditions');
  const { stripMarks } = await import('../src/core/model-texts');
  it('are said by the background, met or not yet', () => {
    const said = (c: Parameters<typeof conditionText>[0], met: boolean) => stripMarks(conditionText(c, met));
    expect([said({ kind: 'gone', query: 'button stop' }, true), said({ kind: 'gone', query: 'button stop' }, false)]).toEqual(['"button stop" is gone', '"button stop" is still there']);
    expect([said({ kind: 'appears', query: 'x' }, true), said({ kind: 'appears', query: 'x' }, false)]).toEqual(['"x" appeared', '"x" has not appeared']);
    expect([said({ kind: 'stable', ms: 50 }, true), said({ kind: 'stable', ms: 50 }, false)]).toEqual(['no change for 50 ms', 'it is still changing']);
  });
});

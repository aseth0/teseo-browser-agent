// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RefStore } from '../src/content/a11y';
import { startWatch, type WatchFired, type WatchSpec } from '../src/content/watch';

beforeEach(() => {
  document.body.innerHTML = `<main><div id="answer">Hel</div><button id="stop">Stop generating</button></main>`;
});

const watch = (spec: WatchSpec) => {
  let stop = () => {};
  const fired = new Promise<WatchFired>((resolve) => (stop = startWatch(document, new RefStore(), spec, resolve)));
  return { fired, stop: () => stop() };
};
const never = (ms: number) => new Promise<'not yet'>((resolve) => setTimeout(() => resolve('not yet'), ms));

describe('startWatch', () => {
  it('fires once the element is gone', async () => {
    setTimeout(() => document.getElementById('stop')!.remove(), 100);
    const res = await watch({ gone: 'button stop' }).fired;
    expect(res.met).toEqual([{ kind: 'gone', query: 'button stop' }]);
    expect(res.ms).toBeGreaterThanOrEqual(90);
  });

  it('fires once the element appears, by CSS selector', async () => {
    setTimeout(() => document.querySelector('main')!.insertAdjacentHTML('beforeend', '<button class="copy">Copy</button>'), 100);
    const res = await watch({ appears: 'button.copy', css: true }).fired;
    expect(res.met).toEqual([{ kind: 'appears', query: 'button.copy' }]);
  });

  it('does not fire while the element is still there', async () => {
    const w = watch({ gone: 'button stop' });
    document.getElementById('answer')!.textContent += 'lo'; // a change, checked
    expect(await Promise.race([w.fired, never(1500)])).toBe('not yet');
    w.stop();
  });

  it('reads the element it found again, not the whole page, and nothing while the page is still', async () => {
    document.body.innerHTML = '<main><div id="answer">Hel</div>' + '<button>Other</button>'.repeat(100) + '<button>Stop generating</button></main>';
    const refs = new RefStore();
    const refFor = vi.spyOn(refs, 'refFor'); // a search names every button on the page
    let stop = () => {};
    const fired = new Promise<WatchFired>((resolve) => (stop = startWatch(document, refs, { gone: 'button stop', stableMs: 100 }, resolve)));
    const answer = document.getElementById('answer')!;
    const growing = setInterval(() => (answer.textContent += 'l'), 200);
    setTimeout(() => clearInterval(growing), 1000);
    expect(await Promise.race([fired, never(3500)])).toBe('not yet');
    stop();
    expect(refFor.mock.calls.length).toBeLessThan(150); // one search (101), then the button alone
  }, 10_000);

  it('fires once the element found appears, and keeps reading it alone', async () => {
    setTimeout(() => document.querySelector('main')!.insertAdjacentHTML('beforeend', '<button>Copy</button>'), 100);
    const res = await watch({ appears: 'button copy' }).fired;
    expect(res.met).toEqual([{ kind: 'appears', query: 'button copy' }]);
  });

  it('does not fire for gone when the page has more than a search reads', async () => {
    document.body.innerHTML = '<p>line</p>'.repeat(5000) + '<button>Stop generating</button>';
    const w = watch({ gone: 'button stop' });
    expect(await Promise.race([w.fired, never(300)])).toBe('not yet');
    w.stop();
  }, 30_000); // 5,000 nodes read in jsdom take seconds on a loaded machine

  it('waits for the page to stop changing too', async () => {
    const answer = document.getElementById('answer')!;
    const growing = setInterval(() => (answer.textContent += 'l'), 50);
    setTimeout(() => {
      clearInterval(growing);
      document.getElementById('stop')!.remove();
    }, 300);
    const res = await watch({ gone: '#stop', css: true, stableMs: 500 }).fired;
    expect(res.met).toEqual([{ kind: 'gone', query: '#stop' }, { kind: 'stable', ms: 500 }]);
    expect(res.ms).toBeGreaterThanOrEqual(750);
  });

  it('stops for good when stopped', async () => {
    const w = watch({ gone: '#stop', css: true });
    w.stop();
    document.getElementById('stop')!.remove();
    expect(await Promise.race([w.fired, never(1300)])).toBe('not yet');
  });
});

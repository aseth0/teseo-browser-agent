// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Recording } from '../src/recording/recording';

// The review: its search box (the user's steps go while a term filters the calls, and stay while one is
// still being typed), another recording waiting meanwhile, and the Make a tool step.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../src/recording/pending-secrets', () => ({ savePendingSecret: vi.fn() }));
vi.mock('../src/recording/block', async (original) => {
  const block = await original<typeof import('../src/recording/block')>();
  return { ...block, recordingPreview: vi.fn(block.recordingPreview) };
});
const { RecordingReview } = await import('../src/entrypoints/sidepanel/RecordingReview');
const { recordingPreview } = await import('../src/recording/block');

const r: Recording = {
  tabId: 1, site: 'shop.example.test', startedAt: 0, endedAt: 1000, hidden: [],
  calls: [{ id: 'a', method: 'GET', url: 'https://shop.example.test/api/orders', at: 1, included: true, status: 200 }],
  steps: [{ at: 2, tabId: 1, kind: 'click', target: 'button "Pay"' }],
};
const none = () => undefined;

async function shown(anotherWaits = false) {
  const root = document.createElement('div');
  await act(async () => createRoot(root).render(createElement(RecordingReview, { recording: r, anotherWaits, onChange: none, onAttach: none, onMakeTool: none, onDiscard: none })));
  return root;
}
async function typed(text: string) {
  const root = await shown();
  const box = root.querySelector<HTMLInputElement>('input[aria-label="Filter calls"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return root.textContent ?? '';
}

describe("the review's search", () => {
  it('a term that filters hides the steps', async () => expect(await typed('method:GET')).not.toContain('Clicked button "Pay"'));
  it('a term still being typed keeps them', async () => {
    expect(await typed('domain:')).toContain('Clicked button "Pay"');
    expect(await typed('larger-than:1.')).toContain('Clicked button "Pay"');
  });
});

describe('another recording, stopped during this review', () => {
  it('says it waits', async () => {
    expect((await shown(true)).textContent).toContain('Another recording waits for review: it opens when you finish this one.');
    expect((await shown()).textContent).not.toContain('Another recording waits');
  });
});

const two: Recording = {
  tabId: 1, site: 'shop.example.test', startedAt: 0, endedAt: 42_000, hidden: [], preset: 'API calls', leftOut: 2,
  calls: [
    { id: 'a', method: 'GET', url: 'https://shop.example.test/api/items?q=tent', at: 1, included: true, status: 200, responseBody: '{"id":4242}' },
    { id: 'b', method: 'GET', url: 'https://shop.example.test/api/account', at: 2, included: false, status: 200, responseBody: '{"email":"ana@example.test"}' },
    { id: 'c', method: 'GET', url: 'https://shop.example.test/api/items/4242', at: 3, included: true, status: 200 },
  ],
};
async function review(rec: Recording, onMakeTool: () => void = none) {
  const root = document.createElement('div');
  await act(async () => createRoot(root).render(createElement(RecordingReview, { recording: rec, onChange: none, onAttach: none, onMakeTool, onDiscard: none })));
  return root;
}
const click = (root: HTMLElement, name: string) => act(async () => [...root.querySelectorAll('button')].find((b) => b.textContent === name || b.ariaLabel === name)!.click());
const summary = (root: HTMLElement, section: string) => root.querySelector(`details[data-section="${section}"] > summary`)?.textContent ?? '';

describe('the review, at a glance', () => {
  it('its head: the site, then calls, time, preset and what it left out', async () => {
    const root = await review(two);
    expect(root.querySelector('.recording-title')?.textContent).toContain('Recording · shop.example.test');
    expect(root.querySelector('.recording-meta')?.textContent).toBe('3 calls · 42 s · API calls · 2 left out');
  });
  it('each section says where it stands', async () => {
    const root = await review(two);
    expect(summary(root, 'calls')).toContain('2 of 3 ticked');
    expect(summary(root, 'privacy')).toContain('1 sensitive call unticked');
    expect(summary(root, 'model')).toMatch(/\d+ of 30k characters/);
  });
  it("the ticked calls carry the model's numbers", async () => {
    const rows = [...(await review(two)).querySelectorAll('.recording-call > summary')].map((s) => s.querySelector('.recording-n')?.textContent ?? '');
    expect(rows).toEqual(['#1', '', '#2']);
  });
  it('the preview is what the model gets, without the call left out', async () => {
    const pre = (await review(two)).querySelector('details[data-section="model"] pre')?.textContent ?? '';
    expect(pre).toContain('#1 GET /api/items?q=tent → 200');
    expect(pre).toContain('#2 GET /api/items/4242 → 200');
    expect(pre).not.toContain('ana@example.test');
  });
  it('the actions: attach first, a tool next, discard apart, and that nothing goes yet', async () => {
    const root = await review(two);
    expect([...root.querySelectorAll('.recording-actions button')].map((b) => b.textContent)).toEqual(['Attach 2 calls', 'Make a tool…', 'Discard']);
    expect(root.querySelector('.recording-actions button.primary')?.textContent).toBe('Attach 2 calls');
    expect(root.textContent).toContain('Nothing is sent until you send your message.');
  });
  it('over the limit, the size says how many calls go without their bodies', async () => {
    const big = 'x'.repeat(29_000);
    const rec = { ...two, calls: two.calls.map((c) => ({ ...c, included: true, responseBody: big })) };
    expect(summary(await review(rec), 'model')).toContain('2 calls without their bodies');
  });
});

describe('the Make a tool step', () => {
  it('Make a tool… opens it: the calls ticked, then the variables by what happens to them', async () => {
    const make = vi.fn();
    const root = await review(two, make);
    expect(root.querySelector('details[data-section="variables"]')).toBeNull(); // not in the review itself
    await click(root, 'Make a tool…');
    expect(make).not.toHaveBeenCalled();
    expect(root.querySelector('.recording-title')?.textContent).toContain('Make a tool · what changes each run');
    expect([...root.querySelectorAll('.recording-call-list li')].map((li) => li.textContent)).toEqual(['#1 GET /api/items?q=tent', '#2 GET /api/items/4242']);
    expect([...root.querySelectorAll('.recording-var-group')].map((g) => g.textContent)).toEqual(["You give it each time · the tool's inputs", 'The tool fills them in']);
    expect(root.textContent).toContain('used in #2 URL');
    expect([...root.querySelectorAll<HTMLOptionElement>('select[aria-label="Kind of itemId"] option')].map((o) => o.textContent)).toEqual(['You give it each time', "From #1's answer", 'Always as recorded']);
  });
  it('its preview has the variables; the review\'s, for Attach, has none', async () => {
    const root = await review(two);
    const pre = () => root.querySelector('details[data-section="model"] pre')?.textContent ?? '';
    expect(pre()).not.toContain('Variables,');
    await click(root, 'Make a tool…');
    expect(pre()).toContain('- itemId = 4242: from the answer of #1 (id)');
  });
  it('Make the tool attaches it; Back goes back to the review', async () => {
    const make = vi.fn();
    const root = await review(two, make);
    await click(root, 'Make a tool…');
    await click(root, 'Back');
    expect(root.querySelector('details[data-section="calls"]')).not.toBeNull();
    await click(root, 'Make a tool…');
    await click(root, 'Make the tool');
    expect(make).toHaveBeenCalledOnce();
  });
  it('without variables, Make a tool… attaches it at once', async () => {
    const make = vi.fn();
    await click(await review(r, make), 'Make a tool…');
    expect(make).toHaveBeenCalledOnce();
  });
});

// The block the model gets is a multi-MB build for a big recording: made again only when the recording
// changes, never for a keystroke in the search.
describe('what the model gets', () => {
  it('is built once per recording, not again for a keystroke in the search', async () => {
    vi.mocked(recordingPreview).mockClear();
    await typed('method:GET');
    expect(recordingPreview).toHaveBeenCalledTimes(1);
  });
  it('follows a tick', async () => {
    const root = document.createElement('div');
    const reactRoot = createRoot(root);
    const render = (rec: Recording) => act(async () => reactRoot.render(createElement(RecordingReview, { recording: rec, onChange: none, onAttach: none, onMakeTool: none, onDiscard: none })));
    const pre = () => root.querySelector('details[data-section="model"] pre')?.textContent ?? '';
    await render(two);
    expect(pre()).not.toContain('ana@example.test');
    await render({ ...two, calls: two.calls.map((c) => ({ ...c, included: true })) });
    expect(pre()).toContain('ana@example.test');
    expect(summary(root, 'calls')).toContain('3 of 3 ticked');
  });
});

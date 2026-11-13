// @vitest-environment jsdom
import { act, createElement, useState, type FunctionComponent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';

// A stopped recording reaches the chat meant to review it: the one floating on its tab, that tab's
// side panel, or the window's; it waits as long as it takes.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
vi.mock('../src/ui/floating-frame', () => ({ FLOATING: false, MANAGER: false, FULL: false, PREVIEW: false, floatingTab: async () => undefined }));
vi.mock('../src/entrypoints/sidepanel/usePageTarget', () => ({ PANEL_TAB: undefined }));
const { handoffStep } = await import('../src/core/handoff');
const { useHandoff } = await import('../src/entrypoints/sidepanel/useHandoff');
const { RECORDING_HANDOFF, RECORDING_WAIT_MS, isRecordingPayload } = await import('../src/recording/recorder-protocol');

const handoff = (extra = {}, at = Date.now()) => ({ at, payload: { kind: 'recording', recording: { tabId: 4, site: 'shop.example.test', startedAt: 0, calls: [], hidden: [] } }, ...extra });
const at = (chat: { tab?: number; panelTab?: number }, taken = 0, now = Date.now()) => ({ tab: chat.tab, panelTab: chat.panelTab, taken, now, waitMs: RECORDING_WAIT_MS });
const recordingStep = (h: unknown, x: ReturnType<typeof at>) => handoffStep(h, isRecordingPayload, x);
const useRecordingHandoff = (take: Parameters<typeof useHandoff>[3], reviewing: boolean) => useHandoff(RECORDING_HANDOFF, isRecordingPayload, { waitMs: RECORDING_WAIT_MS, hold: reviewing, tag: 'recording-handoff' }, take);

describe('handoffStep, for a recording', () => {
  it("one for a tab's floating chat is that chat's only", () => {
    expect(recordingStep(handoff({ tab: 4 }), at({ tab: 4 })).step).toBe('take');
    expect(recordingStep(handoff({ tab: 4 }), at({})).step).toBe('none');
  });
  it("one for a tab's side panel, that panel's; else the window's panel", () => {
    expect(recordingStep(handoff({ panelTab: 9 }), at({ panelTab: 9 })).step).toBe('take');
    expect(recordingStep(handoff({ panelTab: 9 }), at({})).step).toBe('none');
    expect(recordingStep(handoff(), at({})).step).toBe('take');
  });
  it('taken once; dropped once it has waited too long; anything else ignored', () => {
    const h = handoff({}, 1000);
    expect(recordingStep(h, at({}, 1000)).step).toBe('none');
    expect(recordingStep(handoff({}, 1000), at({}, 0, 1000 + RECORDING_WAIT_MS - 1)).step).toBe('take');
    expect(recordingStep(handoff({}, 1000), at({}, 0, 1000 + RECORDING_WAIT_MS)).step).toBe('drop');
    expect(recordingStep({ at: 1 }, at({})).step).toBe('none');
    expect(recordingStep(undefined, at({})).step).toBe('none');
  });
});

// The chat under test: one at a time, gone (no longer watching storage) once its test ends.
let root: Root | undefined;
const mount = (Probe: FunctionComponent) => act(async () => (root = createRoot(document.createElement('div'))).render(createElement(Probe)));
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  storage.reset();
});
const waiting = () => storage.session.data[RECORDING_HANDOFF]; // in storage, and nobody told: as the chat finds it on mount
const handedOver = (h: unknown) => act(() => storage.session.set({ [RECORDING_HANDOFF]: h })); // written while the chat is open: it is told
// Every chain of promises a change set off has run through: one turn of the task queue later.
const settled = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const taken = (take: ReturnType<typeof vi.fn>) => take.mock.calls.map((c) => (c[0] as { at: number }).at);

describe('useHandoff, for a recording', () => {
  it("takes the window panel's on mount and later, and leaves another chat's in place", async () => {
    const take = vi.fn();
    const t = Date.now(); // each one's time tells them apart; none old enough to be dropped
    storage.session.data[RECORDING_HANDOFF] = handoff({}, t);
    await mount(() => (useRecordingHandoff(take, false), null));
    await vi.waitFor(() => expect(taken(take)).toEqual([t]));
    expect(waiting()).toBeUndefined();
    await handedOver(handoff({ tab: 3 }, t + 1));
    await settled();
    expect(taken(take)).toEqual([t]);
    expect(waiting()).toMatchObject({ tab: 3 }); // left for that chat
    await handedOver(handoff({}, t + 2));
    await vi.waitFor(() => expect(taken(take)).toEqual([t, t + 2]));
    expect(waiting()).toBeUndefined();
  });
  it('one that has waited too long is removed, not taken', async () => {
    const take = vi.fn();
    storage.session.data[RECORDING_HANDOFF] = handoff({}, Date.now() - RECORDING_WAIT_MS);
    await mount(() => (useRecordingHandoff(take, false), null));
    await vi.waitFor(() => expect(waiting()).toBeUndefined());
    expect(take).not.toHaveBeenCalled();
  });
  it('one that comes while this chat reviews another waits, in place, until that review ends', async () => {
    const take = vi.fn();
    let review!: (on: boolean) => void;
    await mount(() => {
      const [busy, setBusy] = useState(true);
      review = setBusy;
      useRecordingHandoff(take, busy);
      return null;
    });
    const h = handoff();
    await handedOver(h);
    await settled();
    expect(take).not.toHaveBeenCalled();
    expect(waiting()).toEqual(h);
    await act(async () => review(false));
    await vi.waitFor(() => expect(taken(take)).toEqual([h.at]));
    expect(waiting()).toBeUndefined();
  });
});

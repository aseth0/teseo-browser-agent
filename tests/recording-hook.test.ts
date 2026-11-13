// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { RecordingHandoff, RecordingStatus } from '../src/recording/recorder-protocol';
import type { Recording } from '../src/recording/recording';

// The chat's recording: while it reviews one, another stopped meanwhile waits, and the review says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let status: RecordingStatus | undefined;
vi.mock('../src/ui/useRecordingStatus', () => ({ useRecordingStatus: () => status }));
let handed: { take: (h: RecordingHandoff) => void; reviewing: boolean };
vi.mock('../src/entrypoints/sidepanel/useHandoff', () => ({
  useHandoff: (_key: string, _is: unknown, how: { hold?: boolean }, take: (h: RecordingHandoff) => void) => void (handed = { take, reviewing: !!how.hold }),
}));
const { useRecording } = await import('../src/entrypoints/sidepanel/useRecording');

const recording = (startedAt: number): Recording => ({ tabId: 7, site: 'shop.example.test', startedAt, calls: [], hidden: [] });
const stopped = (startedAt: number): RecordingStatus => ({ state: 'stopped', tabId: 7, windowId: 2, tabs: [7], site: 'shop.example.test', calls: 2, leftOut: 0, startedAt, preset: 'API calls', mode: 'tab' });

describe('useRecording', () => {
  it('reviewing one, the next waits, and the chat knows another waits', async () => {
    let recorder!: ReturnType<typeof useRecording>;
    let render!: () => void;
    const Probe = () => ((recorder = useRecording()), null);
    const root = createRoot(document.createElement('div'));
    render = () => root.render(createElement(Probe));
    await act(async () => render());
    expect(handed.reviewing).toBe(false);
    await act(async () => handed.take({ at: 1, payload: { kind: 'recording', recording: recording(100) } }));
    expect(recorder.recording?.startedAt).toBe(100);
    expect(handed.reviewing).toBe(true);
    expect(recorder.anotherWaits).toBe(false);
    status = stopped(100); // the one under review, before the background clears it
    await act(async () => render());
    expect(recorder.anotherWaits).toBe(false);
    status = stopped(200);
    await act(async () => render());
    expect(recorder.anotherWaits).toBe(true);
    await act(async () => recorder.discard());
    expect(handed.reviewing).toBe(false);
  });
});

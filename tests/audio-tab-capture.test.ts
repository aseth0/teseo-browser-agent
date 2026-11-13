import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A tab's audio recorded in the offscreen document: taken from the recorder as it goes (a timeslice),
// never kept whole in the recorder's own buffer, and given whole once stopped.
class FakeRecorder {
  static last: FakeRecorder | undefined;
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  timeslice: number | undefined;
  ondataavailable: ((e: { data: Blob }) => void) | undefined;
  onstop: (() => void) | undefined;
  static isTypeSupported = () => true;
  constructor(public stream: unknown) {
    FakeRecorder.last = this;
  }
  start(timeslice?: number) {
    this.state = 'recording';
    this.timeslice = timeslice;
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['last']) });
    this.onstop?.();
  }
}
const track = { stop: vi.fn(), addEventListener: vi.fn() };
const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
class FakeContext {
  destination = {};
  createMediaStreamSource = () => ({ connect: () => undefined });
  close = async () => undefined;
}

beforeEach(() => {
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
});
afterEach(() => vi.unstubAllGlobals());

const { captureTabAudio } = await import('../src/audio/tab-capture');

describe("a tab's audio", () => {
  it('is taken from the recorder as it goes, and given whole once stopped', async () => {
    const audio = await captureTabAudio('stream-1', () => undefined);
    const rec = FakeRecorder.last!;
    expect(rec.timeslice).toBeGreaterThan(0);
    rec.ondataavailable!({ data: new Blob(['one,']) });
    rec.ondataavailable!({ data: new Blob([]) });
    rec.ondataavailable!({ data: new Blob(['two,']) });
    const blob = await audio.stop();
    expect(await blob.text()).toBe('one,two,last');
    expect(blob.type).toBe('audio/webm;codecs=opus');
    expect(track.stop).toHaveBeenCalled();
  });
});

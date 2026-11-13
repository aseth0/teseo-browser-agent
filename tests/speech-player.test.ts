import { describe, expect, it, vi } from 'vitest';
import { createPlayer, type AudioOut, type Clip, type Playing, type PlayerEvent } from '../src/speech/player';
import { refusalText, speechRequest } from '../src/speech/request';
import type { SpeechTarget } from '../src/speech/settings';
import { keptFrames } from '../src/speech/trim';

// A reading in the offscreen document: one request per piece, in order, while the clips already back
// play back to back; Stop or a new reading cuts what is in flight. And the request, and the trim.

const target: SpeechTarget = {
  provider: { id: 'p', name: 'P', baseURL: 'https://tts.example.test/v1/', apiKey: 'k', defaultModel: '', extraHeaders: { 'X-Team': 'blue' } },
  model: 'tts-model',
  voice: 'nova_a+nova_b',
  speed: 1.2,
};
const pieces = (...inputs: string[]) => inputs.map((input, i) => ({ input, trim: i < inputs.length - 1 }));

// Clips one second long, played on a clock the test moves: each ends when the test says.
function fakeOut() {
  const played: { input: string; trim: boolean; startsAt: number; end: () => void; stopped: boolean }[] = [];
  const out: AudioOut = {
    decode: async (data, trim) => ({ duration: 1, input: new TextDecoder().decode(data), trim }) as Clip,
    play: (clip, at) => {
      const c = clip as Clip & { input: string; trim: boolean };
      let end!: () => void;
      const ended = new Promise<void>((r) => (end = r));
      const entry = { input: c.input, trim: c.trim, startsAt: Math.max(at, 0), end, stopped: false };
      played.push(entry);
      const p: Playing = { startsAt: entry.startsAt, endsAt: entry.startsAt + c.duration, ended, stop: () => ((entry.stopped = true), end()) };
      return p;
    },
  };
  return { out, played };
}
// Requests answered when the test says, in order.
function fakeServer() {
  const asked: { input: string; signal: AbortSignal; answer: (ok?: boolean) => void }[] = [];
  const fetchClip = vi.fn((_t: SpeechTarget, input: string, signal: AbortSignal) =>
    new Promise<ArrayBuffer>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
      asked.push({ input, signal, answer: (ok = true) => (ok ? resolve(new TextEncoder().encode(input).buffer as ArrayBuffer) : reject(new Error('The voice server answered 400: no such voice'))) });
    }),
  );
  return { fetchClip, asked };
}
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe('a reading', () => {
  it('asks for each piece in turn, plays them back to back, says how far it is, and ends', async () => {
    const { out, played } = fakeOut();
    const { fetchClip, asked } = fakeServer();
    const events: PlayerEvent[] = [];
    const player = createPlayer({ fetchClip, out, tell: (e) => events.push(e) });

    const started = player.play('r1', pieces('One,', 'two.', 'Three.'), target);
    await settle();
    expect(asked.map((a) => a.input)).toEqual(['One,']); // one at a time
    asked[0]!.answer();
    expect(await started).toEqual({ ok: true });
    await settle();
    expect(played.map((p) => [p.input, p.trim, p.startsAt])).toEqual([['One,', true, 0]]);
    expect(events).toEqual([{ kind: 'progress', run: 'r1', piece: 1, total: 3, playing: true }]);

    // The next comes while the first plays: right after it, without a gap.
    asked[1]!.answer();
    await settle();
    expect(played.map((p) => p.startsAt)).toEqual([0, 1]);
    played[0]!.end();
    await settle();
    expect(events.at(-1)).toEqual({ kind: 'progress', run: 'r1', piece: 2, total: 3, playing: true });

    // The third is not back when the second ends: preparing.
    played[1]!.end();
    await settle();
    expect(events.at(-1)).toEqual({ kind: 'progress', run: 'r1', piece: 3, total: 3, playing: false });
    asked[2]!.answer();
    await settle();
    played[2]!.end();
    await settle();
    expect(events.at(-1)).toEqual({ kind: 'ended', run: 'r1' });
    expect(player.held()).toBeUndefined();
  });

  it('a first request refused answers its error, and nothing plays', async () => {
    const { out, played } = fakeOut();
    const { fetchClip, asked } = fakeServer();
    const player = createPlayer({ fetchClip, out, tell: vi.fn() });
    const started = player.play('r1', pieces('One.', 'Two.'), target);
    await settle();
    asked[0]!.answer(false);
    expect(await started).toEqual({ error: 'The voice server answered 400: no such voice' });
    expect(played).toEqual([]);
    expect(asked).toHaveLength(1);
  });

  it('a later piece refused ends the reading and says why', async () => {
    const { out } = fakeOut();
    const { fetchClip, asked } = fakeServer();
    const events: PlayerEvent[] = [];
    const player = createPlayer({ fetchClip, out, tell: (e) => events.push(e) });
    const started = player.play('r1', pieces('One.', 'Two.'), target);
    await settle();
    asked[0]!.answer();
    await started;
    await settle();
    asked[1]!.answer(false);
    await settle();
    expect(events.at(-1)).toEqual({ kind: 'ended', run: 'r1', error: 'The voice server answered 400: no such voice' });
  });

  it('Stop cuts the request in flight and what plays, and asks for nothing more', async () => {
    const { out, played } = fakeOut();
    const { fetchClip, asked } = fakeServer();
    const events: PlayerEvent[] = [];
    const player = createPlayer({ fetchClip, out, tell: (e) => events.push(e) });
    const started = player.play('r1', pieces('One.', 'Two.', 'Three.'), target);
    await settle();
    asked[0]!.answer();
    await started;
    await settle();
    player.halt();
    await settle();
    expect(asked[1]!.signal.aborted).toBe(true);
    expect(played[0]!.stopped).toBe(true);
    expect(asked).toHaveLength(2);
    expect(events.some((e) => e.kind === 'ended')).toBe(false);
  });

  it('a new reading replaces the one in progress', async () => {
    const { out } = fakeOut();
    const { fetchClip, asked } = fakeServer();
    const player = createPlayer({ fetchClip, out, tell: vi.fn() });
    const first = player.play('r1', pieces('Old.'), target);
    await settle();
    const second = player.play('r2', pieces('New.'), target);
    await settle();
    expect(asked[0]!.signal.aborted).toBe(true);
    asked[1]!.answer();
    expect(await first).toEqual({ error: 'aborted' });
    expect(await second).toEqual({ ok: true });
    expect(player.held()).toBe('r2');
  });
});

describe('the request', () => {
  it('posts the piece with the profile\'s model, voice and speed, and the provider\'s auth and headers', () => {
    const { url, init } = speechRequest(target, 'Hola.');
    expect(url).toBe('https://tts.example.test/v1/audio/speech');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer k', 'X-Team': 'blue' });
    expect(JSON.parse(init.body as string)).toEqual({ model: 'tts-model', input: 'Hola.', voice: 'nova_a+nova_b', response_format: 'mp3', speed: 1.2 });
  });

  it('says what the server says when it refuses', () => {
    expect(refusalText(400, '{"error":{"message":"Voice x not found. Voices: nova_a, nova_b"}}')).toBe('The voice server answered 400: Voice x not found. Voices: nova_a, nova_b');
    expect(refusalText(422, '{"detail":"bad speed"}')).toBe('The voice server answered 422: bad speed');
    expect(refusalText(500, 'down')).toBe('The voice server answered 500: down');
    expect(refusalText(502, '')).toBe('The voice server answered 502');
  });
});

describe('the closing silence', () => {
  it('goes, but for a short tail after the last sound', () => {
    const rate = 1000;
    const ch = new Float32Array(1000);
    ch.fill(0.5, 0, 600); // sound for 0.6 s, then 0.4 s of silence
    ch.fill(0.002, 600); // under the threshold
    expect(keptFrames([ch], rate)).toBe(640);
  });

  it('a clip all silence, or sound to its end, stays whole', () => {
    expect(keptFrames([new Float32Array(100)], 1000)).toBe(100);
    expect(keptFrames([new Float32Array(100).fill(0.3)], 1000)).toBe(100);
  });

  it('counts the louder of the channels', () => {
    const left = new Float32Array(1000), right = new Float32Array(1000);
    right[800] = -0.4;
    expect(keptFrames([left, right], 1000)).toBe(841);
  });
});

describe('a reading whose text is still written', () => {
  it('plays what it has, waits for more, and ends once the text is done', async () => {
    const { out, played } = fakeOut();
    const { fetchClip, asked } = fakeServer();
    const events: PlayerEvent[] = [];
    const player = createPlayer({ fetchClip, out, tell: (e) => events.push(e) });
    const started = player.play('g', pieces('One.'), target, false);
    await settle();
    asked[0]!.answer();
    expect(await started).toEqual({ ok: true });
    await settle();
    played[0]!.end();
    await settle();
    expect(events.at(-1)).toMatchObject({ kind: 'progress', piece: 2, playing: false }); // waiting for more
    player.more('g', pieces('Two.'), false);
    await settle();
    asked[1]!.answer();
    await settle();
    expect(played.map((p) => p.input)).toEqual(['One.', 'Two.']);
    played[1]!.end();
    await settle();
    expect(events.some((e) => e.kind === 'ended')).toBe(false);
    player.more('g', [], true);
    await settle();
    expect(events.at(-1)).toEqual({ kind: 'ended', run: 'g' });
    expect(player.held()).toBeUndefined();
  });

  it("more pieces of another reading are dropped; one done with pieces left ends after the last", async () => {
    const { out, played } = fakeOut();
    const { fetchClip, asked } = fakeServer();
    const events: PlayerEvent[] = [];
    const player = createPlayer({ fetchClip, out, tell: (e) => events.push(e) });
    const started = player.play('g', pieces('One.'), target, false);
    await settle();
    asked[0]!.answer();
    await started;
    player.more('old', pieces('Nope.'), true);
    player.more('g', pieces('Two.'), true);
    await settle();
    asked[1]!.answer();
    await settle();
    played[0]!.end();
    await settle();
    expect(events.some((e) => e.kind === 'ended')).toBe(false);
    played[1]!.end();
    await settle();
    expect(events.at(-1)).toEqual({ kind: 'ended', run: 'g' });
    expect(asked.map((a) => a.input)).toEqual(['One.', 'Two.']);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/storage/settings';
import type { SpeakStatus } from '../src/speech/protocol';
import type { SystemVoice } from '../src/speech/system-voice';

// Without a voice profile, the system's own voice reads (chrome.tts): the same pieces, in the language
// whose reading rules apply, its status marked as the system's; switched off, the reading says what to
// add. It and a profile's reading replace each other, and Stop ends either.
vi.mock('wxt/browser', () => ({ browser: { offscreen: {} } }));
const { createSpeechSession, NO_PROFILE } = await import('../src/speech/session');
const { createSystemVoice, NO_SYSTEM_VOICE } = await import('../src/speech/system-voice');

const provider = { id: 'p', name: 'Voices', baseURL: 'https://tts.example.test/v1', apiKey: 'k', defaultModel: '' };
const settings = (speak: Settings['speak']): Settings => ({ providers: [provider], systemPrompt: '', speak }) as Settings;
const CALM = { id: 'a', name: 'Calm', providerId: 'p', model: 'tts-1', voice: 'nova_a', speed: 1 };

function session(s: Settings, o: { kept?: SpeakStatus; speaking?: boolean } = {}) {
  const statuses: (SpeakStatus | undefined)[] = [];
  const system = { play: vi.fn<SystemVoice['play']>(async () => ({ ok: true })), more: vi.fn(async () => undefined), stop: vi.fn(async () => undefined), speaking: vi.fn(async () => !!o.speaking) };
  const play = vi.fn(async () => ({ ok: true }) as const);
  const halt = vi.fn(async () => undefined);
  let n = 0;
  const sess = createSpeechSession({
    settings: async () => s,
    agentProfileId: async () => undefined,
    unreachable: async () => undefined,
    open: async () => undefined,
    more: async () => undefined,
    play,
    halt,
    held: async () => undefined,
    load: async () => o.kept,
    save: async (st) => void statuses.push(st),
    onChange: vi.fn(),
    failed: vi.fn(),
    newRun: () => `run${++n}`,
    now: () => 1000,
    system,
  });
  return { sess, system, play, halt, statuses };
}

describe('a reading without a voice profile', () => {
  it('goes to the system voice, in the language of the reading rules, and its status says so', async () => {
    const { sess, system, play, halt, statuses } = session(settings({ language: 'es' }));
    expect(await sess.start({ text: 'Son 3 km. Fin.', tabId: 4, key: 'action:x:0' })).toEqual({ started: true });
    expect(play).not.toHaveBeenCalled();
    expect(halt).toHaveBeenCalled(); // a profile's reading, if one went on
    const [run, pieces, o] = system.play.mock.calls[0]!;
    expect(run).toBe('run1');
    expect(pieces.map((p) => p.input).join(' ')).toBe('Son 3 kilómetros. Fin.');
    expect(o).toEqual({ lang: 'es' });
    expect(statuses).toEqual([{ run: 'run1', state: 'preparing', piece: 1, total: 1, startedAt: 1000, tabId: 4, key: 'action:x:0', system: true }]);
  });

  it('switched off, says to add a profile', async () => {
    const { sess, system } = session(settings({ systemVoice: false }));
    expect(await sess.start({ text: 'Hello.' })).toEqual({ error: NO_PROFILE, settings: 'speak' });
    expect(system.play).not.toHaveBeenCalled();
  });

  it("a profile's reading stops the system voice first; Stop ends either", async () => {
    const { sess, system, play } = session(settings({ profiles: [CALM] }));
    await sess.start({ text: 'Hello.' });
    expect(system.stop).toHaveBeenCalled();
    expect(play).toHaveBeenCalled();
    system.stop.mockClear();
    await sess.stop();
    expect(system.stop).toHaveBeenCalled();
    expect(sess.status()).toBeUndefined();
  });

  it('a worker that woke keeps the reading while the system voice still speaks', async () => {
    const kept: SpeakStatus = { run: 'old', state: 'reading', piece: 1, total: 1, startedAt: 1, system: true };
    const still = session(settings({}), { kept, speaking: true });
    await still.sess.ready;
    expect(still.sess.status()).toEqual(kept);
    const done = session(settings({}), { kept, speaking: false });
    await done.sess.ready;
    expect(done.sess.status()).toBeUndefined();
  });
});

describe('the system voice', () => {
  type Opts = { enqueue?: boolean; lang?: string; onEvent?: (e: { type: string; errorMessage?: string }) => void };
  const fakeTts = () => {
    const spoken: [string, Opts][] = [];
    const api = { speak: vi.fn(async (text: string, o: Opts) => void spoken.push([text, o])), stop: vi.fn(), isSpeaking: vi.fn(async () => true) };
    return { api, spoken };
  };
  const pieces = [{ input: 'One.', trim: false }, { input: 'Two.', trim: false }];

  it('queues the pieces, says when each starts and when the last ends', async () => {
    const { api, spoken } = fakeTts();
    const on = { progressed: vi.fn(), ended: vi.fn() };
    const busy = vi.fn();
    const voice = createSystemVoice(on, () => api as never, busy);
    expect(await voice.play('r', pieces, { lang: 'en' })).toEqual({ ok: true });
    expect(busy).toHaveBeenLastCalledWith(true); // the worker kept awake while it reads
    expect(spoken.map(([t, o]) => [t, o.enqueue, o.lang])).toEqual([['One.', true, 'en'], ['Two.', true, 'en']]);
    spoken[0]![1].onEvent!({ type: 'start' });
    spoken[0]![1].onEvent!({ type: 'end' });
    expect(on.progressed).toHaveBeenCalledWith({ run: 'r', piece: 1, total: 2, playing: true });
    expect(on.ended).not.toHaveBeenCalled();
    spoken[1]![1].onEvent!({ type: 'end' });
    expect(on.ended).toHaveBeenCalledWith({ run: 'r' });
    expect(busy).toHaveBeenLastCalledWith(false);
    expect(await voice.speaking()).toBe(true);
  });

  it('an error ends it with what the engine said; a stopped one says nothing', async () => {
    const { api, spoken } = fakeTts();
    const on = { progressed: vi.fn(), ended: vi.fn() };
    const voice = createSystemVoice(on, () => api as never);
    await voice.play('r', pieces, {});
    spoken[0]![1].onEvent!({ type: 'error', errorMessage: 'No voice' });
    expect(on.ended).toHaveBeenCalledWith({ run: 'r', error: 'No voice' });
    on.ended.mockClear();
    await voice.play('s', pieces, {});
    await voice.stop();
    spoken[2]![1].onEvent!({ type: 'interrupted' });
    spoken[3]![1].onEvent!({ type: 'end' });
    expect(on.ended).not.toHaveBeenCalled();
  });

  it('none in this browser: says so', async () => {
    const voice = createSystemVoice({ progressed: vi.fn(), ended: vi.fn() }, () => undefined);
    expect(await voice.play('r', pieces, {})).toEqual({ error: NO_SYSTEM_VOICE });
  });
});

describe('the system voice, a text still written', () => {
  type Opts = { onEvent?: (e: { type: string }) => void };
  it('queues more pieces after the first, and ends after the last once done', async () => {
    const spoken: [string, Opts][] = [];
    const api = { speak: vi.fn(async (text: string, o: Opts) => void spoken.push([text, o])), stop: vi.fn(), isSpeaking: vi.fn(async () => true) };
    const on = { progressed: vi.fn(), ended: vi.fn() };
    const voice = createSystemVoice(on, () => api as never);
    await voice.play('g', [{ input: 'One.', trim: false }], {}, false);
    spoken[0]![1].onEvent!({ type: 'end' });
    expect(on.ended).not.toHaveBeenCalled();
    expect(on.progressed).toHaveBeenLastCalledWith({ run: 'g', piece: 2, total: 2, playing: false });
    await voice.more('g', [{ input: 'Two.', trim: false }], true);
    expect(spoken.map(([t]) => t)).toEqual(['One.', 'Two.']);
    spoken[1]![1].onEvent!({ type: 'end' });
    expect(on.ended).toHaveBeenCalledWith({ run: 'g' });
  });
});

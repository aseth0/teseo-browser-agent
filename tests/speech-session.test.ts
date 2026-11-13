import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/storage/settings';
import type { SpeakStatus } from '../src/speech/protocol';

// The background's one reading: which profile reads it, the plan the offscreen document gets, and its
// status; a reading that ended, broke off or was replaced; a worker that woke.
vi.mock('wxt/browser', () => ({ browser: { offscreen: {} } }));
const { createSpeechSession, NO_PROFILE } = await import('../src/speech/session');

const provider = { id: 'p', name: 'Voices', baseURL: 'https://tts.example.test/v1', apiKey: 'k', defaultModel: '' };
const settings = (speak: Settings['speak'], more: Partial<Settings> = {}): Settings =>
  ({ providers: [provider], systemPrompt: '', speak, ...more }) as Settings;
const PROFILES = [
  { id: 'a', name: 'Calm', providerId: 'p', model: 'tts-1', voice: 'nova_a', speed: 1.1 },
  { id: 'b', name: 'Quick', providerId: 'p', model: 'tts-1', voice: 'nova_b', speed: 1.5 },
];

function session(s: Settings, o: { agentProfile?: string; reply?: { ok: true } | { error: string }; kept?: SpeakStatus; held?: string } = {}) {
  const statuses: (SpeakStatus | undefined)[] = [];
  const play = vi.fn(async (..._a: unknown[]) => o.reply ?? ({ ok: true } as const));
  const failed = vi.fn();
  const halt = vi.fn(async () => undefined);
  const more = vi.fn(async (..._a: unknown[]) => undefined);
  let n = 0;
  const sess = createSpeechSession({
    settings: async () => s,
    agentProfileId: async (_s, agentId) => (agentId === 'reader' || agentId === undefined ? o.agentProfile : undefined),
    unreachable: async () => undefined,
    open: async () => undefined,
    play,
    more,
    halt,
    held: async () => o.held,
    load: async () => o.kept,
    save: async (st) => void statuses.push(st),
    onChange: vi.fn(),
    failed,
    newRun: () => `run${++n}`,
    now: () => 1000,
  });
  return { sess, play, more, failed, halt, statuses };
}

describe('a reading', () => {
  it('goes with the default profile, cut and said as Settings → Speak says', async () => {
    const { sess, play, statuses } = session(settings({ profiles: PROFILES, defaultProfileId: 'b', language: 'es', firstPiece: 40, pairs: [{ written: 'km', said: 'kilómetros' }] }));
    const r = await sess.start({ text: 'Son 3 km a pie, más o menos, por el camino viejo del río. Fin.', tabId: 4, key: 'selection' });
    expect(r).toEqual({ started: true });
    const [run, pieces, target] = play.mock.calls[0]!;
    expect(run).toBe('run1');
    expect(pieces).toEqual([
      { input: 'Son 3 kilómetros a pie, más o menos,', trim: true },
      { input: 'por el camino viejo del río. Fin.', trim: false },
    ]);
    expect(target).toEqual({ provider, model: 'tts-1', voice: 'nova_b', speed: 1.5 });
    expect(statuses).toEqual([{ run: 'run1', state: 'preparing', piece: 1, total: 2, startedAt: 1000, tabId: 4, key: 'selection' }]);
  });

  it('reads only the start of a text longer than Settings → Limits allows at a time, and its status says so', async () => {
    const { setLimitOverrides } = await import('../src/core/limits');
    setLimitOverrides({ speakText: 500 });
    try {
      const { sess, play, statuses } = session(settings({ profiles: PROFILES }));
      const sentence = 'Esta frase tiene cuarenta y tantas letras. ';
      expect(await sess.start({ text: sentence.repeat(40) })).toEqual({ started: true });
      const pieces = play.mock.calls[0]![1] as { input: string }[];
      const sent = pieces.map((p) => p.input).join(' ');
      expect(sent.length).toBeLessThanOrEqual(500);
      expect(sent.endsWith('letras.')).toBe(true);
      expect(statuses[0]).toMatchObject({ cut: true, total: pieces.length });
    } finally {
      setLimitOverrides(undefined);
    }
  });

  it('with the agent\'s profile when it has one, a profile named, or one given (Test)', async () => {
    const s = settings({ profiles: PROFILES });
    const voiceOf = async (req: Parameters<ReturnType<typeof createSpeechSession>['start']>[0], agentProfile?: string) => {
      const { sess, play } = session(s, { agentProfile });
      await sess.start(req);
      return (play.mock.calls[0]![2] as { voice: string }).voice;
    };
    expect(await voiceOf({ text: 'Hi.' })).toBe('nova_a');
    expect(await voiceOf({ text: 'Hi.' }, 'b')).toBe('nova_b'); // the active agent's
    expect(await voiceOf({ text: 'Hi.', agentId: 'reader' }, 'b')).toBe('nova_b');
    expect(await voiceOf({ text: 'Hi.', agentId: 'reader' }, 'gone')).toBe('nova_a'); // removed: the default
    expect(await voiceOf({ text: 'Hi.', profileId: 'b' })).toBe('nova_b');
    expect(await voiceOf({ text: 'Hi.', profile: { id: 'new', name: 'New', providerId: 'p', model: 'm', voice: 'nova_z' } })).toBe('nova_z');
  });

  it('with the reading rules of the profile that reads: its own, else Speak\'s, else Voice\'s language', async () => {
    const text = 'Tarda 0,5 s.';
    const SPANISH = { id: 'es', name: 'Lector', providerId: 'p', model: 'tts-1', voice: 'v_es', language: 'es' };
    const PLAIN = { id: 'en', name: 'Reader', providerId: 'p', model: 'tts-1', voice: 'v_en', language: 'none' };
    const INHERITS = { id: 'in', name: 'Inherits', providerId: 'p', model: 'tts-1', voice: 'v_in' };
    const said = async (s: Settings, req: Parameters<ReturnType<typeof createSpeechSession>['start']>[0], agentProfile?: string) => {
      const { sess, play } = session(s, { agentProfile });
      expect(await sess.start(req)).toEqual({ started: true });
      return (play.mock.calls[0]![1] as { input: string }[]).map((p) => p.input).join(' ');
    };
    const ruled = 'Tarda 0 coma 5 segundos.';
    const s = settings({ profiles: [SPANISH, PLAIN, INHERITS], defaultProfileId: 'en', language: 'none' }, { voice: { language: 'es' } });
    expect(await said(s, { text })).toBe(text); // the default profile's: none
    expect(await said(s, { text, profileId: 'es' })).toBe(ruled); // a profile named (the panel's, the widget's buttons)
    expect(await said(s, { text, agentId: 'reader' }, 'es')).toBe(ruled); // an agent's (speech.say, the shortcut)
    expect(await said(s, { text, profile: { ...PLAIN, language: 'es' } })).toBe(ruled); // Test: the profile as edited
    expect(await said(s, { text, profile: SPANISH, profileId: 'en' })).toBe(ruled);
    // Without one: Speak's, else dictation's, as before.
    expect(await said(s, { text, profileId: 'in' })).toBe(text);
    expect(await said(settings({ profiles: [INHERITS] }, { voice: { language: 'es' } }), { text })).toBe(ruled);
    expect(await said(settings({ profiles: [INHERITS], language: 'es' }), { text })).toBe(ruled);
  });

  it('says what is missing, and where it is set', async () => {
    expect(await session(settings(undefined)).sess.start({ text: 'Hi.' })).toEqual({ error: NO_PROFILE, settings: 'speak' });
    expect(await session(settings({ profiles: PROFILES, enabled: false })).sess.start({ text: 'Hi.' })).toEqual({ error: 'Speak is off in Settings → Speak.', settings: 'speak' });
    expect(await session(settings({ profiles: [{ id: 'x', name: 'X', providerId: 'gone', model: 'm', voice: 'v' }] })).sess.start({ text: 'Hi.' })).toEqual({
      error: 'The voice profile "X" has no provider: choose one in Settings → Speak.',
      settings: 'speak',
    });
    expect(await session(settings({ profiles: PROFILES })).sess.start({ text: '   ' })).toEqual({ error: 'There is no text to read.' });
  });

  it('refused by the server: its status goes, and the error is answered', async () => {
    const { sess, statuses } = session(settings({ profiles: PROFILES }), { reply: { error: 'The voice server answered 400: Voices: nova_a' } });
    expect(await sess.start({ text: 'Hi.' })).toEqual({ error: 'The voice server answered 400: Voices: nova_a' });
    expect(statuses.at(-1)).toBeUndefined();
    expect(sess.status()).toBeUndefined();
  });

  it('follows the offscreen document, and drops what an old reading says', async () => {
    const { sess, failed } = session(settings({ profiles: PROFILES }));
    await sess.start({ text: 'One. Two.' });
    await sess.progressed({ run: 'run1', piece: 1, total: 1, playing: true });
    expect(sess.status()).toMatchObject({ state: 'reading', piece: 1 });
    await sess.progressed({ run: 'old', piece: 9, total: 9, playing: true });
    expect(sess.status()).toMatchObject({ piece: 1 });
    await sess.ended({ run: 'run1', error: 'The voice server answered 500' });
    expect(sess.status()).toBeUndefined();
    expect(failed).toHaveBeenCalledWith('The voice server answered 500');
  });

  it('Stop halts the offscreen document and clears the status', async () => {
    const { sess, halt, statuses } = session(settings({ profiles: PROFILES }));
    await sess.start({ text: 'Hi.' });
    await sess.stop();
    expect(halt).toHaveBeenCalled();
    expect(statuses.at(-1)).toBeUndefined();
  });

  it('a worker that woke keeps the reading the offscreen document still plays, and drops one it lost', async () => {
    const kept: SpeakStatus = { run: 'r9', state: 'reading', piece: 2, total: 3, startedAt: 1 };
    const playing = session(settings({}), { kept, held: 'r9' });
    await playing.sess.ready;
    expect(playing.sess.status()).toEqual(kept);
    const lost = session(settings({}), { kept, held: undefined });
    await lost.sess.ready;
    expect(lost.sess.status()).toBeUndefined();
    expect(lost.statuses).toEqual([undefined]);
  });
});

// Readings on their own (an answer as it ends, an action's boxes): they wait their turn instead of
// replacing the one in progress; one the user starts, or Stop, empties the queue.
describe('the queue', () => {
  const words = (play: { mock: { calls: unknown[][] } }) => play.mock.calls.map((c) => (c[1] as { input: string }[]).map((p) => p.input).join(' '));

  it('reads one on its own at once when nothing is read, and the next ones after it, in order', async () => {
    const { sess, play } = session(settings({ profiles: PROFILES }));
    expect(await sess.start({ text: 'First.', key: 'action:a:0', queued: true })).toEqual({ started: true });
    expect(await sess.start({ text: 'Second.', key: 'action:a:1', queued: true })).toEqual({ started: true, queued: true });
    expect(await sess.start({ text: 'Third.', key: 'answer:x', queued: true })).toEqual({ started: true, queued: true });
    expect(sess.status()).toMatchObject({ run: 'run1', key: 'action:a:0', waiting: ['action:a:1', 'answer:x'] });
    expect(words(play)).toEqual(['First.']);
    await sess.ended({ run: 'run1' });
    expect(sess.status()).toMatchObject({ run: 'run2', key: 'action:a:1', waiting: ['answer:x'] });
    await sess.ended({ run: 'run2' });
    expect(sess.status()).toMatchObject({ run: 'run3', key: 'answer:x' });
    expect(sess.status()?.waiting).toBeUndefined();
    await sess.ended({ run: 'run3' });
    expect(sess.status()).toBeUndefined();
    expect(words(play)).toEqual(['First.', 'Second.', 'Third.']);
  });

  it('waits for one being started (two boxes asked for at once)', async () => {
    const { sess, play } = session(settings({ profiles: PROFILES }));
    const [a, b] = await Promise.all([sess.start({ text: 'One.', key: 'k1', queued: true }), sess.start({ text: 'Two.', key: 'k2', queued: true })]);
    expect(a).toEqual({ started: true });
    expect(b).toEqual({ started: true, queued: true });
    expect(words(play)).toEqual(['One.']);
    expect(sess.status()).toMatchObject({ key: 'k1', waiting: ['k2'] });
  });

  it("one the user starts replaces what is read and empties the queue; Stop too", async () => {
    const { sess, play } = session(settings({ profiles: PROFILES }));
    await sess.start({ text: 'One.', key: 'k1', queued: true });
    await sess.start({ text: 'Two.', key: 'k2', queued: true });
    await sess.start({ text: 'Mine.', key: 'selection' });
    expect(sess.status()).toMatchObject({ run: 'run2', key: 'selection' });
    expect(sess.status()?.waiting).toBeUndefined();
    await sess.start({ text: 'Three.', key: 'k3', queued: true });
    await sess.stop();
    await sess.ended({ run: 'run2' });
    expect(words(play)).toEqual(['One.', 'Mine.']);
  });

  it('drops those that wait by their key, and all of them when the server breaks off', async () => {
    const { sess, play, failed } = session(settings({ profiles: PROFILES }));
    await sess.start({ text: 'One.', key: 'answer:1', queued: true, tabId: 4 });
    await sess.start({ text: 'Box.', key: 'action:a:0', queued: true, tabId: 4 });
    await sess.start({ text: 'Other tab.', key: 'action:b:0', queued: true, tabId: 5 });
    await sess.start({ text: 'Two.', key: 'answer:2', queued: true, tabId: 4 });
    await sess.unqueue('action:', 4);
    expect(sess.status()?.waiting).toEqual(['action:b:0', 'answer:2']);
    await sess.ended({ run: 'run1', error: 'The voice server answered 500' });
    expect(failed).toHaveBeenCalledWith('The voice server answered 500');
    expect(sess.status()).toBeUndefined();
    expect(words(play)).toEqual(['One.']);
  });

  it('one that cannot start is said, and the next one goes on', async () => {
    const { sess, play, failed } = session(settings({ profiles: PROFILES }));
    await sess.start({ text: 'One.', key: 'k1', queued: true });
    await sess.start({ text: '   ', key: 'k2', queued: true });
    await sess.start({ text: 'Three.', key: 'k3', queued: true });
    await sess.ended({ run: 'run1' });
    expect(failed).toHaveBeenCalledWith('There is no text to read.');
    expect(sess.status()).toMatchObject({ key: 'k3' });
    expect(words(play)).toEqual(['One.', 'Three.']);
  });
});

// A text read while it is written: started with its final pieces, the next sent as they become final,
// ended once done; one that waits takes the text as it grows.
describe('a growing reading', () => {
  const S = 'The prices rose this week in every store we checked, and most of all in the small ones.'; // 87
  const T = 'Bread and milk went up the most.';
  const opts = { profiles: PROFILES, firstPiece: 40, pieceSize: 60 };

  it('plays its final pieces, sends the next ones, and ends once done', async () => {
    const { sess, play, more } = session(settings(opts));
    expect(await sess.start({ text: `${S} ${T} Fr`, key: 'stream:a', queued: true, growing: true })).toEqual({ started: true });
    const [, first, , done] = play.mock.calls[0]!;
    expect(done).toBe(false);
    expect((first as { input: string }[]).map((p) => p.input).join(' ')).not.toContain('Fr');
    const sent = (first as unknown[]).length;
    await sess.grow('stream:a', `${S} ${T} Fruit stayed where it was. And`, false);
    await sess.grow('stream:a', `${S} ${T} Fruit stayed where it was. And that is all.`, true);
    const calls = more.mock.calls as unknown as [string, { input: string }[], boolean][];
    expect(calls.at(-1)![2]).toBe(true);
    const all = [...(first as { input: string }[]), ...calls.flatMap((c) => c[1])].map((p) => p.input).join(' ');
    expect(all).toBe(`${S} ${T} Fruit stayed where it was. And that is all.`);
    expect(sess.status()?.total).toBeGreaterThan(sent);
    await sess.grow('stream:a', 'more after it ended', false);
    expect(more.mock.calls.length).toBe(calls.length);
  });

  it('one that waits its turn takes the text as it grows, and starts with all of it', async () => {
    const { sess, play } = session(settings(opts));
    await sess.start({ text: 'Something else.', key: 'k1', queued: true });
    await sess.start({ text: S, key: 'stream:b', queued: true, growing: true });
    await sess.grow('stream:b', `${S} ${T}`, true);
    await sess.ended({ run: 'run1' });
    const [, pieces, , done] = play.mock.calls[1]!;
    expect(done).toBe(true);
    expect((pieces as { input: string }[]).map((p) => p.input).join(' ')).toBe(`${S} ${T}`);
  });

  it('done once it has not grown for a while', async () => {
    vi.useFakeTimers();
    try {
      const { sess, more } = session(settings(opts));
      await sess.start({ text: `${S} ${T} Half a sen`, key: 'stream:c', growing: true });
      await vi.advanceTimersByTimeAsync(61_000);
      expect(more).toHaveBeenLastCalledWith('run1', expect.any(Array), true);
      expect((more.mock.calls.at(-1)![1] as { input: string }[]).map((p) => p.input).join(' ')).not.toContain('Half');
    } finally {
      vi.useRealTimers();
    }
  });
});

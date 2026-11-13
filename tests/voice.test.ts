import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConfig, Settings } from '../src/storage/settings';
import { clampChunk, clampSilenceLevel, clampSilenceStop, clampTabChunk, clampTemperature, languageOf, silenceText, tabAudioTarget, tabAudioView, VOCABULARY_CHARS, vocabularyOf, voiceTarget } from '../src/voice/settings';
import { openMic } from '../src/voice/mic';
import { rankAudioModels } from '../src/voice/models';
import { ChunkOrder } from '../src/voice/order';
import { insertText } from '../src/voice/insert';
import { dictationOptions, joinPrompt, promptTail, tabAudioOptions, transcribe, transcribeTimed, transcriptionRequest } from '../src/voice/transcribe';

const provider: ProviderConfig = { id: 'p1', name: 'Example', baseURL: 'https://api.example.test/v1/', apiKey: 'k', defaultModel: '', extraHeaders: { 'X-Team': 'a' } };
const settings = (voice?: Settings['voice']): Settings => ({ providers: [provider], systemPrompt: '', voice });

describe('voice settings', () => {
  it('keeps the chunk length within 0.5–30 s by half seconds, 3 by default', () => {
    expect(clampChunk(undefined)).toBe(3);
    expect(clampChunk(Number.NaN)).toBe(3);
    expect(clampChunk(0)).toBe(0.5);
    expect(clampChunk(0.2)).toBe(0.5);
    expect(clampChunk(0.5)).toBe(0.5);
    expect(clampChunk(99)).toBe(30);
    expect(clampChunk(1.5)).toBe(1.5);
    expect(clampChunk(2.5)).toBe(2.5);
    expect(clampChunk(2.6)).toBe(2.5);
    expect(clampChunk(2.8)).toBe(3);
  });
  it('reads a removed provider as no model chosen', () => {
    expect(voiceTarget(settings({ providerId: 'gone', model: 'whisper-1' })).provider).toBeUndefined();
    expect(voiceTarget(settings()).chunkSeconds).toBe(3);
    const t = voiceTarget(settings({ providerId: 'p1', model: ' whisper-1 ', language: ' es ', chunkSeconds: 5 }));
    expect(t).toEqual({ provider, model: 'whisper-1', language: 'es', chunkSeconds: 5, silenceLevel: 0.01, silenceStopMs: 60_000 });
    expect(voiceTarget(settings({ providerId: 'p1', model: '  ' })).model).toBeUndefined();
    expect(voiceTarget(settings({ chunkSeconds: 1.5 })).chunkSeconds).toBe(1.5);
  });
});

describe('audio models', () => {
  it('lists the speech-to-text looking ones first, each group in its order', () => {
    expect(rankAudioModels(['gpt-4o', 'whisper-1', 'llama', 'gpt-4o-transcribe'])).toEqual(['whisper-1', 'gpt-4o-transcribe', 'gpt-4o', 'llama']);
  });
});

describe('chunk order', () => {
  it('gives the texts in recording order, whatever order they come in', () => {
    const order = new ChunkOrder();
    const [a, b, c] = [order.add(), order.add(), order.add()];
    expect(order.pending).toBe(3);
    expect(order.settle(b, 'two')).toEqual([]);
    expect(order.settle(a, 'one')).toEqual(['one', 'two']);
    expect(order.pending).toBe(1);
    expect(order.settle(c, 'three')).toEqual(['three']);
  });
  it('an empty text (silence, a failed chunk) still lets the next ones through', () => {
    const order = new ChunkOrder();
    const [a, b] = [order.add(), order.add()];
    expect(order.settle(b, 'after')).toEqual([]);
    expect(order.settle(a, '')).toEqual(['after']);
  });
});

describe('the options added to Settings → Voice', () => {
  it('reads settings saved before them as they behaved: no vocabulary, no temperature, the old silence', () => {
    const t = voiceTarget(settings({ providerId: 'p1', model: 'whisper-1', language: 'es', chunkSeconds: 3 }));
    expect(t.vocabulary).toBeUndefined();
    expect(t.temperature).toBeUndefined();
    expect(t.silenceLevel).toBe(0.01);
    expect(t.silenceStopMs).toBe(60_000);
  });
  it('keeps the vocabulary trimmed and within its characters', () => {
    expect(vocabularyOf('  Teseo, WXT ')).toBe('Teseo, WXT');
    expect(vocabularyOf('   ')).toBeUndefined();
    expect(vocabularyOf('x'.repeat(VOCABULARY_CHARS + 50))).toHaveLength(VOCABULARY_CHARS);
    expect(VOCABULARY_CHARS).toBe(300);
  });
  it('reads a hand-edited import that is not text as none, never failing', () => {
    expect(vocabularyOf(123)).toBeUndefined();
    const t = voiceTarget(settings({ providerId: 'p1', model: 'm', vocabulary: 123, tabLanguage: ['en'] } as never));
    expect(t.vocabulary).toBeUndefined();
    expect(tabAudioTarget(settings({ providerId: 'p1', model: 'm', vocabulary: 123, tabLanguage: ['en'] } as never))).toEqual({ provider, model: 'm', chunkSeconds: 30 });
  });
  it('takes a language as a 2 or 3 letter code only', () => {
    expect([languageOf('en'), languageOf(' spa '), languageOf('english'), languageOf('e'), languageOf('en-US'), languageOf(1)]).toEqual(['en', 'spa', undefined, undefined, undefined, undefined]);
    expect(tabAudioTarget(settings({ providerId: 'p1', model: 'm', tabLanguage: 'English' }))?.language).toBeUndefined();
  });
  it('says how long the silence that stopped a dictation was', () => {
    expect([silenceText(60_000), silenceText(90_000), silenceText(120_000), silenceText(10_000)]).toEqual(['a minute', '90 seconds', '2 minutes', '10 seconds']);
  });
  it('keeps the temperature within 0–1, none when unset', () => {
    expect([clampTemperature(undefined), clampTemperature(NaN), clampTemperature(-1), clampTemperature(0), clampTemperature(0.25), clampTemperature(3)]).toEqual([undefined, undefined, 0, 0, 0.25, 1]);
    expect(voiceTarget(settings({ temperature: 0 })).temperature).toBe(0);
  });
  it('keeps the silence level within 0–0.1 and the silence stop within 10–600 s, 0 for never', () => {
    expect([clampSilenceLevel(undefined), clampSilenceLevel(-1), clampSilenceLevel(0), clampSilenceLevel(0.02), clampSilenceLevel(1)]).toEqual([0.01, 0, 0, 0.02, 0.1]);
    expect([clampSilenceStop(undefined), clampSilenceStop(0), clampSilenceStop(-5), clampSilenceStop(3), clampSilenceStop(90.4), clampSilenceStop(9999)]).toEqual([60, 0, 0, 10, 90, 600]);
    expect(voiceTarget(settings({ silenceStopSeconds: 0 })).silenceStopMs).toBe(Infinity);
    expect(voiceTarget(settings({ silenceStopSeconds: 30 })).silenceStopMs).toBe(30_000);
  });
});

describe('the prompt: the vocabulary, then the tail of what was said', () => {
  it('puts the vocabulary first and the tail last, by the cut (a long prompt loses its start)', () => {
    expect(joinPrompt('Teseo, WXT', 'and then we')).toBe('Teseo, WXT and then we');
    expect(joinPrompt(undefined, 'and then we')).toBe('and then we');
    expect(joinPrompt('Teseo', '')).toBe('Teseo');
    expect(joinPrompt(undefined, '')).toBe('');
  });
  it('stays within what the models read: the vocabulary and the tail at most', () => {
    expect(joinPrompt(vocabularyOf('v'.repeat(1000)), promptTail('t'.repeat(1000)))).toHaveLength(VOCABULARY_CHARS + 1 + 200);
  });
});

describe("a chunk's options", () => {
  it("dictation's: the model, the language, the vocabulary then the tail, the temperature", () => {
    expect(dictationOptions({ model: 'm', language: 'es', vocabulary: 'Teseo', temperature: 0.2 }, 'and then')).toEqual({ model: 'm', language: 'es', prompt: 'Teseo and then', temperature: 0.2 });
    expect(dictationOptions({ model: 'm' }, '')).toEqual({ model: 'm' });
  });
  it("a tab's audio's: its own language, the vocabulary alone", () => {
    expect(tabAudioOptions({ provider, model: 'm', chunkSeconds: 30, language: 'en', prompt: 'Teseo', temperature: 0 })).toEqual({ model: 'm', language: 'en', prompt: 'Teseo', temperature: 0 });
    expect(tabAudioOptions({ provider, model: 'm', chunkSeconds: 30 })).toEqual({ model: 'm' });
  });
});

describe("the model that transcribes a tab's audio", () => {
  it('takes a language of its own, the vocabulary alone as its prompt, the temperature and silence level', () => {
    const voice = { providerId: 'p1', model: 'whisper-1', language: 'es', tabLanguage: ' en ', vocabulary: 'Teseo', temperature: 0.2, silenceLevel: 0.005 };
    expect(tabAudioTarget(settings(voice))).toEqual({ provider, model: 'whisper-1', chunkSeconds: 30, language: 'en', prompt: 'Teseo', temperature: 0.2, silenceLevel: 0.005 });
  });
  it('is the same one, without the language you dictate in: a page may speak any other', () => {
    const voice = { providerId: 'p1', model: ' whisper-1 ', language: 'es' };
    expect(voiceTarget(settings(voice)).language).toBe('es');
    expect(tabAudioTarget(settings(voice))).toEqual({ provider, model: 'whisper-1', chunkSeconds: 30 });
  });
  it('has a chunk length of its own, not dictation\'s: 5–30 s by fives, 30 by default', () => {
    expect(tabAudioTarget(settings({ providerId: 'p1', model: 'm', chunkSeconds: 3, tabChunkSeconds: 15 }))?.chunkSeconds).toBe(15);
    expect([clampTabChunk(undefined), clampTabChunk(1), clampTabChunk(17), clampTabChunk(99), clampTabChunk(NaN)]).toEqual([30, 5, 15, 30, 30]);
  });
  it('shows on the page what was chosen, the time and Stop alone by default', () => {
    expect(tabAudioView(settings())).toBe('pill');
    expect(tabAudioView(settings({ tabAudioView: 'waves' }))).toBe('waves');
    expect(tabAudioView(settings({ tabAudioView: 'other' as never }))).toBe('pill');
  });
  it('none without a model, or with its provider removed', () => {
    expect(tabAudioTarget(settings({ providerId: 'p1' }))).toBeUndefined();
    expect(tabAudioTarget(settings({ providerId: 'gone', model: 'm' }))).toBeUndefined();
  });
});

describe('insertion in the box', () => {
  it('separates the dictated text with spaces, never overwriting', () => {
    expect(insertText('hello', 5, 'world')).toEqual({ value: 'hello world', caret: 11 });
    expect(insertText('ab', 1, 'x')).toEqual({ value: 'a x b', caret: 3 });
    expect(insertText('', 0, 'hi')).toEqual({ value: 'hi', caret: 2 });
    expect(insertText('end ', 99, 'more')).toEqual({ value: 'end more', caret: 8 });
    expect(insertText('a\n', 2, 'b')).toEqual({ value: 'a\nb', caret: 3 });
  });
});

describe('the transcription request', () => {
  it('posts the chunk as multipart with the provider headers, no JSON content type', () => {
    const audio = new Blob(['x'], { type: 'audio/webm' });
    const { url, init } = transcriptionRequest(provider, audio, { model: 'whisper-1', language: 'es', prompt: 'before' });
    expect(url).toBe('https://api.example.test/v1/audio/transcriptions');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers).toEqual({ Authorization: 'Bearer k', 'X-Team': 'a' });
    const form = init.body as FormData;
    expect((form.get('file') as File).name).toBe('chunk.webm');
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('language')).toBe('es');
    expect(form.get('prompt')).toBe('before');
  });
  it('sends the temperature when set, 0 too, and leaves it out unset', () => {
    const form = (temperature?: number) => transcriptionRequest(provider, new Blob(['x']), { model: 'm', temperature }).init.body as FormData;
    expect(form(0.3).get('temperature')).toBe('0.3');
    expect(form(0).get('temperature')).toBe('0');
    expect(form(undefined).has('temperature')).toBe(false);
    expect(form(NaN).has('temperature')).toBe(false);
  });
  it('leaves out an empty language and prompt', () => {
    const form = transcriptionRequest(provider, new Blob(['x']), { model: 'm', language: '', prompt: '' }).init.body as FormData;
    expect(form.has('language')).toBe(false);
    expect(form.has('prompt')).toBe(false);
  });
  it('keeps the last 200 characters as the prompt', () => {
    expect(promptTail('a'.repeat(100) + 'b'.repeat(200))).toBe('b'.repeat(200));
    expect(promptTail('short')).toBe('short');
  });

  afterEach(() => vi.unstubAllGlobals());
  it('reads JSON or plain text, and fails with the status', async () => {
    const reply = (body: string, status = 200) => vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })));
    reply('{"text":" hi "}');
    expect(await transcribe(provider, new Blob(['x']), { model: 'm' })).toBe('hi');
    reply('hola\n');
    expect(await transcribe(provider, new Blob(['x']), { model: 'm' })).toBe('hola');
    reply('{"error":"bad key"}', 401);
    await expect(transcribe(provider, new Blob(['x']), { model: 'm' })).rejects.toThrow(/401/);
  });
  it('asks for segments with their times, and for the text alone where they are refused', async () => {
    const formats: (string | null)[] = [];
    const replies = (...bodies: [string, number][]) =>
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
        formats.push((init.body as FormData).get('response_format') as string | null);
        const [body, status] = bodies.shift()!;
        return new Response(body, { status });
      }));
    replies(['{"text":"a b","segments":[{"start":0,"end":1.5,"text":" a "},{"start":1.5,"end":3,"text":"b"},{"start":3,"end":4,"text":" "}]}', 200]);
    expect(await transcribeTimed(provider, new Blob(['x']), { model: 'whisper-1' })).toEqual({ text: 'a b', segments: [{ start: 0, end: 1.5, text: 'a' }, { start: 1.5, end: 3, text: 'b' }] });
    replies(['{"error":"response_format verbose_json is not supported"}', 400], ['{"text":"plain"}', 200]);
    expect(await transcribeTimed(provider, new Blob(['x']), { model: 'gpt-4o-transcribe' })).toEqual({ text: 'plain' });
    expect(formats).toEqual(['verbose_json', 'verbose_json', null]);
    replies(['{"error":"bad key"}', 401]);
    await expect(transcribeTimed(provider, new Blob(['x']), { model: 'm' })).rejects.toThrow(/401/);
  });
  it('sends the language, prompt and temperature with both requests when the segments are refused', async () => {
    const forms: FormData[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      forms.push(init.body as FormData);
      return forms.length === 1 ? new Response('{"error":"no"}', { status: 400 }) : new Response('{"text":"plain"}');
    }));
    expect(await transcribeTimed(provider, new Blob(['x']), { model: 'fallback-model', language: 'en', prompt: 'Teseo', temperature: 0.2 })).toEqual({ text: 'plain' });
    expect(forms.map((f) => [f.get('response_format'), f.get('language'), f.get('prompt'), f.get('temperature')])).toEqual([
      ['verbose_json', 'en', 'Teseo', '0.2'],
      [null, 'en', 'Teseo', '0.2'],
    ]);
  });
  it('remembers a model that refused the segments: the next chunk is sent once, for the text alone', async () => {
    const formats: (string | null)[] = [];
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const format = (init.body as FormData).get('response_format') as string | null;
      formats.push(format);
      return format ? new Response('{"error":"verbose_json is not supported"}', { status: 422 }) : new Response('{"text":"plain"}');
    });
    vi.stubGlobal('fetch', fetch);
    expect(await transcribeTimed(provider, new Blob(['x']), { model: 'local-whisper' })).toEqual({ text: 'plain' });
    expect(await transcribeTimed(provider, new Blob(['y']), { model: 'local-whisper' })).toEqual({ text: 'plain' });
    expect(formats).toEqual(['verbose_json', null, null]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe('a chunk that does not come back', () => {
  it('is given up after a while, and the caller\'s own signal still stops it', async () => {
    const hanging = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))));
    vi.stubGlobal('fetch', hanging);
    const late = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(late.signal);
    try {
      const sending = transcribeTimed(provider, new Blob(['x']), { model: 'slow' });
      await vi.waitFor(() => expect(hanging).toHaveBeenCalled());
      late.abort(new DOMException('The operation timed out.', 'TimeoutError'));
      await expect(sending).rejects.toThrow(/timed out/);
      expect(timeout).toHaveBeenCalledWith(expect.any(Number));
    } finally {
      timeout.mockRestore();
    }
    const mine = new AbortController();
    const stopped = transcribe(provider, new Blob(['x']), { model: 'slow' }, mine.signal);
    await vi.waitFor(() => expect(hanging).toHaveBeenCalledTimes(2));
    mine.abort(new Error('Stopped.'));
    await expect(stopped).rejects.toThrow('Stopped.');
  });

  it('a server that refused the segments is remembered only once the text alone came back', async () => {
    const formats: (string | null)[] = [];
    const statuses = [400, 500, 400, 200, 200];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      formats.push((init.body as FormData).get('response_format') as string | null);
      const status = statuses.shift()!;
      return new Response(status === 200 ? '{"text":"plain"}' : '{"error":"no"}', { status });
    }));
    await expect(transcribeTimed(provider, new Blob(['x']), { model: 'flaky' })).rejects.toThrow(/500/);
    expect(await transcribeTimed(provider, new Blob(['x']), { model: 'flaky' })).toEqual({ text: 'plain' });
    expect(await transcribeTimed(provider, new Blob(['x']), { model: 'flaky' })).toEqual({ text: 'plain' });
    expect(formats).toEqual(['verbose_json', null, 'verbose_json', null, null]);
  });
});

describe('the microphone chosen', () => {
  const stream = {} as MediaStream;
  const error = (name: string) => Object.assign(new Error(name), { name });
  it('asks for it by id, or for the default without one', async () => {
    const ask = vi.fn(async () => stream);
    expect(await openMic(ask, 'mic-2')).toBe(stream);
    expect(ask).toHaveBeenLastCalledWith({ audio: { deviceId: { exact: 'mic-2' } } });
    await openMic(ask, undefined);
    expect(ask).toHaveBeenLastCalledWith({ audio: true });
  });
  it('takes the default when the chosen one is gone', async () => {
    for (const name of ['OverconstrainedError', 'NotFoundError']) {
      const ask = vi.fn(async (c: MediaStreamConstraints) => (c.audio === true ? stream : Promise.reject(error(name))));
      expect(await openMic(ask, 'unplugged')).toBe(stream);
      expect(ask).toHaveBeenCalledTimes(2);
    }
  });
  it('does not try the default when the microphone is blocked', async () => {
    const ask = vi.fn(async () => Promise.reject(error('NotAllowedError')));
    await expect(openMic(ask, 'mic-2')).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(ask).toHaveBeenCalledTimes(1);
  });
  it('reads the chosen one from the settings', () => {
    expect(voiceTarget(settings({ deviceId: 'mic-2' })).deviceId).toBe('mic-2');
  });
});

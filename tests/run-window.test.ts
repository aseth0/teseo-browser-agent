// The window a run fits its requests in: the panel's, else what is known of the model here (set for
// it, learned, set for its provider), else Settings → Compaction's for an unknown one (0: none).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { checkLearnedWindow, forgetContextWindow, learnContextWindow, runWindow } = await import('../src/context/window');
const { COMPACTION_DEFAULTS } = await import('../src/context/compaction');

const cfg = { id: 'p', name: 'P', baseURL: 'https://llm.test/v1', apiKey: '', defaultModel: 'm' };
const settings = { providers: [cfg], systemPrompt: '' };

beforeEach(() => storage.reset());

describe('runWindow', () => {
  it('is the panel\'s, then the model\'s set, learned, the provider\'s, then the default', async () => {
    expect(await runWindow(settings, cfg, 'm', { tokens: 9000, source: 'server' })).toEqual({ tokens: 9000, source: 'server' });
    expect(await runWindow(settings, cfg, 'm', { tokens: 72000, source: 'default' })).toEqual({ tokens: 72000, source: 'default' });
    expect(await runWindow(settings, cfg, 'm')).toEqual({ tokens: COMPACTION_DEFAULTS.defaultWindow, source: 'default' });
    expect(await runWindow(settings, { ...cfg, contextWindow: 16000 }, 'm')).toEqual({ tokens: 16000, source: 'settings' });
    await learnContextWindow('p', 'm', "This model's maximum context length is 32000 tokens.");
    expect(await runWindow(settings, { ...cfg, contextWindow: 16000 }, 'm')).toEqual({ tokens: 32000, source: 'error' });
    expect(await runWindow({ ...settings, contextWindows: { 'p|m': 64000 } }, cfg, 'm')).toEqual({ tokens: 64000, source: 'model-settings' });
  });

  it('is none for an unknown window when Settings → Compaction says 0', async () => {
    expect((await runWindow({ ...settings, compaction: { defaultWindow: 0 } }, cfg, 'other')).tokens).toBeUndefined();
  });
});

describe('a learned window', () => {
  it('is learned only from an error that refused the request as too long', async () => {
    await learnContextWindow('p', 'm', 'chat 400: max_tokens is larger than the context length of 8192');
    expect((await runWindow(settings, cfg, 'm')).source).toBe('default');
    await learnContextWindow('p', 'm', 'chat 400: the input exceeds the context length of 8192 tokens');
    expect(await runWindow(settings, cfg, 'm')).toEqual({ tokens: 8192, source: 'error' });
  });

  it('is forgotten once stale: a later call took more than it, or from Settings', async () => {
    await learnContextWindow('p', 'm', "This model's maximum context length is 16000 tokens.");
    await checkLearnedWindow('p', 'm', 12000); // fits: kept
    expect((await runWindow(settings, cfg, 'm')).tokens).toBe(16000);
    await checkLearnedWindow('p', 'm', 40000); // the server took more: the learned one was stale
    expect(await runWindow(settings, cfg, 'm')).toEqual({ tokens: COMPACTION_DEFAULTS.defaultWindow, source: 'default' });
    await learnContextWindow('p', 'm', "This model's maximum context length is 16000 tokens.");
    await forgetContextWindow('p|m');
    expect((await runWindow(settings, cfg, 'm')).source).toBe('default');
  });
});

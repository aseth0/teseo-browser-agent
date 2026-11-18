import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeSecretDb, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
const store = storage.local.data;
const secrets = fakeSecretDb();
vi.mock('../src/storage/secret-db', () => secrets);
// With offscreen documents, as Chrome: Speak can read (core/build). A test takes them out, as Firefox.
const api: Record<string, unknown> = { ...fakeBrowser(storage), offscreen: {} };
vi.mock('wxt/browser', () => ({ browser: api }));

const { loadSettings, onSettingsChanged, saveSettings, syncWidgetSettings } = await import('../src/storage/settings');
const { ENV_PROVIDER_ID } = await import('../src/storage/settings-migrate');
const { DEFAULT_SYSTEM_PROMPT } = await import('../src/storage/settings-types');
const { keepEnvKey } = await import('../src/background/env-key');

afterEach(() => {
  vi.unstubAllGlobals();
  storage.reset();
  secrets.data.clear();
  secrets.trusted = true;
});

describe('the key injected at build time', () => {
  const injected = () => vi.stubGlobal('__ENV_PROVIDER__', { baseURL: 'https://llm.test/v1', defaultModel: 'm' });

  it('is kept by the worker where the pages read it, never in the settings', async () => {
    injected();
    await keepEnvKey('sk-build');
    const settings = await loadSettings();
    expect(settings.providers.find((p) => p.id === ENV_PROVIDER_ID)?.apiKey).toBe('sk-build');
    await saveSettings(settings);
    expect(JSON.stringify(store.settings)).not.toContain('sk-build');
    expect(JSON.stringify([...secrets.data.entries()].filter(([name]) => name !== 'envKey'))).not.toContain('sk-build');
    expect((await loadSettings()).providers[0]!.apiKey).toBe('sk-build');
  });

  it('reaches the pages once the worker keeps it, and is gone with a build without one', async () => {
    injected();
    const seen: string[] = [];
    const stop = onSettingsChanged((s) => seen.push(s.providers.find((p) => p.id === ENV_PROVIDER_ID)?.apiKey ?? 'none'));
    expect((await loadSettings()).providers[0]!.apiKey).toBe(''); // not kept yet
    await keepEnvKey('sk-build');
    await vi.waitFor(() => expect(seen).toEqual(['sk-build']));
    stop();
    await keepEnvKey(undefined);
    expect(secrets.data.has('envKey')).toBe(false);
  });

  it('goes only to the URL saved for it, or the build\'s', async () => {
    injected();
    await keepEnvKey('sk-build');
    await saveSettings(await loadSettings());
    await loadSettings();
    const open = store.settings as { providers: { id: string; baseURL: string }[] };
    store.settings = { ...open, providers: open.providers.map((p) => ({ ...p, baseURL: 'https://elsewhere.test/v1' })) };
    expect((await loadSettings()).providers[0]!.apiKey).toBe('');
  });

  it('leaves a stored key alone in a build without one', async () => {
    const settings = { ...(await loadSettings()), providers: [{ id: ENV_PROVIDER_ID, name: 'Mine', baseURL: 'https://x.test/v1', apiKey: 'typed', defaultModel: 'm' }] };
    await saveSettings(settings);
    expect((await loadSettings()).providers[0]!.apiKey).toBe('typed');
  });
});

describe("the page widget's own key", () => {
  const settings = { providers: [{ id: 'p', name: 'P', baseURL: 'https://llm.test/v1', apiKey: 'sk-secret', defaultModel: 'm' }], systemPrompt: 'x', appearance: { mode: 'dark' as const }, pageWidget: { everywhere: false } };
  it('is saved with the settings, without anything else of them', async () => {
    await saveSettings(settings);
    // Speak's buttons on: without a profile, the system voice reads.
    expect(store.widgetSettings).toEqual({ appearance: { mode: 'dark' }, pageWidget: { everywhere: false }, speakButton: true, speakBoxes: 'on', canSpeak: true, pieceSizes: { first: 120, rest: 300 } });
    expect(JSON.stringify(store.widgetSettings)).not.toContain('sk-secret');
  });
  it('is made again from settings saved before it existed, or written without it', async () => {
    store.settings = settings;
    await syncWidgetSettings();
    expect(store.widgetSettings).toEqual({ appearance: { mode: 'dark' }, pageWidget: { everywhere: false }, speakButton: true, speakBoxes: 'on', canSpeak: true, pieceSizes: { first: 120, rest: 300 } });
    store.settings = { ...settings, appearance: { mode: 'light' }, speak: { systemVoice: false } };
    await syncWidgetSettings();
    expect(store.widgetSettings).toEqual({ appearance: { mode: 'light' }, pageWidget: { everywhere: false }, speakBoxes: 'setup' });
  });
  it('has none of Speak where the browser cannot read aloud: the page gets no button that could only fail', async () => {
    const { offscreen } = api;
    delete api.offscreen;
    try {
      await saveSettings(settings);
      expect(store.widgetSettings).toEqual({ appearance: { mode: 'dark' }, pageWidget: { everywhere: false } });
    } finally {
      api.offscreen = offscreen;
    }
  });
  it('tells the page where the chat cannot float (Firefox), which it cannot ask itself: the chat window kept as saved', async () => {
    vi.stubGlobal('__FIREFOX__', true);
    await saveSettings({ ...settings, chatWindow: { opens: 'floating', side: 'left' } });
    expect(store.widgetSettings).toMatchObject({ chatWindow: { opens: 'floating', side: 'left' }, noFloating: true });
    vi.unstubAllGlobals();
    await saveSettings({ ...settings, chatWindow: { opens: 'floating' } });
    expect(store.widgetSettings).not.toHaveProperty('noFloating');
  });
  it('is not made without settings', async () => {
    await syncWidgetSettings();
    expect('widgetSettings' in store).toBe(false);
  });
});

describe('the secrets of the settings', () => {
  const settings = {
    providers: [{ id: 'p', name: 'P', baseURL: 'https://llm.test/v1', apiKey: 'sk-secret', defaultModel: 'm', extraHeaders: { 'api-key': 'hdr-secret' } }],
    systemPrompt: 'x',
    mcpServers: [{ id: 's', name: 'notes', url: 'https://mcp.example.com/mcp', enabled: true, headers: { Authorization: 'Bearer mcp-secret' }, oauth: { clientId: 'c', clientSecret: 'client-secret' } }],
  };
  const SECRETS = ['sk-secret', 'hdr-secret', 'mcp-secret', 'client-secret'];
  // All a content script can see: storage.local, and every change told to its onChanged listeners.
  const seen: unknown[] = [];
  storage.onChanged.addListener((changes) => seen.push(changes));
  const exposed = () => JSON.stringify([store, seen]);

  it('are kept apart, never in storage.local nor its changes, and read back', async () => {
    seen.length = 0;
    await saveSettings(settings);
    for (const secret of SECRETS) expect(exposed()).not.toContain(secret);
    expect(store.settings).toMatchObject({ providers: [{ id: 'p', apiKey: '' }], mcpServers: [{ id: 's', oauth: { clientId: 'c' } }] });
    expect(await loadSettings()).toMatchObject(settings);
  });

  it('left in storage.local by earlier versions, are moved out on loading', async () => {
    store.settings = settings;
    seen.length = 0;
    expect(await loadSettings()).toMatchObject(settings);
    for (const secret of SECRETS) expect(JSON.stringify(store)).not.toContain(secret);
    expect(JSON.stringify(seen.map((c) => (c as { settings?: { newValue?: unknown } }).settings?.newValue))).not.toContain('sk-secret');
    expect(await loadSettings()).toMatchObject(settings);
  });

  it('written to storage.local after the move, are dropped unread', async () => {
    await saveSettings(settings);
    await loadSettings(); // the move, once
    store.settings = { ...(store.settings as object), providers: [{ ...settings.providers[0]!, apiKey: 'sk-page' }], mcpServers: [{ ...settings.mcpServers[0]!, headers: { Authorization: 'Bearer page' } }] };
    const loaded = await loadSettings();
    expect(loaded.providers[0]!.apiKey).toBe('sk-secret');
    expect(loaded.mcpServers?.[0]?.headers).toEqual({ Authorization: 'Bearer mcp-secret' });
    expect(JSON.stringify(store)).not.toContain('sk-page');
    expect(JSON.stringify([...secrets.data.values()])).not.toContain('sk-page');
  });

  it('go only to the URL they were saved for', async () => {
    await saveSettings(settings);
    await loadSettings(); // the move, once
    const open = store.settings as typeof settings;
    store.settings = { ...open, providers: [{ ...open.providers[0]!, baseURL: 'https://elsewhere.test/v1' }], mcpServers: [{ ...open.mcpServers[0]!, url: 'https://elsewhere.test/mcp' }] };
    const moved = await loadSettings();
    expect(moved.providers[0]!.apiKey).toBe('');
    expect(moved.providers[0]!.extraHeaders).toBeUndefined();
    expect(moved.mcpServers?.[0]?.headers).toBeUndefined();
    expect(moved.mcpServers?.[0]?.oauth).toEqual({ clientId: 'c' });
    // Changed in Settings, where the key is at hand: saved for the new URL.
    await saveSettings({ ...settings, providers: [{ ...settings.providers[0]!, baseURL: 'https://other.test/v1' }] });
    expect((await loadSettings()).providers[0]!.apiKey).toBe('sk-secret');
  });

  it('kept before they had their URL, get the URL they are for on the move', async () => {
    store.settings = { ...settings, providers: [{ ...settings.providers[0]!, apiKey: '', extraHeaders: undefined }], mcpServers: [{ ...settings.mcpServers[0]!, headers: undefined, oauth: { clientId: 'c' } }] };
    secrets.data.set('settings', { providers: { p: { apiKey: 'sk-secret', extraHeaders: { 'api-key': 'hdr-secret' } } }, mcpServers: { s: { headers: { Authorization: 'Bearer mcp-secret' }, clientSecret: 'client-secret' } } });
    expect(await loadSettings()).toMatchObject(settings);
    expect(secrets.data.get('settings')).toMatchObject({ providers: { p: { baseURL: 'https://llm.test/v1' } }, mcpServers: { s: { url: 'https://mcp.example.com/mcp' } } });
  });

  it("of an MCP server keep the provider whose key fills its {{apiKey}}; the one in storage.local is never read", async () => {
    const gateway = { ...settings, mcpServers: [{ ...settings.mcpServers[0]!, headers: { Authorization: 'Bearer {{apiKey}}' }, providerId: 'p' }] };
    await saveSettings(gateway);
    await loadSettings(); // the moves, once
    expect(store.settings).toMatchObject({ mcpServers: [{ providerId: 'p' }] }); // the copy earlier versions read
    store.settings = { ...(store.settings as object), mcpServers: [{ ...(store.settings as typeof gateway).mcpServers[0]!, providerId: 'other' }] };
    expect((await loadSettings()).mcpServers?.[0]?.providerId).toBe('p');
    // Kept only in storage.local by an earlier version: moved once, for the server's URL.
    storage.reset();
    secrets.data.clear();
    store.settings = { ...gateway, providers: [{ ...gateway.providers[0]!, apiKey: '' }], mcpServers: [{ ...gateway.mcpServers[0]!, headers: undefined, oauth: { clientId: 'c' } }] };
    secrets.data.set('moved', { settingsSecrets: true });
    secrets.data.set('settings', { providers: { p: { baseURL: 'https://llm.test/v1', apiKey: 'sk-secret' } }, mcpServers: { s: { url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer {{apiKey}}' } } } });
    expect((await loadSettings()).mcpServers?.[0]).toMatchObject({ providerId: 'p', headers: { Authorization: 'Bearer {{apiKey}}' } });
  });

  // What a build ≤ v0.57.15 writes on saving, sharing the profile: the secrets without their URLs.
  const olderBuildSecrets = { providers: { p: { apiKey: 'sk-older', extraHeaders: { 'api-key': 'hdr-older' } } }, mcpServers: { s: { headers: { Authorization: 'Bearer older' }, clientSecret: 'client-older' } } };

  it('saved by an older build after the move, get the URL stored now, and that build still reads them', async () => {
    await saveSettings(settings);
    await loadSettings(); // the move, once
    secrets.data.set('settings', olderBuildSecrets);
    const loaded = await loadSettings();
    expect(loaded.providers[0]).toMatchObject({ apiKey: 'sk-older', extraHeaders: { 'api-key': 'hdr-older' } });
    expect(loaded.mcpServers?.[0]).toMatchObject({ headers: { Authorization: 'Bearer older' }, oauth: { clientId: 'c', clientSecret: 'client-older' } });
    // As the older build reads them: by id, the URL beside them unread.
    expect(secrets.data.get('settings')).toEqual({
      providers: { p: { ...olderBuildSecrets.providers.p, baseURL: 'https://llm.test/v1' } },
      mcpServers: { s: { ...olderBuildSecrets.mcpServers.s, url: 'https://mcp.example.com/mcp' } },
    });
  });

  it('saved by an older build, are bound before another page is told', async () => {
    await saveSettings(settings);
    await loadSettings();
    const told = vi.fn();
    const off = onSettingsChanged(told);
    secrets.data.set('settings', olderBuildSecrets);
    await storage.local.set({ secretsRev: { settings: 'older-build' } });
    await vi.waitFor(() => expect(told).toHaveBeenCalled());
    expect(told.mock.lastCall?.[0].providers[0].apiKey).toBe('sk-older');
    expect(told.mock.lastCall?.[0].mcpServers[0].headers).toEqual({ Authorization: 'Bearer older' });
    off();
  });

  it("saved by an older build, keep an MCP server's provider for its {{apiKey}}", async () => {
    const gateway = { ...settings, mcpServers: [{ ...settings.mcpServers[0]!, headers: { Authorization: 'Bearer {{apiKey}}' }, providerId: 'p' }] };
    await saveSettings(gateway);
    await loadSettings(); // the moves, once
    // That build's save: the server's headers by id, without its URL nor its provider.
    secrets.data.set('settings', { providers: { p: { apiKey: 'sk-older' } }, mcpServers: { s: { headers: { Authorization: 'Bearer {{apiKey}}' } } } });
    expect((await loadSettings()).mcpServers?.[0]).toMatchObject({ providerId: 'p', headers: { Authorization: 'Bearer {{apiKey}}' } });
  });

  it('with a URL that is not the stored one, are still refused', async () => {
    await saveSettings(settings);
    await loadSettings();
    secrets.data.set('settings', { providers: { p: { baseURL: 'https://elsewhere.test/v1', apiKey: 'sk-elsewhere' } }, mcpServers: { s: { url: 'https://elsewhere.test/mcp', headers: { Authorization: 'Bearer elsewhere' } } } });
    const loaded = await loadSettings();
    expect(loaded.providers[0]!.apiKey).toBe('');
    expect(loaded.mcpServers?.[0]?.headers).toBeUndefined();
    expect(secrets.data.get('settings')).toMatchObject({ providers: { p: { baseURL: 'https://elsewhere.test/v1' } } });
  });

  it('go with their provider or server', async () => {
    await saveSettings(settings);
    await saveSettings({ ...settings, providers: [], mcpServers: [] });
    expect(secrets.data.get('settings')).toEqual({});
  });

  it('changed alone, are told to the other pages', async () => {
    await saveSettings(settings);
    const told = vi.fn();
    const off = onSettingsChanged(told);
    await saveSettings({ ...settings, providers: [{ ...settings.providers[0]!, apiKey: 'sk-new' }] });
    await vi.waitFor(() => expect(told).toHaveBeenCalled());
    expect(told.mock.lastCall?.[0].providers[0].apiKey).toBe('sk-new');
    expect(exposed()).not.toContain('sk-new');
    off();
  });

  it('changed in another page, are read again', async () => {
    await saveSettings(settings);
    const told = vi.fn();
    const off = onSettingsChanged(told);
    // Another page's save: the secret written, then its stamp.
    secrets.data.set('settings', { providers: { p: { baseURL: 'https://llm.test/v1', apiKey: 'sk-other' } } });
    await storage.local.set({ secretsRev: { settings: 'another-page' } });
    await vi.waitFor(() => expect(told).toHaveBeenCalled());
    expect(told.mock.lastCall?.[0].providers[0].apiKey).toBe('sk-other');
    off();
  });

  it('cannot be read outside the extension\'s own pages', async () => {
    await saveSettings(settings);
    secrets.trusted = false;
    await expect(loadSettings()).rejects.toThrow("extension's own pages");
  });
});

describe('settings saved by earlier versions', () => {
  const provider = { id: 'p', name: 'P', baseURL: 'https://llm.test/v1', apiKey: '', defaultModel: 'm' };

  it('lose the providers of a kind no longer supported', async () => {
    store.settings = { providers: [{ ...provider, id: 'old', kind: 'anthropic' }, provider], systemPrompt: 'x' };
    expect((await loadSettings()).providers.map((p) => p.id)).toEqual(['p']);
  });

  it('get the current system prompt in place of the first one', async () => {
    // The first versions' default prompt, as they stored it (not English: it is their text).
    store.settings = { providers: [provider], systemPrompt: 'Eres un asistente integrado en el navegador…' };
    expect((await loadSettings()).systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
    store.settings = { providers: [provider], systemPrompt: 'My own prompt.' };
    expect((await loadSettings()).systemPrompt).toBe('My own prompt.');
  });

  it('turn the Markdown switch off into plain text, and drop the switch', async () => {
    store.settings = { providers: [provider], systemPrompt: 'x', renderMarkdown: false };
    const off = await loadSettings();
    expect(off.chatRender).toBe('plain');
    expect('renderMarkdown' in off).toBe(false);
    store.settings = { providers: [provider], systemPrompt: 'x', renderMarkdown: true };
    const on = await loadSettings();
    expect(on.chatRender).toBeUndefined();
    expect('renderMarkdown' in on).toBe(false);
  });
});

describe('settings stored in another shape', () => {
  it('read as the defaults where they cannot be read, instead of throwing', async () => {
    const { normalize } = await import('../src/storage/settings-migrate');
    expect(normalize('garbage' as never)).toMatchObject({ providers: [], systemPrompt: DEFAULT_SYSTEM_PROMPT });
    expect(normalize({ providers: 'x', systemPrompt: 5 } as never)).toMatchObject({ providers: [], systemPrompt: DEFAULT_SYSTEM_PROMPT });
    expect(normalize({ providers: [null, { id: 'p', kind: 'anthropic' }, { id: 'q' }] } as never).providers).toEqual([{ id: 'q' }]);
  });
});

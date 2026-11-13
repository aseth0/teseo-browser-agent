// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeatureId } from '../src/core/build';
import type { Settings } from '../src/storage/settings';

// What a build leaves out (core/build) and how the UI tells it (ui/FeatureNotice), in each of the three
// builds: the downloadable Chrome one (everything), the Chrome Web Store's (__STORE__, no debugger
// permission) and Firefox's (no debugger, offscreen, tts, tabCapture nor sidePanel).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REPO = 'https://github.com/example/teseo';
const fake = vi.hoisted(() => ({ browser: {} as Record<string, unknown> }));
vi.mock('wxt/browser', () => fake);
vi.mock('../src/ui/SectionTop', () => ({ SectionTop: () => null }));

type Build = 'chrome' | 'store' | 'firefox';
const runtime = { getManifest: () => ({ version: '1.2.3' }), id: 'test', sendMessage: vi.fn(async () => undefined), onMessage: { addListener() {}, removeListener() {} } };
const CHROMIUM = { debugger: {}, offscreen: {}, tts: {}, tabCapture: {}, sidePanel: {} };
function browserOf(build: Build): Record<string, unknown> {
  if (build === 'chrome') return { runtime, ...CHROMIUM };
  const { debugger: _d, ...store } = CHROMIUM; // the store's manifest has no debugger permission
  return build === 'store' ? { runtime, ...store } : { runtime };
}

async function load(build: Build, release = false) {
  vi.resetModules();
  fake.browser = browserOf(build);
  vi.stubGlobal('__STORE__', build === 'store');
  vi.stubGlobal('__REPO_URL__', REPO);
  vi.stubGlobal('__RELEASE_BUILD__', release);
  return {
    build: await import('../src/core/build'),
    links: await import('../src/core/links'),
    notice: await import('../src/ui/FeatureNotice'),
    texts: await import('../src/ui/feature-texts'),
  };
}

const mounted: (() => void)[] = [];
async function render(el: ReactElement) {
  const box = document.createElement('div');
  document.body.append(box);
  const root = createRoot(box);
  await act(async () => root.render(el));
  mounted.push(() => { act(() => root.unmount()); box.remove(); });
  return box;
}

afterEach(() => {
  mounted.splice(0).forEach((u) => u());
  vi.unstubAllGlobals();
});

// The two sentences, as the user reads them (ui/feature-texts builds them from their parts).
const BROWSER_TEXT = 'This feature is not available in your browser. See the documentation.';
const STORE_TEXT = 'This feature is in the downloadable version of Teseo.';

const linkOf = (box: Element) => box.querySelector('a[target="_blank"]')?.getAttribute('href');

const reasons = (b: Awaited<ReturnType<typeof load>>['build']) => Object.fromEntries(b.features().map((f) => [f.id, f.reason ?? 'here']));

describe('the features of each build', () => {
  it('the downloadable Chrome build has them all', async () => {
    const { build } = await load('chrome');
    expect(build.features().filter((f) => !f.available)).toEqual([]);
    expect([build.speakAvailable(), build.tabAudioAvailable(), build.debuggerAvailable(), build.customToolSourcesAvailable()]).toEqual([true, true, true, true]);
  });

  it("the store's leaves out the DevTools engine, by its choice", async () => {
    const { build } = await load('store');
    expect(reasons(build)).toEqual({ devtools: 'store', speak: 'here', systemVoice: 'here', tabAudio: 'here', customToolSources: 'here' });
  });

  it("Firefox's lacks what it has no API for", async () => {
    const { build } = await load('firefox');
    expect(reasons(build)).toEqual({ devtools: 'browser', speak: 'browser', systemVoice: 'browser', tabAudio: 'browser', customToolSources: 'here' });
    expect([build.speakAvailable(), build.tabAudioAvailable(), build.debuggerAvailable()]).toEqual([false, false, false]);
  });

  it('each feature says what it does in a sentence (its docs page: docs-links.test)', async () => {
    const { build } = await load('chrome');
    for (const f of build.features()) expect(f.about).toMatch(/^[A-Z].*\.$/);
  });
});

describe("the store's switch for custom tool sources", () => {
  const all = CHROMIUM;
  it('leaves them in as it is', async () => {
    const { build } = await load('store');
    expect(build.STORE_LEAVES_OUT).not.toContain('customToolSources');
    expect(build.customToolSourcesAvailable()).toBe(true);
  });
  it('leaves them out of the store build only, once listed', async () => {
    const { build } = await load('chrome');
    const leavesOut: FeatureId[] = ['devtools', 'customToolSources'];
    expect(build.featureIn('customToolSources', { store: true, leavesOut, browser: all })).toMatchObject({ available: false, reason: 'store' });
    expect(build.featureIn('customToolSources', { store: false, leavesOut, browser: all })).toMatchObject({ available: true });
    expect(build.featureIn('customToolSources', { store: true, leavesOut: build.STORE_LEAVES_OUT, browser: all })).toMatchObject({ available: true });
  });
  it('a source is not read where they are left out', async () => {
    vi.resetModules();
    vi.doMock('../src/core/build', async (actual) => ({ ...(await actual<typeof import('../src/core/build')>()), customToolSourcesAvailable: () => false }));
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { readSource } = await import('../src/tools/custom/sources');
    await expect(readSource({ url: 'https://example.com/tools.json' })).rejects.toThrow('not in this version of Teseo');
    expect(fetch).not.toHaveBeenCalled();
    vi.doUnmock('../src/core/build');
  });
});

describe('the links', () => {
  it("a release's build links the docs at its version", async () => {
    const { links } = await load('chrome', true);
    const l = links.links();
    expect(l.repo).toBe(REPO);
    expect(l.releases).toBe(`${REPO}/releases/latest`);
    expect(l.issues).toBe(`${REPO}/issues`);
    expect(l.docs('docs/guide/speak.md')).toBe(`${REPO}/blob/v1.2.3/docs/guide/speak.md`);
  });
  it('a dev build, or one not released, at the default branch', async () => {
    const { links } = await load('chrome', false);
    expect(links.links().docs('docs/guide/speak.md#reading')).toBe(`${REPO}/blob/master/docs/guide/speak.md#reading`);
    expect(links.linksFor({ repo: REPO, version: undefined, release: true }).docs('docs/README.md')).toBe(`${REPO}/blob/master/docs/README.md`);
  });
  it('the repository comes from package.json, or TESEO_REPO_URL', async () => {
    const { repoUrlOf, githubSlug } = await import('../src/core/repo-url');
    const pkg = { repository: { url: 'git+https://github.com/example/teseo.git' }, homepage: 'https://github.com/example/other#readme' };
    expect(repoUrlOf(pkg)).toBe('https://github.com/example/teseo');
    expect(repoUrlOf({ homepage: 'https://github.com/example/teseo#readme' })).toBe('https://github.com/example/teseo');
    expect(repoUrlOf(pkg, { TESEO_REPO_URL: 'https://github.com/someone/fork/' })).toBe('https://github.com/someone/fork');
    expect(githubSlug('https://github.com/Example/Teseo.git')).toBe('example/teseo');
  });
  it('a repository in another form becomes its https URL; one that cannot stops the build', async () => {
    const { normalizeRepoUrl } = await import('../src/core/repo-url');
    for (const form of ['git@github.com:example/teseo.git', 'ssh://git@github.com/example/teseo.git', 'git://github.com/example/teseo.git', 'github:example/teseo', 'example/teseo', 'http://github.com/example/teseo/']) {
      expect(normalizeRepoUrl(form)).toBe('https://github.com/example/teseo');
    }
    for (const bad of ['', 'teseo', 'file:///tmp/teseo', 'https://']) expect(() => normalizeRepoUrl(bad)).toThrow('not an https URL');
  });
  it('a release only from its own tag in the repository the links point to', async () => {
    const { isReleaseBuild } = await import('../src/core/repo-url');
    const tag = { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.2.3' };
    expect(isReleaseBuild('1.2.3', REPO, { ...tag, GITHUB_REPOSITORY: 'Example/Teseo' })).toBe(true);
    expect(isReleaseBuild('1.2.3', REPO, { ...tag, GITHUB_REPOSITORY: 'example/teseo-private' })).toBe(false);
    expect(isReleaseBuild('1.2.3', REPO, tag)).toBe(false);
    expect(isReleaseBuild('1.2.4', REPO, { ...tag, GITHUB_REPOSITORY: 'example/teseo' })).toBe(false);
    expect(isReleaseBuild('1.2.3', REPO, { GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'v1.2.3', GITHUB_REPOSITORY: 'example/teseo' })).toBe(false);
  });
});

describe('the notice', () => {

  it('(A) a section: what it does, and the store text to the releases', async () => {
    const { notice } = await load('store');
    const box = await render(createElement(notice.FeaturePage, { id: 'devtools', title: 'Chromium DevTools' }));
    expect(box.querySelector('h3')?.textContent).toBe('Chromium DevTools');
    expect(box.textContent).toContain('Real clicks, keys and typing');
    expect(box.textContent).toContain(STORE_TEXT);
    expect(linkOf(box)).toBe(`${REPO}/releases/latest`);
  });

  it('(A) the browser text to the docs page of the feature', async () => {
    const { notice } = await load('firefox');
    const box = await render(createElement(notice.FeaturePage, { id: 'speak', title: 'Speak' }));
    expect(box.textContent).toContain(BROWSER_TEXT);
    expect(linkOf(box)).toBe(`${REPO}/blob/master/docs/guide/speak.md`);
  });

  it('(B) a greyed row: no control, its mark opens why inside the row, nothing floating', async () => {
    const { notice, texts } = await load('firefox');
    const box = await render(createElement('ul', null, createElement(notice.FeatureRow, { id: 'tabAudio', name: "Tab's audio" })));
    expect(box.querySelector('input')).toBeNull();
    const mark = box.querySelector<HTMLButtonElement>('button.feature-mark')!;
    expect(mark.textContent).toBe(texts.MARK);
    expect(mark.getAttribute('aria-expanded')).toBe('false');
    expect(box.querySelector('.feature-row-reason')).toBeNull();
    await act(async () => mark.click());
    const reason = box.querySelector('li.feature-row > .feature-row-reason')!;
    expect(reason.textContent).toBe(BROWSER_TEXT);
    expect(mark.getAttribute('aria-controls')).toBe(reason.id);
    expect(linkOf(reason)).toBe(`${REPO}/blob/master/docs/guide/tab-audio.md`);
    expect(box.querySelector('.popover-panel')).toBeNull();
    await act(async () => mark.click());
    expect(box.querySelector('.feature-row-reason')).toBeNull();
  });

  it('(C) About: everything in Chrome, else what is left out with export and import', async () => {
    let { notice } = await load('chrome');
    let box = await render(createElement(notice.BuildSummary));
    expect(box.textContent).toBe('This version has every feature.');
    ({ notice } = await load('firefox'));
    box = await render(createElement(notice.BuildSummary));
    expect([...box.querySelectorAll('li strong')].map((s) => s.textContent)).toEqual(['Chromium DevTools engine', 'Speak', 'System voice', "A tab's audio"]);
    expect(box.querySelector('a[href="#export-import"]')).not.toBeNull();
  });
});

describe('where the notices show', () => {
  const settings = { providers: [], systemPrompt: '' } as unknown as Settings;

  async function menu(build: Build) {
    await load(build);
    const { SETTINGS_SECTIONS } = await import('../src/ui/Settings');
    const { feature } = await import('../src/core/build');
    const marked = SETTINGS_SECTIONS.filter((s) => s.feature && !feature(s.feature).available).map((s) => s.id);
    return { ids: SETTINGS_SECTIONS.map((s) => s.id), marked };
  }

  it('the settings menu keeps every section, and marks those left out', async () => {
    expect((await menu('chrome')).marked).toEqual([]);
    expect((await menu('store')).marked).toEqual(['devtools']);
    const firefox = await menu('firefox');
    expect(firefox.ids).toContain('speak');
    expect(firefox.marked).toEqual(['devtools', 'speak']);
  });

  it("Speak's page says why in Firefox", async () => {
    await load('firefox');
    const { SETTINGS_SECTIONS } = await import('../src/ui/Settings');
    const box = await render(SETTINGS_SECTIONS.find((s) => s.id === 'speak')!.render({ settings, onChange: vi.fn() }) as ReactElement);
    expect(box.textContent).toContain(BROWSER_TEXT);
  });

  it("an agent's voice: a greyed row in Firefox, the profiles in Chrome", async () => {
    await load('firefox');
    let { AgentVoice } = await import('../src/ui/agents/AgentVoice');
    let box = await render(createElement(AgentVoice, { settings, voice: {}, onChange: vi.fn() }));
    expect(box.querySelector('.feature-row')).not.toBeNull();
    expect(box.querySelector('input[type="checkbox"]')).toBeNull();
    await load('chrome');
    ({ AgentVoice } = await import('../src/ui/agents/AgentVoice'));
    box = await render(createElement(AgentVoice, { settings, voice: {}, onChange: vi.fn() }));
    expect(box.querySelector('.feature-row')).toBeNull();
    expect(box.querySelector('input[type="checkbox"]')).not.toBeNull();
  });

  it("the popup's options: Tab's audio greyed in Firefox, a switch in Chrome", async () => {
    await load('firefox');
    let { PopupOptions } = await import('../src/ui/PopupOptions');
    let box = await render(createElement(PopupOptions, { settings, onChange: vi.fn() }));
    const row = [...box.querySelectorAll('.feature-row')].find((r) => r.textContent?.includes("Tab's audio"));
    expect(row).toBeDefined();
    expect(row!.querySelector('input[aria-label="Tab\'s audio"]')).not.toBeNull(); // shows it greyed in the popup, or not
    expect((await import('../src/ui/PopupOptions')).POPUP_LINES).toContain('audio'); // counted: the popup shows it
    await load('chrome');
    ({ PopupOptions } = await import('../src/ui/PopupOptions'));
    box = await render(createElement(PopupOptions, { settings, onChange: vi.fn() }));
    expect(box.querySelector('.feature-row')).toBeNull();
  });

  it("Settings → Voice: the tab's audio tab says why in Firefox", async () => {
    await load('firefox');
    const { VoiceSection } = await import('../src/ui/VoiceSettings');
    const box = await render(createElement(VoiceSection, { settings, onChange: vi.fn() }));
    await act(async () => [...box.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent === "A tab's audio")!.click());
    expect(box.querySelector('.feature-notice')?.textContent).toContain(BROWSER_TEXT);
    await act(async () => [...box.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent === 'Dictation')!.click());
    // Nothing else names it: the header, the stats, the fields' hints, Test.
    expect(box.textContent?.replace("A tab's audio", '')).not.toMatch(/tab's audio|· tab /i);
    expect(box.querySelector('select[aria-label="Test with the settings of"]')).toBeNull();
  });

  // Firefox's and Chrome's: devtools-settings.test.
  it('Settings → Chromium DevTools: the store text in the store build', async () => {
    await load('store');
    const { DevtoolsSection } = await import('../src/ui/DevtoolsSettings');
    const box = await render(createElement(DevtoolsSection, { settings, onChange: vi.fn() }));
    expect(box.textContent).toContain(STORE_TEXT);
    expect(linkOf(box)).toBe(`${REPO}/releases/latest`);
  });
});


describe('Settings → Tools', () => {
  const settings = { providers: [], systemPrompt: '' } as unknown as Settings;
  const click = { name: 'browser.click', description: 'Clicks', inputSchema: { type: 'object' }, source: 'browser', effect: 'interact' };

  async function toolsPage(build: Build) {
    await load(build);
    vi.doMock('../src/ui/Tools', async (actual) => ({ ...(await actual<typeof import('../src/ui/Tools')>()), useToolCatalogState: () => ({ tools: [click] }) }));
    const { ToolSettings } = await import('../src/ui/ToolSettings');
    const box = await render(createElement(ToolSettings, { settings, onChange: vi.fn() }));
    vi.doUnmock('../src/ui/Tools');
    return box;
  }

  it('lists the tools only the DevTools engine has greyed, never offered, where the build lacks it', async () => {
    const box = await toolsPage('store');
    const rows = [...box.querySelectorAll('.tool-line.feature-row')];
    expect(rows.map((r) => r.querySelector('.tool-name')?.textContent)).toEqual(['browser__hover', 'browser__drag']);
    expect(rows.some((r) => r.querySelector('input, [role="switch"]'))).toBe(false);
    expect(box.textContent).toContain('1/1 offered');
  });

  it("lists speech.say greyed under its own group where Speak is not available (Firefox)", async () => {
    const box = await toolsPage('firefox');
    const groups = [...box.querySelectorAll('.tool-group-item')].map((b) => b.firstElementChild?.textContent);
    expect(groups).toContain('Speech (read aloud)');
    await act(async () => [...box.querySelectorAll<HTMLButtonElement>('.tool-group-item')].find((b) => b.textContent?.startsWith('Speech'))!.click());
    const rows = [...box.querySelectorAll('.tool-line.feature-row')].map((r) => r.querySelector('.tool-name')?.textContent);
    expect(rows).toEqual(['speech__say']);
    expect(box.textContent).not.toContain('Its tools are listed while you are on that website');
  });

  it('lists nothing of the kind in the downloadable Chrome build', async () => {
    const box = await toolsPage('chrome');
    expect(box.querySelector('.feature-row')).toBeNull();
  });
});

describe('a call to a tool this build lacks', () => {
  async function call(build: Build, name: string) {
    await load(build);
    const { execute } = await import('../src/core/tool-exec');
    const { ToolRegistry } = await import('../src/core/tool-registry');
    const { lackedBy } = await import('../src/tools/build-tools');
    const tools = new ToolRegistry();
    tools.register({ name: 'browser.click', description: '', inputSchema: {}, source: 'browser', effect: 'interact', run: async () => ({ type: 'text', text: 'ok' }) });
    return execute({ tools: { registry: tools, lacking: lackedBy } } as never, tools, name, {}, {} as never);
  }

  it('the store build: the DevTools engine left out, not an unknown tool', async () => {
    const r = await call('store', 'browser__hover');
    expect(r).toEqual({ content: "browser__hover is not in this version of Teseo: the Chrome Web Store's version leaves it out (Chromium DevTools engine). Do without it.", isError: true });
  });

  it('Firefox: speech.say has no API there', async () => {
    const r = await call('firefox', 'speech__say');
    expect(r.content).toBe('speech__say is not in this version of Teseo: this browser has no API for it (Speak). Do without it.');
  });

  it('the downloadable Chrome build: a tool not offered is unknown, as before', async () => {
    const r = await call('chrome', 'browser__hover');
    expect(r.content).toMatch(/^Unknown tool: browser__hover/);
  });
});

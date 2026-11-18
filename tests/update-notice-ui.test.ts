// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The "new version available" notice in the popup and Settings → About (ui/useUpdateNotice): only the
// downloadable release build asks GitHub, once per browser session, and only from the popup.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { fakeEvent } = await import('./fakes/browser');
const local: Record<string, unknown> = {};
const session: Record<string, unknown> = {};
const onChanged = fakeEvent<(changes: Record<string, { newValue?: unknown }>, area: string) => void>();
const area = (name: 'local' | 'session', data: Record<string, unknown>) => ({
  get: vi.fn(async (key: string) => (key in data ? { [key]: data[key] } : {})),
  set: vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(data, items);
    onChanged.emit(Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { newValue: v }])), name);
  }),
});
const storage = { local: area('local', local), session: area('session', session), onChanged };
vi.mock('wxt/browser', () => ({ browser: { storage, runtime: { getManifest: () => ({ version: '0.75.3' }) } } }));
const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ tag_name: 'v0.76.0', body: 'not shown' }), { status: 200 }));

async function load(build: 'download' | 'store' | 'dev') {
  vi.resetModules();
  vi.stubGlobal('__RELEASE_BUILD__', build !== 'dev');
  vi.stubGlobal('__STORE__', build === 'store');
  vi.stubGlobal('fetch', fetchMock);
  const { useUpdateNotice } = await import('../src/ui/useUpdateNotice');
  const { UpdateLine } = await import('../src/entrypoints/popup/UpdateLine');
  const { AboutSection } = await import('../src/ui/AboutSettings');
  // The popup's use of it: the check, and its line.
  function Popup({ settings }: { settings: object }) {
    const n = useUpdateNotice(settings as never, { check: true });
    return n.popup ? createElement(UpdateLine, { latest: n.popup.latest, onDismiss: n.dismiss }) : null;
  }
  const render = async (el: ReturnType<typeof createElement>) => {
    const box = document.createElement('div');
    await act(async () => createRoot(box).render(el));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    return box;
  };
  return {
    popup: (settings: object = { providers: [], systemPrompt: '' }) => render(createElement(Popup, { settings })),
    about: (settings: object = { providers: [], systemPrompt: '' }) => render(createElement(AboutSection, { settings: settings as never, onChange: vi.fn() })),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockClear();
  storage.local.get.mockClear();
  storage.session.get.mockClear();
  for (const d of [local, session]) for (const k of Object.keys(d)) delete d[k];
});

describe('the update notice', () => {
  it('the downloadable build asks once per browser session, the popup shows it until closed, About keeps saying it', async () => {
    const ui = await load('download');
    const box = await ui.popup();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: 'omit' });
    expect(box.querySelector('.popup-update')?.textContent).toBe('Teseo 0.76.0 is availableGet it');
    expect(box.textContent).not.toContain('not shown');
    expect(box.querySelector('a')?.getAttribute('href')).toMatch(/\/releases\/latest$/);
    // Opened again in the same session: no new request, the notice still there.
    const again = await ui.popup();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const close = again.querySelector<HTMLButtonElement>('button[aria-label="Dismiss the notice for 0.76.0"]')!;
    await act(async () => close.click());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(again.querySelector('.popup-update')).toBeNull();
    expect(local.updateNotice).toEqual({ latest: '0.76.0', dismissed: '0.76.0' });
    const about = await ui.about();
    expect(about.querySelector('.update-notice')?.textContent).toBe('Teseo 0.76.0 is out; you have 0.75.3. This version does not update itself: download it from the releases.');
    expect(about.querySelector('[role="switch"][aria-label="Check for a new version"]')).not.toBeNull();
    // About asks nothing itself.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('a newer release shows the notice again', async () => {
    local.updateNotice = { latest: '0.77.0', dismissed: '0.76.0' };
    session.updateChecked = true;
    const box = await (await load('download')).popup();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(box.querySelector('.popup-update strong')?.textContent).toBe('0.77.0');
  });
  it('with the setting off, no request and no notice', async () => {
    local.updateNotice = { latest: '0.76.0' };
    const ui = await load('download');
    const off = { providers: [], systemPrompt: '', updateCheck: false };
    expect((await ui.popup(off)).querySelector('.popup-update')).toBeNull();
    expect((await ui.about(off)).querySelector('.update-notice')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('the store build and a dev build make no request, read nothing and show no switch', async () => {
    for (const build of ['store', 'dev'] as const) {
      local.updateNotice = { latest: '0.76.0' };
      const ui = await load(build);
      expect((await ui.popup()).innerHTML).toBe('');
      const about = await ui.about();
      expect(about.querySelector('.update-notice')).toBeNull();
      expect(about.querySelector('[aria-label="Check for a new version"]')).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage.local.get).not.toHaveBeenCalled();
    expect(storage.session.get).not.toHaveBeenCalled();
  });
  it('a failure says nothing', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('{"message":"Not Found"}', { status: 404 }));
    const box = await (await load('download')).popup();
    expect(box.innerHTML).toBe('');
    expect(session.updateChecked).toBe(true);
  });
});

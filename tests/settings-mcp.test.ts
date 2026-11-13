// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSecretDb, fakeStorage } from './fakes/browser';
import { buttonNamed, pageBrowser, pageGlobals, settle, typeInto } from './fakes/panel';
import type { McpServerConfig } from '../src/mcp/config';

// Settings → MCP servers, on the Options page: one added by URL is saved and listed (its headers kept
// as secrets), switched off from the list, edited from its panel, and removed once confirmed.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
pageGlobals();
const storage = fakeStorage();
const secrets = fakeSecretDb();
const fake = pageBrowser(storage);
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fake.browser }));

const { loadSettings, saveSettings } = await import('../src/storage/settings');
const { Options } = await import('../src/entrypoints/options/Options');

let root: Root;
let box: HTMLElement;
async function open(hash = '#mcp') {
  history.replaceState(null, '', `/options.html${hash}`);
  box = document.body.appendChild(document.createElement('div'));
  root = createRoot(box);
  await act(async () => root.render(createElement(Options)));
  await settle(20);
}
const click = async (el: Element) => {
  await act(async () => (el as HTMLElement).click());
  await settle();
};
// The field inside the label that starts with `text` (or matches it).
const field = (text: string | RegExp) => [...box.querySelectorAll('main label')].find((l) => (typeof text === 'string' ? l.textContent!.startsWith(text) : text.test(l.textContent!)))!.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')!;
const servers = async () => (await loadSettings()).mcpServers ?? [];
const server: McpServerConfig = { id: 's1', name: 'docs', url: 'https://mcp.example.com/mcp', enabled: true };

beforeEach(() => {
  storage.reset();
  secrets.data.clear();
});
afterEach(() => {
  act(() => root.unmount());
  box.remove();
});

describe('Settings → MCP servers', () => {
  it('one added by URL is saved and listed; its headers are kept as secrets', async () => {
    await open();
    await click(buttonNamed(box, '＋ By URL')!);
    expect(location.hash).toBe('#mcp/new');
    await typeInto(field('Name'), 'tickets');
    await typeInto(field('URL'), 'https://tickets.example.com/mcp');
    await click(buttonNamed(box.querySelector('[role="group"][aria-label="How it lets you in"]')!, 'Headers')!);
    await typeInto(field(/headers \(JSON/i), '{"Authorization":"Bearer tok-secret-1"}');
    await click(buttonNamed(box.querySelector('.editor-sticky-footer')!, 'Save')!);
    expect(location.hash).toBe('#mcp');
    expect(await servers()).toEqual([expect.objectContaining({ name: 'tickets', url: 'https://tickets.example.com/mcp', headers: { Authorization: 'Bearer tok-secret-1' } })]);
    expect(JSON.stringify(storage.local.data)).not.toContain('tok-secret-1');
    expect(box.querySelector('[role="button"][aria-label="tickets: open"]')).not.toBeNull();
  });

  it('headers that are not a JSON object cannot be saved', async () => {
    await open();
    await click(buttonNamed(box, '＋ By URL')!);
    await typeInto(field('Name'), 'tickets');
    await typeInto(field('URL'), 'https://tickets.example.com/mcp');
    await typeInto(field(/headers \(JSON/i), '{"Authorization":');
    expect(buttonNamed(box.querySelector('.editor-sticky-footer')!, 'Save')!.disabled).toBe(true);
    expect(box.querySelector('.custom-checks-ok')).toBeNull();
  });

  it('switched off from the list, it stays listed, off', async () => {
    await saveSettings({ ...(await loadSettings()), mcpServers: [server] });
    await open();
    await click(box.querySelector('.mcp-servers input[role="switch"][aria-label="docs: on"]')!);
    expect((await servers())[0]!.enabled).toBe(false);
    expect(box.querySelector('.mcp-server.off')).not.toBeNull();
  });

  it('edited from its panel: the change is saved, the editor closes', async () => {
    await saveSettings({ ...(await loadSettings()), mcpServers: [server] });
    await open();
    await click(box.querySelector('[role="button"][aria-label="docs: open"]')!);
    const panel = box.querySelector('[role="dialog"][aria-label="docs"]')!;
    await click(buttonNamed(panel, 'Edit')!);
    expect(location.hash).toBe('#mcp/s1');
    await typeInto(field('URL'), 'https://mcp.example.com/v2/mcp');
    await click(buttonNamed(box.querySelector('.editor-sticky-footer')!, 'Save')!);
    expect(location.hash).toBe('#mcp');
    expect(await servers()).toEqual([expect.objectContaining({ id: 's1', name: 'docs', url: 'https://mcp.example.com/v2/mcp' })]);
  });

  it('removed from its panel once confirmed', async () => {
    await saveSettings({ ...(await loadSettings()), mcpServers: [server, { ...server, id: 's2', name: 'wiki' }] });
    await open();
    await click(box.querySelector('[role="button"][aria-label="docs: open"]')!);
    const panel = box.querySelector('[role="dialog"][aria-label="docs"]')!;
    await click(buttonNamed(panel, 'Remove')!);
    expect(await servers()).toHaveLength(2);
    await click(buttonNamed(panel.querySelector('[role="group"][aria-label="Remove?"]')!, 'Remove')!);
    expect((await servers()).map((s) => s.name)).toEqual(['wiki']);
  });

  it('a link to a server there is none of says so', async () => {
    await open('#mcp/nope');
    expect(box.querySelector('main')!.textContent).toMatch(/MCP server/);
    expect(box.querySelector('.mcp-servers')).toBeNull();
  });
});

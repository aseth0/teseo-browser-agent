// @vitest-environment jsdom
// MCP → From a provider: a check that ends after another provider is picked shows nothing, so its
// servers (the first provider's addresses) are never added with the second provider's key.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfferedServer } from '../src/mcp/provider';
import type { ProviderConfig } from '../src/storage/settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../src/ui/ask-permission', () => ({ allowSite: async () => undefined }));
const pending = new Map<string, (servers: OfferedServer[]) => void>();
vi.mock('../src/mcp/provider', async (original) => ({
  ...(await original<object>()),
  offeredServers: (p: ProviderConfig) => new Promise<OfferedServer[]>((resolve) => pending.set(p.id, resolve)),
}));
const { FromProvider } = await import('../src/ui/mcp/FromProvider');

const PROVIDERS = [
  { id: 'a', name: 'A', baseURL: 'https://a.example.com/v1' },
  { id: 'b', name: 'B', baseURL: 'https://b.example.com/v1' },
] as unknown as ProviderConfig[];
const A_SERVERS = [{ name: 'notes', url: 'https://a.example.com/mcp/notes' }];

let host: HTMLDivElement;
const onAdd = vi.fn();
beforeEach(async () => {
  pending.clear();
  onAdd.mockClear();
  host = document.createElement('div');
  await act(async () => createRoot(host).render(createElement(FromProvider, { providers: PROVIDERS, servers: [], onAdd, onClose: () => undefined })));
});

const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;
const pick = async (id: string) => {
  const select = host.querySelector('select')!;
  await act(async () => {
    select.value = id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

describe('From a provider', () => {
  it("shows A's servers, and adds them with A's key", async () => {
    await act(async () => button('Check this provider').click());
    await act(async () => pending.get('a')!(A_SERVERS));
    await act(async () => (host.querySelector('input[aria-label="Add notes"]') as HTMLInputElement).click());
    await act(async () => button('Add 1').click());
    expect(onAdd).toHaveBeenCalledWith([expect.objectContaining({ url: A_SERVERS[0]!.url, providerId: 'a' })]);
  });

  it("A's check that ends once B is picked shows nothing for B", async () => {
    await act(async () => button('Check this provider').click());
    await pick('b');
    await act(async () => pending.get('a')!(A_SERVERS));
    expect(host.querySelector('input[aria-label="Add notes"]')).toBeNull();
    expect(host.querySelector('.mcp-offered')).toBeNull();
  });

  it("nor does it replace B's own check", async () => {
    await act(async () => button('Check this provider').click());
    await pick('b');
    await act(async () => button('Check this provider').click());
    await act(async () => pending.get('b')!([{ name: 'docs', url: 'https://b.example.com/mcp/docs' }]));
    await act(async () => pending.get('a')!(A_SERVERS));
    expect(host.querySelector('input[aria-label="Add notes"]')).toBeNull();
    expect(host.querySelector('input[aria-label="Add docs"]')).not.toBeNull();
  });
});

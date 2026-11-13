// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeSecretDb, fakeStorage } from './fakes/browser';
import type { AgentProfile } from '../src/agents/profiles';
import type { Settings } from '../src/storage/settings';
import type { SettingsUpdate } from '../src/ui/useSettings';

// The chat changes to a site's agent when the tab reaches the site, between turns, from Browser or from
// an agent a site chose: never from one chosen by hand, nor when an agent gains the site (a
// sub-agent's "Always" on a card), nor when the agent the site chose has the new one too.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const storage = fakeStorage();
vi.mock('../src/storage/secret-db', () => fakeSecretDb());
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { agentStore, newAgentProfile } = await import('../src/agents/profiles');
const { policyAccessFor } = await import('../src/policy/agent-access');
const { useSiteAgent } = await import('../src/entrypoints/sidepanel/AgentPicker');

const writer = { ...newAgentProfile(), id: 'w', name: 'writer', canAsk: true, sites: { 'docs.test': 'ask' as const } };
const shopper = { ...newAgentProfile(), id: 's', name: 'shopper', canBeAsked: true, onlyItsSites: true, sites: { 'shop.test': 'ask' as const } };

type Props = { url: string; busy: boolean; active?: string };
let root: Root;
let onChange: ReturnType<typeof vi.fn<SettingsUpdate>>;
let onSwitch: ReturnType<typeof vi.fn<(agent: AgentProfile) => void>>;
function Probe({ url, busy, active }: Props) {
  useSiteAgent(url, busy, { activeAgentId: active } as Settings, onChange, onSwitch);
  return null;
}
const render = (props: Props) => act(async () => root.render(createElement(Probe, props)));

beforeEach(() => {
  storage.reset();
  root = createRoot(document.createElement('div'));
  onChange = vi.fn<SettingsUpdate>();
  onSwitch = vi.fn<(agent: AgentProfile) => void>();
});
afterEach(() => act(() => root.unmount()));

describe('useSiteAgent', () => {
  it("changes from Browser to the site's agent when the tab reaches its site, and says so", async () => {
    await agentStore.save(writer);
    await agentStore.save(shopper);
    await render({ url: 'https://news.test/', busy: false });
    expect(onChange).not.toHaveBeenCalled();
    await render({ url: 'https://shop.test/cart', busy: false });
    expect(onChange).toHaveBeenCalledWith({ activeAgentId: 's' });
    expect(onSwitch).toHaveBeenCalledWith(expect.objectContaining({ id: 's' }));
  });

  it('keeps an agent chosen by hand on another agent\'s site', async () => {
    await agentStore.save(writer);
    await agentStore.save(shopper);
    await render({ url: 'https://docs.test/', busy: false, active: 'w' });
    await render({ url: 'https://shop.test/', busy: false, active: 'w' });
    expect(onChange).not.toHaveBeenCalled();
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('moves on from an agent a site chose, unless it has the next site too', async () => {
    await agentStore.save(shopper); // first in the list
    await agentStore.save(writer);
    await render({ url: 'https://docs.test/', busy: false });
    expect(onChange).toHaveBeenLastCalledWith({ activeAgentId: 'w' });
    await render({ url: 'https://shop.test/', busy: false, active: 'w' });
    expect(onChange).toHaveBeenLastCalledWith({ activeAgentId: 's' });
    await agentStore.save({ ...shopper, sites: { ...shopper.sites, 'docs.test': 'ask' } });
    await render({ url: 'https://docs.test/', busy: false, active: 's' });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('keeps the agent a site chose once it is chosen by hand', async () => {
    await agentStore.save(shopper);
    await agentStore.save(writer);
    await render({ url: 'https://shop.test/', busy: false });
    await render({ url: 'https://shop.test/', busy: false, active: 's' });
    await render({ url: 'https://shop.test/', busy: false, active: 'w' }); // by hand
    await render({ url: 'https://shop.test/', busy: false, active: 's' }); // by hand again
    await render({ url: 'https://docs.test/', busy: false, active: 's' });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('waits for the turn to end, and keeps a choice made by hand on the same site', async () => {
    await agentStore.save(shopper);
    await render({ url: 'https://shop.test/', busy: true });
    expect(onChange).not.toHaveBeenCalled();
    await render({ url: 'https://shop.test/', busy: false });
    expect(onChange).toHaveBeenCalledTimes(1);
    await render({ url: 'https://shop.test/other', busy: false }); // Browser, chosen by hand
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('stays when an asked agent gains the site during a turn', async () => {
    await agentStore.save(writer);
    await agentStore.save(shopper);
    await render({ url: 'https://news.test/', busy: false });
    await render({ url: 'https://news.test/', busy: true });
    // shopper, asked, uses only its sites: "Always" on its card saves the site to it.
    await act(() => policyAccessFor(shopper, 'browser').save('news.test', 'auto'));
    expect((await agentStore.load()).find((a) => a.id === 's')?.sites).toHaveProperty(['news.test'], 'auto');
    await render({ url: 'https://news.test/', busy: false });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('switches once the agents are read, not before', async () => {
    await agentStore.save(shopper);
    await render({ url: 'https://shop.test/', busy: false });
    expect(onChange).toHaveBeenCalledWith({ activeAgentId: 's' });
  });
});

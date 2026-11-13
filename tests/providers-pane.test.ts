// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { ProviderConfig, Settings } from '../src/storage/settings';

// Settings → Providers: the pane shows the provider picked, nothing of the one before; the context
// window is kept only as a whole number of tokens.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('wxt/browser', async () => (await import('./fakes/browser')).inertBrowser());
vi.mock('../src/ui/useCollection', () => ({ useCollection: () => [] }));
const { ProvidersSection } = await import('../src/ui/ProvidersSettings');

const provider = (id: string, name: string): ProviderConfig => ({ id, name, baseURL: '', apiKey: '', defaultModel: '' }) as ProviderConfig;
const providers = [provider('a', 'Alpha'), provider('b', 'Beta')];

async function show() {
  const onChange = vi.fn();
  const box = document.body.appendChild(document.createElement('div'));
  await act(async () => createRoot(box).render(createElement(ProvidersSection, { settings: { providers, activeProviderId: 'a' } as Settings, onChange })));
  const field = (label: string) => box.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  const type = (el: HTMLInputElement, value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  return { box, onChange, field, type };
}

describe('Settings → Providers', () => {
  it('an invalid draft of one provider does not show for another', async () => {
    const { box, field, type } = await show();
    await type(field('Extra headers (JSON, optional)'), '{"api-key":');
    expect(box.textContent).toContain('invalid JSON object');
    await act(async () => [...box.querySelectorAll<HTMLButtonElement>('[aria-label="Providers"] button')].find((b) => b.textContent?.startsWith('Beta'))!.click());
    expect(field('Name').value).toBe('Beta');
    expect(field('Extra headers (JSON, optional)').value).toBe('');
    expect(box.textContent).not.toContain('invalid JSON object');
  });

  it('the context window: only a whole number of tokens, at least 1', async () => {
    const { field, type, onChange } = await show();
    const windowOf = () => (onChange.mock.lastCall![0] as { providers: ProviderConfig[] }).providers[0]!.contextWindow;
    for (const [typed, kept] of [['-5', undefined], ['0.5', undefined], ['0', undefined], ['', undefined], ['32000.7', 32000], ['128000', 128000]] as const) {
      await type(field('Context window, tokens'), typed);
      expect(windowOf(), typed).toBe(kept);
    }
  });
});

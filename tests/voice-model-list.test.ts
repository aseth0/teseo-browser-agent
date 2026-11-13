// @vitest-environment jsdom
// Settings → Voice's model field: the provider's models, the speech-to-text looking ones first.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/storage/settings';
import { VoiceSection } from '../src/ui/VoiceSettings';

vi.mock('../src/ui/SectionTop', () => ({ SectionTop: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.unstubAllGlobals());

describe('the audio model list', () => {
  it("offers the provider's models, the speech-to-text looking ones first", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'gpt-4o' }, { id: 'whisper-1' }] }))));
    const provider = { id: 'voice-list', name: 'Local', baseURL: 'https://voice-list.example.com/v1', apiKey: '', defaultModel: 'chat' };
    const settings = { providers: [provider], voice: { providerId: provider.id } } as unknown as Settings;
    const root = document.createElement('div');
    await act(async () => createRoot(root).render(createElement(VoiceSection, { settings, onChange: vi.fn() })));
    await act(async () => { await new Promise((r) => setTimeout(r)); });
    expect([...root.querySelectorAll('datalist option')].map((o) => o.getAttribute('value'))).toEqual(['whisper-1', 'gpt-4o']);
  });
});

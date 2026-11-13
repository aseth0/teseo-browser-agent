// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { CustomTool } from '../src/tools/custom/types';

// Trying a request from its editor: a second click while the site is asked does not send it again,
// and its result no longer shows once the request is changed.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const asked: (() => void)[] = [];
const allow = () => asked.forEach((r) => r());
const sent = vi.fn(async () => ({ status: 200, url: 'https://api.example.com/a', answer: undefined, result: { text: 'ok' } }));
vi.mock('../src/ui/ask-permission', () => ({ askSite: () => new Promise<void>((r) => void asked.push(r)) }));
vi.mock('../src/tools/http', () => ({ hasFixedHost: () => true, httpResult: () => '', sendRequest: sent }));
const { TryRequest } = await import('../src/ui/custom-tools/Try');

const draft = (url: string) => ({ name: 't', http: { method: 'GET', url }, inputs: [], params: {} }) as unknown as CustomTool;

describe('trying a request', () => {
  it('sends once, and drops its result when the request changes', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(createElement(TryRequest, { draft: draft('https://api.example.com/a') })));
    const button = () => [...host.querySelectorAll('button')].find((b) => /Try|Sending/.test(b.textContent ?? ''))!;
    act(() => button().click());
    act(() => button().click());
    await act(async () => allow());
    expect(sent).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.try-status')?.textContent).toContain('200');
    act(() => root.render(createElement(TryRequest, { draft: draft('https://api.example.com/b') })));
    expect(host.querySelector('.try-status')).toBeNull();
    act(() => root.unmount());
  });
});

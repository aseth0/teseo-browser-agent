// @vitest-environment jsdom
// Events carry the number of the run they belong to: a late one from a run stopped and replaced at once
// ("Send now") never reaches the new one, while one without a number (an older worker) still does.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakePort, fakeStorage } from './fakes/browser';
import type { AgentAction } from '../src/entrypoints/sidepanel/agent-state';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// The port each chat opens, the latest one.
let port = fakePort('agent', {});
const connect = () => (port = fakePort('agent', { url: 'chrome-extension://ext-id/sidepanel.html' }));
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(fakeStorage(), { runtime: { id: 'ext-id', connect } }) }));

const { useAgentPort } = await import('../src/entrypoints/sidepanel/useAgentPort');
type Port = ReturnType<typeof useAgentPort>;

function mount() {
  const dispatched: AgentAction[] = [];
  let api: Port | undefined;
  const Host = () => {
    api = useAgentPort((a) => dispatched.push(a), false);
    return null;
  };
  const root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(Host)));
  return { dispatched, api: () => api! };
}

describe('the chat port', () => {
  it('drops the events of a run it left for a newer one, and takes those without a number', () => {
    const { dispatched, api } = mount();
    const start = () => {
      api().setStopped(false);
      const runId = api().newRun();
      api().connectAndPost({ type: 'run', runId, history: [], providerId: 'p', model: 'm', includePage: false });
      return runId;
    };
    const first = start();
    // Send now: stopped, and a new run at once, before the first one's last events arrive.
    api().setStopped(true);
    const second = start();
    expect(second).not.toBe(first);
    port.onMessage.emit({ type: 'text-delta', text: 'late', runId: first });
    port.onMessage.emit({ type: 'done', runId: first });
    port.onMessage.emit({ type: 'text-delta', text: 'new', runId: second });
    port.onMessage.emit({ type: 'text-delta', text: 'older worker' });
    const texts = dispatched.flatMap((a) => (a.type === 'event' && a.event.type === 'text-delta' ? [a.event.text] : []));
    expect(texts).toEqual(['new', 'older worker']);
    expect(dispatched.some((a) => a.type === 'event' && a.event.type === 'done')).toBe(false);
    expect(dispatched.every((a) => a.type !== 'event' || !('runId' in a.event))).toBe(true);
  });

  it('takes on the number of a run it resumes', () => {
    const { dispatched, api } = mount();
    api().connectAndPost({ type: 'attach', conversationId: 'c1' });
    api().setStopped(true);
    port.onMessage.emit({ type: 'resume', history: [], runId: 41 });
    port.onMessage.emit({ type: 'text-delta', text: 'resumed', runId: 41 });
    port.onMessage.emit({ type: 'text-delta', text: 'other', runId: 40 });
    const texts = dispatched.flatMap((a) => (a.type === 'event' && a.event.type === 'text-delta' ? [a.event.text] : []));
    expect(texts).toEqual(['resumed']);
    expect(api().newRun()).toBeGreaterThan(41);
  });
});

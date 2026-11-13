// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { RecordedCall, Recording } from '../src/recording/recording';

// What the review says of a call's values (recording/sensitive): an IP address is a note, never a ⚠
// that unticks the call; the same kind under the same key once, with how many.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../src/recording/pending-secrets', () => ({ savePendingSecret: vi.fn() }));
const { RecordingReview } = await import('../src/entrypoints/sidepanel/RecordingReview');
const { initialTicks } = await import('../src/recording/review');

const call = (over: Partial<RecordedCall>): RecordedCall => ({ id: '1', method: 'GET', url: 'https://shop.example.test/api/log', at: 1, included: true, status: 200, ...over });
const rec = (calls: RecordedCall[]): Recording => ({ tabId: 1, site: 'shop.example.test', startedAt: 0, endedAt: 1000, hidden: [], calls });
const none = () => undefined;

describe('an IP address in a call', () => {
  it('leaves it ticked, as a note', () => {
    const r = initialTicks(rec([call({ id: 'ip', responseBody: '{"ip":"203.0.113.45"}' }), call({ id: 'mail', responseBody: '{"mail":"ann@example.test"}' })]));
    expect(r.calls.map((c) => [c.id, c.included])).toEqual([['ip', true], ['mail', false]]);
  });

  it('is noted once per key, with how many, never as a phone', async () => {
    const answer = JSON.stringify({ rows: [1, 2, 3].map((i) => ({ ip: `203.0.113.${i}`, mt: 1730294400120 + i })) });
    const root = document.createElement('div');
    await act(async () => createRoot(root).render(createElement(RecordingReview, { recording: rec([call({ responseBody: answer })]), onChange: none, onAttach: none, onMakeTool: none, onDiscard: none })));
    expect(root.querySelector('.recording-why')).toBeNull(); // nothing to hide before it may go
    expect([...root.querySelectorAll('.hint')].map((p) => p.textContent)).toContain('ⓘ an IP address (answer: rows[].ip) ×3');
    expect(root.textContent).not.toContain('phone');
    expect(root.querySelector('.recording-mark')!.textContent).toBe('ⓘ');
  });
});

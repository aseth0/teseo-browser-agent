// A write asked in the widget's card is denied once the run stops (the card closed, or its time up),
// also when it already had: an Allow that comes later never runs it.
import { describe, expect, it, vi } from 'vitest';
import type { WidgetRunEvent } from '../src/widget/protocol';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
const { cardConfirms } = await import('../src/background/widget-run');

const request = { summary: 'Buy it', host: 'shop.example.com' };

describe("the widget card's confirmation", () => {
  it('is denied once the run stops, and a later answer changes nothing', async () => {
    const sent: WidgetRunEvent[] = [];
    const { confirm, answer } = cardConfirms((e) => sent.push(e));
    const run = new AbortController();
    const decision = confirm(request, run.signal);
    expect(sent).toMatchObject([{ type: 'confirm', summary: 'Buy it' }]);
    run.abort();
    expect(await decision).toBe('deny');
    answer({ type: 'confirm-reply', id: (sent[0] as { id: string }).id, decision: 'allow' });
    expect(await decision).toBe('deny');
  });

  it('is denied at once, without asking, when the run has already stopped', async () => {
    const sent: WidgetRunEvent[] = [];
    const { confirm } = cardConfirms((e) => sent.push(e));
    expect(await confirm(request, AbortSignal.abort())).toBe('deny');
    expect(sent).toEqual([]);
  });

  it("is the card's answer while the run goes on", async () => {
    const sent: WidgetRunEvent[] = [];
    const { confirm, answer } = cardConfirms((e) => sent.push(e));
    const decision = confirm(request, new AbortController().signal);
    answer({ type: 'confirm-reply', id: (sent[0] as { id: string }).id, decision: 'always' });
    expect(await decision).toBe('always');
  });

  it('from a card in a page, takes "always" as a one-time allow', async () => {
    const sent: WidgetRunEvent[] = [];
    const { confirm, answer } = cardConfirms((e) => sent.push(e), true);
    const decision = confirm(request, new AbortController().signal);
    answer({ type: 'confirm-reply', id: (sent[0] as { id: string }).id, decision: 'always' });
    expect(await decision).toBe('allow');
  });
});

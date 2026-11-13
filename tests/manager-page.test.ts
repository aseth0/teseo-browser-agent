import { describe, expect, it } from 'vitest';
import type { Browser } from 'wxt/browser';
import { chatUrl, type ManagerStatus } from '../src/manager/protocol';
import { elapsed, mustWarn, nowText, rowOfConversation, rowOfSource, rowsReducer, takenTabs, type Row, type Rows } from '../src/manager/rows';
import { canResumeOn, restoredOf, savedOf } from '../src/manager/saved';
import { tabChoices } from '../src/manager/tabs';

// The agent manager's page: its rows, what each says, and the tabs a new agent can work on.
const status: ManagerStatus = { state: 'idle', said: false, conversationId: 'c', title: 'New conversation', step: 0, maxSteps: 15, agentName: 'Browser', model: 'm', given: 0 };

describe('rows', () => {
  const add = (key: string) => ({ type: 'add', row: { key, tabId: 1 } }) as const;
  const three = () => [add('a'), add('b'), add('c')].reduce(rowsReducer, { rows: [] } as Rows);
  it('a new one is added and selected', () => expect(rowsReducer({ rows: [] }, add('a'))).toEqual({ rows: [{ key: 'a', tabId: 1 }], selected: 'a' }));
  it('removing the selected row selects the next, else the one before, else none', () => {
    let s = rowsReducer(rowsReducer(three(), { type: 'select', key: 'b' }), { type: 'remove', key: 'b' });
    expect(s.selected).toBe('c');
    s = rowsReducer(s, { type: 'remove', key: 'c' });
    expect(s.selected).toBe('a');
    expect(rowsReducer(s, { type: 'remove', key: 'a' })).toEqual({ rows: [], selected: undefined });
  });
  it('removing another row leaves the selection', () => expect(rowsReducer(three(), { type: 'remove', key: 'a' }).selected).toBe('c'));
  it('a row being removed is marked until it goes', () => {
    expect(rowsReducer(three(), { type: 'removing', key: 'a' }).rows[0]).toMatchObject({ key: 'a', removing: true });
  });
  it('takes its chat\'s status; one for no row changes nothing', () => {
    const s = three();
    expect(rowsReducer(s, { type: 'status', key: 'b', status }).rows[1]!.status).toBe(status);
    expect(rowsReducer(s, { type: 'status', key: 'x', status })).toBe(s);
  });
  it('one going on with a saved conversation keeps it', () => {
    const s = rowsReducer({ rows: [] }, { type: 'add', row: { key: 'a', tabId: 1, conversationId: 'saved' } });
    expect(s.rows[0]).toEqual({ key: 'a', tabId: 1, conversationId: 'saved' });
  });
  it('finds the row of a conversation: the one its chat shows now, else the one it went on with', () => {
    const rows: Row[] = [
      { key: 'a', tabId: 1, conversationId: 'saved', status: { ...status, conversationId: 'newer' } },
      { key: 'b', tabId: 2, conversationId: 'loading' },
      { key: 'c', tabId: 3, status: { ...status, conversationId: 'c3' } },
    ];
    expect(rowOfConversation(rows, 'newer')?.key).toBe('a');
    expect(rowOfConversation(rows, 'saved')).toBeUndefined();
    expect(rowOfConversation(rows, 'loading')?.key).toBe('b');
    expect(rowOfConversation(rows, 'c3')?.key).toBe('c');
    expect(rowOfConversation(rows, 'x')).toBeUndefined();
    expect(rowOfConversation([{ key: 's', tabId: 4, conversationId: 'c4', stopped: true }], 'c4')).toBeUndefined();
  });
  it('warns before closing while one works or waits', () => {
    const row = (state?: ManagerStatus['state']): Row => ({ key: 'a', tabId: 1, ...(state && { status: { ...status, state } }) });
    expect(mustWarn([row(), row('idle')])).toBe(false);
    expect(mustWarn([row('idle'), row('working')])).toBe(true);
    expect(mustWarn([row('waiting')])).toBe(true);
  });
});

describe('what a row says now', () => {
  it('working: the last tool, the step, the time', () => expect(nowText({ ...status, state: 'working', lastTool: 'browser.click', step: 7, turnStartedAt: 0 }, 65_000)).toBe('browser.click · 7/15 · 1m'));
  it('working, before its first tool', () => expect(nowText({ ...status, state: 'working', step: 1, turnStartedAt: 0 }, 5_000)).toBe('1/15 · 5s'));
  it('waiting', () => expect(nowText({ ...status, state: 'waiting' }, 0)).toBe('Waiting for you'));
  it('done, or nothing yet', () => {
    expect(nowText({ ...status, said: true }, 0)).toBe('Done');
    expect(nowText(status, 0)).toBe('');
    expect(nowText(undefined, 0)).toBe('');
  });
  it('the time since the turn started', () => expect([elapsed(12_000), elapsed(180_000), elapsed(7_200_000)]).toEqual(['12s', '3m', '2h']));
});

describe('messages from frames', () => {
  it('only from the iframe of a row', () => {
    const w = {} as Window;
    expect(rowOfSource(new Map([['a', w]]), w)).toBe('a');
    expect(rowOfSource(new Map([['a', w]]), {} as Window)).toBeUndefined();
    expect(rowOfSource(new Map([['a', null]]), null)).toBeUndefined();
  });
});

describe('the tabs a new agent can work on', () => {
  const tab = (id: number, lastAccessed: number) => ({ id, lastAccessed, title: `T${id}`, url: `https://t${id}.example.com/a` }) as Browser.tabs.Tab;
  it('leaves out the manager and the tabs taken, most recently used first', () => {
    expect(tabChoices([tab(1, 10), tab(2, 30), tab(3, 20), tab(4, 40)], 4, [3])).toEqual([
      { id: 2, title: 'T2', host: 't2.example.com' },
      { id: 1, title: 'T1', host: 't1.example.com' },
    ]);
  });
  it('a tab without a title shows its URL', () => {
    expect(tabChoices([{ id: 5, url: 'https://x.example.com/' } as Browser.tabs.Tab], undefined, [])[0]!.title).toBe('https://x.example.com/');
  });
});

describe('the address of a chat', () => {
  it('its tab, then its agent and the saved conversation it goes on with, when any', () => {
    expect(chatUrl(4)).toBe('sidepanel.html?tab=4&manager');
    expect(chatUrl(4, 'my agent')).toBe('sidepanel.html?tab=4&manager&agent=my%20agent');
    expect(chatUrl(4, undefined, 'c&1')).toBe('sidepanel.html?tab=4&manager&conversation=c%261');
  });
});

describe('the rows of the last time', () => {
  const said = (conversationId: string, url = 'https://shop.example.com/a') => ({ ...status, said: true, conversationId, title: `about ${conversationId}`, agentName: 'Reader', url });
  const stopped: Row = { key: 's', tabId: 7, conversationId: 'c1', stopped: true, url: 'https://shop.example.com/a', title: 'about c1' };

  it('keeps the conversation each shows once said, else the one it went on with; none for the others', () => {
    const rows: Row[] = [
      { key: 'a', tabId: 1, agentId: 'reader', status: said('c1') },
      { key: 'b', tabId: 2, conversationId: 'old', status: { ...status, conversationId: 'fresh' } },
      { key: 'c', tabId: 3, status },
      { key: 'd', tabId: 4, status: said('c4'), removing: true },
    ];
    expect(savedOf(rows)).toEqual([
      { key: 'a', tabId: 1, agentId: 'reader', conversationId: 'c1', url: 'https://shop.example.com/a', title: 'about c1', agentName: 'Reader' },
      { key: 'b', tabId: 2, conversationId: 'old', agentName: 'Browser' },
    ]);
  });
  it('a stopped one is kept as it came back', () => expect(restoredOf(savedOf([stopped]), new Set(['c1']))).toEqual([stopped]));
  it('comes back stopped; one whose conversation is gone, or that cannot be read, is left out', () => {
    const saved = [
      { key: 'a', tabId: 1, conversationId: 'c1', agentId: 'reader', title: 't' },
      { key: 'b', tabId: 2, conversationId: 'deleted' },
      { key: 'c', tabId: '3', conversationId: 'c1' },
      { tabId: 4, conversationId: 'c1' },
      'nonsense',
    ];
    expect(restoredOf(saved, new Set(['c1']))).toEqual([{ key: 'a', tabId: 1, conversationId: 'c1', agentId: 'reader', title: 't', stopped: true }]);
    expect(restoredOf({ rows: [] }, new Set())).toEqual([]);
  });
  it('restored before the rows made since, once each', () => {
    const s = rowsReducer({ rows: [] }, { type: 'add', row: { key: 'new', tabId: 1 } });
    const r = rowsReducer(s, { type: 'restore', rows: [stopped] });
    expect(r.rows.map((x) => x.key)).toEqual(['s', 'new']);
    expect(r.selected).toBe('new');
    expect(rowsReducer(r, { type: 'restore', rows: [stopped] })).toBe(r);
  });
  it('a stopped one goes on, on the tab given, and is shown; a live one is not resumed', () => {
    const s = rowsReducer({ rows: [stopped] }, { type: 'resume', key: 's', tabId: 9, agentId: 'reader' });
    expect(s).toEqual({ rows: [{ ...stopped, tabId: 9, agentId: 'reader', stopped: false }], selected: 's' });
    expect(rowsReducer(s, { type: 'resume', key: 's', tabId: 1 })).toBe(s);
  });
  it('says it is stopped; its tab is free for others', () => {
    expect(nowText(undefined, 0, true)).toBe('Stopped');
    expect(takenTabs([stopped, { key: 'l', tabId: 2 }])).toEqual([2]);
  });
  it('goes on on its tab only while open on the same site and free', () => {
    const tab = { id: 7, url: 'https://shop.example.com/other' };
    expect(canResumeOn(stopped, tab, [])).toBe(true);
    expect(canResumeOn(stopped, undefined, [])).toBe(false);
    expect(canResumeOn(stopped, { id: 7, url: 'https://mail.example.test/' }, [])).toBe(false); // the id is another tab's now
    expect(canResumeOn(stopped, tab, [7])).toBe(false);
    expect(canResumeOn({ tabId: 7 }, tab, [])).toBe(false); // where it was is not known
  });
});

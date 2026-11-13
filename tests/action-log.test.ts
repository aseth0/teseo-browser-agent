import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runAgentLoop } from '../src/core/agent-loop';
import type { ChatEvent, Message, ToolCallLog } from '../src/core/types';
import { authorize, type PolicyDeps } from '../src/policy/engine';
import { ToolRegistry } from '../src/core/tool-registry';
import { collect, loop, scripted } from './helpers';
import { fakeBrowser, fakeSecretDb, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
const areas = { local: storage.local.data, session: storage.session.data };
const secrets = fakeSecretDb();
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { clearActionLog, loadActionLog, logAction, logEntry, moveLegacyActionLog } = await import('../src/logs/actions');

const where = { source: 'chat' as const, agent: 'Default' };
const call = (change: Partial<ToolCallLog> = {}): ToolCallLog => ({ tool: 'browser.click', at: 1000, ms: 5, ...change });

beforeEach(() => {
  storage.reset();
  secrets.data.clear();
});

describe('the action log', () => {
  it('says what was decided: without asking, the card\'s answer, or a refusal', () => {
    expect(logEntry(call({ size: 12 }), where)).toEqual({ at: 1000, source: 'chat', agent: 'Default', tool: 'browser.click', decision: 'free', ok: true, ms: 5, size: 12 });
    expect(logEntry(call({ seen: { summary: 'Click "Buy"', host: 'shop.test', asked: 'always' } }), where)).toMatchObject({ summary: 'Click "Buy"', host: 'shop.test', decision: 'always', ok: true });
    expect(logEntry(call({ seen: { asked: 'deny' }, refused: 'the user denied this action' }), where)).toMatchObject({ decision: 'deny', ok: false, error: 'the user denied this action' });
    expect(logEntry(call({ refused: 'read only' }), where)).toMatchObject({ decision: 'refused', ok: false });
    expect(logEntry(call({ error: 'x'.repeat(400) }), where)).toMatchObject({ decision: 'free', ok: false, error: `${'x'.repeat(300)}…` });
  });

  it('keeps it for the session, in this browser, or not at all; both shown, latest first, until cleared', async () => {
    await logAction(logEntry(call({ at: 1 }), where), 'session');
    await logAction(logEntry(call({ at: 3 }), where), 'kept');
    await logAction(logEntry(call({ at: 2 }), where), 'off');
    expect(areas.session.actionLog).toHaveLength(1);
    // Kept in the extension's own database, where content scripts cannot read it.
    expect(secrets.data.get('actionLog')).toHaveLength(1);
    expect('actionLog' in areas.local).toBe(false);
    expect((await loadActionLog()).map((e) => e.at)).toEqual([3, 1]);
    await clearActionLog();
    expect(await loadActionLog()).toEqual([]);
  });

  it('kept by an earlier version in storage.local is moved once; a log written there later is dropped', async () => {
    await logAction(logEntry(call({ at: 5 }), where), 'kept');
    areas.local.actionLog = [logEntry(call({ at: 4 }), where), logEntry(call({ at: 9 }), where)];
    await moveLegacyActionLog();
    expect((await loadActionLog()).map((e) => e.at)).toEqual([9, 5, 4]);
    expect('actionLog' in areas.local).toBe(false);
    areas.local.actionLog = [logEntry(call({ at: 7 }), where)]; // a content script's
    await moveLegacyActionLog();
    expect((await loadActionLog()).map((e) => e.at)).toEqual([9, 5, 4]);
    expect('actionLog' in areas.local).toBe(false);
  });

  it('gets every call of the agent loop, with what the policy saw', async () => {
    const tools = new ToolRegistry();
    tools.register({ name: 'browser.find', description: '', inputSchema: {}, source: 'browser', effect: 'read', run: async () => ({ type: 'text', text: 'found it' }) });
    tools.register({
      name: 'browser.click', description: '', inputSchema: {}, source: 'browser', effect: 'write',
      describe: async () => ({ summary: 'Click "Buy"' }), run: async () => ({ type: 'text', text: 'clicked' }),
    });
    const steps: ChatEvent[][] = [
      [{ type: 'tool-call', id: 'a', name: 'browser__find', args: {} }, { type: 'tool-call', id: 'b', name: 'browser__click', args: {} }, { type: 'tool-call', id: 'c', name: 'browser__nope', args: {} }, { type: 'done', stopReason: 'tool_calls' }],
      [{ type: 'text-delta', text: 'Done' }, { type: 'done', stopReason: 'stop' }],
    ];
    const provider = scripted(steps);
    const deps: PolicyDeps = { getPolicy: async () => 'ask', setPolicy: async () => {}, tabUrl: async () => 'https://shop.test/', confirm: async () => ({ decision: 'deny' }) };
    const logged: ToolCallLog[] = [];
    const user: Message[] = [{ role: 'user', parts: [{ type: 'text', text: 'buy it' }] }];
    const options = loop(provider, tools, {
      tools: {
        context: { tabId: 1 },
        authorize: async (tool, args, ctx) => {
          const seen = {};
          return { ...(await authorize(deps, tool, args, ctx, seen)), seen };
        },
      },
      hooks: { log: (c) => logged.push(c) },
    });
    await collect(runAgentLoop(user, options, new AbortController().signal));
    expect(logged.map((c) => logEntry(c, where)).map(({ tool, decision, ok, summary, host, size }) => ({ tool, decision, ok, summary, host, size }))).toEqual([
      { tool: 'browser.find', decision: 'free', ok: true, summary: undefined, host: undefined, size: 8 },
      { tool: 'browser.click', decision: 'deny', ok: false, summary: 'Click "Buy"', host: 'shop.test', size: undefined },
      { tool: 'browser__nope', decision: 'refused', ok: false, summary: undefined, host: undefined, size: undefined },
    ]);
  });
});

describe('writing the action log', () => {
  it('writes the calls logged together in one batch, the latest first', async () => {
    const entry = (at: number) => logEntry(call({ at }), where);
    const set = vi.spyOn(storage.session, 'set');
    await Promise.all([logAction(entry(1), 'session'), logAction(entry(2), 'session'), logAction(entry(3), 'session')]);
    expect(set).toHaveBeenCalledTimes(1);
    await logAction(entry(4), 'session');
    expect(set).toHaveBeenCalledTimes(2);
    expect((areas.session.actionLog as { at: number }[]).map((e) => e.at)).toEqual([4, 3, 2, 1]);
    set.mockRestore();
  });

  it('kept in this browser, a batch too', async () => {
    const entry = (at: number) => logEntry(call({ at }), where);
    await Promise.all([logAction(entry(1), 'kept'), logAction(entry(2), 'kept')]);
    await logAction(entry(3), 'kept');
    expect((await loadActionLog()).map((e) => e.at)).toEqual([3, 2, 1]);
  });
});

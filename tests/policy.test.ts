import { describe, expect, it, vi } from 'vitest';
import type { Tool } from '../src/core/types';
import { authorize, type Answer, type Decision, type PolicyDeps } from '../src/policy/engine';
import type { SitePolicy } from '../src/policy/store';
import { TOOL_SETTINGS } from './helpers';

const ctx = { settings: TOOL_SETTINGS, tabId: 1, signal: new AbortController().signal };

function tool(effect: Tool['effect'], url?: string, tabOf?: Tool['tabOf']): Tool {
  return {
    name: 'browser.click', description: '', inputSchema: {}, source: 'browser', effect,
    describe: async () => ({ summary: 'Click button "Buy now"', url }),
    run: async () => ({ type: 'text', text: 'ok' }),
    ...(tabOf && { tabOf }),
  };
}

// Tab 1 (the panel's) is on shop.test; tab 2 is another open tab, on mail.test.
const TAB_URLS: Record<number, string> = { 1: 'https://shop.test/p/x1', 2: 'https://mail.test/inbox', 3: 'http://shop.test/p/x1', 4: 'http://localhost:8080/', 5: 'http://127.0.0.1/' };

function deps(policies: Record<string, SitePolicy> = {}, decision: Decision = 'allow', comment?: string) {
  const d = {
    getPolicy: vi.fn(async (host: string) => policies[host] ?? 'ask'),
    setPolicy: vi.fn(async () => {}),
    tabUrl: vi.fn(async (tabId?: number) => (tabId === undefined ? undefined : TAB_URLS[tabId])),
    confirm: vi.fn(async () => ({ decision, comment })),
  } satisfies PolicyDeps;
  return d;
}

describe('authorize', () => {
  it('never asks for read tools', async () => {
    const d = deps();
    expect(await authorize(d, tool('read'), {}, ctx)).toEqual({});
    expect(d.confirm).not.toHaveBeenCalled();
  });

  it('asks by default, with the summary and the host of the current tab', async () => {
    const d = deps();
    expect(await authorize(d, tool('write'), {}, ctx)).toEqual({ approvedHost: 'shop.test' });
    expect(d.confirm).toHaveBeenCalledWith({ summary: 'Click button "Buy now"', host: 'shop.test' });
  });

  it('reports a denial so the model can adapt', async () => {
    expect(await authorize(deps({}, 'deny'), tool('write'), {}, ctx)).toEqual({ refused: 'the user denied this action' });
  });

  it("passes on the user's comment: as the reason of a denial, or with an allowed call", async () => {
    expect(await authorize(deps({}, 'deny', ' not that one, the Work project '), tool('write'), {}, ctx)).toEqual({
      refused: 'the user denied this action and commented: "not that one, the Work project"',
      comment: 'not that one, the Work project',
    });
    expect(await authorize(deps({}, 'allow', 'then open the first task'), tool('write'), {}, ctx)).toEqual({ comment: 'then open the first task', approvedHost: 'shop.test' });
    expect(await authorize(deps({}, 'always', '  '), tool('write'), {}, ctx)).toEqual({ approvedHost: 'shop.test' }); // blank: no comment
  });

  it('"always" switches the site to auto', async () => {
    const d = deps({}, 'always');
    expect(await authorize(d, tool('write'), {}, ctx)).toEqual({ approvedHost: 'shop.test' });
    expect(d.setPolicy).toHaveBeenCalledWith('shop.test', 'auto', 'site');
  });

  it('"session" allows the site for this conversation only', async () => {
    const d = deps({}, 'session');
    expect(await authorize(d, tool('write'), {}, ctx)).toEqual({ approvedHost: 'shop.test' });
    expect(d.setPolicy).toHaveBeenCalledWith('shop.test', 'auto', 'conversation');
  });

  it('auto sites run without asking; read-only sites refuse', async () => {
    const auto = deps({ 'shop.test': 'auto' });
    expect(await authorize(auto, tool('write'), {}, ctx)).toEqual({ approvedHost: 'shop.test' });
    expect(auto.confirm).not.toHaveBeenCalled();
    expect((await authorize(deps({ 'shop.test': 'read-only' }), tool('write'), {}, ctx)).refused).toMatch(/blocked on shop\.test/);
  });

  it('uses the URL the tool targets (navigate) instead of the current tab', async () => {
    const d = deps({ 'shop.test': 'auto' });
    expect(await authorize(d, tool('write', 'https://other.test/login'), {}, ctx)).toEqual({}); // it leaves the tab's site: none to check
    expect(d.confirm).toHaveBeenCalledWith(expect.objectContaining({ host: 'other.test' }));
  });
});

describe('authorize calls on another tab', () => {
  const onTab = (args: unknown) => (args as { tabId?: number }).tabId;

  it('judges a write tool by the site of the tab it targets, not the panel\'s', async () => {
    const d = deps({ 'shop.test': 'auto' });
    // The site it was allowed on goes with the call, to be checked again right before it acts.
    expect(await authorize(d, tool('write', undefined, onTab), { tabId: 2 }, ctx)).toEqual({ approvedHost: 'mail.test' });
    expect(d.confirm).toHaveBeenCalledWith(expect.objectContaining({ host: 'mail.test' }));
  });

  it('a read tool on the current tab never asks', async () => {
    const d = deps();
    expect(await authorize(d, tool('read', undefined, onTab), { tabId: 1 }, ctx)).toEqual({});
    expect(await authorize(d, tool('read', undefined, onTab), {}, ctx)).toEqual({});
    expect(d.confirm).not.toHaveBeenCalled();
  });

  it('a read tool on another tab asks, with that tab\'s host', async () => {
    const d = deps();
    expect(await authorize(d, tool('read', undefined, onTab), { tabId: 2 }, ctx)).toEqual({});
    expect(d.confirm).toHaveBeenCalledWith(expect.objectContaining({ host: 'mail.test' }));
    expect(await authorize(deps({}, 'deny'), tool('read', undefined, onTab), { tabId: 2 }, ctx)).toEqual({ refused: 'the user denied this action' });
  });

  it('a read on another tab runs without asking when its site is auto or read-only', async () => {
    for (const policy of ['auto', 'read-only'] as SitePolicy[]) {
      const d = deps({ 'mail.test': policy });
      expect(await authorize(d, tool('read', undefined, onTab), { tabId: 2 }, ctx)).toEqual({});
      expect(d.confirm).not.toHaveBeenCalled();
    }
  });
});

describe('authorize on plain http', () => {
  it("does not act without asking on a site's http pages, though its policy is auto", async () => {
    const d = deps({ 'shop.test': 'auto' });
    expect(await authorize(d, tool('write'), {}, { ...ctx, tabId: 3 })).toEqual({ approvedHost: 'shop.test' });
    expect(d.confirm).toHaveBeenCalledWith(expect.objectContaining({ host: 'shop.test' }));
    const opened = deps({ 'shop.test': 'auto' });
    await authorize(opened, tool('write', 'http://shop.test/cart'), {}, ctx);
    expect(opened.confirm).toHaveBeenCalled();
  });

  it('keeps auto on https, and on http on this machine', async () => {
    for (const tabId of [1, 4, 5]) {
      const d = deps({ 'shop.test': 'auto', 'localhost:8080': 'auto', '127.0.0.1': 'auto' });
      await authorize(d, tool('write'), {}, { ...ctx, tabId });
      expect(d.confirm).not.toHaveBeenCalled();
    }
  });

  it('still refuses writes on a read-only site', async () => {
    expect(await authorize(deps({ 'shop.test': 'read-only' }), tool('write'), {}, { ...ctx, tabId: 3 })).toMatchObject({ refused: expect.any(String) });
  });
});

describe('authorize read tools that ask for some calls', () => {
  const readFull: Tool = { ...tool('read'), name: 'history.read', alwaysAsk: (args) => (args as { full?: boolean }).full === true, describe: async () => ({ summary: 'Read a conversation in full' }) };

  it('confirms those calls without a host, whatever the site policy, and lets the others through', async () => {
    const d = deps({ 'shop.test': 'auto' });
    expect(await authorize(d, readFull, { full: true }, ctx)).toEqual({});
    expect(d.confirm).toHaveBeenCalledWith({ summary: 'Read a conversation in full', host: '' });
    expect(await authorize(deps({}, 'deny'), readFull, { full: true }, ctx)).toEqual({ refused: 'the user denied this action' });
    const quiet = deps();
    expect(await authorize(quiet, readFull, { id: 'x' }, ctx)).toEqual({});
    expect(quiet.confirm).not.toHaveBeenCalled();
  });
});

describe('authorize tools that always ask', () => {
  const saveSkill: Tool = { ...tool('write'), name: 'skills.save', alwaysAsk: true, describe: async () => ({ summary: 'Save the skill "x"' }) };

  it('asks whatever the site policy, without a host (so no "always on this site")', async () => {
    for (const policy of ['auto', 'read-only'] as SitePolicy[]) {
      const d = deps({ 'shop.test': policy });
      expect(await authorize(d, saveSkill, {}, ctx)).toEqual({});
      expect(d.confirm).toHaveBeenCalledWith({ summary: 'Save the skill "x"', host: '' });
      expect(d.setPolicy).not.toHaveBeenCalled();
    }
    expect(await authorize(deps({ 'shop.test': 'auto' }, 'deny'), saveSkill, {}, ctx)).toEqual({ refused: 'the user denied this action' });
  });
});

describe('authorize a save the user edited', () => {
  const details = [{ label: 'Description', value: 'Old', edit: { field: 'description', value: 'Old' } }, { label: 'Pinned', value: 'No' }];
  const withEdits = vi.fn(async (args: unknown, edits: Record<string, string>) => {
    if (edits.description === '') throw new Error('Not saved:\n- Give a description.');
    return { ...(args as object), ...edits };
  });
  const save: Tool = { ...tool('write'), name: 'skills.save', alwaysAsk: true, describe: async () => ({ summary: 'Save the skill "x"', details }), withEdits };
  const answering = (...answers: Answer[]) => {
    const d = deps();
    answers.forEach((a) => d.confirm.mockResolvedValueOnce(a as never));
    return d;
  };

  it('runs with the edited arguments, and says what changed', async () => {
    const d = answering({ decision: 'allow', edits: { description: 'New', pinned: 'Yes' } });
    expect(await authorize(d, save, { name: 'x', description: 'Old' }, ctx)).toEqual({ args: { name: 'x', description: 'New' }, edited: [{ label: 'Description', diff: '− Old\n+ New' }] });
    expect(withEdits).toHaveBeenLastCalledWith({ name: 'x', description: 'Old' }, { description: 'New' }, ctx);
  });

  it('ignores values left as proposed, and the edits of a denial', async () => {
    expect(await authorize(answering({ decision: 'allow', edits: { description: 'Old' } }), save, {}, ctx)).toEqual({});
    expect(await authorize(answering({ decision: 'deny', edits: { description: 'New' } }), save, {}, ctx)).toEqual({ refused: 'the user denied this action' });
  });

  it('asks again, saying why, with their values, when the edited one cannot be saved', async () => {
    const d = answering({ decision: 'allow', edits: { description: '' } }, { decision: 'allow', edits: { description: 'Fixed' } });
    expect(await authorize(d, save, {}, ctx)).toMatchObject({ args: { description: 'Fixed' } });
    expect(d.confirm).toHaveBeenNthCalledWith(2, { summary: 'Save the skill "x"', details, host: '', problem: 'Not saved:\n- Give a description.', edited: { description: '' } });
  });
});

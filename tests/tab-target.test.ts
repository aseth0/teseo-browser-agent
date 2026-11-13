// The tab a call acts on and the one the policy judges it by are the same: a tab id written as text
// counts as that tab, one that is not a tab's id is refused (never taken for the panel's).
import { describe, expect, it } from 'vitest';
import { tabOfArgs, targetTab } from '../src/tools/browser/tab-target';
import { TOOL_SETTINGS } from './helpers';

const ctx = { settings: TOOL_SETTINGS, tabId: 1, signal: new AbortController().signal };

describe('the tab a call names', () => {
  it('is the panel\'s when it names none', () => {
    expect([tabOfArgs({}), targetTab({}, ctx)]).toEqual([undefined, 1]);
  });
  it('is that tab, also written as text', () => {
    expect([tabOfArgs({ tabId: 7 }), targetTab({ tabId: 7 }, ctx), tabOfArgs({ tabId: '7' }), targetTab({ tabId: '7' }, ctx)]).toEqual([7, 7, 7, 7]);
  });
  it('is refused when it is not a tab id', () => {
    expect(tabOfArgs({ tabId: 'abc' })).toBeUndefined();
    expect(() => targetTab({ tabId: 'abc' }, ctx)).toThrow('Not a tab id');
  });
});

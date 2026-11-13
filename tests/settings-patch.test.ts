import { describe, expect, it } from 'vitest';
import type { Settings } from '../src/storage/settings';
import { historyOn, includePageOn, memoryOn, mentionsOn, withAutoAttach } from '../src/storage/settings-select';

// A Settings section sends only what it changes: a copy of the whole settings would undo another
// change made in the same tick (useSettings applies each patch on top of the latest).
describe('withAutoAttach', () => {
  it('is a change to its section alone, keeping the rest of that section', () => {
    const settings = { providers: [], includePage: false, memory: { enabled: true, autoAttach: { enabled: false, threshold: 60 } } } as unknown as Settings;
    expect(withAutoAttach(settings, 'memory', { enabled: true })).toEqual({ memory: { enabled: true, autoAttach: { enabled: true, threshold: 60 } } });
    expect(withAutoAttach(settings, 'history', { enabled: true })).toEqual({ history: { autoAttach: { enabled: true } } });
  });
});

describe('the switches on by default', () => {
  it('are on with no value and follow the saved one', () => {
    const none = { providers: [] } as unknown as Settings;
    expect([historyOn(none), memoryOn(none), includePageOn(none), mentionsOn(none, 'history')]).toEqual([true, true, true, true]);
    const off = { providers: [], history: { enabled: false }, memory: { enabled: false }, includePage: false, mentions: { skills: false } } as unknown as Settings;
    expect([historyOn(off), memoryOn(off), includePageOn(off), mentionsOn(off, 'skills'), mentionsOn(off, 'tools')]).toEqual([false, false, false, false, true]);
  });
});

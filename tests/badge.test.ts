import { describe, expect, it } from 'vitest';
import { badgeOf } from '../src/background/badge';

// The toolbar icon's badge: "!" while something waits for the user wins; then a recording's count wins over a
// tab's audio, which wins over DevTools' DBG.
describe('the badge', () => {
  it('DBG while the debugger is attached', () => expect(badgeOf(1)).toEqual({ text: 'DBG' }));
  it('nothing at all: empty', () => expect(badgeOf(0)).toEqual({ text: '' }));
  it("a recording's count, in red, also over DBG", () => expect(badgeOf(1, { state: 'recording', calls: 14 })).toEqual({ text: '14', color: '#d93025' }));
  it('one waiting for review: its count, in gray', () => expect(badgeOf(0, { state: 'stopped', calls: 3 })).toEqual({ text: '3', color: '#5f6368' }));
  it("a tab's audio: its minutes, red while it captures, gray once stopped", () => {
    expect(badgeOf(0, undefined, { state: 'capturing', minutes: 2 })).toEqual({ text: '2m', color: '#d93025' });
    expect(badgeOf(1, undefined, { state: 'stopped', minutes: 4 })).toEqual({ text: '4m', color: '#5f6368' });
  });
  it("a recording's count over a tab's audio", () => expect(badgeOf(0, { state: 'recording', calls: 3 }, { state: 'capturing', minutes: 2 }).text).toBe('3'));
  it('"!" while something waits for the user, over everything else', () => {
    expect(badgeOf(0, undefined, undefined, true)).toEqual({ text: '!', color: '#e37400' });
    expect(badgeOf(1, { state: 'recording', calls: 14 }, { state: 'capturing', minutes: 2 }, true).text).toBe('!');
  });
  it('once nothing waits, back to what is under it', () => expect(badgeOf(0, { state: 'stopped', calls: 3 }, undefined, false).text).toBe('3'));
  it('at most four characters', () => expect(badgeOf(0, { state: 'recording', calls: 1200 }).text).toBe('999+'));
});

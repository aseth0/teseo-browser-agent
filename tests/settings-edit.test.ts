import { describe, expect, it } from 'vitest';
import type { Settings } from '../src/storage/settings';
import { applyEdit, diffEdit, isSettingsEdit, patchEdit } from '../src/storage/settings-edit';

// A change to the settings as data, applied to the settings as stored by then (storage/settings-edit).
const base = { providers: [], systemPrompt: '', chatView: { steps: 'inline', textSize: 100 } } as unknown as Settings;

describe('a change to the settings as data', () => {
  it('sets the fields of a patch whole, and removes one set to undefined', () => {
    const edit = patchEdit({ chatView: { hiddenTools: ['a'] }, includePage: undefined });
    expect(applyEdit({ ...base, includePage: true }, edit)).toEqual({ providers: [], systemPrompt: '', chatView: { hiddenTools: ['a'] } });
  });

  it('sets only the field of an object a function changed, so that another field changed meanwhile stays', () => {
    const prev = base;
    const next = { ...prev, chatView: { ...prev.chatView, textSize: 120 } };
    const edit = diffEdit(prev, next);
    expect(edit).toEqual([{ path: ['chatView', 'textSize'], value: 120 }]);
    const stored = { ...base, chatView: { ...base.chatView, turnDiagram: 'pie' } } as Settings;
    expect(applyEdit(stored, edit).chatView).toEqual({ steps: 'inline', textSize: 120, turnDiagram: 'pie' });
  });

  it('sets a list whole, and removes what a function took away', () => {
    const prev = { ...base, disabledTools: ['a'], systemPrompt: 'x' } as Settings;
    const { systemPrompt: _gone, ...rest } = prev;
    const next = { ...rest, disabledTools: ['a', 'b'], chatView: { steps: 'inline' } } as Settings;
    const edit = diffEdit(prev, next);
    expect(edit).toEqual(expect.arrayContaining([{ path: ['disabledTools'], value: ['a', 'b'] }, { path: ['systemPrompt'], removed: true }, { path: ['chatView', 'textSize'], removed: true }]));
    expect(applyEdit(prev, edit)).toEqual(next);
  });

  it('sets the fields of an object a function made, so that one made meanwhile elsewhere keeps its own', () => {
    const prev = { providers: [] } as unknown as Settings;
    const edit = diffEdit(prev, { ...prev, chatView: { textSize: 90 } });
    expect(edit).toEqual([{ path: ['chatView', 'textSize'], value: 90 }]);
    expect(applyEdit({ ...prev, chatView: { turnDiagram: 'pie' } }, edit).chatView).toEqual({ turnDiagram: 'pie', textSize: 90 });
  });

  it('makes the objects a path goes through where the stored settings have none', () => {
    expect(applyEdit({ providers: [] } as unknown as Settings, [{ path: ['history', 'keepCount'], value: 5 }])).toMatchObject({ history: { keepCount: 5 } });
    expect(applyEdit({ providers: [] } as unknown as Settings, [{ path: ['history', 'keepCount'], removed: true }])).toEqual({ providers: [] });
  });

  it('leaves the stored settings as they were', () => {
    const stored = structuredClone(base);
    applyEdit(stored, [{ path: ['chatView', 'textSize'], value: 1 }]);
    expect(stored).toEqual(base);
  });

  it('crosses a message as it is (JSON) and is told from anything else', () => {
    const edit = diffEdit(base, { ...base, chatView: { ...base.chatView, textSize: 90 }, includePage: false });
    expect(isSettingsEdit(JSON.parse(JSON.stringify(edit)))).toBe(true);
    expect(isSettingsEdit({ path: ['a'], value: 1 })).toBe(false);
    expect(isSettingsEdit([{ path: [], value: 1 }])).toBe(false);
    expect(isSettingsEdit([{ path: ['a'] }])).toBe(false);
    expect(isSettingsEdit([{ path: ['__proto__', 'x'], value: 1 }])).toBe(false);
  });
});

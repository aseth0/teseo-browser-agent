import { describe, expect, it } from 'vitest';
import { DISPLAY_DEFAULTS, DISPLAY_DEFS, DISPLAY_IDS, DISPLAY_SURFACES, displayFrom } from '../src/core/display-defs';
import { displayOf, displayValues } from '../src/storage/settings-select';
import { exportSettingsPart, importSettingsPart } from '../src/storage/settings-transfer';
import type { Settings } from '../src/storage/settings-types';

// The display registry (Settings → Display): each element's default is one of its values, the locked
// ones always show, and what is stored reads as the default where this build cannot use it.
const settings = (display: Record<string, unknown>) => ({ display }) as Pick<Settings, 'display'>;

describe('the display registry', () => {
  it('has each default among its values, a known surface, a label and a line on it', () => {
    for (const id of DISPLAY_IDS) {
      const def = DISPLAY_DEFS[id];
      expect(Object.keys(def.allowed), id).toContain(def.default);
      expect(DISPLAY_SURFACES[def.surface], id).toBeDefined();
      expect(def.label.trim(), id).not.toBe('');
      expect(def.about.trim(), id).not.toBe('');
    }
  });

  it('says why each locked element cannot be hidden, and offers it only as shown', () => {
    const locked = DISPLAY_IDS.filter((id) => DISPLAY_DEFS[id].locked);
    expect(locked).toEqual(expect.arrayContaining(['untrustedMark', 'toolErrors', 'cutMark', 'devtoolsBadge']));
    for (const id of locked) {
      expect(DISPLAY_DEFS[id].why?.trim(), id).toBeTruthy();
      expect(Object.keys(DISPLAY_DEFS[id].allowed), id).toEqual(['shown']);
    }
  });

  it('starts as the chat looked before', () => {
    expect(DISPLAY_DEFAULTS).toMatchObject({
      toolArgs: 'json', toolResultView: 'text', toolScreenshot: 'shown', toolTab: 'shown', toolMemoryTitle: 'shown',
      toolAttached: 'shown', subAgentTrace: 'closed', answerStats: 'shown', answerAgent: 'shown',
    });
  });

  it('ignores a value stored for a locked element', () => {
    expect(displayFrom('untrustedMark', 'hidden')).toBe('shown');
    expect(displayOf(settings({ cutMark: 'hidden', devtoolsBadge: 'hidden' }), 'cutMark')).toBe('shown');
    expect(displayValues(settings({ toolErrors: 'hidden' })).toolErrors).toBe('shown');
  });
});

describe('displayOf', () => {
  it('reads a value stored', () => {
    expect(displayOf(settings({ toolArgs: 'fields' }), 'toolArgs')).toBe('fields');
    expect(displayOf(settings({ answerStats: 'hidden' }), 'answerStats')).toBe('hidden');
  });

  it('falls back to the default: nothing stored, a value this build does not have, one of the wrong kind', () => {
    expect(displayOf({}, 'toolArgs')).toBe('json');
    expect(displayOf(settings({ toolArgs: 'table' }), 'toolArgs')).toBe('json');
    expect(displayOf(settings({ toolTab: true }), 'toolTab')).toBe('shown');
    expect(displayOf(settings({ toolResultView: 'toString' }), 'toolResultView')).toBe('text'); // not an inherited key
  });

  it('gives every element, and leaves out ids this build does not have', () => {
    const all = displayValues(settings({ fromAnotherBuild: 'x', toolTab: 'hidden' }));
    expect(Object.keys(all).sort()).toEqual([...DISPLAY_IDS].sort());
    expect(all.toolTab).toBe('hidden');
  });
});

describe('Display in an export', () => {
  it('travels with the settings', () => {
    const s = { providers: [], systemPrompt: '', display: { toolArgs: 'fields' } } as Settings;
    expect(JSON.parse(exportSettingsPart(s))).toMatchObject({ display: { toolArgs: 'fields' } });
    const rows = importSettingsPart(JSON.stringify({ display: { answerStats: 'hidden' } }), s);
    expect(rows).toMatchObject([{ name: 'Display', status: 'replaces', item: { value: { answerStats: 'hidden' } } }]);
  });
});

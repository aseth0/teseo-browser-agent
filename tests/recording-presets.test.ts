import { describe, expect, it } from 'vitest';
import { presetFor, presetsOf, SHIPPED_PRESETS, type RecordingPreset } from '../src/recording/presets';
import type { Settings } from '../src/storage/settings-types';

const settings = (s: Partial<Settings>) => s as Settings;
const api = SHIPPED_PRESETS.find((p) => p.id === 'api')!;

describe('the recording presets', () => {
  it('ship API calls, Everything and Errors only', () => {
    const all = presetsOf(settings({}));
    expect(all.map((p) => p.id)).toEqual(['api', 'everything', 'errors']);
    expect(all.every((p) => p.builtIn && !p.edited)).toBe(true);
  });
  it('a stored edit of a shipped one replaces it, clamped to the limits', () => {
    const mine = { ...api, name: 'Mine', maxBody: 50_000, maxMinutes: 30 };
    const first = presetsOf(settings({ recordingPresets: [mine] }))[0]!;
    expect(first).toMatchObject({ id: 'api', name: 'Mine', edited: true, builtIn: true, maxBody: 20_000, maxMinutes: 5 });
  });
  it("the user's own come after the shipped ones; malformed ones are skipped", () => {
    const own: RecordingPreset = { ...api, id: 'u1', name: 'Own' };
    const stored = [own, { id: 3 }, null] as unknown as RecordingPreset[];
    const all = presetsOf(settings({ recordingPresets: stored }));
    expect(all.map((p) => p.id)).toEqual(['api', 'everything', 'errors', 'u1']);
    expect(all[3]).toMatchObject({ builtIn: false, edited: false });
  });
  it('one by id, else the default one, else API calls', () => {
    expect(presetFor(settings({ recordingPreset: 'errors' })).id).toBe('errors');
    expect(presetFor(settings({}), 'nope').id).toBe('api');
    expect(presetFor(settings({ recordingPreset: 'gone' })).id).toBe('api');
    expect(presetFor(settings({ recordingPreset: 'errors' }), 'everything').id).toBe('everything');
  });
  it('limits below the floor or not numbers are brought into range', () => {
    const odd = { ...api, id: 'u2', maxBody: 10, maxMinutes: Number.NaN };
    expect(presetsOf(settings({ recordingPresets: [odd] }))[3]).toMatchObject({ maxBody: 1000, maxMinutes: 5 });
  });
});

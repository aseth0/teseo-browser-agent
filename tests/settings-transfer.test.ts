import { describe, expect, it } from 'vitest';
import { exportSettingsPart, importSettingsPart, settingSummary, withSettingChanges } from '../src/storage/settings-transfer';
import type { Settings } from '../src/storage/settings-types';

const mine = {
  providers: [{ id: 'p', name: 'P', baseURL: 'https://api.example.com', apiKey: 'sk', defaultModel: 'm' }],
  activeProviderId: 'p',
  activeModel: 'm',
  systemPrompt: 'Be brief.',
  aboutUser: 'I test things.',
  bookmarks: { rootId: '42', autoAttach: { enabled: true } },
  voice: { language: 'en', deviceId: 'mic-1' },
  limits: { pageText: 40000 },
  mcpServers: [],
  customThemes: [],
} as unknown as Settings;

describe('the settings part', () => {
  it('takes only the settings that travel, without this browser’s', () => {
    const part = JSON.parse(exportSettingsPart(mine));
    expect(part).toEqual({ aboutUser: 'I test things.', systemPrompt: 'Be brief.', bookmarks: { autoAttach: { enabled: true } }, limits: { pageText: 40000 }, voice: { language: 'en' } });
  });

  it('carries Voice’s vocabulary and tuning with it (only the microphone stays)', () => {
    const voice = { language: 'en', deviceId: 'mic-1', vocabulary: 'Teseo, WXT', temperature: 0.2, tabLanguage: 'es', silenceLevel: 0.02, silenceStopSeconds: 30 };
    expect(JSON.parse(exportSettingsPart({ ...mine, voice } as Settings)).voice).toEqual({ language: 'en', vocabulary: 'Teseo, WXT', temperature: 0.2, tabLanguage: 'es', silenceLevel: 0.02, silenceStopSeconds: 30 });
    const rows = importSettingsPart(JSON.stringify({ voice: { vocabulary: 'Other' } }), { ...mine, voice } as Settings);
    const next = withSettingChanges(mine, rows.flatMap((r) => (r.item ? [r.item] : [])));
    expect(next.voice).toEqual({ vocabulary: 'Other', deviceId: 'mic-1' });
  });

  it('offers on import only those that differ, keeping this browser’s fields', () => {
    const rows = importSettingsPart(JSON.stringify({ aboutUser: 'I test things.', systemPrompt: 'Be thorough.', voice: { language: 'es' }, activeProviderId: 'x', limits: 'lots' }), mine);
    expect(rows.map((r) => [r.name, r.status])).toEqual([
      ['System prompt', 'replaces'],
      ['Voice', 'replaces'],
      ['activeProviderId', 'left-out'],
      ['Limits', 'left-out'],
    ]);
    const next = withSettingChanges(mine, rows.flatMap((r) => (r.item ? [r.item] : [])));
    expect(next.systemPrompt).toBe('Be thorough.');
    expect(next.voice).toEqual({ language: 'es', deviceId: 'mic-1' });
    expect(next.activeProviderId).toBe('p');
  });

  it('takes History’s retention only as a whole number from 1 up', () => {
    const rows = importSettingsPart(JSON.stringify({ history: { enabled: true, keepDays: 0.5, keepCount: -3 } }), mine);
    expect(rows.map((r) => r.item?.value)).toEqual([{ enabled: true }]);
    const kept = importSettingsPart(JSON.stringify({ history: { keepDays: 30, keepCount: 2.5 } }), mine);
    expect(kept.map((r) => r.item?.value)).toEqual([{ keepDays: 30 }]);
  });

  it('carries Speak with its profiles, each naming its provider by id; a profile that is not one left out', () => {
    const speak = { profiles: [{ id: 'a', name: 'Calm', providerId: 'p', model: 'tts-1', voice: 'nova_a', language: 'es' }], defaultProfileId: 'a', firstPiece: 80 };
    expect(JSON.parse(exportSettingsPart({ ...mine, speak } as Settings)).speak).toEqual(speak);
    const rows = importSettingsPart(JSON.stringify({ speak: { ...speak, profiles: [...speak.profiles, 'x', { id: 3 }] } }), mine);
    expect(rows.map((r) => r.item?.value)).toEqual([speak]);
  });

  it('is an object', () => {
    expect(() => importSettingsPart('[]', mine)).toThrow(/object/);
  });

  it('shows values short', () => {
    expect(settingSummary(true)).toBe('On');
    expect(settingSummary(undefined)).toBe('default');
    expect(settingSummary('x'.repeat(80))).toMatch(/…”$/);
    expect(settingSummary(['a', 'b'])).toBe('2 items');
    expect(settingSummary({ a: 1 })).toBe('1 field');
  });
});

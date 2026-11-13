import { describe, expect, it } from 'vitest';
import { exportProfiles, readProfiles, withImported, withTarget } from '../src/speech/profile-io';
import type { Settings } from '../src/storage/settings-types';

// Voice profiles exported and imported on their own: the file, each profile new, replacing the one of
// its name or left out (why), a provider not here, the speed bounded, and the plain Name=voice@speed list.
const provider = { id: 'p', name: 'Voices', baseURL: 'https://tts.example.test/v1', apiKey: 'secret-key', defaultModel: '' };
const CALM = { id: 'a', name: 'Calm', providerId: 'p', model: 'tts-1', voice: 'nova_a', speed: 1.1, language: 'es' };
const QUICK = { id: 'b', name: 'Quick', providerId: 'p', model: 'tts-1', voice: 'nova_b' };
const mine = (speak: Settings['speak'] = { profiles: [CALM, QUICK], defaultProfileId: 'b', firstPiece: 80 }) =>
  ({ providers: [provider], systemPrompt: '', speak }) as Settings;
const json = (voiceProfiles: unknown) => JSON.stringify({ voiceProfiles });

describe('exporting voice profiles', () => {
  it('writes { "voiceProfiles": [...] }: no id, no key, nothing a profile is not', () => {
    const text = exportProfiles([{ ...CALM, apiKey: 'secret-key', extra: 1 } as never, QUICK]);
    expect(JSON.parse(text)).toEqual({
      voiceProfiles: [
        { name: 'Calm', providerId: 'p', model: 'tts-1', voice: 'nova_a', speed: 1.1, language: 'es' },
        { name: 'Quick', providerId: 'p', model: 'tts-1', voice: 'nova_b' },
      ],
    });
    expect(text).not.toContain('secret-key');
  });

  it('reads back what it wrote, each replacing the one of its name and keeping its id', () => {
    const read = readProfiles(exportProfiles([CALM, QUICK]), mine());
    expect(read.rows.map((r) => [r.name, r.status])).toEqual([['Calm', 'replaces'], ['Quick', 'replaces']]);
    expect(read.rows.map((r) => r.item)).toEqual([CALM, QUICK]);
    expect(read.notes).toEqual([]);
    expect(read.plain).toBeUndefined();
  });
});

describe('importing voice profiles from JSON', () => {
  it('new ones get an id of their own; one of the same name (any case) replaces it', () => {
    const read = readProfiles(json([{ name: 'calm ', providerId: 'p', voice: 'nova_c' }, { name: 'Lector', providerId: 'p', model: 'tts-1', voice: 'nova_d', language: 'es' }]), mine());
    expect(read.rows.map((r) => [r.name, r.status])).toEqual([['calm', 'replaces'], ['Lector', 'new']]);
    expect(read.rows[0]!.item).toEqual({ id: 'a', name: 'calm', providerId: 'p', voice: 'nova_c' });
    expect(read.rows[1]!.item).toMatchObject({ name: 'Lector', providerId: 'p', model: 'tts-1', voice: 'nova_d', language: 'es' });
    expect(read.rows[1]!.item!.id).not.toMatch(/^[ab]$/);
  });

  it('a list or one profile alone is read too, and another section\'s file is told apart', () => {
    expect(readProfiles(JSON.stringify([{ name: 'X', voice: 'v' }]), mine()).rows).toHaveLength(1);
    expect(readProfiles(JSON.stringify({ name: 'X', voice: 'v' }), mine()).rows[0]).toMatchObject({ name: 'X', status: 'new' });
    expect(() => readProfiles(JSON.stringify({ skills: [{ name: 's' }] }), mine())).toThrow('This is a skills file: import it in Skills.');
    expect(() => readProfiles('{ not json', mine())).toThrow('Not JSON');
  });

  it('takes the profiles of Settings → Export and import\'s file, or of its settings part', () => {
    const part = { speak: { profiles: [{ id: 'z', name: 'Far', providerId: 'p', voice: 'v' }], firstPiece: 60 } };
    const file = { type: 'teseo-export', version: 1, parts: { settings: part } };
    expect(readProfiles(JSON.stringify(file), mine()).rows.map((r) => r.item?.name)).toEqual(['Far']);
    expect(readProfiles(JSON.stringify(part), mine()).rows.map((r) => r.item?.name)).toEqual(['Far']);
    expect(() => readProfiles(JSON.stringify({ type: 'teseo-export', version: 1, parts: { skills: {} } }), mine())).toThrow('No voice profiles');
  });

  it('a provider not among the user\'s: in without one, and the preview says so', () => {
    const read = readProfiles(json([{ name: 'Far', providerId: 'elsewhere', model: 'tts-1', voice: 'v' }, { name: 'None', voice: 'v' }]), mine());
    expect(read.rows.map((r) => r.item)).toEqual([expect.not.objectContaining({ providerId: expect.anything() }), expect.not.objectContaining({ providerId: expect.anything() })]);
    expect(read.rows[0]!.item).toMatchObject({ name: 'Far', model: 'tts-1', voice: 'v' });
    expect(read.notes).toEqual(['Far, None: their provider is not among yours. They come in without one: choose it in Settings → Speak.']);
  });

  it('malformed entries are left out with why; the speed is bounded as the editor bounds it', () => {
    const read = readProfiles(json(['x', { voice: 'v' }, { name: 'Mute' }, { name: 'Odd', voice: 'v', speed: 'fast' }, { name: 'Bad', voice: 'v', model: 3 }, { name: 'Fast', voice: 'v', speed: 9 }, { name: 'Slow', voice: 'v', speed: 0.01 }, { name: 'Fine', voice: 'v', speed: 1.234 }, { name: 'fine', voice: 'w' }, { name: 'Lang', voice: 'v', language: '<b>' }]), mine());
    expect(read.rows.map((r) => [r.name, r.status, r.why])).toEqual([
      ['(no name)', 'left-out', 'an entry that is not a profile.'],
      ['(no name)', 'left-out', 'a profile without a name.'],
      ['Mute', 'left-out', 'Mute: it has no voice.'],
      ['Odd', 'left-out', 'Odd: its speed is not a number.'],
      ['Bad', 'left-out', 'Bad: its model is not text.'],
      ['Fast', 'new', undefined],
      ['Slow', 'new', undefined],
      ['Fine', 'new', undefined],
      ['fine', 'left-out', 'fine: the file has this name more than once.'],
      ['Lang', 'new', undefined],
    ]);
    const speeds = Object.fromEntries(read.rows.filter((r) => r.item).map((r) => [r.name, r.item!.speed]));
    expect(speeds).toEqual({ Fast: 4, Slow: 0.25, Fine: 1.23, Lang: undefined });
    expect(read.rows.at(-1)!.item!.language).toBeUndefined();
  });
});

describe('importing a pasted Name=voice@speed list', () => {
  it('entries apart by commas, semicolons or new lines; speed optional; no provider nor model; rules none', () => {
    const read = readProfiles('Reader=voice_a@1.15, Blend=voice_a+voice_b@1.2;\nPlain = voice_c \n', mine());
    expect(read.plain).toBe(true);
    expect(read.rows.map((r) => [r.name, r.status])).toEqual([['Reader', 'new'], ['Blend', 'new'], ['Plain', 'new']]);
    expect(read.rows.map(({ item }) => item && { name: item.name, voice: item.voice, speed: item.speed, language: item.language, providerId: item.providerId, model: item.model })).toEqual([
      { name: 'Reader', voice: 'voice_a', speed: 1.15, language: 'none', providerId: undefined, model: undefined },
      { name: 'Blend', voice: 'voice_a+voice_b', speed: 1.2, language: 'none', providerId: undefined, model: undefined },
      { name: 'Plain', voice: 'voice_c', speed: undefined, language: 'none', providerId: undefined, model: undefined },
    ]);
    expect(read.notes).toEqual([]);
  });

  it('leaves out what is not name=voice, a speed that is not a number, and a name twice; bounds the speed; replaces by name', () => {
    const read = readProfiles('just text, =v, Name=, A=b=c, X=v@quick, Loud=v@12, loud=w, calm=nova_z@1', mine());
    expect(read.rows.map((r) => [r.name, r.status, r.why])).toEqual([
      ['just text', 'left-out', '"just text": not Name=voice.'],
      ['=v', 'left-out', '"=v": not Name=voice.'],
      ['Name=', 'left-out', '"Name=": not Name=voice.'],
      ['A=b=c', 'left-out', '"A=b=c": not Name=voice.'],
      ['X', 'left-out', 'X: its speed "quick" is not a number.'],
      ['Loud', 'new', undefined],
      ['loud', 'left-out', 'loud: the list has this name more than once.'],
      ['calm', 'replaces', undefined],
    ]);
    expect(read.rows[5]!.item!.speed).toBe(4);
    expect(read.rows[7]!.item!.id).toBe('a');
  });

  it('nothing in it: says so', () => {
    expect(() => readProfiles(' ,;\n ', mine())).toThrow('Nothing to import');
  });

  it('the provider and model chosen in the preview go to all of its profiles', () => {
    const picked = readProfiles('A=v1, B=v2@1.5', mine()).rows.map((r) => r.item!);
    expect(withTarget(picked, { providerId: 'p', model: ' tts-1 ' }).map((p) => [p.providerId, p.model])).toEqual([['p', 'tts-1'], ['p', 'tts-1']]);
    expect(withTarget(picked, {}).map((p) => [p.providerId, p.model])).toEqual([[undefined, undefined], [undefined, undefined]]);
  });
});

describe('the profiles imported', () => {
  it('are added, or replace the one of their id; the default and the rest of Speak as they are', () => {
    const [calm, lector] = readProfiles(json([{ name: 'Calm', providerId: 'p', voice: 'nova_c' }, { name: 'Lector', voice: 'ef' }]), mine()).rows.map((r) => r.item!);
    const speak = withImported(mine(), [calm!, lector!]);
    expect(speak.profiles).toEqual([{ id: 'a', name: 'Calm', providerId: 'p', voice: 'nova_c' }, QUICK, lector]);
    expect(speak).toMatchObject({ defaultProfileId: 'b', firstPiece: 80 });
    expect(withImported({ speak: undefined }, [lector!])).toEqual({ profiles: [lector] });
  });
});

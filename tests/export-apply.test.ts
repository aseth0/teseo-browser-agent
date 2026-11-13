// Settings → Export and import: an import stores the items picked of each part, agents before the
// memory that names them, and providers, themes and settings in one change.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeSecretDb, fakeStorage } from './fakes/browser';
import type { Settings } from '../src/storage/settings-types';

const storage = fakeStorage();
const secrets = fakeSecretDb();
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { applyImport, retentionDeletes } = await import('../src/ui/export-import/apply');
const { saveConversation } = await import('../src/history/store');
const { agentStore } = await import('../src/agents/profiles');
const { memoryStore } = await import('../src/memory/store');
const { skillStore } = await import('../src/skills/store');
type Current = import('../src/ui/export-import/parts').Current;

let settings: Settings;
const save = async (change: Partial<Settings> | ((prev: Settings) => Settings)) => {
  settings = typeof change === 'function' ? change(settings) : { ...settings, ...change };
};
const current = async (): Promise<Current> => ({
  settings, agents: await agentStore.load(), skills: await skillStore.load(), templates: [], memory: await memoryStore.load(),
  blacklist: [], customTools: [], catalog: [], actions: [], conversations: [],
});

beforeEach(() => {
  storage.reset();
  secrets.data.clear();
  settings = { providers: [{ id: 'p', name: 'Mine', baseURL: 'https://api.example.com/v1', apiKey: 'sk-mine', defaultModel: 'm' }], systemPrompt: 'Be brief.' };
});

describe('an import', () => {
  it('stores only the rows picked, agents before the memory that names them', async () => {
    const agents = JSON.stringify({ agents: [{ name: 'helper', instructions: 'Help.' }] });
    const memory = JSON.stringify({ memory: [{ id: 'm1', text: 'Likes tea.', agents: ['helper'] }] });
    const skills = JSON.stringify({ skills: [{ name: 'one', description: 'First.', body: 'Do one.' }, { name: 'two', description: 'Second.', body: 'Do two.' }] });
    const done = await applyImport([
      { kind: 'memory', json: memory, rows: [0] },
      { kind: 'agents', json: agents, rows: [0] },
      { kind: 'skills', json: skills, rows: [1] },
    ], await current(), { save, reload: current });
    expect(done.map((d) => d.kind)).toEqual(['agents', 'skills', 'memory']);
    const helper = (await agentStore.load()).find((a) => a.name === 'helper')!;
    expect(helper.enabled).toBe(false);
    expect((await memoryStore.load())[0]!.agents).toEqual([helper.id]);
    expect((await skillStore.load()).filter((s) => !s.builtin).map((s) => s.name)).toEqual(['two']);
  });

  it('says how many saved conversations an imported History retention would delete', async () => {
    for (const id of ['a', 'b', 'c']) await saveConversation({ id, history: [{ role: 'user', parts: [{ type: 'text', text: id }] }], createdAt: 1, updatedAt: Date.now() });
    const part = (history: object, rows = [0]) => [{ kind: 'settings' as const, json: JSON.stringify({ history }), rows }];
    expect(await retentionDeletes(part({ keepCount: 1 }), await current())).toBe(2);
    expect(await retentionDeletes(part({ keepCount: 1 }, []), await current())).toBe(0); // not picked
    expect(await retentionDeletes(part({ keepCount: 0.5 }), await current())).toBe(0); // not a retention
    settings = { ...settings, history: { keepCount: 1 } };
    expect(await retentionDeletes(part({ keepCount: 1, enabled: true }), await current())).toBe(0); // yours already
  });

  it('changes providers, themes and settings together, keeping your key', async () => {
    await applyImport([
      { kind: 'providers', json: JSON.stringify({ providers: [{ name: 'mine', baseURL: 'https://api.example.com/v2', defaultModel: 'big' }, { name: 'Other', baseURL: 'https://other.example.com/v1' }] }), rows: [0, 1] },
      { kind: 'theme', json: JSON.stringify({ type: 'browser-agent-theme', version: 2, name: 'Dusk', mode: 'dark' }), rows: [0] },
      { kind: 'settings', json: JSON.stringify({ systemPrompt: 'Be thorough.', aboutUser: 'Not this one.' }), rows: [0] },
    ], await current(), { save, reload: current });
    expect(settings.providers.map((p) => [p.name, p.apiKey, p.baseURL])).toEqual([['mine', 'sk-mine', 'https://api.example.com/v2'], ['Other', '', 'https://other.example.com/v1']]);
    expect(settings.customThemes?.map((t) => t.name)).toEqual(['Dusk']);
    expect(settings.systemPrompt).toBe('Be thorough.');
    expect(settings.aboutUser).toBeUndefined();
  });
});

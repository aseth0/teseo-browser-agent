// Settings → Export and import: each part made as its section exports it, and read as its section
// imports it, with what importing would do.
import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/storage/settings-types';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
const { countOf, exportPart, readPart } = await import('../src/ui/export-import/parts');
const { buildExportFile, PARTS } = await import('../src/storage/export-file');
const { newAgentProfile } = await import('../src/agents/profiles');
type Current = import('../src/ui/export-import/parts').Current;

const SECRET = 'SECRET-VALUE';
const settings = {
  providers: [{ id: 'p', name: 'Example', baseURL: 'https://api.example.com/v1', apiKey: SECRET, defaultModel: 'm', extraHeaders: { 'X-Org': SECRET } }],
  systemPrompt: 'Be brief.',
  aboutUser: 'I test things.',
  mcpServers: [{ id: 's', name: 'docs', url: 'https://mcp.example.com', headers: { Authorization: SECRET }, oauth: { clientId: 'c', clientSecret: SECRET }, enabled: true }],
  customThemes: [{ name: 'Dusk', mode: 'dark' }],
} as unknown as Settings;

const cur: Current = {
  settings,
  agents: [{ ...newAgentProfile(), id: 'a', name: 'helper' }],
  skills: [
    { id: 'b', name: 'built-in', description: 'd', matches: [], body: 'x', references: [], enabled: true, builtin: true },
    { id: 's1', name: 'summarize', description: 'Sums up.', matches: [], body: 'Sum it up.', references: [], enabled: true },
  ],
  templates: [],
  memory: [],
  blacklist: [{ term: 'Example Corp', replacement: 'the company' }],
  customTools: [{ id: 't', enabled: true, name: 'api.get', description: 'd', base: 'http', params: {}, http: { method: 'GET', url: 'https://api.example.com/{{secret:k}}', headers: [{ name: 'X-Key', value: SECRET }], secrets: { k: SECRET } } }],
  catalog: [],
  actions: [],
  conversations: [{ id: 'c1', title: 'Old chat', createdAt: 1, updatedAt: 1, turns: 0 }],
};

describe('each part', () => {
  it('counts only what an export takes', () => {
    expect(countOf('skills', cur)).toBe(1); // not the built-in one
    expect(countOf('providers', cur)).toBe(1);
    expect(countOf('settings', cur)).toBe(2);
    expect(countOf('conversations', cur)).toBe(1);
  });

  it('never exports a secret, in any part', () => {
    const parts = Object.fromEntries(PARTS.filter((p) => p.kind !== 'conversations').map((p) => [p.kind, exportPart(p.kind as Exclude<typeof p.kind, 'conversations'>, cur)]));
    for (const [kind, json] of Object.entries(parts)) expect(json, kind).not.toContain(SECRET);
    expect(buildExportFile(parts)).not.toContain(SECRET);
  });

  it('reads back as its section imports it: what is here replaced, the rest new', () => {
    const skills = readPart('skills', exportPart('skills', cur), cur);
    expect(skills.rows.map((r) => [r.name, r.status])).toEqual([['summarize', 'replaces']]);
    const providers = readPart('providers', JSON.stringify({ providers: [{ name: 'Other', baseURL: 'https://other.example.com/v1' }] }), cur);
    expect(providers.rows[0]!.status).toBe('new');
    expect(providers.notes[0]).toMatch(/without a key/);
  });

  it('says of the word blacklist which terms change, and how many are already here', () => {
    const json = JSON.stringify({ type: 'browser-agent-word-blacklist', version: 1, entries: [
      { term: 'Example Corp', replacement: 'the company' },
      { term: 'example corp', replacement: 'a firm' },
      { term: 'Project X', replacement: 'the project' },
    ] });
    const read = readPart('wordBlacklist', json, cur);
    expect(read.rows.map((r) => r.status)).toEqual(['replaces', 'new']);
    expect(read.notes).toEqual(['1 term is already here as in the file.']);
    expect(() => readPart('wordBlacklist', '{"type":"x"}', cur)).toThrow(/word blacklist/);
  });

  it('matches themes by name, and conversations by id', () => {
    expect(readPart('theme', exportPart('theme', cur), cur).rows.map((r) => [r.name, r.status])).toEqual([['Dusk', 'replaces']]);
    const json = JSON.stringify({ conversations: [
      { id: 'c1', title: 'Old chat', history: [] },
      { id: 'c2', history: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }] },
      { id: '', history: [] },
    ] });
    const read = readPart('conversations', json, cur);
    expect(read.rows.map((r) => r.status)).toEqual(['replaces', 'new']);
    expect(read.notes).toEqual(['1 could not be read: left out.']);
  });

  it('adds MCP servers off, and says local ones are left out', () => {
    const read = readPart('mcpServers', JSON.stringify({ mcpServers: { a: { url: 'https://a.example.com/mcp' }, local: { command: 'run' } } }), cur);
    expect(read.rows.map((r) => [r.name, r.status])).toEqual([['a', 'new'], ['local', 'left-out']]);
    expect((read.rows[0]!.item as { enabled: boolean }).enabled).toBe(false);
  });

  it('offers only the settings that differ', () => {
    const read = readPart('settings', JSON.stringify({ systemPrompt: 'Be brief.', aboutUser: 'Someone else.' }), cur);
    expect(read.rows.map((r) => r.name)).toEqual(['About you']);
  });
});

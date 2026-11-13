// Settings → Export and import: the file of several parts, its secrets left out, and what an import
// reads of it (or of one section's file alone).
import { describe, expect, it } from 'vitest';
import { buildExportFile, EXPORT_TYPE, exportFileName, LEFT_OUT, PARTS, readExportFile, scrubSecrets } from '../src/storage/export-file';
import { exportServers } from '../src/mcp/config';
import { exportCustomTools } from '../src/tools/custom/io';
import { exportProviders } from '../src/providers/io';

const now = new Date('2026-11-11T10:42:00Z');

describe('the export file', () => {
  it('holds the parts given, in the order the screens list them, as their sections export them', () => {
    const file = JSON.parse(buildExportFile({ templates: '{"templates":[]}', skills: '{"skills":[{"name":"a"}]}' }, { now, version: '0.69.0' }));
    expect(file).toMatchObject({ type: EXPORT_TYPE, version: 1, exportedAt: '2026-11-11T10:42:00.000Z', app: { name: 'Teseo', version: '0.69.0' }, leftOut: LEFT_OUT });
    expect(Object.keys(file.parts)).toEqual(['skills', 'templates']);
    expect(file.parts.skills).toEqual({ skills: [{ name: 'a' }] });
  });

  it('is read back part by part, each as its section reads it', () => {
    const read = readExportFile(buildExportFile({ skills: '{"skills":[{"name":"a"}]}', settings: '{"aboutUser":"x"}' }, { now }));
    expect(read.single).toBe(false);
    expect(read.meta.exportedAt).toBe('2026-11-11T10:42:00.000Z');
    expect(read.parts).toEqual([{ kind: 'skills', json: '{"skills":[{"name":"a"}]}' }, { kind: 'settings', json: '{"aboutUser":"x"}' }]);
  });

  it('names parts a newer version wrote, and refuses a newer version of the file', () => {
    const read = readExportFile(JSON.stringify({ type: EXPORT_TYPE, version: 1, parts: { skills: { skills: [] }, robots: {} } }));
    expect(read.unknown).toEqual(['robots']);
    expect(() => readExportFile(JSON.stringify({ type: EXPORT_TYPE, version: 2, parts: {} }))).toThrow(/version 2/);
    expect(() => readExportFile(JSON.stringify({ type: EXPORT_TYPE, version: 1 }))).toThrow(/parts/);
  });

  it('takes one section’s file alone as its one part', () => {
    const one = (v: unknown) => readExportFile(JSON.stringify(v)).parts.map((p) => p.kind);
    expect(one({ skills: [{ name: 'a' }] })).toEqual(['skills']);
    expect(one({ mcpServers: { a: { url: 'https://mcp.example.com' } } })).toEqual(['mcpServers']);
    expect(one({ type: 'browser-agent-theme', version: 2, name: 'Dusk' })).toEqual(['theme']);
    expect(one({ type: 'browser-agent-word-blacklist', version: 1, entries: [] })).toEqual(['wordBlacklist']);
    expect(one({ conversations: [] })).toEqual(['conversations']);
    expect(one({ id: 'c', history: [] })).toEqual(['conversations']);
    expect(one({ providers: [] })).toEqual(['providers']);
    expect(readExportFile('{"skills":[{"name":"a"}]}').single).toBe(true);
    expect(() => readExportFile('{"hello":1}')).toThrow(/Not a Teseo export/);
    expect(() => readExportFile('not json')).toThrow('Not JSON.');
  });

  it('is named after the day', () => {
    expect(exportFileName(now)).toBe('teseo-export-2026-11-11.json');
  });

  it('lists every part once', () => {
    expect(new Set(PARTS.map((p) => p.kind)).size).toBe(PARTS.length);
  });
});

describe('secrets', () => {
  it('are scrubbed at any depth: keys dropped, header values emptied, "{{apiKey}}" kept', () => {
    const scrubbed = scrubSecrets({
      a: [{ apiKey: 'sk-1', name: 'p', extraHeaders: { 'X-Org': 'org-secret', 'api-key': '{{apiKey}}' } }],
      http: { secrets: { token: 's3' }, headers: [{ name: 'Authorization', value: 'Bearer abc' }] },
      oauth: { clientId: 'id', clientSecret: 'cs' },
      deep: { accessToken: 't', refreshToken: 'r', password: 'p', token: 'x', keep: 'yes' },
    });
    expect(scrubbed).toEqual({
      a: [{ name: 'p', extraHeaders: { 'X-Org': '', 'api-key': '{{apiKey}}' } }],
      http: { headers: [{ name: 'Authorization', value: '' }] },
      oauth: { clientId: 'id' },
      deep: { keep: 'yes' },
    });
  });

  it('never reach the file, whatever the sections’ exports would hold', () => {
    const secret = 'SECRET-VALUE';
    const file = buildExportFile({
      providers: exportProviders([{ id: 'p', name: 'Example', baseURL: 'https://api.example.com/v1', apiKey: secret, defaultModel: 'm', extraHeaders: { 'X-Org': secret } }]),
      mcpServers: exportServers([{ id: 's', name: 'docs', url: 'https://mcp.example.com', headers: { Authorization: secret }, oauth: { clientId: 'c', clientSecret: secret }, enabled: true }]),
      customTools: exportCustomTools([{ id: 't', enabled: true, name: 'api.get', description: 'd', base: 'http', params: {}, http: { method: 'GET', url: 'https://api.example.com/{{secret:k}}', headers: [{ name: 'X-Key', value: secret }], secrets: { k: secret } } }]),
      // a part whose section would keep one (a key typed where it should not be) is scrubbed too
      settings: JSON.stringify({ webSearch: { apiKey: secret } }),
    });
    expect(file).not.toContain(secret);
    expect(file).toContain('X-Key'); // the header's name stays, to say what to fill in
  });
});

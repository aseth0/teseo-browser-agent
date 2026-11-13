import { describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '../src/storage/settings-types';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
const { exportProviders, importProviders, withProviders } = await import('../src/providers/io');

const mine: ProviderConfig = { id: 'p1', name: 'Example Cloud', baseURL: 'https://api.example.com/v1', apiKey: 'sk-mine', defaultModel: 'small', extraHeaders: { 'X-Org': 'org-1', 'api-key': '{{apiKey}}' } };
const built: ProviderConfig = { id: 'env', name: 'Environment', baseURL: 'https://built.example.com/v1', apiKey: 'sk-built', defaultModel: 'm' };

describe('providers as JSON', () => {
  it('exports them without keys or header values, and without the build’s own', () => {
    const { providers } = JSON.parse(exportProviders([built, mine]));
    expect(providers).toEqual([{ id: 'p1', name: 'Example Cloud', baseURL: 'https://api.example.com/v1', defaultModel: 'small', extraHeaders: { 'X-Org': '', 'api-key': '{{apiKey}}' } }]);
  });

  it('imports by name: one here keeps its id, key and header values; a new one comes without a key', () => {
    const json = JSON.stringify({ providers: [
      { id: 'other', name: 'example cloud', baseURL: 'https://api.example.com/v2', defaultModel: 'big', apiKey: 'sk-file', extraHeaders: { 'X-Org': '' } },
      { id: 'p9', name: 'Local', baseURL: 'http://localhost:11434/v1', defaultModel: 'llama', apiKey: 'sk-file', thinkingParam: 'none', contextWindow: 8192 },
    ] });
    const [replaced, added] = importProviders(json, [mine]);
    expect(replaced).toMatchObject({ status: 'replaces', item: { id: 'p1', apiKey: 'sk-mine', baseURL: 'https://api.example.com/v2', defaultModel: 'big', extraHeaders: { 'X-Org': 'org-1' } } });
    expect(added).toMatchObject({ status: 'new', item: { id: 'p9', apiKey: '', thinkingParam: 'none', contextWindow: 8192 } });
  });

  it('leaves out those without a name or a web address, a name twice, and takes no id already used', () => {
    const rows = importProviders(JSON.stringify({ providers: [
      { name: '', baseURL: 'https://a.example.com' },
      { name: 'Bad', baseURL: 'ftp://a.example.com' },
      { name: 'Worse', baseURL: 'nowhere' },
      { id: 'p1', name: 'New', baseURL: 'https://b.example.com' },
      { name: 'new', baseURL: 'https://c.example.com' },
      { id: 'env', name: 'Sneaky', baseURL: 'https://d.example.com' },
    ] }), [mine]);
    expect(rows.map((r) => r.status)).toEqual(['left-out', 'left-out', 'left-out', 'new', 'left-out', 'new']);
    expect(rows[3]!.item!.id).not.toBe('p1');
    expect(rows[5]!.item!.id).not.toBe('env');
    expect(() => importProviders('{"nope":1}', [])).toThrow(/providers/);
  });

  it('carries the registered models: exported, imported back, kept when the file has no list', () => {
    const registered = { ...mine, models: ['small', 'big'] };
    const [back] = importProviders(exportProviders([registered]), [registered]);
    expect(back!.item!.models).toEqual(['small', 'big']);
    const withList = (models: unknown) => importProviders(JSON.stringify({ providers: [{ name: 'Example Cloud', baseURL: mine.baseURL, ...(models !== undefined && { models }) }] }), [registered])[0]!.item!;
    expect(withList(undefined).models).toEqual(['small', 'big']);
    expect(withList([' a ', 'a', 3, '', 'b']).models).toEqual(['a', 'b']);
    expect(withList([])).not.toHaveProperty('models');
    expect(withList('nope')).not.toHaveProperty('models');
  });

  it('puts those imported in place of theirs, or last', () => {
    const next = withProviders([mine, built], [{ ...mine, defaultModel: 'big' }, { ...built, id: 'n', name: 'N' }]);
    expect(next.map((p) => [p.id, p.defaultModel])).toEqual([['p1', 'big'], ['env', 'm'], ['n', 'm']]);
  });
});

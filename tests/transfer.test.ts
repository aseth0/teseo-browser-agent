import { describe, expect, it, vi } from 'vitest';
import { exportSubset, fetchJsonText, otherKind, rawUrl, urlProblem } from '../src/storage/transfer';

describe('otherKind', () => {
  it('sees another section by its list of objects, never when the own key is there', () => {
    expect(otherKind({ templates: [{ name: 'shop' }] }, 'skills')).toBe('templates');
    expect(otherKind({ skills: [{ name: 'a' }], templates: [{}] }, 'skills')).toBeUndefined();
    expect(otherKind({ name: 'jira', skills: ['review-pr'], templates: ['shop'] }, 'agents')).toBeUndefined(); // one agent
    expect(otherKind({ name: 'jira', skills: ['review-pr'] }, 'skills')).toBeUndefined(); // strings: not a skills file
    expect(otherKind({ mcpServers: { a: { url: 'https://example.com/mcp' } } }, 'skills')).toBe('mcpServers');
    expect(otherKind({ type: 'browser-agent-theme', name: 'Dusk' }, 'memory')).toBe('theme');
    expect(otherKind({ type: 'browser-agent-word-blacklist', entries: [] }, 'memory')).toBe('wordBlacklist');
    expect(otherKind([{ name: 'a' }], 'skills')).toBeUndefined();
  });
});

describe('rawUrl and urlProblem', () => {
  it('reads a GitHub file page as its raw file', () => {
    expect(rawUrl('https://github.com/example/skills/blob/main/dir/skills.json')).toBe('https://raw.githubusercontent.com/example/skills/main/dir/skills.json');
    expect(rawUrl('https://raw.githubusercontent.com/example/skills/main/skills.json')).toBe('https://raw.githubusercontent.com/example/skills/main/skills.json');
    expect(rawUrl('https://gist.github.com/example/abc')).toBe('https://gist.github.com/example/abc');
  });

  it('takes https, and http only for local test hosts', () => {
    expect(urlProblem('https://example.com/a.json')).toBeUndefined();
    expect(urlProblem('http://localhost:8080/a.json')).toBeUndefined();
    expect(urlProblem('http://127.0.0.1/a.json')).toBeUndefined();
    expect(urlProblem('http://shop.test/a.json')).toBeUndefined();
    expect(urlProblem('http://example.com/a.json')).toBe('Use an https:// address.');
    expect(urlProblem('ftp://example.com/a.json')).toBe('Use an https:// address.');
    expect(urlProblem('not a url')).toBe('Not a web address.');
  });
});

describe('fetchJsonText', () => {
  const answer = (body: string, init: ResponseInit = {}) => vi.fn(async () => new Response(body, init));

  it('reads it without cookies or cache', async () => {
    const f = answer('{"skills":[]}');
    expect(await fetchJsonText('https://example.com/s.json', { fetch: f })).toBe('{"skills":[]}');
    expect(f).toHaveBeenCalledWith('https://example.com/s.json', expect.objectContaining({ credentials: 'omit', cache: 'no-store' }));
  });

  it('says why it read nothing', async () => {
    await expect(fetchJsonText('https://example.com/s.json', { fetch: answer('no', { status: 404 }) })).rejects.toThrow('example.com answered 404.');
    await expect(fetchJsonText('https://example.com/s.json', { fetch: answer('<!doctype html><p>page') })).rejects.toThrow('Not JSON: is it the raw file?');
    await expect(fetchJsonText('https://example.com/s.json', { fetch: answer('x'.repeat(11)), maxBytes: 10 })).rejects.toThrow('Larger than 10 bytes.');
  });

  it('counts the size in bytes, and refuses a declared length over it before reading the body', async () => {
    await expect(fetchJsonText('https://example.com/s.json', { fetch: answer(`"${'é'.repeat(5)}"`), maxBytes: 10 })).rejects.toThrow('Larger than 10 bytes.');
    const body = vi.fn(async () => '{}');
    const declared = (async () => ({ ok: true, status: 200, headers: new Headers({ 'content-length': '99' }), text: body })) as unknown as typeof fetch;
    await expect(fetchJsonText('https://example.com/s.json', { fetch: declared, maxBytes: 10 })).rejects.toThrow('Larger than 10 bytes.');
    expect(body).not.toHaveBeenCalled();
  });

  it('gives up after its timeout', async () => {
    const never = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, no) => init.signal!.addEventListener('abort', () => no(new DOMException('aborted', 'AbortError')))));
    await expect(fetchJsonText('https://example.com/s.json', { fetch: never as unknown as typeof fetch, timeoutMs: 5 })).rejects.toThrow('example.com did not answer in time.');
  });
});

describe('exportSubset', () => {
  type Item = { id: string; builtin?: boolean };
  const items: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c', builtin: true }];
  const base = { shown: [items[1]!, items[2]!], selected: new Set(['c', 'a']), id: (t: Item) => t.id, exportable: (t: Item) => !t.builtin };

  it('takes all, shown or selected, only exportable ones, in the list order', () => {
    expect(exportSubset(items, { ...base, scope: 'all' }).map((t) => t.id)).toEqual(['a', 'b']);
    expect(exportSubset(items, { ...base, scope: 'shown' }).map((t) => t.id)).toEqual(['b']);
    expect(exportSubset(items, { ...base, scope: 'selected' }).map((t) => t.id)).toEqual(['a']);
  });
});

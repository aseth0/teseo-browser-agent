import { afterEach, describe, expect, it, vi } from 'vitest';
import { stripMarks } from '../src/core/model-texts';
import { AccessRequiredError } from '../src/core/types';
import { runtimeCustomTools } from '../src/tools/custom/runtime';
import { customProblems } from '../src/tools/custom/validate';
import type { CustomTool } from '../src/tools/custom/types';
import { answerText, extractPath, fillBody, fillUrl, hasFixedHost } from '../src/tools/http';
import { mockFetch, redirecting } from './fakes/browser';
import { TOOL_SETTINGS } from './helpers';

const allowed = new Set(['https://api.example.com/*']);
const cookies: Record<string, string> = {}; // of api.example.com
vi.mock('wxt/browser', () => ({
  browser: {
    permissions: { contains: async ({ origins }: { origins: string[] }) => origins.every((o) => allowed.has(o)) },
    cookies: { get: async ({ url, name }: { url: string; name: string }) => (new URL(url).host === 'api.example.com' && name in cookies ? { name, value: cookies[name] } : null) },
  },
}));

const search: CustomTool = {
  id: 's',
  enabled: true,
  name: 'api.search',
  description: 'Searches the API.',
  base: 'http',
  params: {},
  inputs: [
    { name: 'query', type: 'string', description: 'Words', required: true },
    { name: 'lang', type: 'string', description: 'Language', default: 'es' },
  ],
  http: { method: 'GET', url: 'https://api.example.com/search?q={query}&lang={lang}', headers: [{ name: 'X-Key', value: 'secret' }], extract: 'items[].title' },
};
const add: CustomTool = {
  ...search,
  id: 'a',
  name: 'api.add',
  inputs: [{ name: 'name', type: 'string', description: 'Its name' }, { name: 'stars', type: 'number', description: 'Stars' }],
  http: { method: 'POST', url: 'https://api.example.com/items', body: '{"name": {name}, "stars": {stars}}' },
};
const ctx = { settings: TOOL_SETTINGS, signal: new AbortController().signal };

afterEach(() => vi.unstubAllGlobals());

describe('HTTP request custom tools', () => {
  it('fills the URL encoded and the body as JSON', () => {
    expect(fillUrl('https://x.test/s?q={q}&n={n}', { q: 'a b&c', n: undefined })).toBe('https://x.test/s?q=a%20b%26c&n=');
    expect(fillBody('{"name": {name}, "tags": {tags}, "none": {none}}', { name: 'Perry "P"', tags: ['a'] })).toBe('{"name": "Perry \\"P\\"", "tags": ["a"], "none": null}');
  });

  it('cuts a JSON answer to a path', () => {
    const answer = { items: [{ title: 'A', n: 1 }, { title: 'B' }], data: [{ name: 'first' }] };
    expect(extractPath(answer, 'items[].title')).toEqual(['A', 'B']);
    expect(extractPath(answer, 'data.0.name')).toBe('first');
    expect(extractPath([{ name: 'x' }], '[].name')).toEqual(['x']);
    // Several keys: of each element, of the root, and those an element lacks left out.
    const channels = [{ id: '1', name: 'inc-1', display_name: 'INC-1', purpose: 'x' }, { id: '2', display_name: 'INC-2' }];
    expect(extractPath(channels, '[].{display_name, name}')).toEqual([{ display_name: 'INC-1', name: 'inc-1' }, { display_name: 'INC-2' }]);
    expect(extractPath({ username: 'perry', email: 'p@x', roles: 'u' }, '{username,email}')).toEqual({ username: 'perry', email: 'p@x' });
    expect(extractPath(answer, 'items[].{title}')).toEqual([{ title: 'A' }, { title: 'B' }]);
    expect(extractPath(answer, 'data.{name}')).toBeUndefined(); // a list, not an object
    expect(answerText(JSON.stringify(answer), 'data.0.name')).toBe('first');
    // Nothing there: the keys the answer has, to pick another path from.
    expect(answerText(JSON.stringify(answer), 'nope')).toBe("(nothing at nope; the answer's top-level keys: items, data)");
    expect(answerText(JSON.stringify([{ id: 1, name: 'a' }, {}]), 'items')).toBe("(nothing at items; the answer is a list of 2, its first item's keys: id, name)");
    expect(answerText('[]', 'items')).toBe('(nothing at items; the answer is a list of 0)');
    expect(answerText('42', 'items')).toBe('(nothing at items)');
    expect(answerText('not json', 'items')).toBe('not json');
  });

  it('offers only its parameters; GET reads, other methods write and are described with their body', async () => {
    const [get, post] = runtimeCustomTools([search, add], []);
    expect(get).toMatchObject({ name: 'api.search', source: 'custom', effect: 'read' });
    expect(JSON.stringify(get!.inputSchema)).not.toContain('secret');
    expect(post!.effect).toBe('write');
    // A POST the user says only reads (a search): a read.
    expect(runtimeCustomTools([{ ...add, http: { ...add.http!, readOnly: true } }], [])[0]!.effect).toBe('read');
    expect(await post!.describe!({ name: 'Perry', stars: 5 }, ctx)).toEqual({
      summary: 'POST https://api.example.com/items',
      url: 'https://api.example.com/items',
      details: [{ label: 'Body', value: '{"name": "Perry", "stars": 5}', code: true }],
    });
  });

  it('sends the request with its headers and gives the answer, cut, as untrusted', async () => {
    const fetch = mockFetch(new Response(JSON.stringify({ items: [{ title: 'Platypus' }], total: 1 }), { status: 200 }));
    const [get] = runtimeCustomTools([search], []);
    const result = (await get!.run({ query: 'platypus bill' }, ctx)) as { text: string; isError?: boolean; data?: unknown };
    expect(fetch).toHaveBeenCalledWith('https://api.example.com/search?q=platypus%20bill&lang=es', expect.objectContaining({ method: 'GET', headers: { 'X-Key': 'secret' } }));
    // The query is left out: a value the user wrote into the URL template (a key) must not reach the model.
    const [, inner] = stripMarks(result.text).match(/^<untrusted_http_response status="200" url="https:\/\/api\.example\.com\/search\?…">\n([\s\S]*)\n<\/untrusted_http_response>$/) ?? [];
    expect(JSON.parse(inner!)).toEqual(['Platypus']);
    expect(result.isError).toBe(false);
    // Kept apart as a value too, for the page widget (never sent to the model).
    expect(result.data).toEqual(['Platypus']);
  });

  it('follows no redirect: its headers never go to where it leads', async () => {
    const fetch = mockFetch(redirecting);
    const [get] = runtimeCustomTools([search], []);
    await expect(get!.run({ query: 'x' }, ctx)).rejects.toThrow('api.example.com answered with a redirect, which is not followed');
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'manual' }));
  });

  it('asks for the site when it has no access, and says an error status is one', async () => {
    const [other] = runtimeCustomTools([{ ...search, http: { method: 'GET', url: 'https://other.example.org/x' } }], []);
    await expect(other!.run({ query: 'x' }, ctx)).rejects.toBeInstanceOf(AccessRequiredError);
    mockFetch(new Response('nope', { status: 404 }));
    const [get] = runtimeCustomTools([search], []);
    expect(((await get!.run({ query: 'x' }, ctx)) as { isError?: boolean }).isError).toBe(true);
  });

  it('sends the browser session only when the user ticked it, and says when there is none', async () => {
    const fetch = mockFetch(new Response('[]', { status: 200 }));
    const [plain, signed] = runtimeCustomTools([search, { ...search, id: 'm', name: 'api.mine', http: { ...search.http!, session: true } }], []);
    await plain!.run({ query: 'x' }, ctx);
    expect(fetch).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ credentials: 'omit' }));
    await signed!.run({ query: 'x' }, ctx);
    expect(fetch).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ credentials: 'include' }));
    expect((await signed!.describe!({ query: 'x' }, ctx)).details).toEqual([{ label: 'Signed in as you', value: 'Sends your browser session for api.example.com' }]);
    mockFetch(new Response('', { status: 401 }));
    expect(await signed!.run({ query: 'x' }, ctx)).toEqual({
      type: 'text',
      text: 'Not signed in to api.example.com: the user must open it in the browser and sign in, then try again.',
      isError: true,
    });
  });

  it('puts a cookie of the API\'s site in a header (a CSRF token), only with the session', async () => {
    const fetch = mockFetch(new Response('{}', { status: 200 }));
    const csrf: CustomTool = { ...add, id: 'c', name: 'api.create', http: { ...add.http!, session: true, headers: [{ name: 'X-CSRF-Token', value: '{{cookie:MMCSRF}}' }, { name: 'X-Both', value: 'a={{cookie:MMCSRF}};b={{ cookie:other }}' }] } };
    const [tool] = runtimeCustomTools([csrf], []);
    cookies.MMCSRF = 'tok';
    cookies.other = 'o';
    await tool!.run({ name: 'x', stars: 1 }, ctx);
    expect(fetch).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ headers: expect.objectContaining({ 'X-CSRF-Token': 'tok', 'X-Both': 'a=tok;b=o' }) }));
    // Not there: not sent, and said.
    delete cookies.MMCSRF;
    fetch.mockClear();
    expect(await tool!.run({ name: 'x', stars: 1 }, ctx)).toEqual({ type: 'text', text: 'No MMCSRF cookie for api.example.com: the user must open it in the browser and sign in, then try again.', isError: true });
    expect(fetch).not.toHaveBeenCalled();
    // The card never shows it.
    expect(JSON.stringify(await tool!.describe!({ name: 'x', stars: 1 }, ctx))).not.toContain('MMCSRF');
    // Loaded before it had the permission: said, not a crash.
    const { browser } = await import('wxt/browser');
    const api = browser.cookies;
    Object.assign(browser, { cookies: undefined });
    expect(await tool!.run({ name: 'x', stars: 1 }, ctx)).toMatchObject({ isError: true, text: expect.stringContaining('cannot read cookies yet: reload it') });
    Object.assign(browser, { cookies: api });
    expect(customProblems({ ...csrf, http: { ...csrf.http!, session: undefined } }, [], [])).toContain('A header takes a cookie ({{cookie:…}}): it needs the browser session ("Send the browser\'s session for this site", or "session": true).');
  });

  it('needs a host no value can change', () => {
    for (const url of ['https://api.example.com', 'https://api.example.com/v1/{path}', 'https://api.example.com?q={q}', 'http://api.example.com:8080/#x'])
      expect(hasFixedHost(url), url).toBe(true);
    for (const url of ['https://api.example.com{sub}/v1', 'https://{host}/v1', 'https://api.example.com:{port}/', 'https://api.example.com.{tld}', 'ftp://api.example.com/'])
      expect(hasFixedHost(url), url).toBe(false);
  });

  it('never sends to another site than its own, even a tool saved before the host was checked', async () => {
    const fetch = mockFetch(new Response('[]', { status: 200 }));
    const [old] = runtimeCustomTools([{ ...search, http: { method: 'GET', url: 'https://api.example.com{sub}/search' } }], []);
    await expect(old!.run({ query: 'x' }, ctx)).rejects.toThrow('not sent');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('names what keeps it from being saved', () => {
    expect(customProblems(search, [], [])).toEqual([]);
    expect(customProblems({ ...search, http: undefined }, [], [])).toEqual(['Write the request: its method and URL.']);
    expect(customProblems({ ...add, http: { ...add.http!, body: '{"name": "{name}"}' } }, [], [])).toEqual([
      'In the body a parameter goes as {name}, without quotes: it is written as a JSON value (a text with its quotes).',
    ]);
    const bad: CustomTool = { ...add, http: { method: 'POST', url: '{host}/items?k={key}', body: '{"name": {name} {stars}}', headers: [{ name: '', value: 'x' }] } };
    expect(customProblems(bad, [], [])).toEqual([
      'The URL starts with http:// or https:// and a fixed host, e.g. https://api.example.com/search?q={query}.',
      'The URL uses {host}, {key}, not a parameter of this tool.',
      'The body is not JSON (a parameter goes as {name}, without quotes: it is written as a JSON value).',
      'A header has a value but no name.',
    ]);
  });
});

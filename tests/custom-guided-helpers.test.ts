import { describe, expect, it } from 'vitest';
import { extractPath } from '../src/tools/http';
import { fillSecrets } from '../src/tools/secrets';
import { isCredentialName, isCredentialValue } from '../src/tools/custom/credentials';
import { shellWords } from '../src/tools/custom/curl';
import { extractOf, pickOf, picksOf, pickState, pickText, togglePick } from '../src/tools/custom/extract-picks';
import { fixAgain, fixSecret, foundValues, keepAsSecret, letModelFill } from '../src/tools/custom/found-values';
import { scanJsonTemplate } from '../src/tools/custom/json-template';
import { parsePastedRequest } from '../src/tools/custom/pasted-request';
import { siteWord, suggestName } from '../src/tools/custom/suggest-name';
import type { CustomTool } from '../src/tools/custom/types';
import { customProblems } from '../src/tools/custom/validate';
import type { HttpRequest } from '../src/tools/http';

const parsed = (text: string) => {
  const r = parsePastedRequest(text);
  if ('problem' in r) throw new Error(r.problem);
  return r;
};
// What the model reads of a request: its URL and body (custom_tools gives them to it as they are).
const modelReads = (http: HttpRequest) => `${http.url}\n${http.body ?? ''}`;
const httpTool = (http: HttpRequest, inputs: CustomTool['inputs'] = []) =>
  ({ id: 'x', name: 'example.tool', description: 'd', base: 'http', params: {}, inputs, http, enabled: true }) as CustomTool;

describe('a pasted request', () => {
  it('reads a URL as a GET', () => {
    expect(parsed('https://api.example.com/search?q=cats&limit=10').http).toEqual({ method: 'GET', url: 'https://api.example.com/search?q=cats&limit=10' });
  });

  it('reads a curl command: method, headers, JSON body as it was written', () => {
    const { http } = parsed(`curl -X POST 'https://chat.example.com/api/v4/posts' \\
      -H 'Content-Type: application/json' -H "X-Requested-With: XMLHttpRequest" \\
      --data-raw '{"channel_id":"abc","message":"hi","n":12345678901234567890}' --compressed`);
    expect(http.method).toBe('POST');
    expect(http.url).toBe('https://chat.example.com/api/v4/posts');
    expect(http.headers).toEqual([{ name: 'Content-Type', value: 'application/json' }, { name: 'X-Requested-With', value: 'XMLHttpRequest' }]);
    expect(http.body).toBe('{"channel_id":"abc","message":"hi","n":12345678901234567890}');
  });

  it('takes the URL wherever it is, past options it does not know, and joined or = values', () => {
    expect(parsed('curl --unknown-flag value https://api.example.com/a').http.url).toBe('https://api.example.com/a');
    const { http } = parsed(`curl -XPOST --header='X-A: 1' -HX-B:2 https://api.example.com/a -d a=1 -d b=2`);
    expect(http.method).toBe('POST');
    expect(http.headers?.slice(0, 2)).toEqual([{ name: 'X-A', value: '1' }, { name: 'X-B', value: '2' }]);
    expect(http.body).toBe('a=1&b=2');
  });

  it('puts -G data in the query', () => {
    expect(parsed(`curl -G https://api.example.com/search -d q=cats`).http).toEqual({ method: 'GET', url: 'https://api.example.com/search?q=cats' });
  });

  it("reads Chrome's $'…' strings, curl.exe and a prompt", () => {
    expect(parsed(`$ curl.exe 'https://api.example.com/a' --data-raw $'{"t":"it\\'s\\n"}'`).http.body).toBe('{"t":"it\'s\n"}');
    expect(shellWords(`curl "a \\"b\\"" 'c d' e\\ f`)).toEqual(['curl', 'a "b"', 'c d', 'e f']);
    // A backslash and newline inside '…' are kept as they are.
    expect(shellWords("curl 'a\\\nb'")).toEqual(['curl', 'a\\\nb']);
    expect(shellWords('curl a \\\n b')).toEqual(['curl', 'a', 'b']);
  });

  it('keeps every credential out of what the model reads', () => {
    const keys = ['appid', 'private_token', 'access_key', 'subscription-key', 'x-api-key', 'refresh_token', 'id_token', 'X-Amz-Signature', 'jwt', 'sid', 'pwd', 'code'];
    const url = `https://api.example.com/a?q=x&${keys.map((k, i) => `${k}=SECRET${i}`).join('&')}&t=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln`;
    const body = JSON.stringify({ auth: { password: 'SECRETP', pin: 1234 }, list: [{ token: 'SECRETL' }], note: 'sk-live-0123456789abcdef', n: 5 });
    const { http } = parsed(`curl '${url}' -H 'Authorization: Bearer SECRETH' --json '${body}'`);
    expect(modelReads(http)).not.toMatch(/SECRET|eyJ|sk-live/);
    expect(modelReads(http)).toContain('q=x');
    expect(http.body).toContain('"n":5');
    expect(Object.keys(http.secrets ?? {}).length).toBe(keys.length + 1 + 3);
  });

  it('keeps a form body\'s keys out too', () => {
    const { http, notes } = parsed(`curl https://api.example.com/a -d 'api_key=SECRET1&q=x'`);
    expect(http.body).toBe('api_key={{secret:api_key}}&q=x');
    expect(http.headers).toContainEqual({ name: 'Content-Type', value: 'application/x-www-form-urlencoded' });
    expect(notes.join(' ')).toContain('not JSON');
  });

  it('makes user:password@ an Authorization header, and never a name', () => {
    const { http, notes } = parsed('https://me:pw@api.example.com/a');
    expect(http.url).toBe('https://api.example.com/a');
    expect(http.headers).toEqual([{ name: 'Authorization', value: `Basic ${btoa('me:pw')}` }]);
    expect(notes.join(' ')).toContain('Authorization header');
    expect(siteWord('https://me:pw@api.example.com/a')).toBe('example');
  });

  it('encodes -u as UTF-8, and never throws', () => {
    const { http } = parsed('curl -u josé:ñ https://api.example.com/a');
    expect(atob(http.headers![0]!.value.slice(6))).toBe(String.fromCharCode(...new TextEncoder().encode('josé:ñ')));
  });

  it('leaves cookies out, saying so, without turning the session on', () => {
    const { http, notes } = parsed(`curl https://api.example.com/a -H 'Cookie: sid=SECRET3' -b 'x=1'`);
    expect(JSON.stringify(http)).not.toContain('SECRET3');
    expect(http.session).toBeUndefined();
    expect(notes.join(' ')).toContain("Send the browser's session");
  });

  it('sends a saved value back exactly as it came: encoded in the URL, escaped in JSON', () => {
    const { http } = parsed(`curl 'https://api.example.com/a?sig=ab%2Bc%3D' --json '{"password":"p\\"w\\\\x"}'`);
    expect(fillSecrets(http.url, http.secrets)).toBe('https://api.example.com/a?sig=ab%2Bc%3D');
    expect(JSON.parse(fillSecrets(http.body!, http.secrets))).toEqual({ password: 'p"w\\x' });
    expect(customProblems(httpTool(http), [], [])).toEqual([]);
  });

  it('says why it cannot read one', () => {
    for (const bad of ['', 'wget https://example.com', 'curl -X GET', "curl 'https://example.com", 'curl -X TRACE https://example.com']) {
      expect(parsePastedRequest(bad)).toHaveProperty('problem');
    }
  });
});

describe('what looks like a credential', () => {
  it('by its name, not a word that only contains one', () => {
    expect(['api_key', 'accessToken', 'X-Amz-Signature', 'client_secret', 'code'].every(isCredentialName)).toBe(true);
    expect(['keyword', 'author', 'country_code', 'q', 'limit'].some(isCredentialName)).toBe(false);
  });
  it('by its value', () => {
    expect(['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.x', 'sk-0123456789abcdef', 'ghp_0123456789abcdefABCDEF', 'aZ3kQ9vX2mP7wL5tR8nB4cY6'].every(isCredentialValue)).toBe(true);
    expect(['cats', '123456789012345678901234', '11111111-2222-4333-8444-555555555555', 'hello world this is long'].some(isCredentialValue)).toBe(false);
  });
});

describe('a JSON body template', () => {
  it('finds each value where it is written, templates included', () => {
    const spots = scanJsonTemplate('{ "a": {q}, "b": [1, "x"], "c": {"d": {{secret:k}} } }')!;
    expect(spots.map((s) => [s.path.join('.'), s.kind, s.raw])).toEqual([
      ['a', 'input', '{q}'], ['b.0', 'number', '1'], ['b.1', 'string', '"x"'], ['c.d', 'secret', '{{secret:k}}'],
    ]);
    expect(scanJsonTemplate('{"a": }')).toBeUndefined();
  });
});

describe('the values found in a request', () => {
  const http: HttpRequest = { method: 'POST', url: 'https://api.example.com/v1/items/12345/notes?lang=en&tag=a&tag=b&q={query}#x#y', body: '{"text": "hello", "pinned": true, "to": {who}, "big": 12345678901234567890}' };

  it('finds path ids, query values (repeated ones apart) and body values, not placeholders', () => {
    const found = foundValues(http);
    // The other parts of the path are listed apart (minor).
    expect(found.filter((f) => f.minor).map((f) => f.value)).toEqual(['v1', 'items', 'notes']);
    expect(found.filter((f) => !f.minor).map((f) => [f.where, f.name, f.value, f.type])).toEqual([
      ['path', 'item_id', '12345', 'string'],
      ['query', 'lang', 'en', 'string'],
      ['query', 'tag', 'a', 'string'],
      ['query', 'tag_2', 'b', 'string'],
      ['body', 'text', 'hello', 'string'],
      ['body', 'pinned', 'true', 'boolean'],
      ['body', 'big', '12345678901234567890', 'number'],
    ]);
    expect(new Set(found.map((f) => f.id)).size).toBe(found.length);
  });

  it('names an id after a word, or "id"', () => {
    const id = (url: string) => foundValues({ method: 'GET', url }).find((f) => !f.minor)!.name;
    expect(id('https://api.example.com/123')).toBe('id');
    expect(id('https://api.example.com/_/123')).toBe('id');
  });

  it('makes each one an input and back, the rest written as it was', () => {
    for (const f of foundValues(http)) {
      const { http: filled, was } = letModelFill(http, f, 'v');
      expect(modelReads(filled)).toContain('{v}');
      expect(filled.url.endsWith('#x#y')).toBe(true);
      expect(filled.body).toContain('{who}');
      if (f.name !== 'big') expect(filled.body).toContain('12345678901234567890');
      expect(fixAgain(filled, 'v', was!)).toEqual(http);
    }
  });

  it('puts a value back in the URL and the body alike', () => {
    const f = foundValues(http).find((x) => x.name === 'lang')!;
    const { http: filled, was } = letModelFill(http, f, 'lang');
    const both = { ...filled, body: filled.body!.replace('"hello"', '{lang}') };
    const back = fixAgain(both, 'lang', was!);
    expect(back.url).toContain('lang=en');
    expect(back.body).toContain('"text": "en"');
  });

  it('makes one a saved value and back', () => {
    const f = foundValues(http).find((x) => x.name === 'text')!;
    const secret = keepAsSecret(http, f, 'text');
    expect(secret.body).toContain('"text": "{{secret:text}}"');
    expect(secret.secrets).toEqual({ text: 'hello' });
    const again = foundValues(secret).find((x) => x.secret === 'text')!;
    expect(fixSecret(secret, again)).toEqual({ ...http, secrets: undefined });
    // A number saved alone, without quotes, and still JSON for the checks.
    const big = keepAsSecret(http, foundValues(http).find((x) => x.name === 'big')!, 'big');
    expect(big.body).toContain('"big": {{secret:big}}');
    expect(customProblems(httpTool(big, [{ name: 'who', type: 'string', description: 'd' }, { name: 'query', type: 'string', description: 'd' }]), [], [])).toEqual([]);
  });

  it('reads a GET body as none, and numbers in the query as numbers', () => {
    expect(foundValues({ method: 'GET', url: 'https://api.example.com/a?limit=10', body: '{"x":1}' }).filter((f) => !f.minor).map((f) => [f.name, f.type])).toEqual([['limit', 'number']]);
  });

  it('marks a fixed value that looks like a key', () => {
    expect(foundValues({ method: 'GET', url: 'https://api.example.com/a?token=abc' }).find((f) => f.where === 'query')!.suspect).toBe(true);
  });
});

describe('answer cut to, by clicking keys', () => {
  const answer = { items: [{ title: 'a', url: 'u', author: { name: 'n', id: 1 } }], total: 1 };

  it('makes a pick of a clicked key, a list position standing for each element', () => {
    expect(pickText(pickOf(['items', 0, 'title'])!)).toBe('items[].title');
    expect(pickText(pickOf([0, 'name'])!)).toBe('[].name');
    expect(pickText(pickOf(['rows', 0, 2])!)).toBe('rows[].[]');
  });

  it('refuses keys it could not read back', () => {
    for (const key of ['a.b', 'a,b', '{a}', 'a[0]', '42', ' a']) expect(pickOf([key])).toBeUndefined();
  });

  it('joins picks into one path the runtime reads', () => {
    let state = togglePick('', pickOf(['items', 0, 'title'])!);
    state = togglePick(state.extract, pickOf(['items', 0, 'url'])!);
    expect(state).toEqual({ extract: 'items[].{title,url}', approximate: false });
    expect(extractPath(answer, state.extract)).toEqual([{ title: 'a', url: 'u' }]);
    expect(togglePick(state.extract, pickOf(['items', 0, 'url'])!).extract).toBe('items[].title');
  });

  it('keeps a whole key when a pick goes deeper than the others', () => {
    expect(extractOf([pickOf(['items', 0, 'title'])!, pickOf(['items', 0, 'author', 'name'])!])).toEqual({ extract: 'items[].{title,author}', approximate: true });
  });

  it('drops a pick inside another', () => {
    expect(extractOf([pickOf(['items'])!, pickOf(['items', 0, 'title'])!]).extract).toBe('items');
  });

  it('reads an extract back into picks, and says how a key stands', () => {
    const picks = picksOf('items[].{title,url}')!;
    expect(picks.map(pickText)).toEqual(['items[].title', 'items[].url']);
    expect(pickState(pickOf(['items', 0, 'title'])!, picks)).toBe('picked');
    expect(pickState(pickOf(['items', 0, 'author'])!, picks)).toBeUndefined();
    expect(pickState(pickOf(['items', 0, 'author', 'name'])!, picksOf('items[].author')!)).toBe('inside');
    expect(picksOf('data.0.name')).toBeUndefined();
    expect(picksOf('')).toEqual([]);
  });
});

describe('a suggested name', () => {
  const tool = (c: Partial<CustomTool>) => ({ id: 'x', name: '', description: '', base: '', params: {}, enabled: true, ...c }) as CustomTool;

  it('names the site', () => {
    expect(siteWord('https://api.example.com/x')).toBe('example');
    expect(siteWord('https://forum.example.co.uk/x')).toBe('forum');
    expect(siteWord('https://{x}.example.com')).toBeUndefined();
  });

  it('names a request by its site and what it does', () => {
    const http = (method: 'GET' | 'POST' | 'DELETE', url: string) => tool({ base: 'http', http: { method, url } });
    expect(suggestName(http('GET', 'https://api.example.com/search?q={query}'), [])).toBe('example.search');
    expect(suggestName(http('GET', 'https://api.example.com/v2/items/{id}'), [])).toBe('example.get_item');
    expect(suggestName(http('GET', 'https://api.example.com/v2/items'), [])).toBe('example.list_items');
    expect(suggestName(http('POST', 'https://chat.example.com/api/messages'), [])).toBe('chat.post_message');
    expect(suggestName(http('POST', 'https://api.example.com/items'), [])).toBe('example.create_item');
    expect(suggestName(http('DELETE', 'https://api.example.com/items/{id}'), [])).toBe('example.delete_item');
    expect(suggestName(http('GET', 'https://api.example.com/search?q=x'), ['example.search'])).toBe('example.search_2');
    expect(suggestName(http('GET', ''), [])).toBeUndefined();
  });

  it('names a preset tool by the site in its texts, and a script by its site', () => {
    expect(suggestName(tool({ base: 'web.search', params: { query: { mode: 'model', template: '{value} site:forum.example.com' } } }), [])).toBe('forum.search');
    expect(suggestName(tool({ base: 'web.search' }), [])).toBe('my.search');
    expect(suggestName(tool({ base: 'script', http: { method: 'GET', url: 'https://app.example.com' } }), [])).toBe('example.run');
  });
});

describe('keys the second review found', () => {
  it('takes a key out of the path, and lists every part of it', () => {
    const { http } = parsed('https://api.example.com/bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11/sendMessage?chat_id=1');
    expect(http.url).toBe('https://api.example.com/{{secret:token}}/sendMessage?chat_id=1');
    expect(fillSecrets(http.url, http.secrets)).toBe('https://api.example.com/bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11/sendMessage?chat_id=1');
    const hook = foundValues({ method: 'POST', url: 'https://hooks.example.com/services/T0001/B0002/aZ3kQ9vX2mP7wL5tR8nB4cY6' });
    expect(hook.map((f) => [f.value, f.suspect, !!f.minor])).toEqual([
      ['services', false, true], ['T0001', false, true], ['B0002', false, true], ['aZ3kQ9vX2mP7wL5tR8nB4cY6', true, false],
    ]);
    // Any part made a saved value by hand.
    const part = hook.find((f) => f.value === 'T0001')!;
    expect(keepAsSecret({ method: 'POST', url: 'https://hooks.example.com/services/T0001/x' }, { ...part, at: 2 }, 'team').url).toBe('https://hooks.example.com/services/{{secret:team}}/x');
  });

  it('reads names written together', () => {
    expect(['accesstoken', 'authkey', 'apitoken', 'secretkey', 'hapikey', 'adminpassword'].every(isCredentialName)).toBe(true);
    expect(['keyword', 'author', 'keywords', 'q'].some(isCredentialName)).toBe(false);
    const { http } = parsed('https://api.example.com/a?accesstoken=AbC123xyZ987LmN456&hapikey=QwE456rtY123UiO789');
    expect(http.url).toBe('https://api.example.com/a?accesstoken={{secret:accesstoken}}&hapikey={{secret:hapikey}}');
  });

  it('keeps a + and an @ in user:password@', () => {
    expect(parsed('https://user:a+b@api.example.com/x').http.headers?.[0]?.value).toBe(`Basic ${btoa('user:a+b')}`);
    const { http } = parsed('https://user:p@ss@api.example.com/x');
    expect(http.url).toBe('https://api.example.com/x');
    expect(http.headers?.[0]?.value).toBe(`Basic ${btoa('user:p@ss')}`);
    expect(siteWord('https://user:p@ss@api.example.com/x')).toBe('example');
  });

  it('leaves the fragment out', () => {
    const { http, notes } = parsed('https://api.example.com/cb#access_token=SECRET');
    expect(http.url).toBe('https://api.example.com/cb');
    expect(notes.join(' ')).toContain('after # was left out');
  });
});

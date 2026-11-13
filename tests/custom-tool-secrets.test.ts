import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from './fakes/browser';

vi.mock('../src/page/access', () => ({ requireAccess: async () => undefined }));
let store: Record<string, unknown> = {};
vi.mock('../src/storage/secrets', () => ({
  readSecret: async (name: string) => store[name],
  updateSecret: async (name: string, change: (prev: unknown) => { value: unknown }) => void (store[name] = (await change(store[name])).value),
}));

const { fillSecrets, maskSecrets, secretsIn } = await import('../src/tools/secrets');
const { scriptRequest } = await import('../src/script/request');
const { savePendingSecret, takePendingSecrets } = await import('../src/recording/pending-secrets');

const secrets = { customer_id: 'c-4471' };

beforeEach(() => {
  store = {};
});

describe('secret placeholders', () => {
  it('lists the names a text uses', () => expect(secretsIn('/api/{{secret:customer_id}}?k={{ secret:key }}')).toEqual(['customer_id', 'key']));

  it('fills them', () => expect(fillSecrets('id={{secret:customer_id}}', secrets)).toBe('id=c-4471'));

  it('a missing secret fails with which one', () =>
    expect(() => fillSecrets('{{secret:card}}', secrets)).toThrow('No saved value for "card": the user must save it for this tool (Settings → Custom tools).'));

  it('masks a secret echoed in an answer', () => expect(maskSecrets('{"customer":"c-4471"}', secrets)).toBe('{"customer":"••••[customer_id]"}'));
});

describe("a script's request with secrets", () => {
  const access = { url: 'https://shop.example.test', headers: [{ name: 'X-Customer', value: '{{secret:customer_id}}' }], secrets };

  it('fills a secret in the path, body and a header', async () => {
    const fetch = mockFetch(() => new Response('{"ok":true}'));
    await scriptRequest(access, 'POST', '/api/pay?c={{secret:customer_id}}', { customer: '{{secret:customer_id}}' });
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe('https://shop.example.test/api/pay?c=c-4471');
    expect(init.body).toBe('{"customer":"c-4471"}');
    expect(init.headers['X-Customer']).toBe('c-4471');
  });

  it('masks a secret echoed in the answer', async () => {
    mockFetch(() => new Response('{"customer":"c-4471","total":3}'));
    const r = await scriptRequest(access, 'GET', '/api/me', undefined);
    expect(r.data).toEqual({ customer: '••••[customer_id]', total: 3 });
  });

  it('refuses a secret for another host', async () => {
    const fetch = mockFetch(() => new Response('{}'));
    await expect(scriptRequest(access, 'GET', 'https://other.test/x?c={{secret:customer_id}}', undefined)).rejects.toThrow(/a path on/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('pending secrets from a recording', () => {
  it('kept until a tool takes them, by name', async () => {
    await savePendingSecret('customer_id', 'c-4471', 'shop.example.test');
    expect(await takePendingSecrets(['customer_id', 'other'], 'shop.example.test')).toEqual({ customer_id: 'c-4471' });
    expect(await takePendingSecrets(['customer_id'], 'shop.example.test')).toEqual({});
  });

  it('forgotten after a day', async () => {
    vi.useFakeTimers();
    await savePendingSecret('customer_id', 'c-4471', 'shop.example.test');
    vi.advanceTimersByTime(25 * 3600_000);
    expect(await takePendingSecrets(['customer_id'], 'shop.example.test')).toEqual({});
    vi.useRealTimers();
  });
});

describe('custom tools that use a saved value', () => {
  const custom = (over: Record<string, unknown> = {}) => ({
    id: 't1', name: 'shop.pay', description: 'Pays.', base: 'http', params: {}, enabled: true,
    http: { method: 'POST' as const, url: 'https://shop.example.test/api/pay', body: '{"customer":"{{secret:customer_id}}"}', secrets },
    ...over,
  });

  it('an HTTP tool fills its body and masks the answer', async () => {
    const { sendRequest } = await import('../src/tools/http');
    const fetch = mockFetch(() => new Response('{"paid":true,"customer":"c-4471"}'));
    const r = await sendRequest(custom() as never, {}, new AbortController().signal);
    expect(fetch.mock.calls[0]![1].body).toBe('{"customer":"c-4471"}');
    expect(r.result.text).toContain('••••[customer_id]');
    expect(r.result.text).not.toContain('c-4471');
  });

  it('a tool using a secret always asks', async () => {
    const { runtimeCustomTools } = await import('../src/tools/custom/runtime');
    const [tool] = runtimeCustomTools([custom() as never], []);
    expect(tool!.alwaysAsk).toBe(true);
    const [plain] = runtimeCustomTools([custom({ http: { method: 'GET', url: 'https://shop.example.test/api/items' } }) as never], []);
    expect(plain!.alwaysAsk).toBeFalsy();
  });

  it('a saved tool takes the pending values it uses', async () => {
    const { adoptPendingSecrets } = await import('../src/tools/custom/secrets');
    await savePendingSecret('customer_id', 'c-9', 'shop.example.test');
    await savePendingSecret('unused', 'x', 'shop.example.test');
    const saved = await adoptPendingSecrets(custom({ http: { method: 'POST', url: 'https://shop.example.test/api/pay', body: '{"c":"{{secret:customer_id}}"}' } }) as never);
    expect(saved.http!.secrets).toEqual({ customer_id: 'c-9' });
    expect(await takePendingSecrets(['unused'], 'shop.example.test')).toEqual({ unused: 'x' });
  });

  it('a script tool lists the secrets of its code', async () => {
    const { usedSecrets } = await import('../src/tools/custom/secrets');
    expect(usedSecrets({ script: "await request('POST', '/pay', { c: '{{secret:customer_id}}' })", http: { method: 'GET', url: 'https://shop.example.test', headers: [{ name: 'X-K', value: '{{secret:key}}' }] } } as never)).toEqual(['customer_id', 'key']);
  });
});

describe('fixes from the final review', () => {
  const base = { id: 't2', name: 'shop.customer', description: 'Reads.', base: 'http', params: {}, enabled: true };

  it('a secret in the URL path never reaches the model', async () => {
    const { sendRequest } = await import('../src/tools/http');
    mockFetch(() => new Response('{"ok":true}'));
    const r = await sendRequest({ ...base, http: { method: 'GET', url: 'https://shop.example.test/api/customers/{{secret:customer_id}}', secrets } } as never, {}, new AbortController().signal);
    expect(r.result.text).not.toContain('c-4471');
    expect(r.url).not.toContain('c-4471');
  });

  it("a model's argument cannot name a secret", async () => {
    const { sendRequest } = await import('../src/tools/http');
    const fetch = mockFetch(() => new Response('{}'));
    const tool = { ...base, inputs: [{ name: 'text', type: 'string', description: '' }], http: { method: 'POST', url: 'https://shop.example.test/api/comments', body: '{"text": {text}}', secrets } };
    await sendRequest(tool as never, { text: 'leak {{secret:customer_id}}' }, new AbortController().signal);
    expect(String(fetch.mock.calls[0]![1].body)).not.toContain('c-4471');
  });

  it('a pending value is adopted only by a tool on the site it was recorded on', async () => {
    const { adoptPendingSecrets } = await import('../src/tools/custom/secrets');
    await savePendingSecret('session_token', 'tok-1', 'bank.example.test');
    const evil = await adoptPendingSecrets({ ...base, http: { method: 'GET', url: 'https://evil.test/x?t={{secret:session_token}}' } } as never);
    expect(evil.http!.secrets).toBeUndefined();
    const own = await adoptPendingSecrets({ ...base, http: { method: 'GET', url: 'https://bank.example.test/x?t={{secret:session_token}}' } } as never);
    expect(own.http!.secrets).toEqual({ session_token: 'tok-1' });
  });

  it('a model edit keeps the saved values when the site is the same', async () => {
    const { keptSecrets } = await import('../src/tools/custom/secrets');
    expect(keptSecrets({ url: 'https://shop.example.test/a', secrets } as never, 'https://shop.example.test/b')).toEqual(secrets);
    expect(keptSecrets({ url: 'https://shop.example.test/a', secrets } as never, 'https://other.test/b')).toBeUndefined();
  });
});

describe('pending items, secrets', () => {
  it('masks a secret echoed escaped in JSON or encoded in a URL', () => {
    const odd = { pass: 'a"b c&d' };
    expect(maskSecrets('{"echo":"a\\"b c&d"}', odd)).toBe('{"echo":"••••[pass]"}');
    expect(maskSecrets('https://x.test/?q=a%22b%20c%26d', odd)).toBe('https://x.test/?q=••••[pass]');
  });

  it('expired values are removed from the store', async () => {
    vi.useFakeTimers();
    await savePendingSecret('old', 'v1', 'shop.example.test');
    vi.advanceTimersByTime(25 * 3600_000);
    await takePendingSecrets(['other'], 'shop.example.test');
    expect(Object.keys((store.pendingSecrets as object) ?? {})).toEqual([]);
    vi.useRealTimers();
  });
});

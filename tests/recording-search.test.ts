import { describe, expect, it } from 'vitest';
import type { RecordedCall } from '../src/recording/recording';
import { matchesSearch, parseSearch } from '../src/recording/search';

const call = (id: string, change: Partial<RecordedCall> = {}): RecordedCall => ({ id, method: 'GET', url: `https://shop.example.com/api/${id}`, at: 0, included: true, status: 200, ...change });
const calls = [
  call('orders', { method: 'POST', responseType: 'application/json', responseBody: 'x'.repeat(2000) }),
  call('items', { responseType: 'text/html', responseBody: 'short' }),
  call('missing', { status: 404 }),
  call('cdn', { url: 'https://cdn.example.net/lib.js' }),
];
const found = (q: string) => calls.filter((c) => matchesSearch(c, parseSearch(q))).map((c) => c.id);

describe("the review's search, as DevTools' Network panel reads it", () => {
  it('nothing typed: every call', () => expect(found('')).toEqual(['orders', 'items', 'missing', 'cdn']));
  it('a plain word, in the method, address or status', () => {
    expect(found('orders')).toEqual(['orders']);
    expect(found('404')).toEqual(['missing']);
    expect(found('post')).toEqual(['orders']);
  });
  it('method:', () => expect(found('method:post')).toEqual(['orders']));
  it('status-code:', () => expect(found('status-code:404')).toEqual(['missing']));
  it('domain:, with a glob, and negated', () => {
    expect(found('domain:cdn.example.net')).toEqual(['cdn']);
    expect(found('-domain:*.example.net')).toEqual(['orders', 'items', 'missing']);
  });
  it('mime-type:', () => expect(found('mime-type:application/json')).toEqual(['orders']));
  it('larger-than:, in bytes or k', () => {
    expect(found('larger-than:1k')).toEqual(['orders']);
    expect(found('larger-than:100')).toEqual(['orders']);
  });
  it('terms together, a plain word negated', () => {
    expect(found('api -method:GET')).toEqual(['orders']);
    expect(found('-orders -cdn')).toEqual(['items', 'missing']);
  });
  it('an unknown key is a plain word', () => expect(found('foo:bar')).toEqual([]));
  it('a key still being typed, or with a value it cannot read, filters nothing yet', () => {
    const every = ['orders', 'items', 'missing', 'cdn'];
    for (const q of ['domain:', '-domain:', 'method:', 'status-code:', 'mime-type:', 'larger-than:', 'larger-than:1.', 'larger-than:10x', 'status-code:4x', '-']) expect(found(q), q).toEqual(every);
    expect(found('orders larger-than:')).toEqual(['orders']);
  });
  it('larger-than: a number as it is typed already filters', () => {
    expect(found('larger-than:1')).toEqual(['orders', 'items']);
    expect(found('larger-than:1.5k')).toEqual(['orders']);
    expect(found('larger-than:1m')).toEqual([]);
  });
});

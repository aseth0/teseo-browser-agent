import { describe, expect, it } from 'vitest';
import type { RecordedCall, Recording } from '../src/recording/recording';
import { defaultName, hideNamed, initialTicks, valuesOf } from '../src/recording/review';

const call = (over: Partial<RecordedCall>): RecordedCall => ({ id: '1', method: 'POST', url: 'https://shop.example.test/api', at: 0, included: true, ...over });
const rec = (calls: RecordedCall[]): Recording => ({ tabId: 1, site: 'shop.example.test', startedAt: 0, hidden: [], calls });

describe('the review', () => {
  it('⚠ calls start unticked', () => {
    const r = initialTicks(rec([call({ id: 'a', requestBody: '{"card":{"number":"4111111111111111"}}' }), call({ id: 'b', requestBody: '{"q":"lamp"}' }), call({ id: 'c', headerNames: ['Authorization'] })]));
    expect(r.calls.map((c) => [c.id, c.included])).toEqual([['a', false], ['b', true], ['c', true]]);
  });

  it('valuesOf lists sent, answer and query leaves', () => {
    const values = valuesOf(call({ url: 'https://shop.example.test/api?page=2', requestBody: '{"cart":{"id":"c-4471"}}', responseBody: '{"order":"A-1"}' }));
    expect(values).toEqual([
      { where: 'query', key: 'page', value: '2' },
      { where: 'sent', key: 'cart.id', value: 'c-4471' },
      { where: 'answer', key: 'order', value: 'A-1' },
    ]);
  });

  it('hideNamed hides everywhere and names it', () => {
    const r = hideNamed(rec([call({})]), 'c-4471', 'customer_id');
    expect(r.hidden).toEqual(['c-4471']);
    expect(r.hiddenNames).toEqual({ 'c-4471': 'customer_id' });
  });

  it('defaultName of card.number is card_number', () => {
    expect(defaultName('card.number')).toBe('card_number');
    expect(defaultName('items[0].sessionToken')).toBe('session_token');
  });
});

describe('pending items, the review', () => {
  it('a password-like key is risky, a shipping one is not', async () => {
    const { riskyKey } = await import('../src/recording/review');
    expect(riskyKey('password')).toBe(true);
    expect(riskyKey('card.cvv')).toBe(true);
    expect(riskyKey('pin')).toBe(true);
    expect(riskyKey('shippingAddress')).toBe(false);
    expect(riskyKey('passenger')).toBe(false);
  });
});

describe('the domains a recording touched', () => {
  it('each with its number of calls, most first', async () => {
    const { domainsOf } = await import('../src/recording/review');
    const calls = [call({ url: 'https://shop.example.test/a' }), call({ url: 'https://api.example.test/b' }), call({ url: 'https://shop.example.test/c' }), call({ url: 'wss://live.example.test/s' })];
    expect(domainsOf(calls)).toEqual([{ host: 'shop.example.test', calls: 2 }, { host: 'api.example.test', calls: 1 }, { host: 'live.example.test', calls: 1 }]);
  });
});

describe("the review's summaries", () => {
  it('privacy: the ticked calls still sensitive, those left unticked, the values hidden', async () => {
    const { privacySummary } = await import('../src/recording/review');
    const email = '{"email":"ana@example.test"}';
    expect(privacySummary(rec([call({ requestBody: '{"q":"lamp"}' })]))).toEqual({ text: 'Nothing looks sensitive', warn: false });
    expect(privacySummary(rec([call({ requestBody: email }), call({ id: '2', requestBody: email, included: false })]))).toEqual({ text: '⚠ 1 ticked call looks sensitive · 1 sensitive call unticked', warn: true });
    expect(privacySummary({ ...rec([call({ requestBody: email })]), hidden: ['ana@example.test', 'c-4471'] })).toEqual({ text: '2 hidden', warn: false });
  });
  it('privacy: a header that signs in is a note, not a ⚠', async () => {
    const { privacySummary } = await import('../src/recording/review');
    expect(privacySummary(rec([call({ headerNames: ['Authorization'] })])).text).toBe('Nothing looks sensitive');
  });
  it('sizes in characters, short', async () => {
    const { shortChars } = await import('../src/recording/review');
    expect([shortChars(950), shortChars(6214), shortChars(30000), shortChars(1049)]).toEqual(['950', '6.2k', '30k', '1k']);
  });
});

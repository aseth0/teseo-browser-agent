import { describe, expect, it } from 'vitest';
import type { RecordedCall } from '../src/recording/recording';
import { gzipSync } from 'node:zlib';
import { unpackedText } from '../src/recording/bodies';
import { grouped, reasonOf, reasonsOf, resolved } from '../src/recording/sensitive';

const call = (over: Partial<RecordedCall>): RecordedCall => ({ id: '1', method: 'POST', url: 'https://shop.example.test/api', at: 0, included: true, ...over });
const kinds = (c: RecordedCall, headers?: string[]) => reasonsOf(c, headers).map((r) => `${r.kind} ${r.where}`);

describe('reasonsOf', () => {
  it('a secret-looking key', () => expect(kinds(call({ requestBody: '{"session_token":"abc123xyz"}' }))).toEqual(['secret-key sent: session_token']));

  it('a card number that passes the check, and one that does not', () => {
    expect(kinds(call({ requestBody: '{"card":{"number":"4111 1111 1111 1111"}}' }))).toEqual(['card sent: card.number']);
    expect(kinds(call({ requestBody: '{"card":{"number":"4111 1111 1111 1112"}}' }))).toEqual([]);
  });

  it('an email in the answer', () => expect(kinds(call({ responseBody: '{"user":{"mail":"ann@example.test"}}' }))).toEqual(['email answer: user.mail']));

  it('a phone in the query', () => expect(kinds(call({ method: 'GET', url: 'https://shop.example.test/api?tel=%2B34600111222' }))).toEqual(['phone query: tel']));

  it('a JWT and a long hex token', () => {
    expect(kinds(call({ responseBody: '{"t":"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlLXBhcnQ"}' }))).toEqual(['token answer: t']);
    expect(kinds(call({ responseBody: `{"t":"${'a1'.repeat(16)}"}` }))).toEqual(['token answer: t']);
  });

  it('header names as notes', () => expect(kinds(call({}), ['Authorization', 'Cookie', 'Accept'])).toEqual(['auth-header header: Authorization', 'cookie-header header: Cookie']));

  it('a value already •••• gives no reason', () => expect(kinds(call({ requestBody: '{"password":"••••"}' }))).toEqual([]));

  it('a form body', () => expect(kinds(call({ requestBody: 'email=ann%40example.test&q=lamp' }))).toEqual(['email sent: email']));
});

describe('resolved', () => {
  it('once every value is hidden', () => {
    const reasons = reasonsOf(call({ requestBody: '{"card":{"number":"4111111111111111"},"mail":"ann@example.test"}' }));
    expect(resolved(reasons, ['4111111111111111'])).toBe(false);
    expect(resolved(reasons, ['4111111111111111', 'ann@example.test'])).toBe(true);
  });

  it('header reasons never block', () => expect(resolved(reasonsOf(call({}), ['Authorization']), [])).toBe(true));
});

describe('phones, and what only looks like one', () => {
  it('a phone by its shape: a leading +, or digits in groups', () => {
    for (const v of ['+34 600 111 222', '+14155550123', '(415) 555-0123', '415-555-0123', '600 111 222', '06.12.34.56.78']) expect(reasonOf('contact', v), v).toBe('phone');
  });
  it('bare digits are a phone only under a phone-like key', () => {
    expect(reasonOf('mobile', '600111222')).toBe('phone');
    expect(reasonOf('user.phoneNumber', '34600111222')).toBe('phone');
    expect(reasonOf('tel', '0034600111223')).toBe('phone');
    for (const k of ['number', 'contact', 'gsm', 'sms', 'cellular', 'landline', 'contact.number', 'phones[0]', 'user.phones[1]', 'telephones[0]']) expect(reasonOf(k, '600111222'), k).toBe('phone');
    expect(reasonOf('orderNumber', '987654321012')).toBeUndefined(); // number only as the whole key
    expect(reasonOf('contactId', '987654321012')).toBeUndefined();
  });
  it('a list of phones: each item, by the list\'s key', () => {
    expect(kinds(call({ requestBody: '{"phones":["600111222","600111223"]}' }))).toEqual(['phone sent: phones[0]', 'phone sent: phones[1]']);
  });
  it('a dotted date or time is not a phone', () => {
    for (const v of ['2026.11.02.14.30', '2026.11.02.143000', '1999.12.31.23.59']) expect(reasonOf('at', v), v).toBeUndefined();
    expect(reasonOf('at', '06.12.34.56.78')).toBe('phone');
  });
  it('timestamps, numeric ids, decimals and versions are not phones, nor cards', () => {
    for (const [k, v] of [['mt', '1730294400'], ['mt', '1730294400123'], ['id', '123456789'], ['orderId', '987654321012'], ['ts', '1730294400.123'], ['os', '10.0.19045.3803'], ['n', '-1234567890'], ['hotel', '123456789']]) {
      expect(reasonOf(k!, v!), `${k}=${v}`).toBeUndefined();
    }
  });
  it('a 15-digit card starting with 1 is still a card', () => expect(reasonOf('n', '100000000000009')).toBe('card'));
  it('an IP address is an IP address, not a phone', () => {
    expect(reasonOf('ip', '203.0.113.45')).toBe('ip');
    expect(reasonOf('client.addr', '2001:db8::8a2e:370:7334')).toBe('ip');
    expect(reasonOf('v', '300.1.2.3')).toBeUndefined();
    expect(reasonOf('at', '12:30:00')).toBeUndefined();
  });
  it('an answer with IPs and timestamps', () => {
    const c = call({ responseBody: JSON.stringify({ rows: [{ ip: '203.0.113.45', mt: 1730294400123 }, { ip: '198.51.100.7', mt: 1730294400456 }] }) });
    expect(kinds(c)).toEqual(['ip answer: rows[0].ip', 'ip answer: rows[1].ip']);
  });
});

describe('grouped', () => {
  it('the same kind under the same key once, counted; every value still to hide', () => {
    const c = call({ responseBody: JSON.stringify({ rows: [1, 2, 3].map((i) => ({ ip: `203.0.113.${i}`, mail: `u${i}@example.test` })), ip: '198.51.100.7' }) });
    const reasons = reasonsOf(c);
    expect(grouped(reasons)).toEqual([
      { kind: 'ip', where: 'answer: rows[].ip', count: 3 },
      { kind: 'email', where: 'answer: rows[].mail', count: 3 },
      { kind: 'ip', where: 'answer: ip', count: 1 },
    ]);
    expect(resolved(reasons, ['u1@example.test', 'u2@example.test'])).toBe(false);
    expect(resolved(reasons, ['u1@example.test', 'u2@example.test', 'u3@example.test'])).toBe(true);
  });
  it('an IP address is a note: it never blocks, and has no value to hide', () => {
    const reasons = reasonsOf(call({ responseBody: '{"ip":"203.0.113.45"}' }));
    expect(reasons).toEqual([{ kind: 'ip', where: 'answer: ip' }]);
    expect(resolved(reasons, [])).toBe(true);
  });
});

describe('a body that came compressed', () => {
  it('is looked at once unpacked', async () => {
    const requestBody = await unpackedText(new Uint8Array(gzipSync(JSON.stringify({ mail: 'ann@example.test', ip: '203.0.113.45' }))), ['gzip'], { max: 20_000 });
    expect(kinds(call({ requestBody }))).toEqual(['email sent: mail', 'ip sent: ip']);
  });
});

describe('bodies that are neither JSON nor a form', () => {
  const multipart = (parts: [string, string][]) => parts.map(([n, v]) => `--b1\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`).join('') + '--b1--\r\n';
  it('a multipart body, by its part names', () => {
    expect(kinds(call({ requestBody: multipart([['email', 'ann@example.test'], ['q', 'lamp']]) }))).toEqual(['email sent: email']);
  });
  it('NDJSON, each line a record', () => {
    expect(kinds(call({ responseBody: '{"mail":"ann@example.test"}\n{"mail":"bob@example.test"}\n' }))).toEqual(['email answer: [0].mail', 'email answer: [1].mail']);
  });
  it('lines that are not JSON are skipped, the JSON ones read', () => {
    expect(kinds(call({ responseBody: '{oops\n{"mail":"ann@example.test"}\n' }))).toEqual(['email answer: [0].mail']);
  });
  it('SSE, by its data payloads', () => {
    expect(kinds(call({ responseBody: 'event: m\ndata: {"tel":"+34600111222"}\n\n' }))).toEqual(['phone answer: [0].tel']);
  });
  it('any other text with named parts is flagged as one the review cannot read', () => {
    const c = call({ requestBody: '<form><field name="password">hunter2</field></form>' });
    expect(kinds(c)).toEqual(['unread sent: (body)']);
    expect(resolved(reasonsOf(c), [])).toBe(false);
    expect(resolved(reasonsOf(c), [c.requestBody!])).toBe(true);
  });
  it('plain text without named parts stays silent', () => expect(kinds(call({ requestBody: 'hello there' }))).toEqual([]));
});

import { describe, expect, it } from 'vitest';
import { stripMarks } from '../src/core/model-texts';
import { recordingBlock } from '../src/recording/block';
import { HIDDEN, hideSecrets, hideSecretsInUrl, hideValue, withAnswer, type RecordedCall, type Recording } from '../src/recording/recording';

const call = (change: Partial<RecordedCall> = {}): RecordedCall => ({ id: '1', method: 'GET', url: 'https://wiki.example.com/rest/api/content/12345', at: 0, included: true, ...change });
const recording = (calls: RecordedCall[], hidden: string[] = []): Recording => ({ tabId: 1, site: 'wiki.example.com', startedAt: 0, calls, hidden });

describe('a recording hides secrets as they come in', () => {
  it('in JSON and forms, by key, at any depth', () => {
    expect(JSON.parse(hideSecrets('{"title":"Page","auth":{"accessToken":"abc","user":"x"},"items":[{"password":"p"}]}'))).toEqual({
      title: 'Page', auth: { accessToken: HIDDEN, user: 'x' }, items: [{ password: HIDDEN }],
    });
    expect(hideSecrets('q=sales&csrf_token=abc&x=1')).toBe(`q=sales&csrf_token=${HIDDEN}&x=1`);
    expect(hideSecrets('plain text with token=abc inside')).toBe('plain text with token=abc inside');
  });
  it('in a URL\'s query', () => {
    expect(hideSecretsInUrl('https://a.example.com/x?api_key=123&q=1')).toBe(`https://a.example.com/x?api_key=${HIDDEN}&q=1`);
    expect(hideSecretsInUrl('https://a.example.com/x?token=1&q=1&secret=2')).toBe(`https://a.example.com/x?token=${HIDDEN}&q=1&secret=${HIDDEN}`);
  });
});

describe('the page\'s answers', () => {
  it('pair with the call the browser saw: the same method and URL, the first not answered', () => {
    const calls = [call({ id: 'a' }), call({ id: 'b' })];
    const once = withAnswer(calls, { method: 'get', url: 'https://wiki.example.com/rest/api/content/12345#x', status: 200, type: 'application/json', body: '{"id":"12345","token":"t"}' });
    expect(once.map((c) => c.responseBody)).toEqual([`{"id":"12345","token":"${HIDDEN}"}`, undefined]);
    expect(once[0]).toMatchObject({ status: 200, responseType: 'application/json' });
    const twice = withAnswer(once, { method: 'GET', url: 'https://wiki.example.com/rest/api/content/12345', status: 200, body: 'second' });
    expect(twice.map((c) => c.responseBody)).toEqual([`{"id":"12345","token":"${HIDDEN}"}`, 'second']);
  });
  it('are dropped when the browser saw no such call: the page cannot add calls', () => {
    const calls = [call()];
    expect(withAnswer(calls, { method: 'POST', url: 'https://wiki.example.com/rest/api/content/12345', status: 200, body: 'made up' })).toBe(calls);
  });
  it("are taken only from the frame that made the call: another frame cannot write its answer", () => {
    const calls = [call({ id: 'top' }), call({ id: 'ad' })];
    const frames: Record<string, number> = { top: 0, ad: 3 };
    const fromAd = withAnswer(calls, { method: 'GET', url: 'https://wiki.example.com/rest/api/content/12345', status: 200, body: 'fake' }, (c) => frames[c.id] === 3);
    expect(fromAd.map((c) => c.responseBody)).toEqual([undefined, 'fake']);
    expect(withAnswer([calls[0]!], { method: 'GET', url: 'https://wiki.example.com/rest/api/content/12345', status: 200, body: 'fake' }, (c) => frames[c.id] === 3)).toEqual([calls[0]]);
  });
});

describe('what the model gets', () => {
  it('the calls ticked, in order, with the values hidden by the user hidden everywhere', () => {
    const r = hideValue(recording([
      call({ status: 200, responseBody: '{"version":{"number":7}}', responseType: 'application/json' }),
      call({ id: '2', method: 'POST', url: 'https://other.example.com/track', status: 204, included: false }),
      call({ id: '3', method: 'PUT', status: 200, requestBody: '{"title":"Q3 sales","version":{"number":8}}' }),
    ]), 'Q3 sales');
    const block = stripMarks(recordingBlock(r));
    expect(block).toContain('<untrusted_page_content source="recording of wiki.example.com" calls="2">');
    expect(block).toContain('#1 GET /rest/api/content/12345 → 200\nanswer (application/json):\n{\n  "version": {\n    "number": 7\n  }\n}');
    expect(block).toContain(`#2 PUT /rest/api/content/12345 → 200\nsent:\n{\n  "title": "${HIDDEN}"`);
    expect(block).not.toContain('Q3 sales');
    expect(block).not.toContain('track');
  });
  it('past the limit, the calls that do not fit go without their bodies', () => {
    const big = 'x'.repeat(29_000);
    const block = stripMarks(recordingBlock(recording([call({ status: 200, responseBody: big }), call({ id: '2', status: 200, responseBody: big })])));
    expect(block).toContain('#2 GET /rest/api/content/12345 → 200\n(bodies left out: over the limit)');
    expect(block).toContain('1 call without their bodies.');
  });
});

describe('named hidden values', () => {
  it('a named hidden value shows as ••••[name]', async () => {
    const { withHidden } = await import('../src/recording/recording');
    expect(withHidden('id=c-4471&x=1', ['c-4471'], { 'c-4471': 'customer_id' })).toBe('id=••••[customer_id]&x=1');
  });

  it('an unnamed one stays ••••', async () => {
    const { withHidden } = await import('../src/recording/recording');
    expect(withHidden('id=c-4471', ['c-4471'], {})).toBe('id=••••');
  });

  it('the block shows the name', async () => {
    const { recordingBlock } = await import('../src/recording/block');
    const block = recordingBlock({ tabId: 1, site: 'shop.example.test', startedAt: 0, hidden: ['c-4471'], hiddenNames: { 'c-4471': 'customer_id' }, calls: [{ id: '1', method: 'POST', url: 'https://shop.example.test/api/pay', at: 0, status: 200, requestBody: '{"customer":"c-4471"}', responseBody: '{}', included: true }] });
    expect(block).toContain('••••[customer_id]');
    expect(block).not.toContain('c-4471');
  });

  it('recording.variables ends with the secret sentence', async () => {
    const { text } = await import('../src/core/model-texts');
    expect(text('recording.variables').endsWith('A value shown as ••••[name] is hidden from you: where a call sends it, write {{secret:name}}; the value the user saved replaces it when the tool runs, and you never see it.')).toBe(true);
  });
});

describe('steps in the block', () => {
  it('interleaves steps and calls by time', () => {
    const r: Recording = {
      tabId: 1, site: 'shop.example.test', startedAt: 0, hidden: ['lamp-secret'], mode: 'tabs-mouse',
      steps: [
        { at: 1, tabId: 1, kind: 'type', target: 'searchbox "Search"', text: 'lamp-secret' },
        { at: 3, tabId: 1, kind: 'click', target: 'button "Pay"' },
        { at: 5, tabId: 2, kind: 'tab', target: 'Payments (pay.example.test)' },
      ],
      calls: [call({ id: 'a', at: 2, status: 200 }), call({ id: 'b', at: 4, status: 200 }), call({ id: 'c', at: 6, status: 200, url: 'https://pay.example.test/api' })],
    };
    const block = stripMarks(recordingBlock(r));
    const order = ['⌨ typed "••••" into searchbox "Search"', '#1 ', '🖱 clicked button "Pay"', '#2 ', '→ tab Payments (pay.example.test)', '#3 '].map((x) => block.indexOf(x));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(block).not.toContain('lamp-secret');
  });

  it('a typed field without its text', () => {
    const r: Recording = { tabId: 1, site: 'shop.example.test', startedAt: 0, hidden: [], steps: [{ at: 1, tabId: 1, kind: 'type', target: 'textbox "Password"' }], calls: [] };
    expect(stripMarks(recordingBlock(r))).toContain('⌨ typed into textbox "Password" (text not kept)');
  });
});

describe('a named hidden value without variables', () => {
  it('still tells the model how to use it', () => {
    const r: Recording = { tabId: 1, site: 'shop.example.test', startedAt: 0, hidden: ['c-4471'], hiddenNames: { 'c-4471': 'customer' }, calls: [call({ id: 'a', url: 'https://shop.example.test/api/customer', status: 200, responseBody: '{"customer":"c-4471"}' })] };
    const block = stripMarks(recordingBlock(r));
    expect(block).toContain('••••[customer]');
    expect(block).toContain('write {{secret:name}}');
  });
});

describe('pending items, the block', () => {
  it('steps count toward the limit, and a long typed text is cut', async () => {
    const { setLimitOverrides } = await import('../src/core/limits');
    setLimitOverrides({ recording: 5000 }); // the least it may be
    const steps = Array.from({ length: 100 }, (_, i) => ({ at: i, tabId: 1, kind: 'type' as const, target: `textbox "F${i}"`, text: 'x'.repeat(300) }));
    const block = stripMarks(recordingBlock({ tabId: 1, site: 'shop.example.test', startedAt: 0, hidden: [], steps, calls: [] }));
    expect(block.length).toBeLessThan(6000);
    expect(block).not.toContain('x'.repeat(201));
    expect(block).toContain('steps left out');
    setLimitOverrides({});
  });
});

describe('withAnswer, a long answer', () => {
  it('hides its secrets before cutting it', () => {
    const calls: RecordedCall[] = [{ id: '1', method: 'GET', url: 'https://shop.example.test/api/me', at: 0, included: true }];
    const [c] = withAnswer(calls, { method: 'GET', url: 'https://shop.example.test/api/me', status: 200, body: JSON.stringify({ access_token: 'tok-secret-123', pad: 'x'.repeat(30_000) }) });
    expect(c!.responseBody).not.toContain('tok-secret-123');
    expect(c!.responseBody!.length).toBeLessThanOrEqual(20_000);
  });
});

describe("the review's preview of what the model gets", () => {
  it('is the block as sent, its size and the limit', async () => {
    const { recordingPreview } = await import('../src/recording/block');
    const r = recording([call({ status: 200, responseBody: '{"a":1}' })]);
    const p = recordingPreview(r);
    expect(p.text).toBe(stripMarks(recordingBlock(r)));
    expect(p.size).toBe(p.text.length);
    expect(p.max).toBe(30_000);
    expect(p.cut).toBe(0);
  });
  it('counts the calls that go without their bodies', async () => {
    const { recordingPreview } = await import('../src/recording/block');
    const big = 'x'.repeat(29_000);
    expect(recordingPreview(recording([call({ status: 200, responseBody: big }), call({ id: '2', status: 200, responseBody: big })])).cut).toBe(1);
  });
});

// A multipart body as a browser sends a form with files: each part named, the closing boundary at the end.
const multipart = (boundary: string, parts: [string, string, string?][]) =>
  parts.map(([n, v, file]) => `--${boundary}\r\nContent-Disposition: form-data; name="${n}"${file ? `; filename="${file}"\r\nContent-Type: text/plain` : ''}\r\n\r\n${v}\r\n`).join('') + `--${boundary}--\r\n`;

describe('a recording hides secrets in bodies that are neither JSON nor a form', () => {
  it('multipart, by each part\'s name, with the boundary from the type or from the first line', () => {
    const body = multipart('----WebKitFormBoundaryx7', [['user', 'ann'], ['password', 'hunter2']]);
    const hidden = multipart('----WebKitFormBoundaryx7', [['user', 'ann'], ['password', HIDDEN]]);
    expect(hideSecrets(body, 'multipart/form-data; boundary=----WebKitFormBoundaryx7')).toBe(hidden);
    expect(hideSecrets(body)).toBe(hidden);
  });
  it('multipart with a file part: its content kept, a secret part next to it hidden', () => {
    const body = multipart('b1', [['avatar', 'file content', 'me.txt'], ['csrf_token', 'abc']]);
    expect(hideSecrets(body)).toBe(multipart('b1', [['avatar', 'file content', 'me.txt'], ['csrf_token', HIDDEN]]));
  });
  it('a cut JSON that looks like a form with a bad escape does not throw', () => {
    expect(hideSecrets('{"tok%en":"x=1')).toBe('{"tok%en":"x=1');
  });
  it('NDJSON and SSE, line by line, the other lines as they are', () => {
    expect(hideSecrets('{"a":1,"token":"t"}\n{"b":2}\n')).toBe(`{"a":1,"token":"${HIDDEN}"}\n{"b":2}\n`);
    expect(hideSecrets('event: m\r\ndata: {"session":"s","x":1}\r\n\r\ndata: plain\r\n')).toBe(`event: m\r\ndata: {"session":"${HIDDEN}","x":1}\r\n\r\ndata: plain\r\n`);
  });
});

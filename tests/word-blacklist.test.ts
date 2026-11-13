import { describe, expect, it } from 'vitest';
import { blacklistApplies, blocksSaving, compileBlacklist, entryIssues, urlMatches } from '../src/word-blacklist/core';
import { maskRequest, restoreEvents } from '../src/word-blacklist/request';
import { blacklistGate, chatBlacklistState, urlsIn } from '../src/word-blacklist/gate';
import type { ChatEvent, ChatRequest, LLMProvider } from '../src/core/types';

const bl = compileBlacklist([
  { term: 'Acme', replacement: 'CLIENT_A' },
  { term: 'Acme Labs', replacement: 'CLIENT_B' },
  { term: 'José Pérez', replacement: 'PERSON_1' },
  { term: 'secret.example.com', replacement: 'HOST_1' },
]);

describe('mask', () => {
  it('replaces terms whatever their case and accents', () => {
    expect(bl.mask('acme and ACME and Ácme')).toBe('CLIENT_A and CLIENT_A and CLIENT_A');
    expect(bl.mask('Call jose perez or JOSÉ PÉREZ')).toBe('Call PERSON_1 or PERSON_1');
    // Decomposed accents too.
    expect(bl.mask('José Pérez')).toBe('PERSON_1');
  });

  it('replaces whole words only', () => {
    expect(bl.mask('Acmes, AcmeCorp, acme_x, xacme')).toBe('Acmes, AcmeCorp, acme_x, xacme');
    expect(bl.mask('(Acme), "Acme". Acme!')).toBe('(CLIENT_A), "CLIENT_A". CLIENT_A!');
  });

  it('takes the longest term first, and any run of spaces inside it', () => {
    expect(bl.mask('Acme Labs is not Acme')).toBe('CLIENT_B is not CLIENT_A');
    expect(bl.mask('Acme\n  Labs')).toBe('CLIENT_B');
  });

  it('matches terms with dots and keeps the rest of the text', () => {
    expect(bl.mask('Open https://secret.example.com/path now')).toBe('Open https://HOST_1/path now');
  });

  it('masks every string inside a value, not its keys', () => {
    expect(bl.maskDeep({ Acme: 'Acme', list: ['acme', 1, { q: 'José Pérez' }] })).toEqual({ Acme: 'CLIENT_A', list: ['CLIENT_A', 1, { q: 'PERSON_1' }] });
  });

  it('leaves everything as it is without entries', () => {
    const none = compileBlacklist([{ term: ' ', replacement: 'X' }]);
    expect(none.empty).toBe(true);
    expect(none.mask('Acme')).toBe('Acme');
    expect(none.restore('CLIENT_A')).toBe('CLIENT_A');
  });
});

describe('restore', () => {
  it('puts the terms back, whole words, whatever the case', () => {
    expect(bl.restore('CLIENT_A, client_b and Person_1')).toBe('Acme, Acme Labs and José Pérez');
    expect(bl.restore('CLIENT_AB and XCLIENT_A')).toBe('CLIENT_AB and XCLIENT_A');
  });

  it('restores tool arguments once parsed', () => {
    expect(bl.restoreDeep({ url: 'https://HOST_1/x', text: 'Hi PERSON_1', n: 2 })).toEqual({ url: 'https://secret.example.com/x', text: 'Hi José Pérez', n: 2 });
  });

  it('restores a placeholder split across stream chunks', () => {
    const chunks = ['Hello CLI', 'ENT', '_A, and PERS', 'ON_1', '.'];
    const r = bl.streamRestorer();
    const out = chunks.map((c) => r.push(c)).join('') + r.end();
    expect(out).toBe('Hello Acme, and José Pérez.');
  });

  it('waits for the next chunk to say whether a placeholder is a whole word', () => {
    const r = bl.streamRestorer();
    const out = [r.push('x CLIENT_A'), r.push('B y CLIENT_'), r.push('A')].join('') + r.end();
    expect(out).toBe('x CLIENT_AB y Acme');
  });

  it('sees the word boundary before a chunk', () => {
    const r = bl.streamRestorer();
    const out = [r.push('abcdefghijkX'), r.push('CLIENT_A z')].join('') + r.end();
    expect(out).toBe('abcdefghijkXCLIENT_A z');
  });

  it('gives text back as it comes when nothing may be a placeholder', () => {
    const r = bl.streamRestorer();
    // The longest placeholder has 8 characters: only the last 8 wait.
    expect(r.push('a long chunk of text without any')).toBe('a long chunk of text wit');
    expect(r.end()).toBe('hout any');
  });
});

describe('entryIssues', () => {
  it('finds two entries with the same replacement', () => {
    const issues = entryIssues([{ term: 'Acme', replacement: 'CLIENT_A' }, { term: 'Globex', replacement: 'client_a' }]);
    expect(issues.get(0)).toEqual(['same-replacement']);
    expect(issues.get(1)).toEqual(['same-replacement']);
    expect(blocksSaving(issues)).toBe(true);
  });

  it('finds a replacement that contains a term', () => {
    const issues = entryIssues([{ term: 'Acme', replacement: 'CLIENT_A' }, { term: 'Globex', replacement: 'ACME 2' }]);
    expect(issues.get(1)).toEqual(['contains-term']);
    expect(blocksSaving(issues)).toBe(true);
  });

  it('warns of an ordinary word without blocking', () => {
    const issues = entryIssues([{ term: 'Acme', replacement: 'Phoenix' }, { term: 'Globex', replacement: 'CLIENT_2' }]);
    expect(issues.get(0)).toEqual(['ordinary-word']);
    expect(issues.has(1)).toBe(false);
    expect(blocksSaving(issues)).toBe(false);
  });

  it('skips entries not filled in yet', () => {
    expect(entryIssues([{ term: 'Acme', replacement: '' }, { term: '', replacement: 'X' }]).size).toBe(0);
  });
});

describe('when it applies', () => {
  it('matches URL patterns', () => {
    expect(urlMatches('https://a.example.com/x', '*.example.com')).toBe(true);
    expect(urlMatches('https://example.com/x', '*.example.com')).toBe(true);
    expect(urlMatches('https://example.org/x', '*.example.com')).toBe(false);
    expect(urlMatches('https://notexample.com/', '*.example.com')).toBe(false);
    expect(urlMatches('https://example.com/docs/a', 'example.com/docs/*')).toBe(true);
    expect(urlMatches('https://example.com/blog', 'example.com/docs/*')).toBe(false);
    expect(urlMatches('http://example.com/', 'https://*')).toBe(false);
    expect(urlMatches('not a url', '*')).toBe(false);
  });

  it('applies with the providers and pages listed, always with neither, never off', () => {
    const at = { providerId: 'p1', model: 'm1', urls: [] as string[] };
    expect(blacklistApplies({ enabled: false }, at)).toBe(false);
    expect(blacklistApplies({ enabled: true }, at)).toBe(true);
    expect(blacklistApplies({ enabled: true, targets: [{ providerId: 'p1' }] }, at)).toBe(true);
    expect(blacklistApplies({ enabled: true, targets: [{ providerId: 'p1', model: 'm2' }] }, at)).toBe(false);
    expect(blacklistApplies({ enabled: true, targets: [{ providerId: 'p2' }], pages: ['*.example.com'] }, at)).toBe(false);
    expect(blacklistApplies({ enabled: true, pages: ['*.example.com'] }, { ...at, urls: ['https://a.example.com/'] })).toBe(true);
  });

  it('finds the pages a conversation opened or read', () => {
    expect(urlsIn([
      { role: 'user', parts: [{ type: 'text', text: 'x', context: 'page', source: 'https://a.example.com/' }] },
      { role: 'assistant', parts: [{ type: 'tool_call', id: 'c', name: 'web__read', args: { url: 'https://b.example.com/' } }] },
      { role: 'tool', parts: [{ type: 'tool_result', toolCallId: 'c', content: '', tab: { id: 1, title: '', url: 'https://c.example.com/' } }] },
    ])).toEqual(['https://a.example.com/', 'https://b.example.com/', 'https://c.example.com/']);
  });
});

const opts = { hideImages: false, systemNote: 'NOTE', imageNote: '[hidden]' };

describe('maskRequest', () => {
  const req: ChatRequest = {
    model: 'm',
    system: 'You help Acme.',
    tools: [{ name: 't', description: 'Acme tool', inputSchema: { type: 'object', properties: { acme: { type: 'string', description: 'For Acme', enum: ['Acme', 'Other'] } }, required: ['acme'] } }],
    messages: [
      { role: 'user', parts: [{ type: 'text', text: 'About Acme' }, { type: 'image', mediaType: 'image/png', data: 'AAA' }] },
      { role: 'assistant', parts: [{ type: 'tool_call', id: 'c', name: 't', args: { acme: 'Acme' } }] },
      { role: 'tool', parts: [{ type: 'tool_result', toolCallId: 'c', content: 'Acme found', images: [{ mediaType: 'image/png', data: 'BBB' }] }] },
    ],
  };

  it('masks every text and adds the note to the system prompt, leaving the request as it was', () => {
    const masked = maskRequest(req, bl, opts);
    expect(masked.system).toBe('You help CLIENT_A.\n\nNOTE');
    expect(masked.tools![0]!.description).toBe('CLIENT_A tool');
    expect(masked.tools![0]!.inputSchema).toEqual({ type: 'object', properties: { acme: { type: 'string', description: 'For CLIENT_A', enum: ['CLIENT_A', 'Other'] } }, required: ['acme'] });
    expect(masked.messages[0]!.parts[0]).toEqual({ type: 'text', text: 'About CLIENT_A' });
    expect(masked.messages[0]!.parts[1]).toMatchObject({ type: 'image', data: 'AAA' });
    expect(masked.messages[1]!.parts[0]).toMatchObject({ args: { acme: 'CLIENT_A' } });
    expect(masked.messages[2]!.parts[0]).toMatchObject({ content: 'CLIENT_A found', images: [{ data: 'BBB' }] });
    expect(req.messages[0]!.parts[0]).toEqual({ type: 'text', text: 'About Acme' });
  });

  it('replaces the images with the note when they are hidden', () => {
    const masked = maskRequest(req, bl, { ...opts, hideImages: true });
    expect(masked.messages[0]!.parts[1]).toEqual({ type: 'text', text: '[hidden]' });
    expect(masked.messages[2]!.parts[0]).toMatchObject({ content: 'CLIENT_A found\n[hidden]', images: undefined });
  });
});

async function* stream(events: ChatEvent[]) {
  yield* events;
}
const all = async (it: AsyncIterable<ChatEvent>) => {
  const out: ChatEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
};

describe('restoreEvents', () => {
  it('restores the text, the reasoning and the tool calls in their order', async () => {
    const out = await all(restoreEvents(stream([
      { type: 'reasoning-delta', text: 'About CLIENT' },
      { type: 'reasoning-delta', text: '_A' },
      { type: 'reasoning-end' },
      { type: 'text-delta', text: 'Opening HOST' },
      { type: 'text-delta', text: '_1' },
      { type: 'tool-call', id: 'c', name: 't', args: { url: 'https://HOST_1/' } },
      { type: 'done', stopReason: 'tool_calls' },
    ]), bl));
    const joined = (type: string) => out.filter((e) => e.type === type).map((e) => (e as { text: string }).text).join('');
    expect(joined('reasoning-delta')).toBe('About Acme');
    expect(joined('text-delta')).toBe('Opening secret.example.com');
    expect(out.map((e) => e.type).filter((t, i, types) => t !== types[i - 1])).toEqual(['reasoning-delta', 'reasoning-end', 'text-delta', 'tool-call', 'done']);
    expect(out.find((e) => e.type === 'tool-call')).toMatchObject({ args: { url: 'https://secret.example.com/' } });
  });
});

describe('blacklistGate', () => {
  const provider = (answer: ChatEvent[]) => {
    const requests: ChatRequest[] = [];
    const p: LLMProvider = {
      listModels: async () => [],
      chat: (req) => {
        requests.push(req);
        return stream(answer);
      },
    };
    return { p, requests };
  };
  const config = { enabled: true, pages: ['*.example.com'] };
  const plain: ChatRequest = { model: 'm', messages: [{ role: 'user', parts: [{ type: 'text', text: 'Acme' }] }] };

  it('masks once a page matches, and from then on', async () => {
    let url = 'https://other.test/';
    const gate = blacklistGate({ config, blacklist: bl }, { pageUrl: async () => url });
    const { p, requests } = provider([{ type: 'text-delta', text: 'CLIENT_A' }, { type: 'done', stopReason: 'stop' }]);
    const masked = gate.provider(p, 'p1');
    expect(await all(masked.chat(plain, new AbortController().signal))).toEqual([{ type: 'text-delta', text: 'CLIENT_A' }, { type: 'done', stopReason: 'stop' }]);
    expect(requests[0]!.messages[0]!.parts[0]).toMatchObject({ text: 'Acme' });
    expect(gate.active).toBe(false);
    url = 'https://a.example.com/';
    expect((await all(masked.chat(plain, new AbortController().signal)))[0]).toEqual({ type: 'text-delta', text: 'Acme' });
    expect(requests[1]!.messages[0]!.parts[0]).toMatchObject({ text: 'CLIENT_A' });
    url = 'https://other.test/';
    await all(masked.chat(plain, new AbortController().signal));
    expect(requests[2]!.messages[0]!.parts[0]).toMatchObject({ text: 'CLIENT_A' });
    expect(gate.active).toBe(true);
  });

  it('masks from the start in a conversation that went masked, and never while off', async () => {
    const { p, requests } = provider([{ type: 'done', stopReason: 'stop' }]);
    await all(blacklistGate({ config, blacklist: bl }, { sticky: true }).provider(p, 'p1').chat(plain, new AbortController().signal));
    await all(blacklistGate(undefined, { sticky: true }).provider(p, 'p1').chat(plain, new AbortController().signal));
    expect(requests.map((r) => (r.messages[0]!.parts[0] as { text: string }).text)).toEqual(['CLIENT_A', 'Acme']);
  });
});

describe('chatBlacklistState', () => {
  const base = { config: { enabled: true, targets: [{ providerId: 'p1' }], pages: ['*.example.com'] }, hasTerms: true, providerId: 'p2', model: 'm', history: [] };
  it('is off while switched off or without terms', () => {
    expect(chatBlacklistState({ ...base, config: { enabled: false } })).toBe('off');
    expect(chatBlacklistState({ ...base, hasTerms: false, chosen: 'on' })).toBe('off');
  });
  it('is active with the provider, the page, a masked answer or turned on by hand; else available', () => {
    expect(chatBlacklistState({ ...base, providerId: 'p1', history: [{ role: 'assistant', parts: [], masked: true }], chosen: 'off' })).toBe('available');
    expect(chatBlacklistState(base)).toBe('available');
    expect(chatBlacklistState({ ...base, providerId: 'p1' })).toBe('active');
    expect(chatBlacklistState({ ...base, pageUrl: 'https://a.example.com/' })).toBe('active');
    expect(chatBlacklistState({ ...base, history: [{ role: 'assistant', parts: [], masked: true }] })).toBe('active');
    expect(chatBlacklistState({ ...base, chosen: 'on' })).toBe('active');
  });
});

describe('replaced', () => {
  it('lists the entries masking uses, once each, as they come', () => {
    expect(bl.replaced('acme labs, then Acme and ACME LABS')).toEqual([{ term: 'Acme Labs', replacement: 'CLIENT_B' }, { term: 'Acme', replacement: 'CLIENT_A' }]);
    expect(bl.replaced('nothing here')).toEqual([]);
  });
});

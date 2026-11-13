import { describe, expect, it } from 'vitest';
import { keepAnswer, keepRequest, matchesUrlPattern, typeOfCdp, typeOfWebRequest, webRequestTypes } from '../src/recording/filter';
import { SHIPPED_PRESETS, type RecordingPreset } from '../src/recording/presets';

const preset = (id: string) => SHIPPED_PRESETS.find((p) => p.id === id)!;
const everything = preset('everything');
const with_ = (change: Partial<RecordingPreset>): RecordingPreset => ({ ...everything, ...change });
const keep = (p: RecordingPreset, url: string, more: { method?: string; type?: 'fetch' | 'document' | 'script' | 'socket' | 'static'; requestBody?: string } = {}, site = 'shop.example.com', seen = new Set<string>()) =>
  keepRequest(p, { method: more.method ?? 'GET', url, type: more.type ?? 'fetch', requestBody: more.requestBody }, site, seen);

describe('an address pattern', () => {
  it('with a scheme is a Chrome match pattern', () => {
    expect(matchesUrlPattern('*://*.example.com/api/*', 'https://a.example.com/api/x')).toBe(true);
    expect(matchesUrlPattern('*://*.example.com/api/*', 'https://a.example.com/web/x')).toBe(false);
  });
  it('without one, a glob over the host, path and query, any case', () => {
    expect(matchesUrlPattern('*analytics*', 'https://analytics.example.net/x')).toBe(true);
    expect(matchesUrlPattern('*analytics*', 'https://shop.example.com/js/Analytics.js')).toBe(true);
    expect(matchesUrlPattern('*/collect', 'https://shop.example.com/collect')).toBe(true);
    expect(matchesUrlPattern('*/collect', 'https://shop.example.com/collect?v=2')).toBe(false);
  });
});

describe('API calls leaves out what only looks like noise by its address', () => {
  const api = preset('api');
  it.each(['/api/collections', '/api/collector-items', '/v1/pixels-per-inch'])('keeps %s', (path) => {
    expect(keep(api, `https://shop.example.com${path}`)).toBe(true);
  });
  it.each(['/collect', '/collect?v=2', '/g/collect', '/pixel?id=1', '/p/pixel.gif', '/ads/banner'])('leaves out %s', (path) => {
    expect(keep(api, `https://shop.example.com${path}`)).toBe(false);
  });
  it('leaves out an analytics host', () => expect(keep(api, 'https://analytics.example.net/x')).toBe(false));
  it('keeps an API on another site', () => expect(keep(api, 'https://api.example.net/orders')).toBe(true));
});

describe('a request kept or left out', () => {
  it('by its type; static resources always out', () => {
    expect(keep(with_({ types: ['fetch'] }), 'https://shop.example.com/a.js', { type: 'script' })).toBe(false);
    expect(keep(everything, 'https://shop.example.com/a.png', { type: 'static' })).toBe(false);
  });
  it('by site: this one and its subdomains, without www.', () => {
    const own = with_({ sites: 'this-site' });
    expect(keep(own, 'https://shop.example.com/x')).toBe(true);
    expect(keep(own, 'https://api.shop.example.com/x')).toBe(true);
    expect(keep(own, 'https://example.net/x')).toBe(false);
    expect(keep(own, 'https://example.com/x', {}, 'www.example.com')).toBe(true);
    expect(keep(own, 'https://cdn.example.com/x', {}, 'www.example.com')).toBe(true);
  });
  it('only the addresses included, when any', () => {
    const only = with_({ include: ['*://*/api/*'] });
    expect(keep(only, 'https://shop.example.com/api/x')).toBe(true);
    expect(keep(only, 'https://shop.example.com/web/x')).toBe(false);
  });
  it('by method, in any case', () => {
    const posts = with_({ methods: ['POST'] });
    expect(keep(posts, 'https://shop.example.com/x', { method: 'GET' })).toBe(false);
    expect(keep(posts, 'https://shop.example.com/x', { method: 'post' })).toBe(true);
  });
  it('a call repeated is kept once: query values do not count, bodies do', () => {
    const once = with_({ dedupe: true });
    const seen = new Set<string>();
    expect(keep(once, 'https://shop.example.com/api/items?page=1', {}, undefined, seen)).toBe(true);
    expect(keep(once, 'https://shop.example.com/api/items?page=2', {}, undefined, seen)).toBe(false);
    expect(keep(once, 'https://shop.example.com/api/items?page=2&sort=a', {}, undefined, seen)).toBe(true);
    expect(keep(once, 'https://shop.example.com/api/items', { method: 'POST', requestBody: '{"a":1}' }, undefined, seen)).toBe(true);
    expect(keep(once, 'https://shop.example.com/api/items', { method: 'POST', requestBody: '{"a":2}' }, undefined, seen)).toBe(true);
    const all = new Set<string>();
    expect(keep(everything, 'https://shop.example.com/api/items?page=1', {}, undefined, all)).toBe(true);
    expect(keep(everything, 'https://shop.example.com/api/items?page=2', {}, undefined, all)).toBe(true);
  });
  it('a call left out is not remembered for dedupe', () => {
    const p = with_({ dedupe: true, methods: ['POST'] });
    const seen = new Set<string>();
    expect(keep(p, 'https://shop.example.com/x', { method: 'GET' }, undefined, seen)).toBe(false);
    expect(seen.size).toBe(0);
  });
});

describe('an answer kept or left out', () => {
  it('errors only: 4xx, 5xx and failures', () => {
    const errors = with_({ status: 'errors' });
    expect(keepAnswer(errors, { status: 404 })).toBe(true);
    expect(keepAnswer(errors, { status: 500 })).toBe(true);
    expect(keepAnswer(errors, { error: 'net::ERR_FAILED' })).toBe(true);
    expect(keepAnswer(errors, { status: 200 })).toBe(false);
    expect(keepAnswer(errors, { status: 302 })).toBe(false);
  });
  it('success only: the reverse', () => {
    const ok = with_({ status: 'success' });
    expect(keepAnswer(ok, { status: 200 })).toBe(true);
    expect(keepAnswer(ok, { status: 302 })).toBe(true);
    expect(keepAnswer(ok, { status: 404 })).toBe(false);
    expect(keepAnswer(ok, { error: 'net::ERR_FAILED' })).toBe(false);
  });
  it('JSON and text only; a type never known is kept', () => {
    const text = with_({ answers: 'text' });
    for (const t of ['application/json', 'text/html', 'application/graphql-response+json', undefined, '']) expect(keepAnswer(text, { status: 200, responseType: t })).toBe(true);
    for (const t of ['image/png', 'application/octet-stream']) expect(keepAnswer(text, { status: 200, responseType: t })).toBe(false);
  });
});

describe('the browser types', () => {
  it('of DevTools', () => {
    expect(['XHR', 'Fetch', 'Other', 'Preflight'].map(typeOfCdp)).toEqual(['fetch', 'fetch', 'fetch', 'fetch']);
    expect(typeOfCdp('Document')).toBe('document');
    expect(typeOfCdp('Script')).toBe('script');
    expect(['WebSocket', 'EventSource', 'Ping'].map(typeOfCdp)).toEqual(['socket', 'socket', 'socket']);
    expect(['Image', 'Font', 'Stylesheet', 'Media', 'Manifest', 'TextTrack'].map(typeOfCdp).every((t) => t === 'static')).toBe(true);
  });
  it('of webRequest, both ways', () => {
    expect(typeOfWebRequest('xmlhttprequest')).toBe('fetch');
    expect(typeOfWebRequest('main_frame')).toBe('document');
    expect(typeOfWebRequest('sub_frame')).toBe('document');
    expect(typeOfWebRequest('script')).toBe('script');
    expect(typeOfWebRequest('ping')).toBe('socket');
    expect(typeOfWebRequest('image')).toBe('static');
    expect(webRequestTypes(['fetch', 'socket'])).toEqual(['xmlhttprequest', 'websocket', 'ping']);
    expect(webRequestTypes(['document', 'script'])).toEqual(['main_frame', 'sub_frame', 'script']);
  });
});

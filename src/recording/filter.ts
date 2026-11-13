// What a recording's preset (recording/presets) keeps, decided as each call comes: by what it asks
// (its type, site, address, method, and once only when repeated), then by its answer (status, type).
// A call left out is only counted by the engines (recording/devtools, recording/webrequest).
import { matchesPattern } from '../skills/match';
import { globMatches, hostOf } from '../core/util';
import type { CallType, RecordingPreset } from './presets';

// A Chrome match pattern ("*://*.example.com/api/*"), or without a scheme a glob over the host, path
// and query ("*analytics*"), in any case.
export function matchesUrlPattern(pattern: string, url: string): boolean {
  if (pattern === '<all_urls>' || pattern.includes('://')) return matchesPattern(pattern, url);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return globMatches(pattern, u.host + u.pathname + u.search);
}

// The answer's type is text the model can read. recording/page-hooks (injected, so self-contained)
// repeats it word for word: a change here goes there too (tests/recording-page-hooks keeps them equal).
export const textual = (type: string) => !type || /json|text|xml|javascript|urlencoded|graphql/i.test(type);

const ownSite = (url: string, site: string) => {
  const host = hostOf(url);
  const own = site.replace(/^www\./, '');
  return host === own || host.endsWith(`.${own}`);
};

// The same call: its method, its address with the query's names (not their values), and its body.
export function dedupeKey(method: string, url: string, body = ''): string {
  try {
    const u = new URL(url);
    return `${method.toUpperCase()} ${u.host}${u.pathname}?${[...new Set(u.searchParams.keys())].sort().join('&')}#${body}`;
  } catch {
    return `${method.toUpperCase()} ${url}#${body}`;
  }
}

// `seen`: the calls kept so far (dedupe); a call kept is added to it, and taken out again by the engine
// if its answer drops it.
export function keepRequest(p: RecordingPreset, call: { method: string; url: string; type: CallType | 'static'; requestBody?: string }, site: string, seen: Set<string>): boolean {
  if (call.type === 'static' || !p.types.includes(call.type)) return false;
  if (p.sites === 'this-site' && !ownSite(call.url, site)) return false;
  if (p.include.length && !p.include.some((x) => matchesUrlPattern(x, call.url))) return false;
  if (p.exclude.some((x) => matchesUrlPattern(x, call.url))) return false;
  if (p.methods.length && !p.methods.some((m) => m.toUpperCase() === call.method.toUpperCase())) return false;
  if (p.dedupe) {
    const key = dedupeKey(call.method, call.url, call.requestBody);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

export function keepAnswer(p: RecordingPreset, c: { status?: number; error?: string; responseType?: string }): boolean {
  const failed = !!c.error || (c.status ?? 0) >= 400;
  if (p.status === 'errors' && !failed) return false;
  if (p.status === 'success' && failed) return false;
  return p.answers === 'all' || textual(c.responseType ?? '');
}

const STATIC_CDP = new Set(['Image', 'Font', 'Stylesheet', 'Media', 'Manifest', 'TextTrack']);
// A request's type as DevTools tells it; any other (Other, Preflight…) is kept as a call, as before.
export function typeOfCdp(resourceType: string): CallType | 'static' {
  if (STATIC_CDP.has(resourceType)) return 'static';
  if (resourceType === 'Document') return 'document';
  if (resourceType === 'Script') return 'script';
  if (['WebSocket', 'EventSource', 'Ping'].includes(resourceType)) return 'socket';
  return 'fetch';
}

const WEB_REQUEST: Record<CallType, string[]> = { fetch: ['xmlhttprequest'], document: ['main_frame', 'sub_frame'], script: ['script'], socket: ['websocket', 'ping'] };
export const webRequestTypes = (types: CallType[]): string[] => types.flatMap((t) => WEB_REQUEST[t]);
export const typeOfWebRequest = (type: string): CallType | 'static' =>
  (Object.keys(WEB_REQUEST) as CallType[]).find((t) => WEB_REQUEST[t].includes(type)) ?? 'static';

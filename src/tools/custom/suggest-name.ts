// A name to suggest for a custom tool from what it is: the site it reaches ("forum" of
// forum.example.com, "example" of api.example.com) and what it does there ("search", "get_item",
// "post_message"), joined by a dot as tool names are. Undefined when there is nothing to make it from.
import { SCRIPT_BASE } from './script-tool';
import type { CustomTool } from './types';
import { singular, snake, uniqueName } from './names';
import { splitUrl } from './request-url';
import { HTTP_BASE } from '../http';

// Host labels that say nothing about the site.
const GENERIC = new Set(['www', 'api', 'apis', 'app', 'm', 'rest', 'gateway', 'web', 'service', 'services', 'v1', 'v2', 'v3']);
// The second-level part of country domains (example.co.uk).
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu']);

// The word for a site: its first label that names it.
export function siteWord(url: string | undefined): string | undefined {
  // Never from user:password@ before the host (splitUrl leaves it out of the origin).
  const host = /^https?:\/\/([^/:?#{}@]+)/i.exec(splitUrl(url?.trim() ?? '').origin)?.[1]?.toLowerCase();
  if (!host || /^[\d.]+$/.test(host)) return undefined;
  const labels = host.split('.');
  labels.pop(); // the top-level domain
  if (labels.length > 1 && SECOND_LEVEL.has(labels.at(-1)!)) labels.pop();
  const word = labels.find((l) => !GENERIC.has(l)) ?? labels.at(-1);
  return word ? snake(word) || undefined : undefined;
}

// What a request does: its last word of the path (not a placeholder, a version or "api"), with the
// method's verb; "search" for a GET with a search word in the path or query.
function requestWord(method: string, url: string): string {
  const parts = splitUrl(url);
  const query = parts.query ?? '';
  const path = parts.path.split('/').filter(Boolean);
  const words = path.filter((s) => !/[{}]/.test(s) && !/^v\d+$/i.test(s) && !/^(api|rest|json)$/i.test(s) && !/\d/.test(s));
  const last = snake(words.at(-1) ?? '');
  const endsInValue = /[{}]|\d/.test(path.at(-1) ?? '');
  if (method === 'GET') {
    if (/search|find|query/.test(last) || /(^|&)(q|query|search)=/.test(query)) return 'search';
    if (endsInValue && last) return `get_${singular(last)}`;
    if (!last) return 'get';
    return /^(list|get|read)_/.test(last) ? last : `list_${last}`;
  }
  return last ? `${verbOf(method, last)}_${singular(last)}` : verbOf(method, last);
}

function verbOf(method: string, last: string): string {
  if (method === 'DELETE') return 'delete';
  if (method !== 'POST') return 'update';
  return !last || /^(messages?|posts?|comments?)$/.test(last) ? 'post' : 'create';
}

// The site a preset tool is about: a host written in its texts or fixed values ("{value}
// site:forum.example.com").
function presetSite(custom: CustomTool): string | undefined {
  const textOf = (r: CustomTool['params'][string]) => (r.mode === 'fixed' ? String(r.value ?? '') : (r.template ?? ''));
  const texts = Object.values(custom.params).map(textOf);
  for (const t of texts) {
    const host = /(?:https?:\/\/|site:)([a-z0-9.-]+\.[a-z]{2,})/i.exec(t)?.[1];
    if (host) return siteWord(`https://${host}`);
  }
  return undefined;
}

// The name suggested, none of those taken.
export function suggestName(custom: CustomTool, taken: string[]): string | undefined {
  let name: string | undefined;
  if (custom.base === HTTP_BASE && custom.http) {
    const site = siteWord(custom.http.url);
    if (site) name = `${site}.${requestWord(custom.http.method, custom.http.url)}`;
  } else if (custom.base === SCRIPT_BASE) {
    const site = siteWord(custom.http?.url);
    const last = custom.uses?.at(-1)?.split('.').at(-1);
    name = site ? `${site}.run` : last ? `steps.${snake(last)}` : undefined;
  } else if (custom.base) {
    const action = custom.base.split('.').at(-1) ?? '';
    name = `${presetSite(custom) ?? 'my'}.${snake(action) || 'tool'}`;
  }
  if (!name || !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(name)) return undefined;
  return uniqueName(name, new Set(taken));
}

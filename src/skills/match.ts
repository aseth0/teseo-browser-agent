import { globMatches } from '../core/util';

// Chrome match patterns: <scheme>://<host><path>, e.g. "*://*.github.com/*/pull/*".
// scheme "*" = http or https; host "*" = any, "*.x.com" = x.com and its subdomains;
// "*" in the path matches anything. "<all_urls>" matches every http(s) page.
export function matchesPattern(pattern: string, url: string): boolean {
  if (pattern === '<all_urls>') return /^https?:\/\//.test(url);
  const m = pattern.match(/^(\*|https?):\/\/([^/]+)(\/.*)$/);
  if (!m) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const [, scheme, host, path] = m as unknown as [string, string, string, string];
  const protocol = u.protocol.slice(0, -1);
  if (scheme === '*' ? !['http', 'https'].includes(protocol) : protocol !== scheme) return false;
  if (host !== '*') {
    const base = host.startsWith('*.') ? host.slice(2) : host;
    const ok = u.hostname === base || (host.startsWith('*.') && u.hostname.endsWith(`.${base}`));
    if (!ok) return false;
  }
  return matchesPath(path, u);
}

// A path pattern with * ("/app/project/*") against the path and query of a URL.
export function matchesPath(pattern: string, url: URL): boolean {
  return globMatches(pattern, url.pathname + url.search, { caseSensitive: true });
}

export function matchesAny(patterns: string[], url: string | undefined): boolean {
  return !!url && patterns.some((p) => matchesPattern(p, url));
}

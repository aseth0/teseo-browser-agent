// A request's URL template in its parts, each kept as written (encoded, with its {name}s), to change
// one value of its path or query without touching the rest.
export interface UrlParts {
  origin: string; // https://api.example.com (without user:password@)
  userinfo?: string; // user:password, as written
  path: string; // /v1/items/{id}
  query?: string; // q={query}&limit=10, without "?"
  hash: string; // #… as written, "" for none
}

export function splitUrl(url: string): UrlParts {
  const hashAt = url.indexOf('#');
  const before = hashAt < 0 ? url : url.slice(0, hashAt);
  const hash = hashAt < 0 ? '' : url.slice(hashAt);
  const queryAt = before.indexOf('?');
  const main = queryAt < 0 ? before : before.slice(0, queryAt);
  const query = queryAt < 0 ? undefined : before.slice(queryAt + 1);
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)(.*)$/i.exec(main);
  if (!m) return { origin: '', path: main, query, hash };
  // user:password@host: the host after the authority's last @ (a password may hold one).
  const authority = m[2]!;
  const at = authority.lastIndexOf('@');
  const host = at < 0 ? authority : authority.slice(at + 1);
  return { origin: `${m[1]}${host}`, ...(at >= 0 && { userinfo: authority.slice(0, at) }), path: m[3] ?? '', query, hash };
}

export const joinUrl = (p: UrlParts) =>
  `${p.origin.replace(/^([a-z][a-z0-9+.-]*:\/\/)/i, (s) => (p.userinfo !== undefined ? `${s}${p.userinfo}@` : s))}${p.path}${p.query !== undefined ? `?${p.query}` : ''}${p.hash}`;

export interface QueryPair {
  name: string; // decoded
  rawName: string;
  raw: string; // its value as written
  hasValue: boolean;
}

export function queryPairs(query: string | undefined): QueryPair[] {
  if (!query) return [];
  return query.split('&').map((pair) => {
    const eq = pair.indexOf('=');
    const rawName = eq < 0 ? pair : pair.slice(0, eq);
    return { name: decode(rawName), rawName, raw: eq < 0 ? '' : pair.slice(eq + 1), hasValue: eq >= 0 };
  });
}

export const joinQuery = (pairs: QueryPair[]) => pairs.map((p) => (p.hasValue ? `${p.rawName}=${p.raw}` : p.rawName)).join('&');

// A URL part as the user reads it.
export function decode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

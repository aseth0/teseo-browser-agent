// The review's search box (sidepanel/RecordingReview): words as DevTools' Network panel reads them —
// method:, status-code:, domain: (with *), mime-type:, larger-than: (bytes, k, m) — any of them, or a
// plain word, negated by a leading -. Every term must hold; one still being typed (`domain:`, a lone -)
// or with a value it cannot read (`larger-than:1.`) filters nothing until it can.
import { globMatches, hostOf } from '../core/util';
import type { RecordedCall } from './recording';

type Key = 'method' | 'status-code' | 'domain' | 'mime-type' | 'larger-than' | 'word';
export interface SearchTerm {
  key: Key;
  value: string;
  not: boolean;
}

const KEYS = new Set<Key>(['method', 'status-code', 'domain', 'mime-type', 'larger-than']);

// 1k = 1024; a body's size as its characters.
const bytes = (v: string) => {
  const m = /^(\d+(?:\.\d+)?)([km]?)$/.exec(v);
  return m ? Number(m[1]) * (m[2] === 'k' ? 1024 : m[2] === 'm' ? 1024 ** 2 : 1) : Number.NaN;
};
// A term that can filter yet: a value, and for a size or a status one it reads.
function readable(t: SearchTerm): boolean {
  if (!t.value) return false;
  if (t.key === 'larger-than') return Number.isFinite(bytes(t.value));
  return t.key !== 'status-code' || /^\d+$/.test(t.value);
}

export function parseSearch(q: string): SearchTerm[] {
  return q.split(/\s+/).filter(Boolean).map((word): SearchTerm => {
    const not = word.startsWith('-');
    const bare = not ? word.slice(1) : word;
    const at = bare.indexOf(':');
    const key = bare.slice(0, at).toLowerCase() as Key;
    return at > 0 && KEYS.has(key) ? { key, value: bare.slice(at + 1).toLowerCase(), not } : { key: 'word', value: bare.toLowerCase(), not };
  }).filter(readable);
}

function holds(c: RecordedCall, t: SearchTerm): boolean {
  switch (t.key) {
    case 'method': return c.method.toLowerCase() === t.value;
    case 'status-code': return String(c.status ?? '') === t.value;
    case 'domain': return globMatches(t.value, hostOf(c.url));
    case 'mime-type': return (c.responseType ?? '').toLowerCase().startsWith(t.value);
    case 'larger-than': return (c.responseBody?.length ?? 0) > bytes(t.value);
    case 'word': return `${c.method} ${c.url} ${c.status ?? ''}`.toLowerCase().includes(t.value);
  }
}

export const matchesSearch = (c: RecordedCall, terms: SearchTerm[]) => terms.every((t) => holds(c, t) !== t.not);

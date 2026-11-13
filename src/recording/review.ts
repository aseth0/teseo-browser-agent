// The review of a recording (sidepanel/RecordingReview): what starts unticked, a call's values, and
// hiding one under a name (••••[name], for a tool's {{secret:name}}).
import { hideValue, type RecordedCall, type Recording } from './recording';
import { reasonsOf, resolved } from './sensitive';
import { hostOf, plural } from '../core/util';
import { jsonLeaves, queryLeaves } from './variables';

// The calls that look sensitive (a ⚠ not resolved by hiding) start unticked: the user ticks them.
export const initialTicks = (r: Recording): Recording => ({
  ...r,
  calls: r.calls.map((c) => (resolved(reasonsOf(c, c.headerNames), r.hidden) ? c : { ...c, included: false })),
});

// Every value of a call, to hide one: its query, what it sent, what it got.
export const valuesOf = (c: RecordedCall): { where: 'query' | 'sent' | 'answer'; key: string; value: string }[] => [
  ...queryLeaves(c.url).map((l) => ({ where: 'query' as const, key: l.path, value: l.value })),
  ...jsonLeaves(c.requestBody).map((l) => ({ where: 'sent' as const, key: l.path, value: l.value })),
  ...jsonLeaves(c.responseBody).map((l) => ({ where: 'answer' as const, key: l.path, value: l.value })),
];

export const hideNamed = (r: Recording, value: string, name: string): Recording => {
  const hidden = hideValue(r, value);
  return name ? { ...hidden, hiddenNames: { ...hidden.hiddenNames, [value]: name } } : hidden;
};

// sessionToken → session Token: a camelCase name's words apart (joined by `by`).
const splitCamel = (s: string, by: string) => s.replace(/([a-z0-9])([A-Z])/g, `$1${by}$2`);
const snake = (s: string) => splitCamel(s, '_').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase();
const GENERIC = /^(number|id|value|code|key|token)$/i;

// The name proposed for a hidden value, from its key: card.number → card_number, sessionToken → session_token.
export function defaultName(key: string): string {
  const parts = key.split('.').map((p) => p.replace(/\[\d+\]/g, '')).filter(Boolean);
  const last = parts.at(-1) ?? 'value';
  return snake(GENERIC.test(last) && parts.length > 1 ? `${parts.at(-2)}_${last}` : last) || 'value';
}

// A value better not saved for a tool, by its key's words: a password, a card's code, a PIN.
const RISKY = new Set(['password', 'passwd', 'pass', 'pwd', 'cvv', 'cvc', 'pin', 'otp']);
export const riskyKey = (key: string) =>
  splitCamel(key, ' ').toLowerCase().split(/[^a-z0-9]+/).some((word) => RISKY.has(word));

// The sites a recording's calls went to, each with how many, most first (equal ones in the order met).
export function domainsOf(calls: RecordedCall[]): { host: string; calls: number }[] {
  const counts = new Map<string, number>();
  for (const c of calls) {
    const host = hostOf(c.url) || c.url;
    counts.set(host, (counts.get(host) ?? 0) + 1);
  }
  return [...counts].map(([host, n]) => ({ host, calls: n })).sort((a, b) => b.calls - a.calls);
}

// The calls whose sensitive values (a ⚠, not a header note) are not all hidden: ticked, and not.
function sensitiveCalls(r: Recording): { ticked: number; unticked: number } {
  const open = r.calls.filter((c) => !resolved(reasonsOf(c, c.headerNames), r.hidden));
  return { ticked: open.filter((c) => c.included).length, unticked: open.filter((c) => !c.included).length };
}

// "⚠ 1 ticked call looks sensitive · 1 sensitive call unticked · 2 hidden"; `warn`: a ticked one is.
export function privacySummary(r: Recording): { text: string; warn: boolean } {
  const { ticked, unticked } = sensitiveCalls(r);
  const parts = [
    ticked && `⚠ ${plural(ticked, 'ticked call looks', 'ticked calls look')} sensitive`,
    unticked && plural(unticked, 'sensitive call unticked', 'sensitive calls unticked'),
    r.hidden.length && `${r.hidden.length} hidden`,
  ].filter(Boolean);
  return { text: parts.length ? parts.join(' · ') : 'Nothing looks sensitive', warn: ticked > 0 };
}

// 950, 6.2k, 30k: a size in characters, short.
export const shortChars = (n: number) => (n < 1000 ? String(n) : `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`);

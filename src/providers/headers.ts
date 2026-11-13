// Request headers: Bearer auth plus user-defined extra headers, where "{{apiKey}}"
// is replaced by the key. If an extra header uses the key, Bearer auth is skipped
// (gateways that expect e.g. "api-key: <key>").
import { API_KEY_PLACEHOLDER, fillApiKey } from '../core/util';

// Extra headers as typed in Settings (a JSON object): its texts, and its numbers and yes/no as text,
// as they would be sent; anything else (an object, a list, null) is no header.
export const headerValues = (v: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(Object.entries(v).flatMap(([k, x]) => (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean' ? [[k, String(x)]] : [])));

export function buildHeaders(apiKey: string | undefined, extra: Record<string, unknown> | undefined): Record<string, string> {
  const entries = Object.entries(headerValues(extra ?? {}));
  const usesKey = entries.some(([, v]) => v.includes(API_KEY_PLACEHOLDER));
  return {
    'Content-Type': 'application/json',
    ...(apiKey && !usesKey && { Authorization: `Bearer ${apiKey}` }),
    ...Object.fromEntries(entries.map(([k, v]) => [k, fillApiKey(v, apiKey)])),
  };
}

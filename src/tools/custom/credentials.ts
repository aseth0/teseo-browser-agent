// What looks like a credential in a request a user pasted or wrote: by its name (a query or body
// key: "api_key", "X-Amz-Signature", "private_token") or by its value (a JWT, a provider's key
// prefix, a long random string). It errs on the side of a key: a value taken for one is kept as a
// saved value, which the user can set back to fixed.

// Words of a name that make it a credential's ("access_key": "key").
const WORDS = new Set([
  'key', 'keys', 'apikey', 'appid', 'appkey', 'token', 'secret', 'pass', 'passwd', 'password', 'pwd', 'passphrase',
  'auth', 'authorization', 'sig', 'signature', 'credential', 'credentials', 'session', 'sessionid', 'sid', 'jwt', 'bearer', 'otp',
]);
// Names that are one only on their own (an OAuth code, not "country_code").
const WHOLE = new Set(['code']);

// The words of a name: "X-Amz-Signature" → x, amz, signature; "accessToken" → access, token.
const wordsOf = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

// A word that ends as one does, written together: "accesstoken", "authkey", "hapikey", "secretkey".
const ENDS = /(key|token|secret|passw(or)?d|pwd|signature)$/;

export function isCredentialName(name: string): boolean {
  const words = wordsOf(name);
  return WHOLE.has(words.join('')) || words.some((w) => WORDS.has(w) || ENDS.test(w));
}

// Bits per character: a random key has many, a word or an id few.
function entropy(text: string): number {
  const counts = new Map<string, number>();
  for (const c of text) counts.set(c, (counts.get(c) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) bits -= (n / text.length) * Math.log2(n / text.length);
  return bits;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JWT = /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/;
const KEY_PREFIX = /^(sk|pk|rk|ghp|gho|ghs|ghu|glpat|xox[abprs]|AKIA|AIza)[-_A-Za-z0-9]{8,}/;

export function isCredentialValue(value: string): boolean {
  const v = value.trim();
  if (JWT.test(v) || KEY_PREFIX.test(v) || /^(Bearer|Basic|Token)\s+\S{8,}/i.test(v)) return true;
  if (v.length < 24 || UUID.test(v) || /^\d+$/.test(v) || !/^[A-Za-z0-9_\-+/=.~%]+$/.test(v)) return false;
  return /\d/.test(v) && /[A-Za-z]/.test(v) && entropy(v) >= 3.5;
}

export const isCredential = (name: string, value: string) => isCredentialName(name) || isCredentialValue(value);

// A part of a URL's path that is a key: one that looks like one, or a bot's token
// ("bot123456:ABC-DEF…", as some chat APIs put it in the path).
export function isCredentialSegment(segment: string): boolean {
  let text = segment;
  try {
    text = decodeURIComponent(segment);
  } catch { /* as written */ }
  return /^bot\d+:[A-Za-z0-9_-]{20,}$/.test(text) || isCredentialValue(text);
}

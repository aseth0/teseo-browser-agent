// What looks sensitive in a recorded call (the review's ⚠): a secret-looking key, a card number, an
// email, a phone number, a long token, in what it sent, its query or its answer; as notes (ⓘ, never
// blocking), an IP address there and the headers it sent that carry the user's sign-in (by name only:
// their values are never kept).
import { HIDDEN, NAMED_PARTS, SECRET_KEY, type RecordedCall } from './recording';
import { jsonLeaves, queryLeaves } from './variables';

export type Reason =
  | { kind: 'secret-key' | 'card' | 'email' | 'phone' | 'token' | 'unread'; where: string; value: string } // unread: a body with named parts the review cannot read (its value: the whole body)
  | { kind: 'ip' | 'auth-header' | 'cookie-header'; where: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[\d ().-]{9,20}$/;
const JWT = /^[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}$/;
const LONG_TOKEN = /^(?:[A-Fa-f0-9]{32,}|[A-Za-z0-9+/_-]{32,}={0,2})$/;

// The Luhn check, on 13 to 19 digits (spaces and dashes allowed). Not 13 starting with 1: a timestamp in
// milliseconds, one in ten of which would pass the check (no card network gives such numbers).
function isCard(value: string): boolean {
  if (!/^[\d -]+$/.test(value)) return false;
  const digits = value.replace(/[ -]/g, '');
  if (digits.length < 13 || digits.length > 19 || /^1\d{12}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

const digitsIn = (v: string) => v.replace(/\D/g, '').length;

// A key's words: phoneNumber, phone_number → phone, number.
const wordsOf = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
// A word of a key that says phone (phones, telephone_number); and keys that say it only on their own
// ("number", "contact": orderNumber and contactId are ids).
const PHONE_WORDS = new Set(['phone', 'tel', 'telephone', 'mobile', 'msisdn', 'cell', 'cellphone', 'cellular', 'landline', 'fax', 'whatsapp', 'gsm', 'sms']);
const PHONE_KEYS = new Set(['number', 'contact', 'num']);
const phoneWord = (w: string) => PHONE_WORDS.has(w) || PHONE_WORDS.has(w.replace(/s$/, '')) || w.endsWith('phone'); // phones; sms stays sms
const phoneKey = (key: string) => PHONE_KEYS.has(key.toLowerCase()) || wordsOf(key).some(phoneWord);

// A phone by its shape, not any run of digits: a leading +, digits in groups (dots only as in
// 06.12.34.56.78, not a date or time such as 2026.11.02.14.30), or bare digits under a phone-like key.
// Timestamps and numeric ids are bare digits.
function isPhone(key: string, v: string): boolean {
  if (!PHONE.test(v) || digitsIn(v) < 9 || digitsIn(v) > 15) return false;
  if (/^(19|20)\d\d\./.test(v)) return false;
  if (phoneKey(key) || v.startsWith('+')) return true;
  if (/^\d+$/.test(v)) return false;
  if (/^[\d.]+$/.test(v)) return v.split('.').length >= 3 && v.split('.').every((g) => g.length >= 2 && g.length <= 4);
  return /^\(?\d[\d ().-]*\d$/.test(v);
}

// An IPv4 or IPv6 address.
function isIp(v: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return v.split('.').every((n) => Number(n) <= 255);
  if (!/^[\da-f:.]+$/i.test(v) || (v.match(/:/g) ?? []).length < 2) return false;
  try {
    return new URL(`http://[${v}]/`).hostname !== '';
  } catch {
    return false;
  }
}

export function reasonOf(key: string, value: string): Reason['kind'] | undefined {
  const v = value.trim();
  if (!v || v.includes(HIDDEN)) return undefined;
  if (key === '(body)') return NAMED_PARTS.test(v) ? 'unread' : undefined;
  // The key's last name: an item of a list (phones[0]) goes by the list's.
  const last = key.split(/[.[\]]/).filter((p) => p && !/^\d+$/.test(p)).at(-1) ?? key;
  if (SECRET_KEY.test(last)) return 'secret-key';
  if (isCard(v)) return 'card';
  if (EMAIL.test(v)) return 'email';
  if (isIp(v)) return 'ip';
  if (isPhone(last, v)) return 'phone';
  if (JWT.test(v) || LONG_TOKEN.test(v)) return 'token';
  return undefined;
}

export function reasonsOf(call: RecordedCall, headerNames: string[] = []): Reason[] {
  const out: Reason[] = [];
  const add = (place: string, leaves: { path: string; value: string }[]) => {
    for (const { path, value } of leaves) {
      const kind = reasonOf(path, value);
      const where = `${place}: ${path}`;
      if (kind === 'ip') out.push({ kind, where });
      else if (kind) out.push({ kind, where, value });
    }
  };
  add('query', queryLeaves(call.url));
  add('sent', jsonLeaves(call.requestBody));
  add('answer', jsonLeaves(call.responseBody));
  for (const name of headerNames) {
    if (/^authorization$/i.test(name)) out.push({ kind: 'auth-header', where: `header: ${name}` });
    else if (/^cookie$/i.test(name)) out.push({ kind: 'cookie-header', where: `header: ${name}` });
  }
  return out;
}

// The reasons as the review lists them: the same kind under the same key (array items alike) once,
// with how many. Every value still counts for `resolved`.
export function grouped(reasons: Reason[]): { kind: Reason['kind']; where: string; count: number }[] {
  const out = new Map<string, { kind: Reason['kind']; where: string; count: number }>();
  for (const r of reasons) {
    const where = r.where.replace(/\[\d+\]/g, '[]');
    const seen = out.get(`${r.kind} ${where}`);
    if (seen) seen.count++;
    else out.set(`${r.kind} ${where}`, { kind: r.kind, where, count: 1 });
  }
  return [...out.values()];
}

// Every value behind a ⚠ hidden: the call may go. Notes (an IP, the headers) never block.
export const resolved = (reasons: Reason[], hidden: string[]) => reasons.every((r) => !('value' in r) || hidden.includes(r.value));

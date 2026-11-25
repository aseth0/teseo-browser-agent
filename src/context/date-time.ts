// Settings → About you → Date & time: each of your messages ends with when you wrote it, in a tag the
// system prompt explains (system.time), formatted from the parts you chose: "Wednesday, 25 November
// 2026, 10:42 (Europe/Madrid, UTC+01:00)". Written once, when the message goes (a context part kept with
// it, as a mention's note is), so it is the same on every later request of the conversation and the
// provider's prompt cache holds; a setting changed later applies to the messages sent from then on.
// A task for another agent (agents.ask) ends with one too.
import type { ContextItem } from '../core/messages';
import { text } from '../core/model-texts';
import type { Message } from '../core/types';
import type { DateTimeSettings } from '../storage/settings-types';
import { MESSAGE_TIME_SOURCE } from './sources';

export const DATE_TIME_DEFAULTS = { weekday: true, date: true, time: true, zone: true } as const;
export type DateTimeParts = { [K in keyof typeof DATE_TIME_DEFAULTS]: boolean };

export const dateTimePartsOf = (s: DateTimeSettings | undefined): DateTimeParts => ({
  weekday: s?.weekday ?? DATE_TIME_DEFAULTS.weekday,
  date: s?.date ?? DATE_TIME_DEFAULTS.date,
  time: s?.time ?? DATE_TIME_DEFAULTS.time,
  zone: s?.zone ?? DATE_TIME_DEFAULTS.zone,
});

// Whether anything is sent: with every part off, no stamp and no line in the system prompt.
export const sendsDateTime = (s: DateTimeSettings | undefined) => Object.values(dateTimePartsOf(s)).some(Boolean);

// The browser's time zone, as it is now.
export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// The zone the stamp is in: the one picked, else (none, or one this browser does not know) the browser's.
export const timeZoneOf = (s: DateTimeSettings | undefined) => (s?.timeZone && isTimeZone(s.timeZone) ? s.timeZone : browserTimeZone());

// The zones the list offers: those the browser knows, UTC among them.
export function timeZones(): string[] {
  const known = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return known.includes('UTC') ? known : [...known, 'UTC'];
}

// "UTC+01:00", "UTC-03:30", "UTC+00:00": the zone's offset at that moment.
export function utcOffset(at: number, zone: string): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const offset = name.replace(/^(GMT|UTC)/, '');
  return `UTC${offset || '+00:00'}`;
}

// The moment with the parts chosen, in English whatever the browser's language; "" with none.
export function formatMoment(at: number, parts: DateTimeParts, zone: string): string {
  const field = (options: Intl.DateTimeFormatOptions, type: Intl.DateTimeFormatPartTypes) =>
    new Intl.DateTimeFormat('en-US', { timeZone: zone, ...options }).formatToParts(at).find((p) => p.type === type)?.value ?? '';
  const pieces: string[] = [];
  if (parts.weekday) pieces.push(field({ weekday: 'long' }, 'weekday'));
  if (parts.date) pieces.push(`${field({ day: 'numeric' }, 'day')} ${field({ month: 'long' }, 'month')} ${field({ year: 'numeric' }, 'year')}`);
  if (parts.time) {
    const clock = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const;
    pieces.push(`${field(clock, 'hour')}:${field(clock, 'minute')}`);
  }
  const head = pieces.join(', ');
  if (!parts.zone) return head;
  const where = `${zone}, ${utcOffset(at, zone)}`;
  return head ? `${head} (${where})` : where;
}

// The stamp as Settings has it, for a message written at `at` (Date.now()); "" when nothing is sent.
export function messageTime(at: number, s: DateTimeSettings | undefined): string {
  const moment = formatMoment(at, dateTimePartsOf(s), timeZoneOf(s));
  return moment && text('time.stamp', { message_time: moment });
}

// What a message gets at its end; none when nothing is sent.
export function messageTimeItem(at: number, s: DateTimeSettings | undefined): ContextItem | undefined {
  const stamp = messageTime(at, s);
  return stamp ? { kind: 'tool', source: MESSAGE_TIME_SOURCE, text: stamp } : undefined;
}

// Whether a message has its stamp already (it is never written twice).
export const hasMessageTime = (m: Message | undefined) => !!m?.parts.some((p) => p.type === 'text' && p.source === MESSAGE_TIME_SOURCE);

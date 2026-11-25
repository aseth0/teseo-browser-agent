// Settings → About you → Date & time (context/date-time): the stamp at the end of each of your messages,
// formatted from the parts chosen, in the browser's zone or one picked; written once, so every later
// request of the conversation carries it the same (the provider's prompt cache holds), through compaction.
import { afterEach, describe, expect, it } from 'vitest';
import { browserTimeZone, dateTimePartsOf, formatMoment, hasMessageTime, messageTime, messageTimeItem, sendsDateTime, timeZoneOf, timeZones, utcOffset } from '../src/context/date-time';
import { modelView } from '../src/context/compaction';
import { pieceLabel } from '../src/context/pieces';
import { appendContext } from '../src/core/messages';
import { setTextOverrides } from '../src/core/model-texts';
import type { Message } from '../src/core/types';
import { toOpenAIMessages } from '../src/providers/wire';

// Wednesday 25 November 2026, 09:42 UTC.
const AT = Date.UTC(2026, 10, 25, 9, 42);
const ALL = { weekday: true, date: true, time: true, zone: true };
const fmt = (parts: Partial<typeof ALL>, zone = 'Europe/Madrid', at = AT) => formatMoment(at, { weekday: false, date: false, time: false, zone: false, ...parts }, zone);

afterEach(() => setTextOverrides({}));

describe('the moment as the model reads it', () => {
  it('has every part by default, in English, 24-hour, with the zone and its offset', () => {
    expect(dateTimePartsOf(undefined)).toEqual(ALL);
    expect(fmt(ALL)).toBe('Wednesday, 25 November 2026, 10:42 (Europe/Madrid, UTC+01:00)');
    expect(messageTime(AT, { timeZone: 'Europe/Madrid' })).toBe('<message_time>Wednesday, 25 November 2026, 10:42 (Europe/Madrid, UTC+01:00)</message_time>');
  });

  it('keeps only the parts switched on, each combination joined the same way', () => {
    expect(fmt({ weekday: true })).toBe('Wednesday');
    expect(fmt({ date: true })).toBe('25 November 2026');
    expect(fmt({ time: true })).toBe('10:42');
    expect(fmt({ zone: true })).toBe('Europe/Madrid, UTC+01:00');
    expect(fmt({ weekday: true, date: true })).toBe('Wednesday, 25 November 2026');
    expect(fmt({ weekday: true, time: true })).toBe('Wednesday, 10:42');
    expect(fmt({ date: true, time: true })).toBe('25 November 2026, 10:42');
    expect(fmt({ time: true, zone: true })).toBe('10:42 (Europe/Madrid, UTC+01:00)');
    expect(fmt({ weekday: true, zone: true })).toBe('Wednesday (Europe/Madrid, UTC+01:00)');
    expect(fmt({ weekday: true, date: true, time: true })).toBe('Wednesday, 25 November 2026, 10:42');
    expect(fmt({ date: true, time: true, zone: true })).toBe('25 November 2026, 10:42 (Europe/Madrid, UTC+01:00)');
    expect(fmt({})).toBe('');
  });

  it('with every part off, sends nothing: no stamp, no item', () => {
    const off = { weekday: false, date: false, time: false, zone: false };
    expect(sendsDateTime(off)).toBe(false);
    expect(sendsDateTime({ ...off, zone: true })).toBe(true);
    expect(sendsDateTime(undefined)).toBe(true);
    expect(messageTime(AT, off)).toBe('');
    expect(messageTimeItem(AT, off)).toBeUndefined();
  });

  it('is in the zone picked, its offset as it is on that day (summer time), else the browser\'s', () => {
    expect(fmt(ALL, 'America/New_York')).toBe('Wednesday, 25 November 2026, 04:42 (America/New_York, UTC-05:00)');
    expect(fmt(ALL, 'Asia/Kolkata')).toBe('Wednesday, 25 November 2026, 15:12 (Asia/Kolkata, UTC+05:30)');
    expect(fmt(ALL, 'UTC')).toBe('Wednesday, 25 November 2026, 09:42 (UTC, UTC+00:00)');
    expect(utcOffset(Date.UTC(2026, 6, 1, 12), 'Europe/Madrid')).toBe('UTC+02:00');
    expect(timeZoneOf({ timeZone: 'Asia/Tokyo' })).toBe('Asia/Tokyo');
    expect(timeZoneOf({})).toBe(browserTimeZone());
    // A zone this browser does not know: the browser's.
    expect(timeZoneOf({ timeZone: 'Nowhere/Atlantis' })).toBe(browserTimeZone());
    expect(timeZones()).toContain('UTC');
    expect(timeZones()).toContain('Europe/Madrid');
  });

  it('turns the day at midnight in the zone, not in UTC', () => {
    // 23:30 UTC on the 25th is 00:30 on the 26th in Madrid, and still the 25th in New York.
    const late = Date.UTC(2026, 10, 25, 23, 30);
    expect(fmt({ weekday: true, date: true, time: true }, 'Europe/Madrid', late)).toBe('Thursday, 26 November 2026, 00:30');
    expect(fmt({ weekday: true, date: true, time: true }, 'America/New_York', late)).toBe('Wednesday, 25 November 2026, 18:30');
    expect(fmt({ time: true }, 'UTC', Date.UTC(2026, 10, 25, 0, 0))).toBe('00:00');
  });

  it('turns the year at midnight in the zone', () => {
    const newYearUtc = Date.UTC(2026, 11, 31, 23, 15);
    expect(fmt({ weekday: true, date: true, time: true }, 'Europe/Madrid', newYearUtc)).toBe('Friday, 1 January 2027, 00:15');
    expect(fmt({ weekday: true, date: true, time: true }, 'UTC', newYearUtc)).toBe('Thursday, 31 December 2026, 23:15');
    expect(fmt({ date: true }, 'Pacific/Kiritimati', Date.UTC(2026, 11, 31, 10))).toBe('1 January 2027');
  });

  it('uses the text as edited in Prompt preview', () => {
    setTextOverrides({ 'time.stamp': '[sent {message_time}]' });
    expect(messageTime(AT, { timeZone: 'UTC', zone: false })).toBe('[sent Wednesday, 25 November 2026, 09:42]');
  });
});

describe('the stamp in a conversation', () => {
  const stamped = (history: Message[], at: number) => appendContext(history, [messageTimeItem(at, { timeZone: 'Europe/Madrid' })!]);
  const userContents = (history: Message[]) => toOpenAIMessages(undefined, modelView(undefined, history).messages).filter((m) => m.role === 'user').map((m) => m.content);

  it('ends your message, hidden in the chat, labelled for the views', () => {
    const [m] = stamped([{ role: 'user', parts: [{ type: 'text', text: 'What day is it?' }] }], AT);
    expect(hasMessageTime(m)).toBe(true);
    const part = m!.parts.at(-1)!;
    expect(part).toMatchObject({ type: 'text', context: 'tool', source: 'message-time' });
    expect(part.type === 'text' && pieceLabel(part)).toBe('Message time');
    expect(userContents([m!])).toEqual(['What day is it?\n<message_time>Wednesday, 25 November 2026, 10:42 (Europe/Madrid, UTC+01:00)</message_time>']);
    expect(hasMessageTime({ role: 'user', parts: [{ type: 'text', text: 'hi' }] })).toBe(false);
  });

  it('goes the same in every later request: earlier ones are a prefix of the next, whatever the setting now', () => {
    let history = stamped([{ role: 'user', parts: [{ type: 'text', text: 'first' }] }], AT);
    const first = userContents(history);
    history = [...history, { role: 'assistant', parts: [{ type: 'text', text: 'ok' }] }];
    // 90 minutes later, with the weekday switched off meanwhile: only the new message follows the new setting.
    history = appendContext([...history, { role: 'user', parts: [{ type: 'text', text: 'second' }] }], [messageTimeItem(AT + 90 * 60_000, { timeZone: 'Europe/Madrid', weekday: false })!]);
    const second = userContents(history);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe('second\n<message_time>25 November 2026, 12:12 (Europe/Madrid, UTC+01:00)</message_time>');
    // The same history again: byte for byte.
    expect(JSON.stringify(toOpenAIMessages('sys', modelView('sys', history).messages))).toBe(JSON.stringify(toOpenAIMessages('sys', modelView('sys', history).messages)));
  });

  it('is not lost to compaction: the message it is on, and those after it, keep theirs', () => {
    const turn = (n: number): Message[] => [
      ...stamped([{ role: 'user', parts: [{ type: 'text', text: `q${n}` }] }], AT + n * 60_000),
      { role: 'assistant', parts: [{ type: 'text', text: `a${n}` }] },
    ];
    const history = [...turn(1), ...turn(2), ...turn(3)];
    // Summarized up to the third turn: the first two go as the summary.
    const compacted = history.map((m, i) => (i === 4 ? { ...m, compaction: { at: AT, before: 100, after: 10, summary: 'Earlier turns.', turns: 2, trimmed: { pages: true, toolResults: true, screenshots: true, replies: true, toolArgs: true, attached: true } } } : m));
    const users = userContents(compacted);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatch(/q3\n<message_time>Wednesday, 25 November 2026, 10:45 \(Europe\/Madrid, UTC\+01:00\)<\/message_time>$/);
  });
});

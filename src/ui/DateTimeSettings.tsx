// Settings → About you → Date & time (context/date-time): what the model is told of when each of your
// messages was written, part by part, in the browser's time zone or one picked; and the line as it goes.
import { useEffect, useState } from 'react';
import { browserTimeZone, dateTimePartsOf, isTimeZone, messageTime, timeZones, type DateTimeParts } from '../context/date-time';
import type { DateTimeSettings } from '../storage/settings-types';
import type { Settings } from '../storage/settings';
import { Switch } from './Collection';
import { PageModelTexts } from './PageModelTexts';
import type { SettingsPatch } from './useSettings';

const PARTS: [keyof DateTimeParts, string, string][] = [
  ['weekday', 'Day of the week', 'Wednesday'],
  ['date', 'Date', '25 November 2026'],
  ['time', 'Time', '10:42, 24-hour clock'],
  ['zone', 'Time zone', 'Its name and its offset from UTC: Europe/Madrid, UTC+01:00'],
];

// Now, again every 30 seconds: the example follows the clock.
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function DateTimeTab({ settings, onChange }: { settings: Settings; onChange: SettingsPatch }) {
  const now = useNow();
  const saved = settings.dateTime ?? {};
  const parts = dateTimePartsOf(saved);
  // Stored only when changed from the default: a part off is false, the browser's zone none.
  const set = (patch: Partial<DateTimeSettings>) => {
    const next = Object.fromEntries(Object.entries({ ...saved, ...patch }).filter(([, v]) => v !== undefined)) as DateTimeSettings;
    onChange({ dateTime: Object.keys(next).length ? next : undefined });
  };
  const picked = saved.timeZone;
  const unknown = picked && !isTimeZone(picked);
  const example = messageTime(now, saved);
  return (
    <>
      <p className="hint">
        Each message you send ends with when you wrote it, so the model knows the date, the time, and how long ago your earlier messages
        were. It is written once, when the message goes, and sent the same from then on: a change here applies to the messages you send
        after it. Not shown in the chat.
      </p>
      <ul className="switch-rows" aria-label="What the model is told">
        {PARTS.map(([key, label, about]) => (
          <li key={key}>
            <div><strong>{label}</strong><span className="hint">{about}</span></div>
            <Switch checked={parts[key]} label={label} onChange={(on) => set({ [key]: on ? undefined : false })} />
          </li>
        ))}
        <li>
          <div><strong>In the time zone</strong><span className="hint">The browser&apos;s is read each time a message goes; another one keeps the date and time in that zone wherever you are</span></div>
          <select aria-label="Time zone" value={picked ?? ''} onChange={(e) => set({ timeZone: e.target.value || undefined })}>
            <option value="">Browser ({browserTimeZone()})</option>
            {unknown && <option value={picked}>{picked} (unknown here)</option>}
            {timeZones().map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </li>
      </ul>
      {unknown && <p className="hint over-limit">This browser does not know {picked}: the browser&apos;s zone is used.</p>}
      <div className="date-time-example">
        <div className="field-label">As the model gets it now</div>
        {example ? <pre className="widget-text" aria-label="Example">{example}</pre> : <p className="hint">Nothing: with every part off, the model is told neither the date nor the time.</p>}
      </div>
      <PageModelTexts page="about-you" />
    </>
  );
}

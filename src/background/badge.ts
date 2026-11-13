// The toolbar icon's badge, from its sources: DBG while the DevTools engine's debugger is attached
// (devtools/cdp); a tab's audio, its minutes (background/audio-host); and a recording's count
// (background/recording-host), which wins over those. Red while it records, gray once stopped. Over
// them all, "!" while something waits for the user and the chat is not in view (background/alerts).
import { browser } from 'wxt/browser';
import { bestEffort } from '../core/errors';

type Recording = { state: 'recording' | 'stopped'; calls: number };
type Audio = { state: 'capturing' | 'stopped'; minutes: number };

const RED = '#d93025';
const GRAY = '#5f6368';
const AMBER = '#e37400';

export function badgeOf(debuggerTabs: number, rec?: Recording, audio?: Audio, waiting = false): { text: string; color?: string } {
  if (waiting) return { text: '!', color: AMBER };
  if (rec) return { text: rec.calls > 999 ? '999+' : String(rec.calls), color: rec.state === 'recording' ? RED : GRAY };
  if (audio) return { text: `${Math.min(audio.minutes, 999)}m`, color: audio.state === 'capturing' ? RED : GRAY };
  return { text: debuggerTabs ? 'DBG' : '' };
}

let debuggerTabs = 0;
let recording: Recording | undefined;
let audio: Audio | undefined;
let waiting = false;

export function setBadgePart(part: 'debugger', tabs: number): void;
export function setBadgePart(part: 'recording', rec: Recording | undefined): void;
export function setBadgePart(part: 'audio', audio: Audio | undefined): void;
export function setBadgePart(part: 'waiting', on: boolean): void;
export function setBadgePart(part: 'debugger' | 'recording' | 'audio' | 'waiting', value: number | boolean | Recording | Audio | undefined): void {
  if (part === 'debugger') debuggerTabs = value as number;
  else if (part === 'recording') recording = value as Recording | undefined;
  else if (part === 'waiting') waiting = value as boolean;
  else audio = value as Audio | undefined;
  const { text, color } = badgeOf(debuggerTabs, recording, audio, waiting);
  void bestEffort(browser.action.setBadgeText({ text }), 'badge');
  if (color) void bestEffort(browser.action.setBadgeBackgroundColor({ color }), 'badge');
}

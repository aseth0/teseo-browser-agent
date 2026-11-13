// A tab's audio, captured from the toolbar popup's Audio line or its shortcut (background/audio-host) in
// the offscreen document (audio/offscreen), which keeps it, and its transcript (audio/transcript), until
// it is discarded or another starts. Where it goes once stopped (AudioTo): the review page
// (entrypoints/audio), the chat, or nowhere (the file only, not transcribed).
// From the extension's pages to the background: AUDIO_START { tabId, windowId, to } → started, or why
// not; AUDIO_STOP; AUDIO_DISCARD; AUDIO_REVIEW (opens the review page); AUDIO_TO_CHAT { tabId, windowId }
// (the transcript into the chat for that tab, opened inside the click).
// From the extension's pages to the offscreen document: AUDIO_FILE → the recording's blob URL and file
// name; AUDIO_TRANSCRIPT → the transcript; AUDIO_EDIT { key, text }; AUDIO_RETRY { n } (a failed chunk again).
// Between the background and the offscreen document: AUDIO_CAPTURE { streamId, name, maxMs, transcribe?, waves? }
// → its start time, or why not; AUDIO_END → its size; AUDIO_DROP; AUDIO_HELD → what it holds (a worker
// that woke checks); AUDIO_ENDED from it, when the tab's stream ends by itself (the tab closed) or the
// time is up. AUDIO_CHANGED from it, to every page: the transcript changed (how far it is). AUDIO_LEVEL
// { level } from it, every fifth of a second with waves on: the sound level.
// Between the background and the pill on the captured page (recording/pill): AUDIO_PILL_STOP, its Stop;
// AUDIO_PILL { off } that it goes, { lines } the last ones transcribed, { level } the sound level.
import type { AudioTo, ProviderConfig, TabAudioView } from '../storage/settings-types';
import { clock, type AttachLine, type Transcript } from './transcript';

export type { AudioTo } from '../storage/settings-types';

export const AUDIO_START = 'browser-agent:audio-start';
export const AUDIO_STOP = 'browser-agent:audio-stop';
export const AUDIO_DISCARD = 'browser-agent:audio-discard';
export const AUDIO_REVIEW = 'browser-agent:audio-review';
export const AUDIO_TO_CHAT = 'browser-agent:audio-to-chat';
export const AUDIO_FILE = 'browser-agent:audio-file';
export const AUDIO_TRANSCRIPT = 'browser-agent:audio-transcript';
export const AUDIO_EDIT = 'browser-agent:audio-edit';
export const AUDIO_RETRY = 'browser-agent:audio-retry';
export const AUDIO_CAPTURE = 'browser-agent:audio-capture';
export const AUDIO_END = 'browser-agent:audio-end';
export const AUDIO_DROP = 'browser-agent:audio-drop';
export const AUDIO_HELD = 'browser-agent:audio-held';
export const AUDIO_ENDED = 'browser-agent:audio-ended';
export const AUDIO_CHANGED = 'browser-agent:audio-changed';
export const AUDIO_LEVEL = 'browser-agent:audio-level';
export const AUDIO_PILL = 'browser-agent:audio-pill';
export const AUDIO_PILL_STOP = 'browser-agent:audio-pill-stop';

// The manifest's command (wxt.config.ts).
export const AUDIO_COMMAND = 'audio-toggle';

export const AUDIO_TO_DEFAULT: AudioTo = 'review';
export const audioToOf = (v: unknown): AudioTo => (v === 'chat' || v === 'file' || v === 'review' ? v : AUDIO_TO_DEFAULT);

// The model that transcribes it (voice/settings tabAudioTarget).
export interface AudioTranscriber {
  provider: ProviderConfig;
  model: string;
  chunkSeconds: number;
  language?: string; // none: detected
  prompt?: string; // the user's vocabulary
  temperature?: number; // none: not sent
  silenceLevel?: number; // none: voice/session SILENCE_LEVEL
}
// How far its transcript is: chunks still out, chunks that failed, and whether every one is back.
export interface AudioProgress {
  sending: number;
  failed: number;
  done: boolean;
}

export type AudioMessage =
  | { type: typeof AUDIO_START; tabId: number; windowId: number; to: AudioTo }
  | { type: typeof AUDIO_STOP }
  | { type: typeof AUDIO_DISCARD }
  | { type: typeof AUDIO_REVIEW }
  | { type: typeof AUDIO_TO_CHAT; tabId: number; windowId: number }
  | { type: typeof AUDIO_FILE }
  | { type: typeof AUDIO_TRANSCRIPT }
  | { type: typeof AUDIO_EDIT; key: string; text: string }
  | { type: typeof AUDIO_RETRY; n: number }
  | { type: typeof AUDIO_CAPTURE; streamId: string; name: string; maxMs: number; transcribe?: AudioTranscriber; waves?: boolean }
  | { type: typeof AUDIO_END }
  | { type: typeof AUDIO_DROP }
  | { type: typeof AUDIO_HELD }
  | { type: typeof AUDIO_ENDED }
  | { type: typeof AUDIO_CHANGED; progress: AudioProgress }
  | { type: typeof AUDIO_LEVEL; level: number }
  | { type: typeof AUDIO_PILL; off?: true; lines?: string[]; level?: number }
  | { type: typeof AUDIO_PILL_STOP };

export interface AudioReplies {
  [AUDIO_START]: { started: true } | { error: string; settings?: 'voice' }; // settings: where what is missing is set
  [AUDIO_STOP]: Record<string, never>;
  [AUDIO_DISCARD]: void;
  [AUDIO_REVIEW]: void;
  [AUDIO_TO_CHAT]: Record<string, never> | { error: string };
  [AUDIO_FILE]: { url: string; name: string } | { error: string };
  [AUDIO_TRANSCRIPT]: { transcript: Transcript } | { error: string };
  [AUDIO_EDIT]: void;
  [AUDIO_RETRY]: void;
  [AUDIO_CAPTURE]: { startedAt: number } | { error: string };
  [AUDIO_END]: { size: number } | { error: string };
  [AUDIO_DROP]: void;
  [AUDIO_HELD]: { held: 'capturing' | 'stopped' | 'none' };
  [AUDIO_ENDED]: void;
  [AUDIO_CHANGED]: void;
  [AUDIO_LEVEL]: void;
  [AUDIO_PILL]: void;
  [AUDIO_PILL_STOP]: Record<string, never>;
}

// storage.session: what is captured, or kept once stopped (absent: nothing), for the popup, the badge
// and the review page.
export const AUDIO_STATUS = 'audioStatus';
export interface AudioStatus {
  state: 'capturing' | 'stopped';
  tabId: number;
  windowId: number;
  site: string;
  startedAt: number;
  endedAt?: number;
  size?: number; // bytes, once stopped
  to?: AudioTo; // none (an older build's): the file only
  view?: TabAudioView; // what its pill shows (none: the time and Stop)
  progress?: AudioProgress; // being transcribed, or transcribed
  sent?: boolean; // its transcript handed to the chat
}

// The transcript for the chat's message box, handed (core/handoff) under capture/protocol's CHAT_ATTACH:
// its name, the site, its length in seconds and its lines (core/texts 'audio.block').
export interface AudioAttach {
  name: string;
  site: string;
  seconds: number;
  lines: AttachLine[];
}
export type AudioPayload = AudioAttach & { kind: 'audio' };
export function isAudioPayload(v: unknown): v is AudioPayload {
  const a = v as Partial<AudioPayload> | null;
  const isLine = (l: unknown) => {
    const x = l as Record<string, unknown> | null;
    return !!x && typeof x.at === 'number' && (typeof x.text === 'string' || (x.gap === true && typeof x.to === 'number'));
  };
  return !!a && a.kind === 'audio' && typeof a.name === 'string' && typeof a.site === 'string' && typeof a.seconds === 'number' && Array.isArray(a.lines) && a.lines.every(isLine);
}

// What its chip in the message box says: "Audio of video.example.test (4:02)".
export const audioName = (site: string, seconds: number) => `Audio of ${site || 'a tab'} (${clock(seconds)})`;

// "audio-video.example.test-2026-11-01-1432.webm", in local time.
export function audioFileName(site: string, at: number): string {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, '0');
  const place = site.replace(/[^a-z0-9.-]+/gi, '-') || 'tab';
  return `audio-${place}-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}.webm`;
}

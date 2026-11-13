// Speak: text read aloud by a text-to-speech model, one reading at a time (background/speech-host), its
// requests and playback in the offscreen document (speech/player), which outlives the side panel and a
// change of tab. A new reading replaces the one in progress.
// From the extension's pages (the side panel, Settings' Test, the popup) and the page widget to the
// background: SPEAK_TEXT { text, agentId?, profileId?, profile?, tabId?, key?, queued? } → started once the
// first piece's clip is back (queued: waiting its turn), or why not; SPEAK_STOP; SPEAK_UNQUEUE { prefix }, the
// readings that wait with that key dropped. A text still being written (an answer as it streams) is read
// `growing`: started with its first final piece (speech/growing), then SPEAK_GROW { key, text, done? } with
// the whole text so far, until it is done; the background sends the new final pieces on (SPEAK_MORE). A page's widget may name neither an agent nor a profile:
// its selection is read with the active agent's, on its own tab; a box of an action's card (action, box)
// with the voice of the action's agent.
// Between the background and the offscreen document: SPEAK_PLAY { run, pieces, target } → once the first
// clip is back, or why not; SPEAK_HALT; SPEAK_HELD → the reading it holds (a worker that woke checks);
// SPEAK_PROGRESS { run, piece, total, playing } and SPEAK_ENDED { run, error? } from it.
// Between the background and the pill on the page (speech/pill): SPEAK_PILL { off } or { text };
// SPEAK_PILL_STOP, its Stop.
import type { VoiceProfile } from '../storage/settings-types';
import type { PlannedPiece } from './plan';
import type { SpeechTarget } from './settings';

export const SPEAK_TEXT = 'browser-agent:speak-text';
export const SPEAK_STOP = 'browser-agent:speak-stop';
export const SPEAK_PLAY = 'browser-agent:speak-play';
export const SPEAK_HALT = 'browser-agent:speak-halt';
export const SPEAK_HELD = 'browser-agent:speak-held';
export const SPEAK_PROGRESS = 'browser-agent:speak-progress';
export const SPEAK_ENDED = 'browser-agent:speak-ended';
export const SPEAK_PILL = 'browser-agent:speak-pill';
export const SPEAK_PILL_STOP = 'browser-agent:speak-pill-stop';
export const SPEAK_UNQUEUE = 'browser-agent:speak-unqueue';
export const SPEAK_GROW = 'browser-agent:speak-grow';
export const SPEAK_MORE = 'browser-agent:speak-more';

// The tool an agent whose switch is on is offered (speech/tool, background/run-setup).
export const SAY_TOOL = 'speech.say';

// The manifest's command (wxt.config.ts): reads the page's selection, or stops what is being read.
export const SPEAK_COMMAND = 'speak-toggle';

// What a reading is of, for the button that started it to show Stop: "message:<id>", "selection", "test".
export type SpeakKey = string;

export type SpeechMessage =
  | { type: typeof SPEAK_TEXT; text: string; agentId?: string; profileId?: string; profile?: VoiceProfile; tabId?: number; key?: SpeakKey; action?: string; box?: number; queued?: boolean; growing?: boolean }
  | { type: typeof SPEAK_STOP }
  | { type: typeof SPEAK_GROW; key: SpeakKey; text: string; done?: boolean }
  | { type: typeof SPEAK_UNQUEUE; prefix: string }
  | { type: typeof SPEAK_PLAY; run: string; pieces: PlannedPiece[]; target: SpeechTarget; done?: boolean }
  | { type: typeof SPEAK_MORE; run: string; pieces: PlannedPiece[]; done: boolean }
  | { type: typeof SPEAK_HALT }
  | { type: typeof SPEAK_HELD }
  | { type: typeof SPEAK_PROGRESS; run: string; piece: number; total: number; playing: boolean }
  | { type: typeof SPEAK_ENDED; run: string; error?: string }
  | { type: typeof SPEAK_PILL; off?: true; text?: string; key?: SpeakKey; waiting?: SpeakKey[] }
  | { type: typeof SPEAK_PILL_STOP };

export type SpeakStarted = { started: true; queued?: true } | { error: string; settings?: 'speak' };

export interface SpeechReplies {
  [SPEAK_TEXT]: SpeakStarted;
  [SPEAK_STOP]: Record<string, never>;
  [SPEAK_UNQUEUE]: Record<string, never>;
  [SPEAK_GROW]: Record<string, never>;
  [SPEAK_MORE]: void;
  [SPEAK_PLAY]: { ok: true } | { error: string };
  [SPEAK_HALT]: void;
  [SPEAK_HELD]: { run?: string };
  [SPEAK_PROGRESS]: void;
  [SPEAK_ENDED]: void;
  [SPEAK_PILL]: void;
  [SPEAK_PILL_STOP]: Record<string, never>;
}

// storage.session: the reading in progress (absent: none), for the pill, the popup and the panel's buttons.
export const SPEAK_STATUS = 'speakStatus';
export interface SpeakStatus {
  run: string;
  state: 'preparing' | 'reading'; // waiting for a clip, or one playing
  piece: number; // the one playing (from 1), or the next one
  total: number;
  tabId?: number; // where its pill is
  key?: SpeakKey;
  startedAt: number;
  cut?: true; // the text was longer than Settings → Limits allows at a time: only its start is read
  system?: true; // read by the system's voice (speech/system-voice), not a profile's
  waiting?: SpeakKey[]; // the readings on their own that wait their turn after it, in order
}

// What the pill and the popup say: "Preparing…", "Reading 2 of 5", "Reading".
export const speakText = (s: Pick<SpeakStatus, 'state' | 'piece' | 'total' | 'cut' | 'waiting'>): string =>
  `${s.state === 'preparing' ? 'Preparing…' : s.total > 1 ? `Reading ${s.piece} of ${s.total}` : 'Reading'}${s.cut ? ' · only its start (Limits)' : ''}${s.waiting?.length ? ` · ${s.waiting.length} more waiting` : ''}`;

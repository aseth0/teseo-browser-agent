// Dictation in the chat floating on a page (sidepanel/useDictation, ui/floating-frame FLOATING). A web
// page decides who may use the microphone in its frames (its Permissions-Policy, and the prompt named
// after it), so the floating chat does not open the microphone itself: the offscreen document
// (voice/offscreen) records and transcribes there, with the extension's own permission, the one
// mic.html grants, and hands the texts back. The side panel and the other chats record in their page.
// From the floating chat to the background: DICTATION_OFFSCREEN → the offscreen document open, or why not.
// Between the floating chat and the offscreen document, a port (DICTATION_PORT), one dictation each:
// DictationStart → `started`, or `failed` (the error's name, for voice/mic micProblem, and its text);
// then `text`, each chunk's in recording order, and `end` once stopped and every chunk's text is in;
// meanwhile `level`, the sound level, five times a second while it records, and `pending`, the chunks
// out being transcribed, as it changes, and `stopping` as it stops, by itself too (silence, a failed
// chunk), before its last chunks are in (for the message box's strip, sidepanel/DictationStrip);
// `stop` from the chat. The port closed by either side (the frame gone: closed, its page navigated,
// its tab closed; the extension reloaded) drops the dictation: the microphone off, its requests aborted.
import type { ProviderConfig } from '../storage/settings';
import type { SessionEnd } from './session';

export const DICTATION_OFFSCREEN = 'browser-agent:dictation-offscreen';
export const DICTATION_PORT = 'browser-agent:dictation';

export type VoiceMessage = { type: typeof DICTATION_OFFSCREEN };
export interface VoiceReplies {
  [DICTATION_OFFSCREEN]: Record<string, never> | { error: string };
}

// What a dictation records and sends (voice/settings voiceTarget, its model chosen). JSON on the wire:
// `silenceStopMs` none for never (Infinity would arrive as null).
export interface DictationStart {
  type: 'start';
  provider: ProviderConfig;
  model: string;
  deviceId?: string;
  chunkMs: number;
  language?: string;
  vocabulary?: string;
  temperature?: number;
  silenceLevel: number;
  silenceStopMs?: number;
}

export type DictationToOffscreen = DictationStart | { type: 'stop' };
export type DictationToChat =
  | { type: 'started' }
  | { type: 'failed'; name?: string; error: string }
  | { type: 'text'; text: string }
  | { type: 'level'; level: number }
  | { type: 'pending'; count: number }
  | { type: 'stopping' }
  | { type: 'end'; end: SessionEnd };

// What a recorded tab sends (recording/page-hooks): an answer the page got, as JSON text, under the
// recording's key; and, in a tabs-and-mouse recording through DevTools, a step the user took
// (content/steps). Both to the background (recording/webrequest, recording/devtools).
import type { CaptureMode } from './devtools';
import type { RecordedStep } from './step-types';

// The background's recorder (background/recording-host), from the extension's pages only: the toolbar
// popup's Record line. Start → started, or a stopped one waits for review, or why not. Stop → the chat
// for the recorded tab opens, inside the click, and gets it. Review: the chat for the tab the user is on
// opens for the one waiting (the recorded tab may be gone).
export const RECORDING_START = 'browser-agent:recording-start';
export const RECORDING_STOP = 'browser-agent:recording-stop';
export const RECORDING_REVIEW = 'browser-agent:recording-review';
export const RECORDING_DISCARD = 'browser-agent:recording-discard';
// From the pill on a recorded page (recording/pill), inside the click on its Stop; and to it, its count
// or that it goes (`off`).
export const RECORDING_PILL_STOP = 'browser-agent:recording-pill-stop';
export const RECORDING_PILL = 'browser-agent:recording-pill';

export type RecordingMessage =
  | { type: 'recording-answer'; key: string; answer: string }
  | { type: 'recording-step'; key: string; step: Omit<RecordedStep, 'tabId'> }
  | { type: typeof RECORDING_START; tabId: number; windowId: number; mode: CaptureMode; presetId?: string }
  | { type: typeof RECORDING_STOP }
  | { type: typeof RECORDING_REVIEW; tabId: number; windowId: number }
  | { type: typeof RECORDING_DISCARD }
  | { type: typeof RECORDING_PILL_STOP }
  | { type: typeof RECORDING_PILL; calls?: number; leftOut?: number; startedAt?: number; off?: boolean };

export interface RecordingReplies {
  'recording-answer': void;
  'recording-step': void;
  [RECORDING_START]: { started: true } | { waiting: true } | { error: string };
  [RECORDING_STOP]: Record<string, never>;
  [RECORDING_REVIEW]: { opened: boolean };
  [RECORDING_DISCARD]: void;
  [RECORDING_PILL_STOP]: { opened: boolean };
  [RECORDING_PILL]: void;
}

// The background's one recording (recording/recorder), as the chats, the popup and the badge see it:
// its status, and the stopped recording waiting for a chat to review it, both in storage.session.
import { handoff, isHandoff, type Handoff, type HandoffTo } from '../core/handoff';
import type { CaptureMode } from './devtools';
import type { Recording } from './recording';

// What is recording, or waiting for review (absent: nothing).
export const RECORDING_STATUS = 'recordingStatus';
export interface RecordingStatus {
  state: 'recording' | 'stopped';
  tabId: number; // the tab it started on
  windowId: number;
  tabs: number[]; // every tab it recorded
  site: string;
  calls: number;
  leftOut: number;
  startedAt: number;
  endedAt?: number;
  preset: string; // its name
  mode: CaptureMode;
}

// A stopped recording for a chat's review, a handoff (core/handoff) taken by that chat, which removes
// it. It waits at most RECORDING_WAIT_MS (longer than the rest: a review of another may be on): past
// that the recorder and the chats drop it, so that its bodies do not stay in storage.session for the session.
export const RECORDING_HANDOFF = 'recordingHandoff';
export const RECORDING_WAIT_MS = 30 * 60_000;
export interface RecordingPayload {
  kind: 'recording';
  recording: Recording;
}
export type RecordingHandoff = Handoff<RecordingPayload>;
export function isRecordingPayload(v: unknown): v is RecordingPayload {
  if (!v || typeof v !== 'object') return false;
  const r = (v as Record<string, unknown>).recording as Record<string, unknown> | undefined;
  return (v as Record<string, unknown>).kind === 'recording' && !!r && typeof r.tabId === 'number' && Array.isArray(r.calls) && Array.isArray(r.hidden);
}
export const isRecordingHandoff = (v: unknown): v is RecordingHandoff => isHandoff(v, isRecordingPayload);
export const recordingHandoff = (recording: Recording, to: HandoffTo, at = Date.now()): RecordingHandoff => handoff({ kind: 'recording', recording }, to, at);

// What has been caught so far, while it records: what a restarted worker turns into a stopped one.
export const RECORDING_LIVE = 'recordingLive';

// The manifest's command (wxt.config.ts) that starts or stops it.
export const RECORDING_COMMAND = 'record-toggle';

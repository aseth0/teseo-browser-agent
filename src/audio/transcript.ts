// A tab's audio as it is transcribed (audio/offscreen keeps it): its chunks, of the length chosen
// (Settings → Voice), numbered as recorded; each one back is a line per segment the server timed, or one line for the
// whole chunk where it gives none. A silent chunk is not sent and has no part. The user's edits
// (the review page) go on top, by line, and a chunk sent again drops its own.
import { TAB_CHUNK_SECONDS } from '../voice/settings';
import type { TimedText } from '../voice/transcribe';

export interface TranscriptLine {
  at: number; // seconds from the start
  text: string;
}
export type TranscriptPart = { n: number } & ({ state: 'sending' } | { state: 'done'; lines: TranscriptLine[] } | { state: 'failed'; error: string });

export interface Transcript {
  parts: TranscriptPart[]; // by their number
  edits: Record<string, string>; // lineKey → the line as edited (empty: left out)
  done: boolean; // stopped, and every chunk is back
  chunkSeconds: number;
}

export const emptyTranscript = (chunkSeconds = TAB_CHUNK_SECONDS.default): Transcript => ({ parts: [], edits: {}, done: false, chunkSeconds });
export const lineKey = (n: number, i: number) => `${n}:${i}`;
export const partStart = (t: { chunkSeconds: number }, n: number) => n * t.chunkSeconds;

// A chunk's reply as its lines, timed from the start of the audio.
export function linesOf(n: number, chunkSeconds: number, reply: { text: string; segments?: TimedText[] }): TranscriptLine[] {
  const from = n * chunkSeconds;
  if (reply.segments?.length) return reply.segments.map((s) => ({ at: from + s.start, text: s.text }));
  return reply.text ? [{ at: from, text: reply.text }] : [];
}

export function withPart(t: Transcript, part: TranscriptPart): Transcript {
  const edits = Object.fromEntries(Object.entries(t.edits).filter(([key]) => !key.startsWith(`${part.n}:`)));
  return { ...t, parts: [...t.parts.filter((p) => p.n !== part.n), part].sort((a, b) => a.n - b.n), edits };
}

export function progressOf(t: Transcript): { sending: number; failed: number } {
  return { sending: t.parts.filter((p) => p.state === 'sending').length, failed: t.parts.filter((p) => p.state === 'failed').length };
}

// What goes to the chat (core/texts 'audio.block'): the lines as edited, and for each chunk not
// transcribed (failed, or still out) the stretch it covers, within the audio's length.
export type AttachLine = { at: number; text: string } | { at: number; to: number; gap: true };
export function attachLines(t: Transcript, seconds: number): AttachLine[] {
  return t.parts.flatMap((p): AttachLine[] => {
    if (p.state !== 'done') return [{ at: partStart(t, p.n), to: Math.min(partStart(t, p.n + 1), Math.max(partStart(t, p.n), seconds)), gap: true }];
    return p.lines.flatMap((l, i) => {
      const text = (t.edits[lineKey(p.n, i)] ?? l.text).trim();
      return text ? [{ at: l.at, text }] : [];
    });
  });
}

// As Copy text gives it: a line each, after its time.
export const transcriptText = (lines: AttachLine[]): string =>
  lines.map((l) => ('gap' in l ? `[${clock(l.at)}–${clock(l.to)}: not transcribed]` : `[${clock(l.at)}] ${l.text}`)).join('\n');

// What the pill on the page shows while it captures: the last lines back.
export function previewLines(t: Transcript, seconds: number, count = 3): string[] {
  const back = attachLines({ ...t, parts: t.parts.filter((p) => p.state !== 'sending') }, seconds).slice(-count);
  return back.map((l) => transcriptText([l]));
}

// "1:05", "1:02:03".
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const two = (n: number) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`;
}

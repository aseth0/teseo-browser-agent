// What the chat shows while a turn streams: the main agent's text and reasoning, and the sub-agents'
// runs (agents.ask). Shared by the side panel's state (useAgent) and the messages that show it (ui/).
import type { Message } from './types';

// What is being streamed right now, in arrival order (reasoning, then text, ...).
export type LiveSegment = { kind: 'reasoning' | 'text'; text: string };

export function appendLive(segments: LiveSegment[], kind: LiveSegment['kind'], text: string): LiveSegment[] {
  const last = segments[segments.length - 1];
  if (last?.kind === kind) return [...segments.slice(0, -1), { kind, text: last.text + text }];
  return [...segments, { kind, text }];
}

// A sub-agent's run while it goes (agents.ask), by the call it answers: its messages so far and what
// it is streaming. Once it answers, the call's result keeps the whole run (trace).
export interface SubRun {
  agent: string;
  messages: Message[];
  live: LiveSegment[];
}

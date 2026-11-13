// What the chat's message views read from above them: how to show the steps, the sub-agents running,
// and what the chat can do with its messages.
import { createContext } from 'react';
import { DISPLAY_DEFAULTS, type DisplayValues } from '../../core/display-defs';
import type { LiveSegment, SubRun } from '../../core/live';
import type { Message, Part } from '../../core/types';
import type { ChatView, TurnDiagramKind } from '../../storage/settings-types';

// How the chat shows reasoning and tool calls (Settings → Appearance); defaults where not provided.
export const ChatViewContext = createContext<ChatView>({});

// What the chat shows of each element (Settings → Display), each at the value it shows with
// (storage/settings-select displayValues); the defaults where not provided.
export const DisplayContext = createContext<DisplayValues>(DISPLAY_DEFAULTS);

// What the model streams now, for what shows it as it comes without the chat re-rendering on every
// token (a running turn's diagram); none where nothing streams. The side panel's live source fits it.
interface LiveSegments {
  get(): { segments: LiveSegment[] };
}
export const LiveContext = createContext<LiveSegments | undefined>(undefined);

// The sub-agents running, by the call they answer (core/live).
export const SubRunsContext = createContext<Record<string, SubRun>>({});

// What a sub-agent is doing now, for the chat's waiting line: "🤖 Todoist · running browser__find…".
export function subRunStatus(run: SubRun): string {
  const last = run.messages.at(-1);
  const call = last?.role === 'assistant' ? last.parts.find((p): p is Extract<Part, { type: 'tool_call' }> => p.type === 'tool_call') : undefined;
  const doing =
    run.live.at(-1)?.kind === 'reasoning' ? 'thinking…'
    : run.live.length ? 'writing…'
    : call ? `running ${call.name}…`
    : 'working…';
  return `${run.agent} · ${doing}`; // the chat puts the agent icon before it
}

// What the chat can do with its messages: regenerate from one (none in a preview, which only shows
// them).
interface ChatActions {
  busy: boolean;
  regenerate?: (from: Message) => void;
  openMemory?: () => void; // the memory panel, from a message's memory chip
  pickDiagram?: (kind: TurnDiagramKind) => void; // remember the kind picked on a turn's diagram, for the next ones
  speak?: SpeakButtons; // read an answer aloud (the side panel, while Speak is on)
}
// What the speak buttons do: whether the text of `key` is being read, read it with the voice of
// `agentId` (none: Browser) or stop it, and what the last one could not do.
export interface SpeakButtons {
  speaking: (key: string) => boolean;
  toggle: (key: string, text: string, agentId: string | undefined) => void;
  failed: string;
  // Read on its own (an answer as its turn ends), after what is read now; why it was not, by its key.
  // `growing`: its text is still written (SPEAK_GROW follows).
  readOnItsOwn?: (key: string, text: string, agentId: string | undefined, o?: { growing?: boolean }) => void;
  notRead?: (key: string) => string | undefined;
}
export const ChatActionsContext = createContext<ChatActions>({ busy: false });

// Which of your messages ↑ ↓ brought back to the composer: on its own, so that only your messages'
// text re-renders as it moves.
export const RecalledContext = createContext<Message | undefined>(undefined);

export const stepsOf = (view: ChatView) => view.steps ?? 'grouped';

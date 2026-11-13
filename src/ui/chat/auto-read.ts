// An answer read aloud on its own as its turn ends (Settings → Speak → Reading → Answers read on their own),
// where the chat is: floating on a page, in the side panel (or a tab), or in the Agents Panel. What is read
// is what its 🔊 reads; it waits its turn behind a reading in progress (speech/session's queue).
import { stripMarks } from '../../core/model-texts';
import type { Message } from '../../core/types';
import { speakable } from '../../speech/markdown';
import type { Settings } from '../../storage/settings';
import { turnsOf } from './turns';

export type ChatPlace = 'floating' | 'panel' | 'manager';

// Whether answers are read on their own here; in the Agents Panel, 'shown' only while this chat is the
// one shown (`shown`).
export function readsAnswers(s: Pick<Settings, 'speak'>, place: ChatPlace | undefined, shown: () => boolean): boolean {
  const auto = s.speak?.autoRead;
  if (!place || !auto) return false;
  if (place === 'manager') return auto.manager === 'all' || (auto.manager === 'shown' && shown());
  return auto[place] === true;
}

// What its 🔊 reads: the text of the answer, without Markdown marks or code blocks.
export const answerSpeech = (answer: Message): string => speakable(stripMarks(answer.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')));

// The answer the last turn ended with, to read: none when it ended with no answer, or the user stopped it.
export function answerToRead(history: Message[]): { answer: Message; text: string; agentId?: string } | undefined {
  const turn = turnsOf(history).at(-1);
  if (!turn?.answer || turn.messages.at(-1)?.stopped) return undefined;
  const text = answerSpeech(turn.answer);
  return text.trim() ? { answer: turn.answer, text, ...(turn.user?.agent && { agentId: turn.user.agent }) } : undefined;
}

// The model's own text and reasoning, as the chat shows them (ui/chat/MessageView, ToolCallView).
import { useContext, useMemo } from 'react';
import type { TextFormat } from '../../storage/settings-types';
import { markdownToJira } from '../jira-markup';
import { Markdown } from '../Markdown';
import { ChatViewContext, stepsOf } from './contexts';

// Open while the model is still thinking, then collapsed; or always open, or not shown. With the
// steps grouped it does not open while thinking: it would push the answer down.
export function Reasoning({ text, active }: { text: string; active: boolean }) {
  const view = useContext(ChatViewContext);
  const mode = view.reasoning ?? 'collapsed';
  if (mode === 'hidden') return null;
  const openWhileThinking = active && stepsOf(view) === 'inline';
  return (
    <details className="reasoning" open={openWhileThinking || mode === 'expanded' || undefined}>
      <summary>{active ? 'Thinking…' : 'Thought process'}</summary>
      <div className="reasoning-text">{text.trim()}</div>
    </details>
  );
}

// The model's text, as Markdown, exactly as it came, or as Jira markup.
export function AssistantText({ text, format }: { text: string; format: TextFormat }) {
  const raw = useMemo(() => (format === 'jira' ? markdownToJira(text) : text.trim()), [text, format]);
  return format === 'markdown' ? <div className="msg assistant"><Markdown text={text} foldable /></div> : <div className="msg assistant raw">{raw}</div>;
}

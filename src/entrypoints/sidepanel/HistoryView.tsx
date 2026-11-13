import { memo } from 'react';
import type { ToolInfo } from '../../core/protocol';
import type { Message } from '../../core/types';
import type { ChatRender } from '../../storage/settings-types';
import { ChatHistory, type ToolResultPart } from '../../ui/ChatMessages';
import { ConversationJson } from './ConversationJson';
import { TechHistory } from './TechHistory';

// The conversation so far. Memoized: streamed text and typing in the composer re-render the chat
// many times a second, and these only change with the history (or the view).
export const HistoryView = memo(function HistoryView(props: {
  render: ChatRender;
  history: Message[];
  results: Map<string, ToolResultPart>;
  running: boolean;
  toolCatalog: ToolInfo[];
}) {
  const { render, history, results, running } = props;
  if (render === 'tech') return <TechHistory history={history} results={results} running={running} toolCatalog={props.toolCatalog} />;
  if (render === 'diagrams') return <ChatHistory history={history} results={results} running={running} format="markdown" diagrams />;
  return <ChatHistory history={history} results={results} running={running} format={render} />;
});

export const ConversationJsonView = memo(ConversationJson);

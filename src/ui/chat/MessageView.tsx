// One message as the chat shows it: user and model text, reasoning, and tool calls with their result
// nested inside (a sub-agent's run inside its call, made of messages again).
import { memo, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Options } from 'react-markdown';
import { shownText } from '../../core/messages';
import { dataUrlOf, type Message, type Part } from '../../core/types';
import type { TextFormat } from '../../storage/settings-types';
import { remarkBreaks, remarkMentions, type Mentioned } from '../../markdown/user';
import { Icon } from '../chat-icons';
import { Markdown } from '../Markdown';
import { AttachedChips } from './AttachedChips';
import { RecalledContext } from './contexts';
import { MentionChip, mentionsIn, withMentions } from './mentions';
import { AssistantText, Reasoning } from './MessageText';
// ToolCallView imports this file back: a call shows the run inside it (another agent's) as messages
// again. The two render each other; neither uses the other while it loads.
import { ToolCall } from './ToolCallView';
import type { ToolResultPart } from './turns';

// The spans remarkMentions made, as chips.
const MENTION_COMPONENTS: Options['components'] = {
  span: ({ node, ...props }) => {
    const trigger = node?.properties?.dataMention;
    return typeof trigger === 'string' ? <MentionChip trigger={trigger} name={String(props.children ?? '')} /> : <span {...props} />;
  },
};

// Your text, marked while ↑ ↓ show it in the composer: as Markdown, its line breaks kept and what it
// mentions that was attached as chips; or as written, with the chips, when the chat is shown plain.
// Memoized: the chat renders again at each streamed token, and its Markdown would be parsed again.
const UserText = memo(function UserText({ message, text, mentioned, format }: { message: Message; text: string; mentioned?: Mentioned; format: TextFormat }) {
  const recalled = useContext(RecalledContext) === message;
  const remark = useMemo(() => [...(mentioned ? [[remarkMentions, mentioned] as const] : []), remarkBreaks] as Options['remarkPlugins'], [mentioned]);
  const markdown = format === 'markdown';
  return (
    <div className={`msg ${message.role}${markdown ? ' rendered' : ''}${recalled ? ' recalled' : ''}`}>
      {markdown ? <Markdown text={text} remarkPlugins={remark} components={MENTION_COMPONENTS} /> : mentioned ? withMentions(text, mentioned) : text}
    </div>
  );
});

type MessageViewProps = { message: Message; results: Map<string, ToolResultPart>; running: boolean; format?: TextFormat; trailing?: ReactNode; chips?: boolean };

// The results map is made again with each change of the history: equal when the results of this
// message's calls are the same.
const sameView = (a: MessageViewProps, b: MessageViewProps) =>
  a.message === b.message && a.running === b.running && a.format === b.format && a.trailing === b.trailing && a.chips === b.chips &&
  (a.results === b.results || a.message.parts.every((p) => p.type !== 'tool_call' || a.results.get(p.id) === b.results.get(p.id)));

// `trailing` goes at the end of its last line: in the row of its last tool call, else under it.
// `chips`: false when what went with it is shown elsewhere (a user message: in its buttons' row).
// Memoized: each message added re-renders the conversation, and the earlier ones' Markdown would be
// parsed again (messages are not changed in place: a new one is a new object).
export const MessageView = memo(function MessageView(props: MessageViewProps) {
  const { message, results, running, format = 'markdown', trailing, chips = true } = props;
  // What it mentions that was attached (::site/view, /skill, $tool, #conversation): shown as chips in
  // the text; what went with it otherwise, after it (AttachedChips).
  const mentioned = useMemo(() => mentionsIn(message.parts.map((p) => (p.type === 'text' ? p.source : undefined))), [message.parts]);
  const lastCall = message.parts.at(-1)?.type === 'tool_call' ? message.parts.length - 1 : -1;
  return (
    <>
      {message.parts.map((p, i) => {
        switch (p.type) {
          case 'text':
            if (p.context || !p.text.trim()) return null;
            // As the chat is shown (Markdown, plain, Jira); your text as Markdown or as written.
            return message.role === 'assistant' ? (
              <AssistantText key={i} text={p.text} format={format} />
            ) : (
              <UserText key={i} message={message} text={shownText(p)} mentioned={mentioned} format={format} />
            );
          case 'reasoning':
            return p.text ? <Reasoning key={i} text={p.text} active={false} /> : null;
          case 'image':
            return <UserImage key={i} image={p} />;
          case 'tool_call':
            return <ToolCall key={i} id={p.id} name={p.name} args={p.args} result={results.get(p.id)} running={running} trailing={i === lastCall ? trailing : undefined} />;
          default:
            return null; // tool results are rendered inside their call
        }
      })}
      {chips && <AttachedChips message={message} className="msg-auto-chips" />}
      {trailing && lastCall < 0 && <div className={`layer-chips ${message.role}`}>{trailing}</div>}
    </>
  );
}, sameView);

// An image you attached: small, larger on a click; one a saved conversation did not keep, said so.
function UserImage({ image }: { image: Extract<Part, { type: 'image' }> }) {
  const [large, setLarge] = useState(false);
  if (!image.data) return <div className="msg-image-gone" title="Saved conversations do not keep the images you attach"><Icon name="imageGone" /> image not kept</div>;
  return (
    <button type="button" className={`msg-image${large ? ' large' : ''}`} onClick={() => setLarge((l) => !l)} title={large ? 'Smaller' : 'Larger'}>
      <img src={dataUrlOf(image)} alt="Your image" />
    </button>
  );
}

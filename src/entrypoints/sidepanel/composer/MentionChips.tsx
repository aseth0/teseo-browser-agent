// The mentions in the message box's text, as chips under it (sidepanel/MentionComposer).
import { Icon, type ChatIconName } from '../../../ui/chat-icons';
import type { InlineKind } from '../../../context/inline-mentions';
import { MENTION_PROBLEMS } from '../../../templates/mentions';
import { bookmarkDetail, conversationDetail } from './suggestions';
import type { MentionChipsIn } from './useMentionChips';

const INLINE_ICONS: Record<InlineKind, ChatIconName> = { skill: 'skill', tool: 'tool' };

const toolChipTitle = (name: string, props: { forceTool?: boolean; disabledTools?: string[] }) =>
  `${props.forceTool ? 'The model must call' : 'Asks the model to use'} ${name}` +
  (props.disabledTools?.includes(name) ? ' (off: offered for this message)' : '');

export function MentionChips({ chips, ...props }: { chips: MentionChipsIn; forceTool?: boolean; disabledTools?: string[] }) {
  const { mentions, inline, attached, marked } = chips;
  if (mentions.length + inline.length + attached.length + marked.length === 0) return null;
  return (
    <div className="mention-chips">
      {mentions.map((m) => (
        <span key={m.name} className={`skill-chip${m.problem ? ' warn' : ''}`} title={m.problem ? MENTION_PROBLEMS[m.problem] : `Reads ${m.view ? `the view "${m.view}"` : 'the view for its page'} of ${m.site} and attaches it to the message`}>
          <Icon name={m.problem ? 'error' : 'template'} size={12} /> {m.name}
        </span>
      ))}
      {inline.map((m) => (
        <span key={m.kind + m.name} className="skill-chip" title={m.kind === 'skill' ? `Loads the skill "${m.name}" for this message` : toolChipTitle(m.name, props)}>
          <Icon name={INLINE_ICONS[m.kind]} size={12} /> {m.name}
        </span>
      ))}
      {attached.map((c) => (
        <span key={c.id} className="skill-chip" title={`Attaches the saved conversation "${c.title}" (${conversationDetail(c)})`}>
          <Icon name="history" size={12} /> {c.title}
        </span>
      ))}
      {marked.map((b) => (
        <span key={b.id} className="skill-chip" title={`Attaches the bookmark "${b.title}" (${bookmarkDetail(b)})`}>
          <Icon name="bookmark" size={12} /> {b.title || b.url}
        </span>
      ))}
    </div>
  );
}

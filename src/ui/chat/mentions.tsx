// The mentions attached to a message (::site/view, /skill, $tool, #conversation, b::bookmark), shown as chips in its text.
import { Icon, type ChatIconName } from '../chat-icons';
import { Fragment } from 'react';
import { mentionedIn } from '../../context/inline-mentions';
import { bookmarkMentionOf, historyMentionOf, MENTION_SOURCE } from '../../context/sources';
import { MENTION_TOKEN, mentionOf, type Mentioned } from '../../markdown/user';

// The mentions a message's context says were attached, by their trigger, with the name each chip
// shows; none when there are none.
export function mentionsIn(sources: (string | undefined)[]): Mentioned | undefined {
  const named = (names: Iterable<string>) => new Map([...names].map((n) => [n, n]));
  const sites = named(sources.flatMap((s) => (s?.startsWith(MENTION_SOURCE) ? [s.slice(MENTION_SOURCE.length)] : [])));
  const { skill, tool } = mentionedIn(sources);
  const saved = new Map(sources.flatMap((s) => {
    const m = historyMentionOf(s);
    return m ? [[m.slug, m.title] as const] : [];
  }));
  const marks = new Map(sources.flatMap((s) => {
    const m = bookmarkMentionOf(s);
    return m ? [[m.slug, m.title] as const] : [];
  }));
  return sites.size + skill.size + tool.size + saved.size + marks.size ? { '::': sites, '/': named(skill), $: named(tool), '#': saved, 'b::': marks } : undefined;
}

const MENTION_CHIPS: Record<string, { icon: ChatIconName; title: string }> = {
  '::': { icon: 'template', title: 'Read and attached to the message' },
  '/': { icon: 'skill', title: 'Skill loaded for this message' },
  $: { icon: 'tool', title: 'Tool asked for in this message' },
  '#': { icon: 'history', title: 'Saved conversation attached' },
  'b::': { icon: 'bookmark', title: 'Bookmark attached' },
};

// An attached mention's chip, as the chat shows it in your text.
export function MentionChip({ trigger, name }: { trigger: string; name: string }) {
  const chip = MENTION_CHIPS[trigger];
  if (!chip) return <>{name}</>;
  return <span className="mention" title={chip.title}><Icon name={chip.icon} size={12} /> {name}</span>;
}

// The text with each attached mention ("::tasks/today", "/summarize-page", "$browser.find",
// "#find-the-cable") as a chip: your text as written (as Markdown, markdown/user remarkMentions).
export function withMentions(text: string, mentioned: Mentioned) {
  return text.split(MENTION_TOKEN).map((piece, i) => {
    const found = i % 2 ? mentionOf(piece, mentioned) : undefined;
    if (!found) return piece;
    return (
      <Fragment key={i}>
        <MentionChip trigger={found.trigger} name={mentioned[found.trigger]!.get(found.name)!} />
        {found.rest}
      </Fragment>
    );
  });
}

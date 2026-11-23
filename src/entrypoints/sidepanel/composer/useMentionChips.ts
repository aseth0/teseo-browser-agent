import { useMemo } from 'react';
import { bookmarkSlug, bookmarkSlugs, type Bookmark } from '../../../bookmarks/store';
import { agentNamed, parseInline, skillNamed, toolNamed } from '../../../context/inline-mentions';
import { slugOf } from '../../../context/sources';
import type { ToolInfo } from '../../../core/protocol';
import { historySlugs } from '../../../history/mention';
import type { ConversationMeta } from '../../../history/store';
import type { Skill } from '../../../skills/types';
import { parseMentions } from '../../../templates/mentions';
import type { PageTemplate } from '../../../templates/types';
import type { AskableAgent, Kind } from './suggestions';

export type MentionChipsIn = ReturnType<typeof useMentionChips>;

// The mentions in the message box's text, of the kinds that are on (`on`): parsed again only when the
// text or what they name changes.
export function useMentionChips(value: string, on: Record<Kind, boolean>, { templates, skills, tools, agents, conversations, bookmarks }: { templates: PageTemplate[]; skills: Skill[]; tools: ToolInfo[]; agents: AskableAgent[]; conversations: ConversationMeta[]; bookmarks: Bookmark[] }) {
  return useMemo(() => ({
    mentions: on.template ? parseMentions(value, templates) : [],
    inline: [
      ...(on.skill ? parseInline(value, 'skill', skillNamed(skills)) : []),
      ...(on.tool ? parseInline(value, 'tool', toolNamed(tools.map((t) => t.name))) : []),
      ...(on.agent ? parseInline(value, 'agent', agentNamed(agents)) : []),
    ],
    // The saved conversations mentioned (the latest with that title).
    attached: on.history ? historySlugs(value).flatMap((slug) => conversations.filter((c) => slugOf(c.title) === slug).slice(0, 1)) : [],
    // The bookmarks mentioned (the latest added with that title).
    marked: bookmarkSlugs(value).flatMap((slug) => bookmarks.filter((b) => bookmarkSlug(b) === slug).slice(0, 1)),
  }), [value, on, templates, skills, tools, agents, conversations, bookmarks]);
}

// What the message box suggests for the mention being typed (sidepanel/MentionComposer).
import { agentSlug, type InlineKind } from '../../../context/inline-mentions';
import { agentLabel } from '../../../agents/profiles';
import { slugOf } from '../../../context/sources';
import type { ToolInfo } from '../../../core/protocol';
import { bookmarkSlug, type Bookmark } from '../../../bookmarks/store';
import type { ConversationMeta } from '../../../history/store';
import type { Skill } from '../../../skills/types';
import type { PageTemplate } from '../../../templates/types';
import { shortTokens } from '../../../ui/Usage';

export interface Suggestion {
  label: string;
  detail: string;
  insert: string; // replaces the mention being typed
}

export type Kind = 'template' | InlineKind | 'history' | 'bookmark';

// The mention being typed right before the caret, if any: "::site" or "::site/view", "/skill",
// "$tool", "@agent", "#saved-conversation", "b::bookmark". Only at the start of a word, so "a/b", "std::x"
// or "someone@example.com" are not.
const TYPING: Record<Kind, RegExp> = {
  bookmark: /(?:^|\s)(b::([a-z0-9-]*))$/,
  template: /(?:^|\s)(::([a-z0-9-]*)(?:\/([a-z0-9-]*))?)$/,
  skill: /(?:^|\s)(\/([a-z0-9-]*))$/,
  tool: /(?:^|\s)(\$([\w.-]*))$/,
  agent: /(?:^|\s)(@([A-Za-z0-9-]*))$/,
  history: /(?:^|\s)(#([a-z0-9-]*))$/,
};

// `mention`: as written so far ("::site/vi"), what a suggestion replaces.
export interface Typing {
  kind: Kind;
  match: RegExpMatchArray;
  mention: string;
}

export function typingAt(before: string, on: Record<Kind, boolean>): Typing | undefined {
  for (const kind of Object.keys(TYPING) as Kind[]) {
    const match = on[kind] ? before.match(TYPING[kind]) : null;
    if (match) return { kind, match, mention: match[1] ?? '' };
  }
  return undefined;
}

function templateSuggestions([, , site = '', view]: RegExpMatchArray, templates: PageTemplate[]): Suggestion[] {
  const enabled = templates.filter((t) => t.enabled);
  if (view === undefined) {
    return enabled
      .filter((t) => t.name.startsWith(site))
      .map((t) => ({
        label: t.name,
        detail: `${t.matches.map(shownPattern).join(', ')} · ${t.views.length === 1 ? '1 view' : `${t.views.length} views`}`,
        insert: `::${t.name}/`,
      }));
  }
  const t = enabled.find((x) => x.name === site);
  return (t?.views ?? [])
    .filter((v) => v.name.startsWith(view))
    .map((v) => ({ label: v.name, detail: v.paths.join(', ') || 'block', insert: `::${site}/${v.name} ` }));
}

const MAX_SUGGESTIONS = 12;
export const LIST_LABELS: Record<Kind, string> = { template: 'Site mentions', skill: 'Skill mentions', tool: 'Tool mentions', agent: 'Agent mentions', history: 'Saved conversations', bookmark: 'Bookmarks' };

interface Sources {
  templates: PageTemplate[];
  skills: Skill[];
  tools: ToolInfo[];
  disabled: string[];
  agents: AskableAgent[];
  conversations: ConversationMeta[];
  bookmarks: Bookmark[];
}

// An agent @ offers: one the chat's agent may ask (agents/profiles callableAgents).
export type AskableAgent = { name: string; description: string; icon?: string };

export function suggestionsFor(typing: Typing | undefined, { templates, skills, tools, disabled, agents, conversations, bookmarks }: Sources): Suggestion[] {
  if (!typing) return [];
  const written = typing.match[2] ?? '';
  switch (typing.kind) {
    case 'template':
      return templateSuggestions(typing.match, templates);
    case 'skill':
      return skills
        .filter((s) => s.enabled && s.name.startsWith(written))
        .map((s) => ({ label: s.name, detail: s.description, insert: `/${s.name} ` }))
        .slice(0, MAX_SUGGESTIONS);
    case 'tool':
      return tools
        .filter((t) => t.name.startsWith(written))
        .map((t) => ({ label: t.name, detail: `${disabled.includes(t.name) ? '(off: offered for this message) ' : ''}${t.description}`, insert: `$${t.name} ` }))
        .slice(0, MAX_SUGGESTIONS);
    case 'agent': {
      const lower = written.toLowerCase(); // "@Todo" as "@todo"
      const words = lower.replace(/-/g, ' ');
      return agents
        .filter((a) => agentSlug(a.name) && (agentSlug(a.name).startsWith(lower) || a.name.toLowerCase().includes(words)))
        .map((a) => ({ label: agentLabel(a), detail: a.description.trim() || '(no description)', insert: `@${agentSlug(a.name)} ` }))
        .slice(0, MAX_SUGGESTIONS);
    }
    case 'history':
      return conversations
        .filter((c) => slugOf(c.title).startsWith(written) || c.title.toLowerCase().includes(written.replace(/-/g, ' ')))
        .map((c) => ({ label: c.title, detail: conversationDetail(c), insert: `#${slugOf(c.title)} ` }))
        .slice(0, MAX_SUGGESTIONS);
    case 'bookmark': {
      const words = written.replace(/-/g, ' ');
      return bookmarks
        .filter((b) => bookmarkSlug(b).startsWith(written) || b.title.toLowerCase().includes(words) || (b.url ?? '').toLowerCase().includes(words))
        .map((b) => ({ label: b.title || (b.url ?? ''), detail: bookmarkDetail(b), insert: `b::${bookmarkSlug(b)} ` }))
        .slice(0, MAX_SUGGESTIONS);
    }
  }
}

export const conversationDetail = (c: ConversationMeta) =>
  [new Date(c.updatedAt).toLocaleDateString(), c.site, c.tokens !== undefined && `${shortTokens(c.tokens)} tokens`].filter(Boolean).join(' · ');

export const bookmarkDetail = (b: Bookmark) => [b.path && `/${b.path}`, b.url].filter(Boolean).join(' · ');

// A site template's pattern as the suggestions show it: its host, else the pattern itself.
const shownPattern = (pattern: string) => pattern.match(/^[^:]+:\/\/([^/]+)/)?.[1] ?? pattern;

// The pieces a user message is sent with: what you typed and each block the extension attached
// (site skills, mentions, page values, site templates, the page block), named for the views (Layers).
// The attached ones carry a source saying what they are.
import type { Part } from '../core/types';
import {
  COMPACTION_PLAN_SOURCE,
  historyAutoOf,
  bookmarkAutoOf,
  bookmarkMentionOf,
  callCount,
  historyMentionOf,
  memoryMatchOf,
  MEMORY_CHANGES_SOURCE,
  MEMORY_SOURCE,
  memoryIndexOf,
  MENTION_FAILED_SOURCE,
  MENTION_SOURCE,
  NO_PAGE_SOURCE,
  USER_ELSEWHERE_SOURCE,
  PAGE_SOURCE,
  fileOf,
  recordingOf,
  SKILL_MENTION_SOURCE,
  SKILL_VALUES_SOURCE,
  slugOf,
  TEMPLATE_SOURCE,
  TOOL_MENTION_SOURCE,
} from './sources';

type TextPart = Extract<Part, { type: 'text' }>;

export function pieceLabel(p: TextPart): string {
  if (!p.context) return 'Your message';
  const s = p.source ?? '';
  const after = (prefix: string) => s.slice(prefix.length);
  if (s.startsWith(SKILL_MENTION_SOURCE)) return `Skill mention /${after(SKILL_MENTION_SOURCE)}`;
  if (s.startsWith(TOOL_MENTION_SOURCE)) return `Tool mention ${after(TOOL_MENTION_SOURCE).split(',').map((t) => `$${t}`).join(' ')}`;
  if (s.startsWith(MENTION_SOURCE)) return `Mention ::${after(MENTION_SOURCE)}`;
  if (s.startsWith(MENTION_FAILED_SOURCE)) return `Mention ::${after(MENTION_FAILED_SOURCE)} (not read)`;
  const auto = historyAutoOf(s);
  if (auto) return `Saved conversation (auto) #${slugOf(auto.title)} · ${auto.match}%`;
  const autoBookmark = bookmarkAutoOf(s);
  if (autoBookmark) return `Bookmark (auto) "${autoBookmark.title}" · ${autoBookmark.match}%`;
  const bookmark = bookmarkMentionOf(s);
  if (bookmark) return `Bookmark b::${bookmark.slug}`;
  const saved = historyMentionOf(s);
  if (saved) return `Saved conversation #${saved.slug}`;
  if (s.startsWith(TEMPLATE_SOURCE)) {
    const [name, view] = after(TEMPLATE_SOURCE).split('/');
    return `Site template "${name}"${view ? ` · ${view}` : ''}`;
  }
  if (s.startsWith(SKILL_VALUES_SOURCE)) return `Site skill values "${after(SKILL_VALUES_SOURCE)}"`;
  const matched = memoryMatchOf(s);
  if (matched) return `Memory (auto${matched.origin === 'step' ? ', between steps' : ''}) · ${matched.count} matched`;
  if (s.startsWith(MEMORY_SOURCE)) return `Memory for ${after(MEMORY_SOURCE)}`;
  const index = memoryIndexOf(s);
  if (index) return `Memory for ${index.host}, by title · ${index.titles.length}`;
  if (s === MEMORY_CHANGES_SOURCE) return 'Memory changed since the conversation started';
  const file = fileOf(s);
  if (file !== undefined) return `File "${file}"`;
  const recorded = recordingOf(s);
  if (recorded) return `Recording of ${recorded.site} · ${callCount(recorded.calls)}`;
  if (s === COMPACTION_PLAN_SOURCE) return 'The plan, kept through compaction';
  if (p.context === 'summary') return 'Summary of the earlier turns';
  if (s === PAGE_SOURCE) return 'Page block';
  if (s === NO_PAGE_SOURCE) return 'No page attached';
  if (s === USER_ELSEWHERE_SOURCE) return 'You are on another tab';
  if (p.context === 'skill') return s ? `Site skill "${s}"` : 'Site skill reminder';
  return 'Attached context'; // saved before the pieces were named
}

// Mentions of site templates in a message: "::todoist/today" (a view) or "::todoist" (the view for
// the URL of the tab it is read from). Each one is read from a tab of that site (the active one,
// another open one, or its fixed URL opened in a background tab) and attached to the message.
// Pure: the background reads them (templates/mention-read), the panel suggests and shows them.
import { SLUG } from '../core/sources';
import { limit } from '../core/limits';
import { text } from '../core/model-texts';
import { matchesAny, matchesPath } from '../skills/match';
import type { TemplateRun } from './liquid';
import { emptyInHiddenTab, templateBlock, templateOutput } from './render';
import type { PageTemplate, TemplateView } from './types';

// Why a mention is not read: an unknown or switched-off site is plain text (nothing is sent);
// a missing view or one too many is told to the model.
type MentionProblem = 'unknown' | 'off' | 'no-view' | 'too-many';

export interface Mention {
  name: string; // "todoist/today" or "todoist", as written after ::
  site: string;
  view?: string;
  start: number; // where "::" starts in the text
  end: number;
  template?: PageTemplate;
  problem?: MentionProblem;
}

// At the start of a word, so "std::vector" is not one.
const MENTION = new RegExp(`(^|\\s)::(${SLUG})(?:\\/(${SLUG}))?`, 'g');

// The mentions written in a text, each once, with what is wrong with them.
export function parseMentions(textValue: string, templates: PageTemplate[]): Mention[] {
  const seen = new Set<string>();
  const mentions: Mention[] = [];
  let read = 0;
  for (const m of textValue.matchAll(MENTION)) {
    const [, lead, site, view] = m as unknown as [string, string, string, string | undefined];
    const name = view ? `${site}/${view}` : site;
    if (seen.has(name)) continue;
    seen.add(name);
    const start = m.index + lead.length;
    const template = templates.find((t) => t.name === site);
    const problem: MentionProblem | undefined = !template
      ? 'unknown'
      : !template.enabled
        ? 'off'
        : view && !template.views.some((v) => v.name === view)
          ? 'no-view'
          : read++ >= limit('mentions')
            ? 'too-many'
            : undefined;
    mentions.push({ name, site, view, start, end: start + 2 + name.length, template, problem });
  }
  return mentions;
}

// The mentions sent to the model: the readable ones and the ones it is told about.
export const sentMentions = (mentions: Mention[]) => mentions.filter((m) => m.problem !== 'unknown' && m.problem !== 'off');

// What the composer shows on a mention that will not be read.
export const MENTION_PROBLEMS: Record<MentionProblem, string> = {
  unknown: 'No site template with this name: sent as plain text.',
  off: 'This site template is off: sent as plain text.',
  'no-view': 'This site template has no view with this name.',
  'too-many': `Only ${limit('mentions')} mentions are read per message.`,
};

// The URL a view can be opened at: the first URL pattern with a fixed host, plus its first path
// without wildcards, or with only a trailing * (removed). None when there is no such pattern or path.
export function fixedUrl(t: PageTemplate, view: TemplateView): string | undefined {
  const site = t.matches
    .map((p) => p.match(/^(\*|https?):\/\/([^/*]+)\//))
    .find((m): m is RegExpMatchArray => Boolean(m));
  const path = view.paths.map((p) => (p.endsWith('*') ? p.slice(0, -1) : p)).find((p) => !p.includes('*'));
  if (!site || path === undefined) return undefined;
  const scheme = site[1] === '*' ? 'https' : site[1];
  return `${scheme}://${site[2]}${path.startsWith('/') ? path : `/${path}`}`;
}

interface TabInfo {
  id?: number;
  url?: string;
  active?: boolean;
  lastAccessed?: number;
}

// The tab a mention is read from: the active tab if it fits, else the most recently used open tab
// that fits. A tab fits when it is of the site and, for a view with paths, its URL is one of them.
export function pickTab<T extends TabInfo>(t: PageTemplate, tabs: T[], activeTabId: number | undefined, view?: TemplateView): T | undefined {
  const fits = (tab: T) => {
    if (tab.id === undefined || !matchesAny(t.matches, tab.url)) return false;
    const u = new URL(tab.url!);
    return !view?.paths.length || view.paths.some((p) => matchesPath(p, u));
  };
  const candidates = tabs.filter(fits);
  return candidates.find((tab) => tab.id === activeTabId) ?? candidates.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
}

// Where a mention was read: the active tab, another open tab, or a background tab opened and closed.
export type MentionSource = { kind: 'active' | 'open'; tabId: number } | { kind: 'background'; url: string };

// A mention as the model gets it: the note and the data block; or why it could not be read.
export function mentionMessage(template: string, view: string, run: TemplateRun, from: MentionSource): string {
  const names = { template_name: template, view_name: view };
  const note =
    from.kind === 'background'
      ? text('template.mention_note_closed', { ...names, url: from.url })
      : text('template.mention_note', {
          ...names,
          tab_id: String(from.tabId),
          tab_source: from.kind === 'active' ? text('template.mention_tab_active') : text('template.mention_tab_open', { tab_id: String(from.tabId) }),
        });
  const hidden = emptyInHiddenTab(run) ? [text('template.hidden_tab')] : [];
  return [note, ...hidden, templateBlock(template, templateOutput(run))].join('\n');
}

export const mentionFailed = (mention: string, reason: string) => text('template.mention_failed', { mention, reason });

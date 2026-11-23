// The sources of the context parts a user message is sent with (Part.source): what each attached
// block is, as context/pieces names it for the views. A leaf (it imports only core/util, a leaf too), so
// that the modules that attach the blocks (context, bookmarks, history, memory, skills, templates) and
// those that show them can all use it without importing each other.
import { escapeRegExp } from './util';

export const TEMPLATE_SOURCE = 'template:'; // "template:youtube/videos"
export const SKILL_VALUES_SOURCE = 'skill-values:'; // "skill-values:shop-buy"
export const PAGE_SOURCE = 'page-block';
export const NO_PAGE_SOURCE = 'no-page'; // the note that the message goes without the page
export const USER_ELSEWHERE_SOURCE = 'user-elsewhere'; // the note that the user looks at another tab (context/turn)
export const MENTION_FAILED_SOURCE = 'mention-failed:'; // "mention-failed:todoist/nope"
export const MENTION_SOURCE = 'mention:'; // a site template mention: "mention:todoist/today"
export const MEMORY_SOURCE = 'memory:'; // "memory:example.com", the block for that site
const MEMORY_INDEX_SOURCE = 'memory-index:'; // that site's items that went by title (memory/prompt; memoryIndexSource)
const MEMORY_AUTO_SOURCE = 'memory-auto:'; // the items a message matched, on their own (memory/prompt; memoryMatchSource)
export const MEMORY_CHANGES_SOURCE = 'memory-changes'; // what changed since the conversation's system prompt (memory/prompt memoryChanges)
const MEMORY_STEP_SOURCE = 'memory-step:'; // those a reply of the model's matched, between its steps (context/step-attach)
export const COMPACTION_PLAN_SOURCE = 'compaction-plan'; // the plan a compaction took from what the model gets (context/compaction)
export const PLAN_REMINDER_SOURCE = 'plan-reminder'; // the plan, for the model to update it (context/plan-reminder)
// What a match on its own came from: your message, or a reply of the model's between its steps
// (context/step-attach), which the model is told.
export type AttachOrigin = 'message' | 'step';
// The memory items a text matched, on their own: "memory-auto:" or "memory-step:" and their titles as a
// JSON array, for the views (which so need not read the block, whose wording you can change). An older
// "memory-auto:<count>" says only how many.
export const memoryMatchSource = (origin: AttachOrigin, titles: string[]) => (origin === 'step' ? MEMORY_STEP_SOURCE : MEMORY_AUTO_SOURCE) + JSON.stringify(titles);
export function memoryMatchOf(source: string | undefined): { origin: AttachOrigin; titles: string[]; count: number } | undefined {
  const origin = source?.startsWith(MEMORY_AUTO_SOURCE) ? 'message' : source?.startsWith(MEMORY_STEP_SOURCE) ? 'step' : undefined;
  if (!origin) return undefined;
  const rest = source!.slice((origin === 'step' ? MEMORY_STEP_SOURCE : MEMORY_AUTO_SOURCE).length);
  try {
    const titles = JSON.parse(rest) as unknown;
    if (Array.isArray(titles)) return { origin, titles: titles.map(String), count: titles.length };
  } catch {
    // an older source: the count only
  }
  return { origin, titles: [], count: Number(rest) || 0 };
}
// A site's items that went by title: its host and their titles as JSON, for the views.
export const memoryIndexSource = (host: string, titles: string[]) => MEMORY_INDEX_SOURCE + JSON.stringify({ host, titles });
export function memoryIndexOf(source: string | undefined): { host: string; titles: string[] } | undefined {
  if (!source?.startsWith(MEMORY_INDEX_SOURCE)) return undefined;
  try {
    const { host, titles } = JSON.parse(source.slice(MEMORY_INDEX_SOURCE.length)) as { host?: unknown; titles?: unknown };
    return typeof host === 'string' && Array.isArray(titles) ? { host, titles: titles.map(String) } : undefined;
  } catch {
    return undefined; // a saved conversation can be edited by hand: it must still open
  }
}
// Skills and tools mentioned inline: "skill-mention:summarize-page", "tool-mention:browser.find,…".
export const SKILL_MENTION_SOURCE = 'skill-mention:';
export const TOOL_MENTION_SOURCE = 'tool-mention:';
export const AGENT_MENTION_SOURCE = 'agent-mention:'; // "agent-mention:["Research bot",…]": the agents' names, as JSON
// The agents a context part's source names, if it is an agent mention.
export function agentMentionOf(source: string | undefined): string[] | undefined {
  if (!source?.startsWith(AGENT_MENTION_SOURCE)) return undefined;
  try {
    const names: unknown = JSON.parse(source.slice(AGENT_MENTION_SOURCE.length));
    return Array.isArray(names) ? names.map(String) : undefined;
  } catch {
    return undefined; // a saved conversation can be edited by hand: it must still open
  }
}

// The tool groups a message matched, recommended with it (tools/match): their labels as a JSON array.
export const TOOL_MATCH_SOURCE = 'tool-match:';
export function toolMatchOf(source: string | undefined): string[] | undefined {
  if (!source?.startsWith(TOOL_MATCH_SOURCE)) return undefined;
  try {
    const labels = JSON.parse(source.slice(TOOL_MATCH_SOURCE.length)) as unknown;
    return Array.isArray(labels) ? labels.map(String) : [];
  } catch {
    return []; // a saved conversation can be edited by hand: it must still open
  }
}
const HISTORY_AUTO_SOURCE = 'history-auto:'; // "history-auto:<id>:<match %>:<title>"
const FILE_SOURCE = 'file:'; // "file:<name>": a text file you attached (the paperclip → File…)
const PDF_SOURCE = 'pdf:'; // "pdf:<name>": a PDF you attached, the same way
const RECORDING_SOURCE = 'recording:'; // "recording:<site>:<calls>": a recording of the page's requests
const BOOKMARK_AUTO_SOURCE = 'bookmark-auto:'; // "bookmark-auto:<id>:<match %>:<title>": attached on its own (bookmarks/auto)
const BOOKMARK_MENTION_SOURCE = 'bookmark-mention:'; // "bookmark-mention:<slug>:<title>" (b::<slug>; the chip shows the title)
const HISTORY_MENTION_SOURCE = 'history-mention:'; // "history-mention:<slug>:<title>" (the chip shows the title)

// A mention's name as typed after its trigger (#, b::, ::, /): lowercase letters, digits and dashes.
export const SLUG = '[a-z0-9][a-z0-9-]*';

// The names mentioned after `trigger`, at the start of the text or after a space, each once.
export const slugsAfter = (trigger: string, typed: string) =>
  [...new Set([...typed.matchAll(new RegExp(`(?:^|\\s)${escapeRegExp(trigger)}(${SLUG})`, 'g'))].map((m) => m[1]!))];

// "Find the cheapest cable" → "find-the-cheapest-cable"
export const slugOf = (title: string) => slugOrEmpty(title) || 'conversation';
// The same, "" for a title without a letter or a digit it can keep ("🤖").
export const slugOrEmpty = (title: string) =>
  title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

// A saved conversation attached on its own (history/auto).
export const historyAutoSource = (id: string, match: number, title: string) => `${HISTORY_AUTO_SOURCE}${id}:${match}:${title}`;

export function historyAutoOf(source: string | undefined): { id: string; match: number; title: string } | undefined {
  if (!source?.startsWith(HISTORY_AUTO_SOURCE)) return undefined;
  const [id = '', match = '0', ...title] = source.slice(HISTORY_AUTO_SOURCE.length).split(':');
  return { id, match: Number(match), title: title.join(':') };
}

// A bookmark attached on its own (bookmarks/auto).
// "bookmark-auto:<id>:<match %>:u=<its URL, encoded>:<title>", the URL for the views to link it (an
// older source has none).
export const bookmarkAutoSource = (id: string, match: number, title: string, url?: string) =>
  `${BOOKMARK_AUTO_SOURCE}${id}:${match}:${url ? `u=${encodeURIComponent(url)}:` : ''}${title}`;
export function bookmarkAutoOf(source: string | undefined): { id: string; match: number; title: string; url?: string } | undefined {
  if (!source?.startsWith(BOOKMARK_AUTO_SOURCE)) return undefined;
  const [id = '', match = '0', ...rest] = source.slice(BOOKMARK_AUTO_SOURCE.length).split(':');
  const url = rest[0]?.startsWith('u=') ? safeDecode(rest.shift()!.slice(2)) : undefined;
  return { id, match: Number(match), title: rest.join(':'), ...(url && { url }) };
}
const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return undefined;
  }
};
export const bookmarkMentionSource = (slug: string, title: string) => `${BOOKMARK_MENTION_SOURCE}${slug}:${title}`;
export function bookmarkMentionOf(source: string | undefined): { slug: string; title: string } | undefined {
  if (!source?.startsWith(BOOKMARK_MENTION_SOURCE)) return undefined;
  const [slug = '', ...title] = source.slice(BOOKMARK_MENTION_SOURCE.length).split(':');
  return { slug, title: title.join(':') || slug };
}
export const historyMentionSource = (slug: string, title: string) => `${HISTORY_MENTION_SOURCE}${slug}:${title}`;

// The slug and the title a context part's source names, if it is a # mention.
export function historyMentionOf(source: string | undefined): { slug: string; title: string } | undefined {
  if (!source?.startsWith(HISTORY_MENTION_SOURCE)) return undefined;
  const rest = source.slice(HISTORY_MENTION_SOURCE.length);
  const at = rest.indexOf(':');
  return { slug: rest.slice(0, at), title: rest.slice(at + 1) };
}

// A recording attached to a message: its site and how many calls, as its source says.
export const callCount = (calls: number) => `${calls} ${calls === 1 ? 'call' : 'calls'}`;
export const recordingSource = (site: string, calls: number) => `${RECORDING_SOURCE}${site}:${calls}`;
export function recordingOf(source: string | undefined): { site: string; calls: number } | undefined {
  if (!source?.startsWith(RECORDING_SOURCE)) return undefined;
  const rest = source.slice(RECORDING_SOURCE.length);
  const at = rest.lastIndexOf(':');
  return { site: rest.slice(0, at), calls: Number(rest.slice(at + 1)) || 0 };
}

// A file attached to a message, text or PDF: its name, as its source says.
export const fileSource = (name: string) => `${FILE_SOURCE}${name}`;
export const pdfSource = (name: string) => `${PDF_SOURCE}${name}`;
export const pdfOf = (source: string | undefined) => (source?.startsWith(PDF_SOURCE) ? source.slice(PDF_SOURCE.length) : undefined);
export const fileOf = (source: string | undefined) => (source?.startsWith(FILE_SOURCE) ? source.slice(FILE_SOURCE.length) : pdfOf(source));
// What you attached yourself (a recording, a file), kept when a message is sent again; the rest the
// extension attaches again as things are then.
export const attachedByYou = (source: string | undefined) => !!recordingOf(source) || fileOf(source) !== undefined;

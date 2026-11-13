// Don't resend what the model has seen (Settings → Compaction): a page block, site template output (also
// a ::site mention) or site skill values the same as the last one of its kind, and a mention
// (#conversation, b::bookmark, /skill), a file, a recording or an image of yours the same as one attached
// earlier, go as a short note, but only while that earlier copy is
// still whole in what the model gets. It works on the messages as they go (after compactedView), so a
// copy compaction trimmed or summarized no longer counts, and the content goes whole again. The history
// keeps every block whole: only the request changes, the same way on every request.
import { stripMarks, text } from '../core/model-texts';
import type { Message, Part } from '../core/types';
import type { DedupeSettings } from '../storage/settings-types';
import { bookmarkMentionOf, callCount, fileOf, historyMentionOf, MENTION_SOURCE, PAGE_SOURCE, recordingOf, SKILL_MENTION_SOURCE, SKILL_VALUES_SOURCE, TEMPLATE_SOURCE } from './sources';

const DEDUPE_DEFAULTS = { page: true, siteValues: true, mentions: true, attachments: true } as const;
type Dedupe = { [K in keyof typeof DEDUPE_DEFAULTS]: boolean };
export const dedupeOf = (s: DedupeSettings | undefined): Dedupe => ({ ...DEDUPE_DEFAULTS, ...s });

// As Settings has it: module state in each extension context, set with the texts and limits
// (context/model-settings applyModelSettings) before building a request.
let current: Dedupe = { ...DEDUPE_DEFAULTS };
export function setDedupe(s: DedupeSettings | undefined): void {
  current = dedupeOf(s);
}
export const dedupeNow = () => current;

type TextPart = Extract<Part, { type: 'text' }>;
interface Repeatable {
  setting: keyof Dedupe;
  key: string; // what it is compared with: the last one (page, siteValues) or any earlier one (mentions, attachments) of the same key
  what: string; // how the note names it
}
// Compared with any earlier one of their key, not only the last: what you attach or mention again.
const ANY_EARLIER: (keyof Dedupe)[] = ['mentions', 'attachments'];

const urlOf = (block: string) => /url="([^"]*)"/.exec(stripMarks(block))?.[1];

// What a context part is, when it is one that may go as a note.
function repeatable(p: TextPart): Repeatable | undefined {
  const source = p.source;
  if (!p.context || !source) return undefined;
  if (source === PAGE_SOURCE) {
    const url = urlOf(p.text);
    return { setting: 'page', key: source, what: url ? `The page (${url})` : 'The page' };
  }
  if (source.startsWith(TEMPLATE_SOURCE)) {
    const name = source.slice(TEMPLATE_SOURCE.length);
    const view = name.lastIndexOf('/');
    return { setting: 'siteValues', key: source, what: `The output of the site template ${view > 0 ? name.slice(0, view) : name}` };
  }
  if (source.startsWith(SKILL_VALUES_SOURCE)) return { setting: 'siteValues', key: source, what: `The values of the site skill ${source.slice(SKILL_VALUES_SOURCE.length)}` };
  if (source.startsWith(MENTION_SOURCE)) return { setting: 'siteValues', key: source, what: `The site mention ::${source.slice(MENTION_SOURCE.length)}` };
  const file = fileOf(source);
  if (file !== undefined) return { setting: 'attachments', key: source, what: `The file "${file}"` };
  const recording = recordingOf(source);
  if (recording) return { setting: 'attachments', key: source, what: `The recording of ${recording.site} (${callCount(recording.calls)})` };
  const conversation = historyMentionOf(source);
  if (conversation) return { setting: 'mentions', key: source, what: `The conversation "${conversation.title}"` };
  const bookmark = bookmarkMentionOf(source);
  if (bookmark) return { setting: 'mentions', key: source, what: `The bookmark "${bookmark.title}"` };
  if (source.startsWith(SKILL_MENTION_SOURCE)) return { setting: 'mentions', key: source, what: `The skill ${source.slice(SKILL_MENTION_SOURCE.length)}` };
  return undefined;
}

// The messages with each repeated block of your messages as a note, as `cfg` says.
export function dedupeContext(messages: Message[], cfg: Dedupe): Message[] {
  if (!Object.values(cfg).some(Boolean)) return messages;
  const last = new Map<string, string>(); // page and site values: the latest one's text, by key
  const whole = new Map<string, Set<string>>(); // the texts the model sees whole, by key
  const seenWhole = (key: string, s: string) => whole.get(key)?.has(s) ?? false;
  const keep = (key: string, s: string) => whole.set(key, (whole.get(key) ?? new Set()).add(s));
  // Seen whole before, any earlier one of its key; else it counts from now on.
  const again = (key: string, s: string) => seenWhole(key, s) || (keep(key, s), false);
  let changed = false;
  const out = messages.map((m) => {
    if (m.role !== 'user') return m;
    let mine = false;
    const parts = m.parts.map((p): Part => {
      // Your image, the same as one earlier: a note in its place.
      if (p.type === 'image' && p.data && cfg.attachments) {
        if (!again('image', p.data)) return p;
        mine = true;
        return { type: 'text', context: 'page', text: text('context.already_attached', { what: 'Your image' }) };
      }
      if (p.type !== 'text') return p;
      const r = repeatable(p);
      if (!r || !cfg[r.setting]) return p;
      if (ANY_EARLIER.includes(r.setting)) {
        if (!again(r.key, p.text)) return p;
        mine = true;
        return { ...p, text: text('context.already_attached', { what: r.what }) };
      }
      const same = last.get(r.key) === p.text && seenWhole(r.key, p.text);
      last.set(r.key, p.text);
      if (same) {
        mine = true;
        return { ...p, text: text('context.unchanged', { what: r.what }) };
      }
      keep(r.key, p.text);
      return p;
    });
    if (!mine) return m;
    changed = true;
    return { ...m, parts };
  });
  return changed ? out : messages;
}

// Skills and tools mentioned in a message: "/summarize-page" loads a skill for that message, and
// "$browser.find" asks the model to use a tool (offered for that message even if it is off). Both at
// the start of a word, and only names that exist: anything else is plain text ("$20", "a/b").
// Pure: the background attaches them, the panel suggests them and shows them as chips.
import type { ContextItem } from '../core/messages';
import { markValue, text } from '../core/model-texts';
import { referencesNote } from '../skills/prompt';
import type { Skill } from '../skills/types';
import { toWireName } from '../core/tool-registry';
export { toolNamed } from '../core/tool-registry';
import { SKILL_MENTION_SOURCE, TOOL_MENTION_SOURCE } from './sources';

export type InlineKind = 'skill' | 'tool';

interface InlineMention {
  kind: InlineKind;
  name: string; // the skill's name, or the tool's dotted name ("browser.find")
  start: number; // where "/" or "$" is in the text
  end: number;
}

const PATTERNS: Record<InlineKind, RegExp> = {
  skill: /(^|\s)\/([a-z0-9][a-z0-9-]*)/g,
  tool: /(^|\s)\$([A-Za-z][\w-]*(?:\.[\w-]+)*)/g,
};

// The mentions of one kind in a text, each once; `known` gives the name a written one stands for
// (a tool by its dotted or its wire name), or none when there is no such skill or tool.
export function parseInline(textValue: string, kind: InlineKind, known: (written: string) => string | undefined): InlineMention[] {
  const seen = new Set<string>();
  const out: InlineMention[] = [];
  for (const m of textValue.matchAll(PATTERNS[kind])) {
    const lead = m[1]!;
    // A sentence may end right after it: "use $browser.find."
    const written = [m[2]!, m[2]!.replace(/[.-]+$/, '')].find((w) => known(w));
    const name = written && known(written);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const start = m.index + lead.length;
    out.push({ kind, name, start, end: start + 1 + written.length });
  }
  return out;
}

// The enabled skills by name.
export const skillNamed = (skills: Skill[]) => (written: string) => skills.find((s) => s.enabled && s.name === written)?.name;

// What a message's skill mentions attach: each skill's instructions, except the site skills already
// attached because they apply to the page (`attached`).
export function skillMentionItems(typed: string, skills: Skill[], attached: Set<string> = new Set()): ContextItem[] {
  return parseInline(typed, 'skill', skillNamed(skills))
    .filter((m) => !attached.has(m.name))
    .map((m) => {
      const s = skills.find((x) => x.name === m.name)!;
      const instructions = markValue(s.body, 'skill') + referencesNote(s.references.map((r) => r.path));
      return { kind: 'skill', source: SKILL_MENTION_SOURCE + s.name, text: text('skill.mention', { skill_name: s.name, skill_instructions: instructions }) };
    });
}

// What a message's tool mentions attach: one note naming them all; none when there are none.
export function toolMentionItem(names: string[]): ContextItem | undefined {
  if (!names.length) return undefined;
  return { kind: 'tool', source: TOOL_MENTION_SOURCE + names.join(','), text: text('tool.mention', { tool_names: names.map(toWireName).join(', ') }) };
}

// The tool the model must call first when forcing is on: the one mentioned, or any ('required')
// when several were; none when none were.
export const forcedToolChoice = (names: string[]) => (names.length > 1 ? 'required' : names[0] && toWireName(names[0]));

// The names a message's context says were mentioned (for the chips): skills and tools.
export function mentionedIn(sources: (string | undefined)[]): Record<InlineKind, Set<string>> {
  const out = { skill: new Set<string>(), tool: new Set<string>() };
  for (const s of sources) {
    if (s?.startsWith(SKILL_MENTION_SOURCE)) out.skill.add(s.slice(SKILL_MENTION_SOURCE.length));
    if (s?.startsWith(TOOL_MENTION_SOURCE)) for (const n of s.slice(TOOL_MENTION_SOURCE.length).split(',')) out.tool.add(n);
  }
  return out;
}

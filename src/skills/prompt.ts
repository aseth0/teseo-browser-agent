// What the model sees of the skills: a catalog in the system prompt (general skills)
// and <site_skill> blocks attached to the user message (site skills).
import { SKILL_VALUES_SOURCE } from '../core/sources';
import { cutDetail, limit, limitText } from '../core/limits';
import type { ContextItem } from '../core/messages';
import { clip } from '../core/clip';
import { linesThatFit } from '../core/util';
import { cutNote, markValue, text } from '../core/model-texts';
import type { Message } from '../core/types';
import { matchesAny } from './match';
import { isSiteSkill, type Skill } from './types';
import { findVariables, type ItemsValue, type PageValue } from './variables';

// Appended to the system prompt. Stable while the set of enabled skills does not change.
export function skillsInstructions(skills: Skill[]): string {
  const general = skills.filter((s) => s.enabled && !isSiteSkill(s));
  const hasSite = skills.some((s) => s.enabled && isSiteSkill(s));
  if (!general.length && !hasSite) return '';
  const parts = [text('system.skills_header')];
  if (general.length) {
    const list = general.map((s) => text('system.skills_item', { skill_name: s.name, skill_description: s.description })).join('\n');
    parts.push(text('system.skills_catalog', { skill_list: list }));
  }
  if (hasSite) parts.push(text('system.site_skills'));
  return parts.join('\n');
}

export function siteSkillsFor(skills: Skill[], url: string | undefined): Skill[] {
  return skills.filter((s) => s.enabled && isSiteSkill(s) && matchesAny(s.matches, url));
}

// The full instructions go in only the first time a site skill is active in the
// conversation; later turns get a one-line reminder (the history is append-only).
// Full blocks are tagged with the skill name to recognise them later.
export function siteSkillItems(active: Skill[], history: Message[]): ContextItem[] {
  const sent = (name: string) => history.some((m) => m.parts.some((p) => p.type === 'text' && p.context === 'skill' && p.source === name));
  return active.map((s) =>
    sent(s.name)
      ? { kind: 'skill', text: siteSkillReminder(s.name) }
      : { kind: 'skill', source: s.name, text: siteSkillBlock(s.name, skillInstructions(s)) },
  );
}

// A skill's instructions as the model gets them: its body, marked as the skill's, and its reference files named.
export const skillInstructions = (s: Skill) => markValue(s.body, 'skill') + referencesNote(s.references.map((r) => r.path));

export function siteSkillBlock(name: string, instructions: string): string {
  return text('skill.site_block', { skill_name: name, skill_instructions: instructions });
}

export function siteSkillReminder(name: string): string {
  return text('skill.reminder', { skill_name: name });
}

// The variables the active site skills ask for, each once.
export const skillVariables = (active: Skill[]) => [...new Set(active.flatMap((s) => findVariables(s.body)))];

// A value read from the page, saying so when it was cut to the limit ("" = not found).
export function skillValueText(value: PageValue): string {
  if ('items' in value) return itemsText(value);
  if (!value.truncated) return value.text;
  const max = value.max ?? limit('skillValue');
  return value.text + cutNote(cutDetail('skillValue', value.total, max)) + text('skill.value_truncated', { max_chars: String(max) });
}

// Each variable's text from the values read on the page ("" = not found), as the model gets it.
export const valueTextOf = (values: Record<string, PageValue>) => (variable: string) =>
  values[variable] ? skillValueText(values[variable]) : '';

// The records as a numbered list: as many whole records as fit in the limit (at least the first,
// cut if it alone is too long), then how many were left out.
function itemsText({ items, total }: ItemsValue): string {
  if (!total) return '';
  const records = items.map((item, i) => {
    const fields = Object.entries(item).map(([field, value]) => text('skill.item_field', { field, value: value || text('skill.item_field_missing') }));
    return text('skill.item', { n: String(i + 1), fields: fields.join('\n   ') });
  });
  const shown = records.slice(0, linesThatFit(records, limit('skillValue')));
  if (!shown.length) shown.push(skillValueText(clip(records[0]!, limit('skillValue'))));
  const more = total - shown.length;
  const left = more ? cutNote(`Site skill value: ${more} of ${total} records left out (limit ${limitText('skillValue')})`) + text('skill.items_more', { more: String(more), max_chars: String(limit('skillValue')) }) : '';
  return text('skill.items', { count: String(total), items: shown.join('\n') }) + left;
}

// One untrusted block per site skill with the page values it asks for ("" = not found).
export function siteSkillValueItems(active: Skill[], valueOf: (variable: string) => string): ContextItem[] {
  return active.flatMap((s) => {
    const lines = findVariables(s.body).map((variable) => text('skill.value', { variable, value: valueOf(variable) || text('skill.value_missing') }));
    return lines.length ? [{ kind: 'page' as const, text: text('skill.values', { skill_name: s.name, skill_values: lines.join('\n') }), source: SKILL_VALUES_SOURCE + s.name }] : [];
  });
}

// Result of skills__load.
export function loadedSkillText(name: string, instructions: string): string {
  return text('result.skill_loaded', { skill_name: name, skill_instructions: instructions });
}

export function referencesNote(paths: string[]): string {
  return paths.length ? text('skill.references', { reference_paths: paths.join(', ') }) : '';
}

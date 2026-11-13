import { describe, expect, it } from 'vitest';
import { mentionedIn, parseInline, skillMentionItems, skillNamed, toolMentionItem, toolNamed } from '../src/context/inline-mentions';
import type { Skill } from '../src/skills/types';

const skill = (name: string, enabled = true): Skill => ({ id: name, name, description: '', matches: [], body: `Do ${name}.`, references: [], enabled });
const skills = [skill('summarize-page'), skill('off', false)];
const tools = toolNamed(['browser.find', 'webmcp.add_to_cart']);

describe('skill and tool mentions', () => {
  it('are names that exist, at the start of a word, each once', () => {
    const text = '/summarize-page a/b /off /nope then /summarize-page';
    expect(parseInline(text, 'skill', skillNamed(skills)).map((m) => [m.name, m.start, m.end])).toEqual([['summarize-page', 0, 15]]);
    // Dotted or wire name; a sentence may end right after it; "$20" is plain text.
    const written = 'use $browser.find. or $webmcp__add_to_cart for $20';
    expect(parseInline(written, 'tool', tools).map((m) => m.name)).toEqual(['browser.find', 'webmcp.add_to_cart']);
  });

  it('attach the skill instructions, except a site skill already attached', () => {
    const [item] = skillMentionItems('/summarize-page please', skills);
    expect(item).toMatchObject({ kind: 'skill', source: 'skill-mention:summarize-page' });
    expect(item!.text).toContain('<skill name="summarize-page">\nDo summarize-page.\n</skill>');
    expect(skillMentionItems('/summarize-page', skills, new Set(['summarize-page']))).toEqual([]);
  });

  it('attach one note naming the tools, and say which were mentioned', () => {
    const note = toolMentionItem(['browser.find', 'webmcp.add_to_cart'])!;
    expect(note.text).toBe('The user asks you to use browser__find, webmcp__add_to_cart for this message.');
    expect(toolMentionItem([])).toBeUndefined();
    const m = mentionedIn([note.source, 'skill-mention:summarize-page', undefined]);
    expect([...m.tool]).toEqual(['browser.find', 'webmcp.add_to_cart']);
    expect([...m.skill]).toEqual(['summarize-page']);
  });
});

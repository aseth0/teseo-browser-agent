import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Message } from '../src/core/types';
import { matchesPattern } from '../src/skills/match';
import { parseSkillMarkdown } from '../src/skills/parser';
import { loadedSkillText, referencesNote, siteSkillItems, siteSkillsFor, siteSkillValueItems, skillsInstructions, skillValueText } from '../src/skills/prompt';
import { appendContext } from '../src/core/messages';
import type { Skill } from '../src/skills/types';
import { skillProblems } from '../src/skills/validate';

const skill = (over: Partial<Skill>): Skill => ({
  id: over.name ?? 'x', name: 'x', description: 'd', matches: [], body: 'Do the thing.', references: [], enabled: true, ...over,
});

describe('parseSkillMarkdown', () => {
  it('reads name, description, inline and block lists, and the body', () => {
    expect(parseSkillMarkdown('---\nname: a\ndescription: "Does A"\nmatches: ["*://a.com/*"]\n---\n# A\nSteps')).toEqual({
      name: 'a', description: 'Does A', matches: ['*://a.com/*'], body: '# A\nSteps',
    });
    expect(parseSkillMarkdown("---\nname: b\ndescription: Does B\nmatches:\n  - '*://b.com/*'\n  - \"*://c.com/*\"  \n---\nbody").matches)
      .toEqual(['*://b.com/*', '*://c.com/*']);
  });

  it("reads an inline list quoted either way, apostrophes and commas inside quotes kept", () => {
    const md = (list: string) => `---\nname: a\ndescription: d\nmatches: ${list}\n---\nbody`;
    expect(parseSkillMarkdown(md(`["it's, here", 'b''s', c, "q\\"d"]`)).matches).toEqual(["it's, here", "b's", 'c', 'q"d']);
    expect(parseSkillMarkdown(md('["unclosed')).matches).toEqual(['unclosed']);
    expect(parseSkillMarkdown(md('[]')).matches).toEqual([]);
  });

  it('rejects files without frontmatter, name or description', () => {
    expect(() => parseSkillMarkdown('# no frontmatter')).toThrow('frontmatter');
    expect(() => parseSkillMarkdown('---\nname: a\n---\nbody')).toThrow('name and a description');
  });

  it.each(['summarize-page', 'fill-form', 'create-skill'])('parses the built-in %s skill', (name) => {
    const s = parseSkillMarkdown(readFileSync(`skills/${name}/SKILL.md`, 'utf8'));
    expect(s.name).toBe(name);
    expect(s.description.length).toBeGreaterThan(40);
    expect(s.matches).toEqual([]);
  });
});

describe('matchesPattern', () => {
  it.each([
    ['*://github.com/*/pull/*', 'https://github.com/golang/go/pull/31877', true],
    ['*://github.com/*/pull/*', 'https://github.com/golang/go/issues/1', false],
    ['*://*.example.com/*', 'https://docs.example.com/a', true],
    ['*://*.example.com/*', 'https://example.com/', true],
    ['*://*.example.com/*', 'https://badexample.com/', false],
    ['https://a.com/*', 'http://a.com/', false],
    ['*://localhost/*', 'http://localhost:8787/shop.html', true],
    ['<all_urls>', 'https://any.where/x', true],
    ['<all_urls>', 'vivaldi://extensions', false],
    ['not a pattern', 'https://a.com/', false],
  ])('%s vs %s → %s', (pattern, url, expected) => {
    expect(matchesPattern(pattern, url)).toBe(expected);
  });
});

describe('skills prompt', () => {
  const general = skill({ name: 'summarize-page', description: 'Summarize pages.' });
  const site = skill({ name: 'pr', matches: ['*://github.com/*/pull/*'], body: 'Read the diff first.' });

  it('lists only enabled general skills, and explains site skills when there are any', () => {
    const text = skillsInstructions([general, skill({ name: 'off', enabled: false }), site]);
    expect(text).toContain('- summarize-page: Summarize pages.');
    expect(text).not.toContain('- off:');
    expect(text).not.toContain('- pr:');
    expect(text).toContain('<site_skill> blocks');
    expect(skillsInstructions([])).toBe('');
  });

  it('activates site skills by URL', () => {
    expect(siteSkillsFor([general, site], 'https://github.com/a/b/pull/1')).toEqual([site]);
    expect(siteSkillsFor([general, site], 'https://github.com/a/b')).toEqual([]);
  });

  it('sends the full instructions once, then a reminder', () => {
    const first = siteSkillItems([site], []);
    expect(first).toEqual([{ kind: 'skill', source: 'pr', text: '<site_skill name="pr">\nRead the diff first.\n</site_skill>' }]);
    const history: Message[] = appendContext([{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }], first);
    expect(siteSkillItems([site], history)).toEqual([{ kind: 'skill', text: '<site_skill name="pr">Still active: follow its instructions above.</site_skill>' }]);
  });

  it('names reference files the same way for loaded and site skills', () => {
    expect(loadedSkillText('pr', 'Read the diff first.' + referencesNote(['a.md', 'b.md']))).toBe(
      '# Skill: pr\n\nRead the diff first.\n\nReference files (read with skills__read_reference): a.md, b.md',
    );
    expect(referencesNote([])).toBe('');
  });
});

describe('site skill page values', () => {
  it('lists items as numbered records, whole ones up to the limit, saying how many were left out', () => {
    expect(skillValueText({ total: 0, items: [] })).toBe('');
    expect(skillValueText({ total: 2, items: [{ title: 'A', channel: 'C' }, { title: 'B', channel: '' }] })).toBe(
      '2 items\n1. title: A\n   channel: C\n2. title: B\n   channel: (not found)',
    );
    const many = Array.from({ length: 100 }, (_, i) => ({ title: `Video ${i} `.padEnd(60, '.') }));
    const listed = skillValueText({ total: 240, items: many });
    const shown = listed.match(/^\d+\. /gm)!.length;
    expect(listed).toMatch(new RegExp(`\\n…\\[${240 - shown} more items not sent: 2000-character limit\\]$`));
    expect(listed.length).toBeLessThan(2100);
    expect(listed).not.toContain(`Video ${shown} `); // never half a record
    const huge = skillValueText({ total: 1, items: [{ text: 'x'.repeat(3000) }] });
    expect(huge).toContain('[truncated: 2000-character limit]'); // a single record too long is cut
  });

  it('says when a value was cut at the limit, and when nothing matched', () => {
    expect(skillValueText({ text: 'abc', truncated: true })).toBe('abc\n…[truncated: 2000-character limit]');
    expect(skillValueText({ text: 'abc', truncated: false })).toBe('abc');
    const pr = skill({ name: 'pr', matches: ['*://github.com/*'], body: 'Title {{selector:h1}} Size {{selector:.size}}' });
    expect(siteSkillValueItems([pr], (v) => (v === '{{selector:h1}}' ? 'Fix login' : ''))).toEqual([
      {
        kind: 'page',
        text: '<untrusted_page_content source="site skill pr">\n{{selector:h1}}: Fix login\n{{selector:.size}}: (not found on the page)\n</untrusted_page_content>',
        source: 'skill-values:pr',
      },
    ]);
  });
});


describe('skill validation', () => {
  it('names the variables that cannot be read', () => {
    const body = 'Videos {{items:ytd-video; title=#title}} bad {{items:li}} {{schema:Product}}';
    expect(skillProblems(skill({ body }), []).filter((p) => p.startsWith('Not a valid variable'))).toEqual([
      expect.stringContaining('{{items:li}}'),
      expect.stringContaining('{{schema:Product}}'),
    ]);
  });
});

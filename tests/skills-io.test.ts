import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
const { exportSkills, importSkills } = await import('../src/skills/io');
type Skill = import('../src/skills/types').Skill;

const mine: Skill = { id: 'm', name: 'review-pr', description: 'Reviews a PR.', matches: ['*://example.com/*'], body: '1. Read it.', references: [{ path: 'references/list.md', content: '- a' }], enabled: true, createdBy: 'model' };
const builtin: Skill = { id: 'builtin:fill-form', name: 'fill-form', description: 'Fills.', matches: [], body: 'x', references: [], enabled: true, builtin: true };

describe('skills as JSON', () => {
  it('exports your skills with their reference files, not the built-in ones nor their on/off', () => {
    const { skills } = JSON.parse(exportSkills([builtin, mine]));
    expect(skills).toEqual([{ name: 'review-pr', description: 'Reviews a PR.', matches: ['*://example.com/*'], body: '1. Read it.', references: [{ path: 'references/list.md', content: '- a' }] }]);
  });

  it('imports them off, replacing yours of the same name, never a built-in one', () => {
    const json = exportSkills([mine]);
    const fresh = importSkills(json, []);
    expect(fresh.skills[0]).toMatchObject({ name: 'review-pr', enabled: false, references: [{ path: 'references/list.md' }] });
    expect(fresh.skills[0]).not.toHaveProperty('createdBy');
    expect(importSkills(json, [mine]).skills[0]!.id).toBe('m');
    const { skills, skipped } = importSkills(JSON.stringify({ skills: [{ ...JSON.parse(json).skills[0], name: 'fill-form' }, { name: 'Bad Name', description: '', body: '' }] }), [builtin]);
    expect(skills).toEqual([]);
    expect(skipped[0]).toBe('fill-form: a built-in skill has this name.');
    expect(skipped[1]).toMatch(/^Bad Name: Name: lowercase/);
  });
});

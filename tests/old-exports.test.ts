// Files exported by earlier versions (tests/fixtures/exports): they still import, every item, and
// export again as they were.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
const { exportSkills, importSkills } = await import('../src/skills/io');
const { exportTemplates, importTemplates } = await import('../src/templates/io');
const { exportCustomTools, importCustomTools } = await import('../src/tools/custom/io');
const { exportActions, importActions } = await import('../src/widget/io');
const { exportAgents, importAgents } = await import('../src/agents/io');
const { exportMemory, importMemory } = await import('../src/memory/io');

const file = (name: string) => readFileSync(new URL(`./fixtures/exports/${name}`, import.meta.url), 'utf8');
const search = { name: 'web.search', source: 'web' as const, inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } };

describe('files exported before', () => {
  it('skills: every one, from the list, a bare list or one alone, exported again the same', () => {
    const { skills, skipped, rows } = importSkills(file('skills.json'), []);
    expect([skipped, rows.map((r) => r.status)]).toEqual([[], ['new', 'new']]);
    expect(exportSkills(skills)).toBe(file('skills.json').trimEnd());
    expect(importSkills(file('skills-list.json'), []).skills.map((s) => s.name)).toEqual(['listed']);
    expect(importSkills(file('skills-one.json'), []).skills.map((s) => s.name)).toEqual(['alone']);
  });

  it('site templates', () => {
    const { templates, skipped } = importTemplates(file('site-templates.json'), []);
    expect(skipped).toEqual([]);
    expect(exportTemplates(templates)).toBe(file('site-templates.json').trimEnd());
  });

  it('custom tools', () => {
    const { tools, skipped } = importCustomTools(file('custom-tools.json'), [], [search]);
    expect(skipped).toEqual([]);
    expect(exportCustomTools(tools)).toBe(file('custom-tools.json').trimEnd());
  });

  it('actions', () => {
    const { actions, skipped } = importActions(file('actions.json'), [], [], []);
    expect(skipped).toEqual([]);
    expect(JSON.parse(exportActions(actions, []))).toMatchObject(JSON.parse(file('actions.json')));
  });

  it('agents', () => {
    const { agents, skipped } = importAgents(file('agents.json'), []);
    expect(skipped).toEqual([]);
    expect(JSON.parse(exportAgents(agents))).toMatchObject(JSON.parse(file('agents.json')));
  });

  it('memory: every item, off, the rest as it was', () => {
    const { items, skipped } = importMemory(file('memory.json'), [], []);
    expect(skipped).toEqual([]);
    expect(items.every((m) => !m.enabled)).toBe(true);
    const was = JSON.parse(file('memory.json')).memory.map((m: { enabled: boolean }) => ({ ...m, enabled: false }));
    expect(JSON.parse(exportMemory(items, [])).memory).toEqual(was);
  });
});

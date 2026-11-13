// Skills as JSON, to back them up or share them (Settings → Skills): { "skills": [...] }, each with
// its reference files. Imported checked as the editor checks them, and off until the user switches
// them on (their instructions reach the model as trusted, and the file comes from elsewhere). One of
// the name of one of yours replaces it; one of a built-in skill's name is left out.
import { importNamed, listFrom, stringList, type ImportRow } from '../storage/import';
import type { Skill } from './types';
import { skillProblems } from './validate';

type Shared = Pick<Skill, 'name' | 'description' | 'matches' | 'body' | 'references'>;

export function exportSkills(skills: Skill[]): string {
  const shared = skills.filter((s) => !s.builtin).map(({ name, description, matches, body, references }): Shared => ({ name, description, matches, body, references }));
  return JSON.stringify({ skills: shared }, null, 2);
}

// The skills in the JSON ({ "skills": [...] }, a list, or one), those left out, with why, and a row each.
export function importSkills(json: string, existing: Skill[]): { skills: Skill[]; skipped: string[]; rows: ImportRow<Skill>[] } {
  const { items: skills, skipped, rows } = importNamed<Skill>({
    list: listFrom(json, 'skills'),
    existing,
    build: (raw, old) => {
      const item = raw as Partial<Shared>;
      const name = String(item.name ?? '').trim();
      if (old?.builtin) return { skip: `${name}: a built-in skill has this name.` };
      const references = (Array.isArray(item.references) ? item.references : [])
        .filter((r) => r && typeof r.path === 'string' && typeof r.content === 'string')
        .map((r) => ({ path: r.path.trim(), content: r.content }));
      return {
        name,
        description: String(item.description ?? '').trim(),
        matches: stringList(item.matches, { trim: true }),
        body: String(item.body ?? '').trim(),
        references,
        enabled: false,
      };
    },
    problems: skillProblems,
  });
  return { skills, skipped, rows };
}

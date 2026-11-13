// A skill: Agent Skills format (SKILL.md) plus an optional `matches` list that
// turns it into a site skill, activated automatically on matching pages.
interface SkillReference {
  path: string; // e.g. "references/checklist.md"
  content: string;
}

export interface Skill {
  id: string;
  name: string; // kebab-case, unique
  description: string; // what it does and when to use it (shown to the model)
  matches: string[]; // Chrome match patterns; empty = general skill
  body: string; // the instructions (Markdown)
  references: SkillReference[];
  enabled: boolean;
  builtin?: boolean; // shipped with the extension: read-only
  createdBy?: 'model'; // saved by the model (skills.save), after the user approved it
}

export const isSiteSkill = (s: Skill) => s.matches.length > 0;

// A new skill, as the editor starts it.
export const newSkill = (): Skill => ({ id: crypto.randomUUID(), name: '', description: '', matches: [], body: '', references: [], enabled: true });

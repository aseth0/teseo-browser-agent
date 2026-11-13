// Skills: the built-in ones (skills/*/SKILL.md, bundled at build time) plus the ones the
// user creates in the options page, stored under their own key.
import { createCollection } from '../storage/collection';
import { parseSkillMarkdown } from './parser';
import type { Skill } from './types';

const files = import.meta.glob<string>('../../skills/*/SKILL.md', { query: '?raw', import: 'default', eager: true });

const BUILTIN: Omit<Skill, 'enabled'>[] = Object.values(files)
  .map((md) => {
    const s = parseSkillMarkdown(md);
    return { ...s, id: `builtin:${s.name}`, references: [], builtin: true as const };
  });

export const skillStore = createCollection<Skill>('skills', BUILTIN);


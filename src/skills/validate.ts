// What makes a skill valid, for the options editor and for skills.save (the model).
import type { Skill } from './types';
import { findVariables, parseVariable } from './variables';

export const NAME = /^[a-z0-9][a-z0-9-]*$/;
export const PATTERN = /^(<all_urls>|(\*|https?):\/\/[^/]+\/.*)$/;

// Problems to fix before saving; empty when it can be saved. `others`: the rest of the skills.
export function skillProblems(skill: Skill, others: Skill[]): string[] {
  return [
    !NAME.test(skill.name) && 'Name: lowercase letters, digits and dashes (e.g. "review-pr").',
    others.some((s) => s.id !== skill.id && s.name === skill.name) && 'Another skill already has this name.',
    !skill.description.trim() && 'Description: say what the skill does and when to use it.',
    !skill.body.trim() && 'Instructions are empty.',
    ...skill.matches.filter((m) => !PATTERN.test(m)).map((m) => `Not a URL pattern: ${m} (e.g. *://github.com/*/pull/*)`),
    skill.references.some((r) => !r.path.trim()) && 'Every reference file needs a path.',
    ...findVariables(skill.body)
      .filter((v) => !parseVariable(v))
      .map((v) => `Not a valid variable: ${v} (e.g. {{schema:@Product:offers.price}}, {{items:li.result; title=h3; url=a?href}})`),
  ].filter((p): p is string => Boolean(p));
}

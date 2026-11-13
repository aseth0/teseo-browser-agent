// The languages with reading rules, by their ISO 639-1 code. English and any other language have none:
// the text goes as it is written, with the user's own pairs.
import { ES } from './es';
import type { ReadingRules } from './types';

export type { ReadingRules } from './types';

const RULES: Record<string, ReadingRules> = { es: ES };

// The languages offered in Settings → Speak, with their names.
export const RULED_LANGUAGES: { code: string; name: string }[] = [{ code: 'es', name: 'Spanish' }];

// A language as Settings → Speak names it: "es-ES" as Spanish, one without rules by its code; none: None.
export const languageName = (code: string | undefined): string =>
  code ? (RULED_LANGUAGES.find((l) => l.code === code.trim().toLowerCase().split(/[-_]/)[0])?.name ?? code) : 'None';

// "es", "es-ES" or "ES": Spanish's rules; none for a language without rules, or no language.
export function rulesFor(language: string | undefined): ReadingRules | undefined {
  const code = language?.trim().toLowerCase().split(/[-_]/)[0];
  return code && Object.hasOwn(RULES, code) ? RULES[code] : undefined;
}

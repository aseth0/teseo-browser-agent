// A text as a voice should say it: the user's own "written = said" pairs first, then the language's
// reading rules (speech/languages), when it has any. The model reads the digits; the marks between them
// and the units after them it does not.
import type { ReadingRules } from './languages';

// A pair from Settings → Speak: what is written, and how to say it.
export interface SpokenPair {
  written: string;
  said: string;
}

// The pairs typed one per line, "written = said"; a line without "=" or without what is written is left out.
export function parsePairs(spec: string): SpokenPair[] {
  return spec
    .split('\n')
    .map((line) => /^\s*([^=]+?)\s*=\s*(.*?)\s*$/.exec(line))
    .flatMap((found) => (found?.[1] ? [{ written: found[1], said: found[2] ?? '' }] : []));
}
export const pairsText = (pairs: SpokenPair[]): string => pairs.map((p) => `${p.written} = ${p.said}`).join('\n');

const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function spoken(text: string, pairs: readonly SpokenPair[], rules?: ReadingRules): string {
  let out = text;
  for (const { written, said } of pairs) if (written) out = out.split(written).join(said);
  if (!rules) return out;

  // The longest first: "ms" before "m", "min" before "m".
  const units = Object.keys(rules.units).sort((a, b) => b.length - a.length).map(escaped).join('|');
  if (units) {
    // 0,26 s · 45 ms · 30%: the unit by its name, one or several.
    out = out.replace(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s?(${units})(?![\\p{L}\\d])`, 'gu'), (_, n: string, unit: string) => {
      const [one, many] = rules.units[unit] ?? [unit, unit];
      return `${n} ${n === '1' ? one : many}`;
    });
  }
  if (rules.thousands) {
    // 1.000.000: thousands, not decimals (2.1.321 is neither, and stays).
    const t = escaped(rules.thousands);
    const other = rules.thousands === '.' ? ',' : '\\.';
    out = out.replace(new RegExp(`(?<![\\d.,])\\d{1,3}(?:${t}\\d{3})+(?![\\d${t}]|${other}\\d)`, 'g'), (n) => n.split(rules.thousands!).join(''));
  }
  // 0,05 → 0 coma cero 5
  const { zero } = rules.decimal;
  return out.replace(/(?<=\d)([.,])(\d+)/g, (_, mark: '.' | ',', digits: string) => {
    const zeros = /^0*/.exec(digits)?.[0].length ?? 0;
    return ` ${rules.decimal[mark]} ${`${zero} `.repeat(zeros)}${digits.slice(zeros)}`.trimEnd();
  });
}

// "Answer cut to" (an HTTP request's extract, tools/http extractPath) built by clicking keys in a tried
// answer: each click a pick, the picks joined into one path ("items[].{title,url}"), and back.
export interface Seg {
  key: string; // '' for the value itself (a list at the top: "[].name")
  each: boolean; // through each element of the list it holds: "items[]"
}
export type Pick = Seg[];

// Where a key clicked in the answer is, from the top (keys and list positions), as a pick: any
// position in a list stands for each of its elements. Undefined when the extract syntax cannot say
// it, or picksOf could not read it back: a key with a dot, a comma, a bracket or a brace, of digits
// only (read as a list position), or with spaces around it.
export function pickOf(path: (string | number)[]): Pick | undefined {
  const segs: Seg[] = [];
  for (const step of path) {
    if (typeof step === 'number') {
      const last = segs.at(-1);
      if (last && !last.each) last.each = true;
      else segs.push({ key: '', each: true });
    } else {
      if (step === '' || /[.,{}[\]]/.test(step) || /^\d+$/.test(step) || step.trim() !== step) return undefined;
      segs.push({ key: step, each: false });
    }
  }
  return segs;
}

const segText = (s: Seg) => `${s.key}${s.each ? '[]' : ''}`;
export const pickText = (pick: Pick) => pick.map(segText).join('.');

// Whether `outer` holds `inner`: its path leads to it (its last key with or without "[]").
function holds(outer: Pick, inner: Pick): boolean {
  if (outer.length > inner.length) return false;
  return outer.every((s, i) => s.key === inner[i]!.key && (s.each === inner[i]!.each || (i === outer.length - 1 && !s.each)));
}

const sameSeg = (a: Seg, b: Seg) => a.key === b.key && a.each === b.each;

// The picks joined into one path: their common part, then the keys they keep there ("{a,b}"). A pick
// deeper than one key past the common part keeps that whole key: `approximate` then.
export function extractOf(picks: Pick[]): { extract: string; approximate: boolean } {
  // One inside another adds nothing.
  const inAnother = (p: Pick, i: number) =>
    picks.some((q, j) => {
      if (j === i || !holds(q, p)) return false;
      // The same pick twice: the first stays.
      return !holds(p, q) || j < i;
    });
  const kept = picks.filter((p, i) => !inAnother(p, i));
  if (!kept.length) return { extract: '', approximate: false };
  if (kept.length === 1) return { extract: pickText(kept[0]!), approximate: false };
  let common = 0;
  while (kept.every((p) => p.length > common && sameSeg(p[common]!, kept[0]![common]!))) common++;
  // The keys they keep are those of an object: a list at the point they part keeps going through it.
  const prefix = kept[0]!.slice(0, common);
  const rests = kept.map((p) => p.slice(common));
  const keys = [...new Set(rests.map((r) => r[0]!.key))];
  if (keys.includes('')) return { extract: pickText(prefix), approximate: true };
  const approximate = rests.some((r) => r.length > 1);
  return { extract: [...prefix.map(segText), `{${keys.join(',')}}`].join('.'), approximate };
}

// An extract path as the picks it is made of (so the keys show picked); undefined when it is not one
// this builds (a position in a list, "data.0.name").
export function picksOf(extract: string | undefined): Pick[] | undefined {
  const text = extract?.trim();
  if (!text) return [];
  const parts = text.split('.');
  const segs: Seg[] = [];
  for (const [i, part] of parts.entries()) {
    const keys = /^\{(.*)\}$/.exec(part)?.[1];
    if (keys !== undefined) {
      if (i !== parts.length - 1) return undefined;
      const names = keys.split(',').map((k) => k.trim()).filter(Boolean);
      return names.map((k) => [...segs, { key: k, each: false }]);
    }
    const each = part.endsWith('[]');
    const key = each ? part.slice(0, -2) : part;
    if (/^\d+$/.test(key) || /[[\]{}]/.test(key) || (!key && !each)) return undefined;
    segs.push({ key, each });
  }
  return [segs];
}

// A key clicked: added to the picks of the path, or taken out when it is one of them.
export function togglePick(extract: string | undefined, pick: Pick): { extract: string; approximate: boolean } {
  const picks = picksOf(extract) ?? [];
  const text = pickText(pick);
  const has = picks.some((p) => pickText(p) === text);
  return extractOf(has ? picks.filter((p) => pickText(p) !== text) : [...picks, pick]);
}

// How a key of the answer stands: one of the picks, inside one, or neither.
export function pickState(pick: Pick, picks: Pick[]): 'picked' | 'inside' | undefined {
  const text = pickText(pick);
  if (picks.some((p) => pickText(p) === text)) return 'picked';
  return picks.some((p) => holds(p, pick)) ? 'inside' : undefined;
}

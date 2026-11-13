// A change to the settings as data, so that it can be handed to another context (the background
// stores a page's changes: core/protocol SETTINGS_EDIT) and applied there to the settings as stored:
// each step sets a value at a path, or removes what is there. Nothing in it is a function.
import type { Settings } from './settings-types';

export type SettingsEditStep = { path: string[]; value: unknown } | { path: string[]; removed: true };
export type SettingsEdit = SettingsEditStep[];

type Obj = Record<string, unknown>;
const isPlain = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

// The fields a patch sets, each replaced whole (as `{ ...stored, ...patch }`); one set to undefined is removed.
export function patchEdit(patch: Partial<Settings>): SettingsEdit {
  return Object.entries(patch).map(([k, value]) => (value === undefined ? { path: [k], removed: true } : { path: [k], value }));
}

// What changed from `prev` to `next`, as finely as their objects go: a field of an object changed
// (or made) alone is set alone, so that a change made elsewhere to another field of it stays. A list, or a
// value that is not an object on both sides, is set whole.
export function diffEdit(prev: Settings, next: Settings): SettingsEdit {
  const out: SettingsEdit = [];
  const walk = (a: Obj, b: Obj, path: string[]) => {
    for (const k of Object.keys(b)) {
      const [x, y] = [a[k], b[k]];
      if (x === y) continue;
      if (isPlain(x) && isPlain(y)) walk(x, y, [...path, k]);
      // An object made where there was none: its fields too (applyEdit makes it again).
      else if (x === undefined && isPlain(y) && Object.keys(y).length) walk({}, y, [...path, k]);
      else if (y === undefined) {
        if (k in a && x !== undefined) out.push({ path: [...path, k], removed: true });
      } else out.push({ path: [...path, k], value: y });
    }
    for (const k of Object.keys(a)) if (!(k in b) && a[k] !== undefined) out.push({ path: [...path, k], removed: true });
  };
  walk(prev as unknown as Obj, next as unknown as Obj, []);
  return out;
}

// The edit applied to `stored`, a copy made along each path changed (the rest shared). Where a path
// goes through something that is not an object there, an object is made for a value set, and a
// removal has nothing to remove.
export function applyEdit(stored: Settings, edit: SettingsEdit): Settings {
  const set = (obj: Obj, path: string[], step: SettingsEditStep): Obj => {
    const [k, ...rest] = path as [string, ...string[]];
    const out = { ...obj };
    if (rest.length) {
      const inner = obj[k];
      if (!isPlain(inner) && 'removed' in step) return obj;
      out[k] = set(isPlain(inner) ? inner : {}, rest, step);
    } else if ('removed' in step) delete out[k];
    else out[k] = step.value;
    return out;
  };
  let s = stored as unknown as Obj;
  for (const step of edit) if (step.path.length) s = set(s, step.path, step);
  return s as unknown as Settings;
}

// What a runtime message may carry as an edit: anything else is refused, not applied.
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
export const isSettingsEdit = (v: unknown): v is SettingsEdit =>
  Array.isArray(v) &&
  v.every((s) => isPlain(s) && Array.isArray(s.path) && s.path.length > 0 && s.path.every((p) => typeof p === 'string' && !FORBIDDEN.has(p)) && ('value' in s || s.removed === true));

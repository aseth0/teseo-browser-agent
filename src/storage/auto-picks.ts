// What memory, bookmarks and saved conversations attach on their own (Auto-attach): from those ranked
// against a text, the ones `keep` lets through over the match needed or that `alsoPasses` lets through
// under it (memory, by meaning), the best first, at most `max`; none while it is off.
import { attachMax } from './settings-select';
import type { AttachDefaults, MatchAttach } from './settings-types';

export function autoPicks<R extends { match: number }>(ranked: R[], auto: MatchAttach | undefined, defaults: AttachDefaults, keep: (r: R) => boolean = () => true, alsoPasses: (r: R) => boolean = () => false): R[] {
  if (!auto?.enabled) return [];
  const threshold = auto.threshold ?? defaults.threshold;
  return ranked.filter((r) => keep(r) && (r.match * 100 >= threshold || alsoPasses(r))).slice(0, attachMax(auto, defaults));
}

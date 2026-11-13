// The conditions a wait (browser.wait_for) or a tab watch waits for, in the model's words (TEXT_DEFS
// wait.*), from what the page reports (content/watch Condition): met, or not yet.
import { text } from '../core/model-texts';
import type { Condition } from '../content/watch';

export function conditionText(c: Condition | string, met: boolean): string {
  if (typeof c === 'string') return c; // reported by an earlier version, already in words
  if (c.kind === 'stable') return text(met ? 'wait.stable' : 'wait.changing', { ms: String(c.ms) });
  if (c.kind === 'gone') return text(met ? 'wait.gone' : 'wait.still_there', { query: c.query });
  return text(met ? 'wait.appeared' : 'wait.not_appeared', { query: c.query });
}

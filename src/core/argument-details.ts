// The arguments of a call as fields of its confirmation card: text as it is (a block when it has
// several lines), anything else as JSON.
import type { ActionDetail } from './types';

export function argumentDetails(args: unknown): ActionDetail[] {
  return Object.entries((args ?? {}) as Record<string, unknown>).map(([label, v]) =>
    typeof v === 'string' ? { label, value: v, code: v.includes('\n') } : { label, value: JSON.stringify(v, null, 2), code: typeof v === 'object' && v !== null },
  );
}

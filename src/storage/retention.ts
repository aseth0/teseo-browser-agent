// A retention's days or count as applied (Settings → History, and an imported History setting): a
// whole number from 1 up; anything else (0, 0.5, a negative number, text, as an imported file may
// have) is none, and keeps them all.
export const retentionLimit = (v: unknown): number | undefined => (Number.isInteger(v) && (v as number) >= 1 ? (v as number) : undefined);

import { clock } from '../audio/transcript';

// The time since `from` as m:ss (h:mm:ss past an hour, as a transcript's times), for what runs (the
// popup's Record and Audio lines).
export const elapsed = (from: number, to = Date.now()): string => clock((to - from) / 1000);

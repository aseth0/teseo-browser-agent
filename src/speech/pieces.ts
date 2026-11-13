// A text cut into pieces, each what one request to the text-to-speech model speaks. Never the whole text
// at once: a server that runs its model on a CPU takes a while per piece, so the first one is short and
// the voice starts at once, while the next downloads as it plays.

// The pieces' sizes in characters (Settings → Speak): the first, and each one after it.
export const FIRST_PIECE = { default: 120, min: 40, max: 2000 };
export const PIECE_SIZE = { default: 300, min: 40, max: 2000 };
export const clampSize = (v: number | undefined, size: typeof FIRST_PIECE): number =>
  v === undefined || !Number.isFinite(v) ? size.default : Math.min(size.max, Math.max(size.min, Math.round(v)));

// Where a sentence longer than a piece is cut: after the last comma, colon or closing bracket that fits,
// where a voice would pause anyway; with none past the piece's first third, at the last space.
export function cutPoint(sentence: string, limit: number): number {
  const head = sentence.slice(0, limit);
  let cut = -1;
  for (const pause of head.matchAll(/[,;:)\]»—]\s/g)) cut = pause.index + 1;
  if (cut < limit / 3) cut = head.lastIndexOf(' ');
  return cut > 0 ? cut : limit;
}

// Whole sentences while they fit: `first` characters for the first piece, `rest` for the others. A
// sentence ends at its mark before a space, so "1.15" and "file.mp3" stay whole; a line break ends one too.
export function pieces(text: string, first: number, rest: number): string[] {
  const sentences = text.split(/(?<=[.!?…]["»)\]]*)\s+|\s*\n+\s*/).filter((sentence) => sentence.trim());
  const out: string[] = [];
  let piece = '';
  const limit = () => (out.length ? rest : first);
  const flush = () => {
    if (piece.trim()) out.push(piece.trim());
    piece = '';
  };
  for (const sentence of sentences) {
    if (piece && piece.length + 1 + sentence.length > limit()) flush();
    let left = sentence.trim();
    while (left.length > limit()) {
      const cut = cutPoint(left, limit());
      piece = left.slice(0, cut);
      flush();
      left = left.slice(cut).trim();
    }
    piece = piece ? `${piece} ${left}` : left;
  }
  flush();
  return out;
}

// Whether piece `i` stops inside a sentence, the next piece going on with it: its clip's closing
// silence (a full stop's pause) is trimmed, so the next follows as after a comma.
export const isMidSentence = (parts: readonly string[], i: number): boolean => i + 1 < parts.length && !/[.!?…]["»)\]]*$/.test(parts[i] ?? '');

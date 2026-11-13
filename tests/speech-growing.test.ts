import { describe, expect, it } from 'vitest';
import { finalPieces, plannedFrom, wholeSentencesEnd } from '../src/speech/growing';
import { pieces } from '../src/speech/pieces';

// A text read while it is written: which pieces are final, so that what was sent never changes.
const S1 = 'The prices rose this week in every store we checked.'; // 52
const S2 = 'Bread and milk went up the most, by about a tenth.'; // 50
const S3 = 'Fruit stayed where it was.';

describe('the final pieces of a text still written', () => {
  it('none while the first piece could still take more', () => {
    expect(finalPieces(S1, false, 120, 300)).toEqual([]);
    expect(finalPieces(`${S1} ${S2}`, false, 120, 300)).toEqual([]); // 103: a short sentence would still fit
  });

  it('the first once the sentence being written would not fit in it, before that sentence ends', () => {
    expect(finalPieces(`${S1} ${S2} ${S3.slice(0, 20)}`, false, 120, 300)).toEqual([`${S1} ${S2}`]);
  });

  it('never a sentence still being written; all of it once done', () => {
    const text = `${S1} ${S2} ${S3} And the`;
    expect(finalPieces(text, false, 60, 60).join(' ')).not.toContain('And the');
    expect(finalPieces(text, true, 60, 60)).toEqual(pieces(text, 60, 60));
  });

  it('what is final stays as it was while the text grows', () => {
    const full = `${S1} ${S2} ${S3} ${S1} ${S2} ${S3} ${S1}`;
    let before: string[] = [];
    for (let n = 1; n <= full.length; n++) {
      const now = finalPieces(full.slice(0, n), false, 60, 80);
      expect(now.slice(0, before.length)).toEqual(before);
      before = now;
    }
    expect(finalPieces(full, true, 60, 80).slice(0, before.length)).toEqual(before);
  });

  it('a line break ends a sentence', () => {
    expect(wholeSentencesEnd('One line\nanother')).toBe(9);
    expect(wholeSentencesEnd('Version 1.15 is out')).toBe(0);
  });

  it('as said, a piece that stops mid-sentence trimmed, the last one of a text done not', () => {
    expect(plannedFrom(['Uno, dos,', 'tres.', 'cuatro,'], 1, false, {})).toEqual([{ input: 'tres.', trim: false }, { input: 'cuatro,', trim: true }]);
    expect(plannedFrom(['Uno,', 'dos,'], 0, true, {})).toEqual([{ input: 'Uno,', trim: true }, { input: 'dos,', trim: false }]);
  });
});

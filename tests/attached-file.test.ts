// A text file attached to a message: its block, cut to its limit with a note, and kept as yours.
import { afterEach, describe, expect, it } from 'vitest';
import { fileBlock, filePart } from '../src/context/attached-file';
import { attachedByYou, fileOf } from '../src/context/sources';
import { clearKept, keep, readKept } from '../src/core/kept-results';
import { cutsIn, stripMarks, withMarkedValues } from '../src/core/model-texts';
import { setLimitOverrides } from '../src/core/limits';

afterEach(() => {
  setLimitOverrides({});
  clearKept();
});

describe('an attached file', () => {
  it('goes whole within its limit, by its name, with nothing to keep', () => {
    const { block, kept } = fileBlock('notes.md', '# Notes\n- one');
    expect(stripMarks(block)).toBe('<attached_file name="notes.md">\n# Notes\n- one\n</attached_file>');
    expect(kept).toBeUndefined();
  });

  it('is cut past Settings → Limits, with a note tools.read_more reads on by', () => {
    setLimitOverrides({ attachedFile: 2000 });
    const { block, kept } = withMarkedValues(() => fileBlock('big.txt', 'x'.repeat(2500))); // cut notes are written while marking
    expect(stripMarks(block)).toContain(`${'x'.repeat(2000)}\n`);
    expect(stripMarks(block)).not.toContain('x'.repeat(2001));
    expect(stripMarks(block)).toContain(`…[cut at 2000 of 2500 characters: tools__read_more with id "${kept!.id}" reads on]`);
    expect(cutsIn(block)).toEqual(['Attached file (Attach → File…): cut at 2,000 of 2,500 characters']);
    expect(kept).toMatchObject({ text: 'x'.repeat(2500), source: 'file:big.txt', limit: 'attachedFile', next: 2000 });
  });

  it('is read on once the background keeps what the message sent', () => {
    setLimitOverrides({ attachedFile: 2000 });
    const content = 'a'.repeat(2000) + 'b'.repeat(500);
    const { kept } = filePart('big.txt', content);
    keep('c1', kept!);
    const next = readKept('c1', kept!.id, 10000);
    expect(next?.source).toBe('file:big.txt');
    expect(stripMarks(next!.part)).toBe('b'.repeat(500));
  });

  it('is named by its source and stays when the message is sent again', () => {
    const { part } = filePart('data.csv', 'a,b');
    expect(part).toMatchObject({ type: 'text', context: 'page', source: 'file:data.csv' });
    expect(fileOf(part.type === 'text' ? part.source : undefined)).toBe('data.csv');
    expect(attachedByYou('file:data.csv')).toBe(true);
    expect(attachedByYou('recording:shop.test:3')).toBe(true);
    expect(attachedByYou('page-block')).toBe(false);
  });
});

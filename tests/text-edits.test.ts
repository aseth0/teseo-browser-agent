import { describe, expect, it } from 'vitest';
import { applyEdits, editedText } from '../src/tools/text-edits';
import { lineDiff } from '../src/tools/line-diff';
import { withChanges } from '../src/tools/reviewed-save';

const where = { field: 'the instructions', read: 'skills__read', missing: 'There is no skill "x" to edit: give the whole "instructions" to create it.' };

describe('find/replace edits', () => {
  it('applies them in order, each on the result of the one before', () => {
    const r = applyEdits('1. Open.\n2. Click.\n3. Read.', [{ old: '2. Click.', new: '2. Press.' }, { old: 'Press', new: 'Push' }], where);
    expect(r).toEqual({ text: '1. Open.\n2. Push.\n3. Read.', problems: [] });
  });

  it('says which "old" is missing, and how to fix it', () => {
    const r = applyEdits('1. Open.', [{ old: '1. Open', new: 'Go' }, { old: '2. Click.', new: '' }], where);
    expect(r.text).toBe('Go.');
    expect(r.problems).toEqual([
      'Edit 2: this "old" is not in the instructions: "2. Click.". Copy it exactly from skills__read, spaces and line breaks included (edits apply in order, each after the ones before it).',
    ]);
  });

  it('refuses an "old" that appears more than once, or none', () => {
    const r = applyEdits('Click.\nClick.', [{ old: 'Click.', new: 'Tap.' }, { old: '', new: 'x' }], where);
    expect(r.text).toBe('Click.\nClick.');
    expect(r.problems).toEqual([
      'Edit 1: this "old" appears 2 times in the instructions: "Click.". Quote more of the text around it, so that it appears once.',
      'Edit 2: "old" is empty; give the text to replace. To add text, put in "old" the text it goes after and in "new" that text followed by the new one.',
    ]);
  });

  it('shows the closest text when an "old" differs in spaces, escaping or a few characters', () => {
    const code = 'const msg = input.q;\nif (!msg) throw new Error("empty prompt");\nreturn msg;';
    const near = (old: string) => applyEdits(code, [{ old, new: '' }], where).problems[0];
    const shown = (text: string) => ` The closest text in it, as a JSON string to copy into "old": ${JSON.stringify(text)}`;
    expect(near('if (!msg)   throw new Error("empty prompt");\n return')).toContain(shown('if (!msg) throw new Error("empty prompt");\nreturn'));
    expect(near('if (!msg) throw new Error(\\"empty prompt\\");\\nreturn')).toContain(shown('if (!msg) throw new Error("empty prompt");\nreturn'));
    expect(near('if (!msg) throw new_error("empty promt");')).toContain(shown('if (!msg) throw new Error("empty prompt");'));
    expect(near('something else entirely')).not.toContain('closest');
  });

  it('says how to add or replace all, for an empty "old", and refuses edits sent as text', () => {
    expect(editedText({ edits: [{ old: '', new: 'More.' }] }, 'instructions', 'Old.', where).problems).toEqual([
      'Edit 1: "old" is empty; give the text to replace. To add text, put in "old" the text it goes after and in "new" that text followed by the new one; to replace all of it, give the whole "instructions" instead of edits.',
    ]);
    expect(editedText({ edits: '>\n[{"old": "a"' }, 'instructions', 'Old.', where).problems).toEqual(['"edits" is a list of objects, [{"old": "…", "new": "…"}], not a text: it was not JSON.']);
  });

  it('keeps "$" in the new text as written', () => {
    expect(applyEdits('price', [{ old: 'price', new: '$& $1' }], where).text).toBe('$& $1');
  });

  it('takes the whole text, edits of the saved one, or neither, never both', () => {
    expect(editedText({ instructions: 'All.' }, 'instructions', 'Old.', where)).toEqual({ text: 'All.', problems: [] });
    expect(editedText({}, 'instructions', 'Old.', where)).toEqual({ text: undefined, problems: [] });
    expect(editedText({ edits: [{ old: 'Old', new: 'New' }] }, 'instructions', 'Old.', where)).toEqual({ text: 'New.', problems: [] });
    expect(editedText({ instructions: 'All.', edits: [] }, 'instructions', 'Old.', where).problems).toEqual(['Give either "instructions" or "edits", not both.']);
    expect(editedText({ edits: [{ old: 'a', new: 'b' }] }, 'instructions', undefined, where).problems).toEqual([where.missing]);
  });
});

describe('the line diff', () => {
  it('marks the lines added, removed and kept', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc\nd')).toBe('  a\n− b\n+ B\n  c\n+ d');
    expect(lineDiff('', 'x\ny')).toBe('+ x\n+ y');
    expect(lineDiff('x', '')).toBe('− x');
  });

  it('folded, keeps two lines around each change', () => {
    const before = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].join('\n');
    const after = before.replace('5', 'five');
    expect(lineDiff(before, after, true)).toBe('⋯ 2 unchanged lines\n  3\n  4\n− 5\n+ five\n  6\n  7\n⋯ 2 unchanged lines');
    expect(lineDiff('1\n2\n3\n4', '1\n2\n3\nfour', true)).toBe('⋯ 1 unchanged line\n  2\n  3\n− 4\n+ four');
  });
});

describe('the card of an update', () => {
  const card = (details: { label: string; value: string; code?: boolean; key?: string }[]) => ({ summary: 'Update', details });

  it('shows a new item as it is', () => {
    const after = card([{ label: 'Instructions', value: 'a', code: true }]);
    expect(withChanges(after, undefined)).toBe(after);
  });

  it('diffs what changes, keeps what does not, and adds what was taken out', () => {
    const before = card([
      { label: 'Description', value: 'Old.' },
      { label: 'Websites', value: '*://a.example.com/*' },
      { label: 'Instructions', value: 'a\nb', code: true },
      { label: 'View "old"', value: 'x', code: true, key: 'view:old' },
      { label: 'View "main" · paths: /a', value: 'm', code: true, key: 'view:main' },
    ]);
    const after = card([
      { label: 'Description', value: 'New.' },
      { label: 'Websites', value: '*://a.example.com/*' },
      { label: 'Instructions', value: 'a\nb', code: true },
      { label: 'View "main" · paths: /b', value: 'm', code: true, key: 'view:main' },
      { label: 'View "new"', value: 'n', code: true, key: 'view:new' },
    ]);
    expect(withChanges(after, before).details).toEqual([
      { label: 'Description', value: '− Old.\n+ New.', diff: true },
      { label: 'Websites', value: '*://a.example.com/*' },
      { label: 'Instructions', value: 'Unchanged' },
      { label: 'View "main" · paths: /b (was: View "main" · paths: /a)', value: 'Unchanged' },
      { label: 'View "new"', value: '+ n', diff: true, code: true },
      { label: 'View "old"', value: '− x', diff: true, code: true },
    ]);
  });
});

// The tools the model saves things with (skills.save, templates.save, custom_tools.save, actions.save).
// The arguments are drafted into the item first: one that cannot be saved is refused, saying why,
// before the user is asked; otherwise the user reviews it every time (an update, as what changes:
// withChanges), and it is drafted again (from the same arguments) to be saved. The user may edit its
// main fields on the card first (edit): those values replace the call's, checked the same way.
// The tools that delete them are reviewed the same way.
import type { ActionDescription, ActionDetail, Tool, ToolContext } from '../core/types';
import { stringList } from '../storage/import';
import { fields } from './define';
import { lineDiff } from './line-diff';

// The `name` argument of a call, trimmed ('' when there is none).
export const nameArg = (args: unknown): string => String(fields(args).name ?? '').trim();

// A list argument: its strings trimmed, the empty ones left out; a single string is a list of one.
export const listArg = (v: unknown): string[] => stringList(v, { trim: true });

// What keeps an item from being saved (or tried): one line each.
export const notDone = (done: string, problems: string[]) => `Not ${done}:\n- ${problems.join('\n- ')}`;
export const notSaved = (problems: string[]) => notDone('saved', problems);

// What a save keeps of the item it updates: whether it is on (a new one is), and who made it (the
// user's stays the user's).
export const draftMeta = (existing: { enabled: boolean; createdBy?: 'model' } | undefined): { enabled: boolean; createdBy?: 'model' } => ({
  enabled: existing?.enabled ?? true,
  createdBy: existing ? existing.createdBy : 'model',
});

// The card of an update: each field as the saved item has it (`before`, its card) and as it would be
// (`after`), matched by key: a field that changes as a line diff (code folded around the changes), one
// added or taken out as all added or all removed, code that stays as "Unchanged", any other as it is.
// Without `before` (a new item), the card as it is.
export function withChanges(after: ActionDescription, before: ActionDescription | undefined): ActionDescription {
  if (!before) return after;
  const keyOf = (d: ActionDetail) => d.key ?? d.label;
  const was = new Map(before.details?.map((d) => [keyOf(d), d]));
  const now = new Set(after.details?.map(keyOf));
  const diffed = (label: string, from: string, to: string, code?: boolean): ActionDetail => ({ label, value: lineDiff(from, to, code), diff: true, ...(code && { code }) });
  const changed = (d: ActionDetail): ActionDetail => {
    const b = was.get(keyOf(d));
    const label = b && b.label !== d.label ? `${d.label} (was: ${b.label})` : d.label;
    if (b?.value === d.value) return d.code ? { label, value: 'Unchanged' } : { ...d, label };
    return diffed(label, b?.value ?? '', d.value, d.code);
  };
  const removed = (before.details ?? []).filter((d) => !now.has(keyOf(d)));
  return { ...after, details: [...(after.details ?? []).map(changed), ...removed.map((d) => diffed(d.label, d.value, '', d.code))] };
}

// A field the user may edit on the card: the argument it sets (a dotted path: "script.code"), the
// label of the card's detail it goes with, and its whole proposed value (a list, one per line). One
// that sets the text the call's partial edits change replaces them.
export interface EditField {
  field: string;
  label: string;
  value: string;
  lines?: 'list' | 'text';
  replacesEdits?: boolean;
}

interface EditSteps<D> {
  fields(draft: D): EditField[];
  isUpdate(draft: D): boolean;
  // A new item's name, editable too (an update's is what identifies it); kind, as the user reads it,
  // for "A skill named … already exists".
  name?: { of(draft: D): string; kind: string };
}

interface SaveSteps<D extends { problems: string[] }> {
  draft(args: unknown, ctx: ToolContext): Promise<D>;
  review(draft: D, args: unknown, ctx: ToolContext): ActionDescription | Promise<ActionDescription>; // may refuse it too (throw)
  save(draft: D): Promise<string>; // what the model is told
  edit?: EditSteps<D>; // the fields the user may edit on the card
}

// The fields of a draft the user may edit: a new item's name first.
function editFields<D>(edit: EditSteps<D>, draft: D): EditField[] {
  const name = edit.name && !edit.isUpdate(draft) ? [{ field: 'name', label: 'Name', value: edit.name.of(draft) }] : [];
  return [...name, ...edit.fields(draft)];
}

// The card with the fields the user may edit: each on the detail it goes with (by key, else label), or
// in a row of its own, first, shown only while editing.
export function withEditFields(card: ActionDescription, editable: EditField[]): ActionDescription {
  const details = card.details ?? [];
  const keyOf = (d: ActionDetail) => d.key ?? d.label;
  const editOf = ({ field, value, lines }: EditField) => ({ field, value, ...(lines && { lines }) });
  const shown = details.map((d) => {
    const f = editable.find((e) => e.label === keyOf(d));
    return f ? { ...d, edit: editOf(f) } : d;
  });
  const own = editable.filter((e) => !details.some((d) => keyOf(d) === e.label)).map((e) => ({ label: e.label, value: '', editOnly: true, edit: editOf(e) }));
  return { ...card, details: [...own, ...shown] };
}

// The call's arguments with the user's values, for the fields they may edit (any other is left out):
// each set at its path, a list split by lines; one that replaces the partial edits drops them.
export function argsWithEdits(args: unknown, edits: Record<string, string>, editable: EditField[]): Record<string, unknown> {
  const out: Record<string, unknown> = structuredClone(fields(args));
  for (const f of editable) {
    const value = edits[f.field];
    if (value === undefined) continue;
    const path = f.field.split('.');
    const last = path.pop()!;
    let at = out;
    for (const key of path) {
      const inner = { ...fields(at[key]) };
      at[key] = inner;
      at = inner;
    }
    at[last] = f.lines === 'list' ? listArg(value.split('\n')) : value;
    if (f.replacesEdits) delete out.edits;
  }
  return out;
}

export function reviewedSaveTool<D extends { problems: string[] }>(tool: Pick<Tool, 'name' | 'description' | 'inputSchema' | 'source'>, steps: SaveSteps<D>): Tool {
  const { edit } = steps;
  return {
    ...tool,
    effect: 'write',
    alwaysAsk: true,
    describe: async (args, ctx) => {
      const draft = await steps.draft(args, ctx);
      if (draft.problems.length) throw new Error(notSaved(draft.problems));
      const card = await steps.review(draft, args, ctx);
      return edit ? withEditFields(card, editFields(edit, draft)) : card;
    },
    ...(edit && { withEdits: async (args: unknown, edits: Record<string, string>, ctx: ToolContext) => {
      const proposed = await steps.draft(args, ctx);
      const changed = argsWithEdits(args, edits, editFields(edit, proposed));
      const draft = await steps.draft(changed, ctx);
      if (draft.problems.length) throw new Error(notSaved(draft.problems));
      // A new name that is taken would update that item instead.
      if (!edit.isUpdate(proposed) && edit.isUpdate(draft)) throw new Error(`A ${edit.name?.kind ?? 'item'} named "${nameArg(changed)}" already exists: choose another name.`);
      return changed;
    } }),
    run: async (args, ctx) => {
      const draft = await steps.draft(args, ctx);
      if (draft.problems.length) return { type: 'text', text: notSaved(draft.problems), isError: true };
      return { type: 'text', text: await steps.save(draft) };
    },
  };
}

interface DeleteSteps<T> {
  find(args: unknown, ctx: ToolContext): Promise<T>; // the item the call names; throws when there is none it may delete
  review(item: T): ActionDescription;
  remove(item: T): Promise<string>; // what the model is told
}

// The user reviews what is deleted every time; the item is looked up again to be deleted.
export function reviewedDeleteTool<T>(tool: Pick<Tool, 'name' | 'description' | 'inputSchema' | 'source'>, steps: DeleteSteps<T>): Tool {
  return {
    ...tool,
    effect: 'write',
    alwaysAsk: true,
    describe: async (args, ctx) => steps.review(await steps.find(args, ctx)),
    run: async (args, ctx) => ({ type: 'text', text: await steps.remove(await steps.find(args, ctx)) }),
  };
}

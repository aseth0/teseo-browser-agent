// The tab a browser tool acts on: the one its call names, or the panel's.
import type { ToolContext } from '../../core/types';
import { text } from '../../core/model-texts';
import { namedTab } from '../../core/util';
import { fields } from '../define';

export const tabIdProp = { tabId: { type: 'number', description: "Tab from browser__list_tabs; default: this chat's tab (workingOn), even if the user switched." } };

// For Tool.tabOf: the tab the policy judges the call by (none: the panel's).
export const tabOfArgs = (args: unknown): number | undefined => namedTab(args);

// The tab it acts on: the one it names, else the panel's. One it names wrongly is refused, not taken
// for the panel's, which the policy did not judge it by.
export function targetTab(args: unknown, ctx: ToolContext): number {
  const given = fields(args).tabId;
  const id = given === undefined || given === null ? ctx.tabId : namedTab(args);
  if (given !== undefined && given !== null && id === undefined) throw new Error(text('error.not_a_tab_id', { given: JSON.stringify(given) }));
  if (id === undefined) throw new Error(text('error.no_active_tab'));
  return id;
}

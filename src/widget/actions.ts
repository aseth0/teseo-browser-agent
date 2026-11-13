// The page widget's actions (Settings → Actions): a button in a box injected into matching pages
// that runs a tool and shows its answer as a card; with a prompt, the model answers too (the tool's
// answer, if any, goes with the prompt). The background runs them; the widget in the page only gets
// their names and the lines to show.
import type { CollectionItem } from '../storage/collection';
import type { ThinkingLevel } from '../core/types';
import { matchesAny } from '../skills/match';
import { parseVariable } from '../skills/variables';
import { fillTemplate, placeholdersOf } from '../tools/custom/values';
import { hostOf } from '../core/util';
import { patternHost } from '../page/permissions';
import { agentAllows, type AgentProfile } from '../agents/profiles';
import { DEFAULT_AGENT_ID } from '../agents/builtins';
import { neutralizeTags, text } from '../core/model-texts';
import { MAX_PAGE_VALUE } from './protocol';
import { hasSteps, pathProblems, readStepsOf, stepProblems, type ActionStep } from './steps';

// What the user gives the action: nothing, a text (pre-filled with the page's selection), or the
// selection itself.
export type ActionInput = 'none' | 'text' | 'selection';
export const ACTION_INPUTS: { value: ActionInput; label: string }[] = [
  { value: 'text', label: 'A text (pre-filled with the selection)' },
  { value: 'selection', label: 'The selected text' },
  { value: 'none', label: 'Nothing' },
];

// A box of the card: the part of the tool's answer at `from`; each element of a list is a line,
// written by `text` and linked by `link` ({key} templates on the element, {value} for a plain one).
// With a prompt, the model's answer: all of it in the only box, or with several, its key in the JSON
// the model is asked for (`from`).
export interface ActionOutput {
  label: string;
  from?: string; // a path, as in an HTTP tool's answer: "[].title", "query.search[].{title,pageid}"
  text?: string; // "{full_name} ★ {stargazers_count}"; none: the element's values
  link?: string; // "https://en.wikipedia.org/wiki/{title}"
}

export interface WidgetAction extends CollectionItem {
  name: string; // the button's tooltip
  icon?: string; // the button: an emoji or a few characters; none: the name's first letter
  where: string[]; // URL match patterns; none: every site granted one by one
  input: ActionInput;
  placeholder?: string;
  tool: string; // by name: it keeps its headers, session, effect and site policy; none: only the model
  args: Record<string, string>; // templates with {input}
  prompt?: string; // for the model, with {input}; none: the tool's answer is shown as it is
  providerId?: string; // its model; none: its agent's, else the chat's
  model?: string;
  thinking?: ThinkingLevel; // how much the model reasons; none: as the chat has it for that model
  outputs: ActionOutput[];
  agent?: string; // the agent it belongs to, by id: only its tools, only on its sites; none: Default
  openChat?: boolean; // instead of a card: the chat opens with the prompt, sent at once (its agent's conversation)
  when?: 'click' | 'load'; // none: on click. On load: a tool that reads, no prompt, nothing to type
  reads?: Record<string, string>; // values from the page, by name: {{selector:…}}, {{meta:…}}, {{schema:…}}, {{url}}; used as {name}
  createdBy?: 'model'; // saved by the model (actions.save), after the user approved it
  // Steps instead of its tool and prompt (widget/steps); the boxes' paths then start with a step's name.
  steps?: ActionStep[];
  badge?: string; // a path, as the boxes': what the bubble shows on page load (a number, ✓ or ✗)
  chatButtons?: boolean; // its card goes on in the chat: here (floating) or in the side panel
  speak?: ActionSpeak; // its boxes read aloud: which voice, and when (none: its agent's, on a click)
  besideSelection?: true; // a button for it beside the text selected on its sites, next to the selection's speaker
}
// How an action's boxes of text are read aloud (Settings → Speak): `profileId` a voice profile instead of
// its agent's (one removed: its agent's); `when` 'shown': on their own, one after another, as soon as they
// show in its card (an action on page load: when its card opens); none: when their speaker is clicked.
export interface ActionSpeak {
  profileId?: string;
  when?: 'shown';
}
export const readsOnItsOwn = (action: Pick<WidgetAction, 'speak' | 'openChat'>) => !action.openChat && action.speak?.when === 'shown';
// An action's own reading, kept only for what it sets: none for a default one.
export const actionSpeakOf = (v: unknown): ActionSpeak | undefined => {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const out: ActionSpeak = {
    ...(typeof o.profileId === 'string' && o.profileId && { profileId: o.profileId }),
    ...(o.when === 'shown' && { when: 'shown' as const }),
  };
  return Object.keys(out).length ? out : undefined;
};

// Whether it shows beside the selected text: marked so, on a click, taking a text or the selection.
export const showsBesideSelection = (action: Pick<WidgetAction, 'besideSelection' | 'input' | 'when'>) =>
  !!action.besideSelection && !onLoad(action) && (action.input === 'selection' || action.input === 'text');

export const INPUT = '{input}';
// The name of a value an action reads from the page: what its parameters use, {owner}.
const READ_NAME = /^[a-z][a-z0-9_]*$/;
export const onLoad = (action: Pick<WidgetAction, 'when'>) => action.when === 'load';
const JSON_KEY = /^[A-Za-z_]\w*$/;
// Whether the model answers in JSON, one key per box.
export const answersInJson = (action: Pick<WidgetAction, 'prompt' | 'outputs' | 'openChat' | 'steps'>) => !action.openChat && !hasSteps(action) && !!action.prompt?.trim() && action.outputs.length > 1;
// What it reads from the page: its values and its read steps', by name.
export const allReads = (action: Pick<WidgetAction, 'reads' | 'steps'>): Record<string, string> => ({ ...action.reads, ...readStepsOf(action) });
// Those it reads as {{page}}, the page's main text: by name. The background reads them (background/
// widget-page-text), with Settings → Limits' size for them; the widget in the page reads the others.
const readsPage = (token: string) => parseVariable(token.trim())?.kind === 'page';
export const pageTextNames = (action: Pick<WidgetAction, 'reads' | 'steps'>): string[] => Object.entries(allReads(action)).filter(([, token]) => readsPage(token)).map(([name]) => name);
export const widgetReads = (action: Pick<WidgetAction, 'reads' | 'steps'>): Record<string, string> => Object.fromEntries(Object.entries(allReads(action)).filter(([, token]) => !readsPage(token)));

// The action's prompt with what it takes and reads in it: the model's, or the message sent to the chat.
// The values come from the page: their untrusted tags neutralized, and each one wrapped as `wrap` says
// (the model's prompt: in an untrusted block).
export const filledPrompt = (
  action: Pick<WidgetAction, 'prompt'>,
  values: { input: string; reads?: Record<string, string> },
  wrap: (name: string, value: string) => string = (_name, value) => value,
) =>
  fillTemplate(action.prompt!.trim(), (name) => {
    const value = name === 'input' ? values.input : values.reads?.[name];
    return value === undefined ? `{${name}}` : wrap(name, neutralizeTags(value));
  });

// The prompt as the model gets it, each value from the page in an untrusted block: in the card's
// request, and as the user's message in the chat (sent at once, or kept and sent again in the turns
// after it).
export const askedPrompt = (action: Pick<WidgetAction, 'prompt'>, values: { input: string; reads?: Record<string, string> }) =>
  filledPrompt(action, values, (name, value) => text('widget.page_value', { name, value }));

// What a page sent an action, as it may be used: the input a text, and only the values the action
// reads, texts too; each cut to what the widget takes from the page (the input typed in its box may
// be longer than a selection).
const MAX_TYPED_INPUT = 20_000;
export function pageValues(action: Pick<WidgetAction, 'reads' | 'steps'>, req: { input?: unknown; reads?: unknown }): { input: string; reads?: Record<string, string> } {
  const input = typeof req.input === 'string' ? req.input.slice(0, MAX_TYPED_INPUT) : '';
  const given = req.reads && typeof req.reads === 'object' ? (req.reads as Record<string, unknown>) : {};
  const reads = Object.fromEntries(
    Object.keys(allReads(action)).flatMap((name) => {
      const v = Object.hasOwn(given, name) ? given[name] : undefined;
      return typeof v === 'string' ? [[name, v.slice(0, MAX_PAGE_VALUE)]] : [];
    }),
  );
  return { input, ...(Object.keys(reads).length && { reads }) };
}

export const newAction = (): WidgetAction => ({ id: crypto.randomUUID(), enabled: true, name: '', where: [], input: 'text', tool: '', args: {}, outputs: [{ label: 'Result' }] });

// A Chrome match pattern the browser accepts for a content script.
const MATCH_PATTERN = /^(\*|https?):\/\/(\*|\*\.[^/*]+|[^/*]+)\/.*$/;
const isMatchPattern = (p: string) => MATCH_PATTERN.test(p);

// The agent an action belongs to: none for Default's; null when that agent is switched off or gone,
// and then the action is not shown.
export function actionOwner(action: Pick<WidgetAction, 'agent'>, agents: AgentProfile[]): AgentProfile | undefined | null {
  if (!action.agent || action.agent === DEFAULT_AGENT_ID) return undefined;
  return agents.find((a) => a.id === action.agent && a.enabled) ?? null;
}

// The sites granted one by one an action without patterns shows on: all of them, but for an agent
// that uses only its sites, those among them (a pattern has no port: its host's).
const sitesOf = (owner: AgentProfile | undefined, grantedSites: string[]) =>
  owner?.onlyItsSites ? grantedSites.filter((p) => Object.keys(owner.sites).some((site) => site.split(':')[0] === patternHost(p))) : grantedSites;

// Where the widget may show up: the actions' patterns, and the sites granted one by one for the
// actions without any. Never every site.
export function widgetMatches(actions: WidgetAction[], grantedSites: string[], agents: AgentProfile[]): string[] {
  const patterns = actions.flatMap((a) => {
    const owner = actionOwner(a, agents);
    if (!a.enabled || owner === null) return [];
    return a.where.length ? a.where : sitesOf(owner, grantedSites);
  });
  return [...new Set(patterns.filter(isMatchPattern))].sort();
}

// The actions of a page: those switched on whose patterns match it, or with none, on a site granted
// one by one; those of an agent that uses only its sites, only there.
export function actionsFor(actions: WidgetAction[], url: string | undefined, grantedSites: string[], agents: AgentProfile[]): WidgetAction[] {
  return actions.filter((a) => {
    const owner = actionOwner(a, agents);
    if (!a.enabled || owner === null || (owner && !agentAllows(owner, hostOf(url)))) return false;
    return matchesAny(a.where.length ? a.where : sitesOf(owner, grantedSites), url);
  });
}

// What keeps it from being saved; among the others saved (their names are unique: actions.save
// updates the one of its name).
export function actionProblems(action: WidgetAction, others: WidgetAction[] = []): string[] {
  const problems: string[] = [];
  if (!action.name.trim()) problems.push('The action needs a name: it is the button in the page.');
  else if (others.some((o) => o.id !== action.id && o.name.trim() === action.name.trim())) problems.push(`Another action is already named "${action.name.trim()}".`);
  const prompt = action.prompt?.trim();
  if (hasSteps(action)) {
    const steps = stepProblems(action.steps!, action.reads);
    problems.push(...steps);
    if (!steps.length) problems.push(...pathProblems(action));
    if (action.openChat) problems.push('An action with steps shows its answer in a card.');
    if (action.tool || prompt) problems.push('An action with steps runs no tool or prompt of its own: make them steps.');
    if (onLoad(action) && action.input !== 'none') problems.push('An action on page load takes nothing typed: its values come from the page.');
  } else if (action.openChat) {
    if (!prompt) problems.push('Write the message it sends to the chat.');
    if (action.tool) problems.push('An action that opens the chat runs no tool: the chat has the tools. Leave it out.');
    if (onLoad(action)) problems.push('The chat opens on a click, not on page load.');
  } else if (!action.tool && !prompt) problems.push('Choose the tool it runs, or write a prompt for the model.');
  if (!!action.providerId !== !!action.model?.trim()) problems.push("Choose both the provider and the model, or neither (its agent's or the chat's).");
  for (const p of action.where) if (!isMatchPattern(p)) problems.push(`"${p}" is not a URL pattern like https://*.example.com/*.`);
  if (action.input === 'none' && Object.values(action.args).some((t) => t.includes(INPUT))) problems.push(`The action takes no input, but a parameter uses ${INPUT}.`);
  if (action.input === 'none' && prompt?.includes(INPUT)) problems.push(`The action takes no input, but the prompt uses ${INPUT}.`);
  if (onLoad(action) && !hasSteps(action)) {
    if (!action.tool) problems.push('An action on page load runs a tool: choose one.');
    if (prompt) problems.push('An action on page load runs no model: the model answers only on a click. Leave the prompt out.');
    if (action.input !== 'none') problems.push('An action on page load takes nothing typed: its values come from the page.');
  }
  // A parameter's {name}: what it takes ({input}) or a value it reads from the page.
  for (const [param, template] of Object.entries(action.args)) {
    const unknown = placeholdersOf(template).filter((n) => n !== 'input' && !(n in (action.reads ?? {})));
    if (unknown.length) problems.push(`The parameter "${param}" uses ${unknown.map((n) => `{${n}}`).join(', ')}: add ${unknown.length > 1 ? 'them' : 'it'} as a value from the page, or use {input}.`);
  }
  for (const [name, value] of Object.entries(action.reads ?? {})) {
    if (!READ_NAME.test(name) || name === 'input') problems.push(`"${name}" cannot name a value from the page: lowercase letters, digits and _, not "input".`);
    const variable = parseVariable(value.trim());
    if (!variable || variable.kind === 'items') problems.push(`The value "${name}" is read with {{page}}, {{selector:css}}, {{selector:css?attr}}, {{meta:name}}, {{schema:@Type:path}} or {{url}}.`);
  }
  if (answersInJson(action)) {
    const keys = action.outputs.map((o) => o.from?.trim() ?? '');
    keys.forEach((k, i) => !JSON_KEY.test(k) && problems.push(`Box ${i + 1} needs a key for the model's answer: letters, digits and _, e.g. "summary".`));
    if (new Set(keys).size < keys.length) problems.push('Each box needs its own key.');
  }
  if (action.besideSelection && !showsBesideSelection(action)) problems.push('Only an action on a click that takes a text or the selection shows beside selected text.');
  if (!action.openChat && !action.outputs.length && !action.badge?.trim()) problems.push('Add a box for the answer.');
  action.outputs.forEach((o, i) => !o.label.trim() && problems.push(`Box ${i + 1} needs a label.`));
  return problems;
}

// The lines of a box: widget/output-lines (the type, here too, for the widget's views).
export type { OutputLine } from './output-lines';

// The action editor's guide (ui/widget-actions/Editor): what an action is for (its kind), the steps
// each kind has, what choosing a kind or an example sets, where each problem actionProblems finds goes,
// and a name to suggest. Pure, for the editor and its tests.
import type { KindCard } from '../guide';
import { INPUT, onLoad, type WidgetAction } from '../../widget/actions';
import { hasSteps } from '../../widget/steps';

export type ActionKind = 'model' | 'tool' | 'chat' | 'load' | 'steps';

export const ACTION_KINDS: KindCard<ActionKind>[] = [
  { id: 'model', title: 'Answer about the selection', about: 'The model answers about the text you select, or a value from the page, in a card.', example: 'Explain this in plain words' },
  { id: 'tool', title: 'Look it up with a tool', about: 'Runs one of your tools with what it takes and shows its answer as a card.', example: 'Search a wiki for the selected word' },
  { id: 'chat', title: 'Open the chat with a message', about: 'Sends a message to the chat at once, with the page attached; the chat answers.', example: 'Summarize this page' },
  { id: 'load', title: 'Check each page as it loads', about: 'Runs a tool that reads when the page loads; its card shows what it found.', example: 'Open issues for this project' },
  { id: 'steps', title: 'Several steps', about: 'Reads from the page, runs tools and asks the model, one after another; fields or a badge.', example: 'Triage this ticket' },
];

// What an action that exists is, from what it has.
export function kindOf(a: WidgetAction): ActionKind {
  if (hasSteps(a)) return 'steps';
  if (a.openChat) return 'chat';
  if (onLoad(a)) return 'load';
  return a.prompt?.trim() ? 'model' : 'tool';
}

export type ActionStepId = 'kind' | 'where' | 'takes' | 'reads' | 'runs' | 'shows' | 'try' | 'name';
export const EVERY_STEP: ActionStepId[] = ['kind', 'where', 'takes', 'reads', 'runs', 'shows', 'try', 'name'];
export const OPTIONAL_STEPS: ActionStepId[] = ['reads'];

export const STEPS_OF: Record<ActionKind | 'none', ActionStepId[]> = {
  none: ['kind'],
  model: ['kind', 'where', 'takes', 'reads', 'runs', 'shows', 'try', 'name'],
  tool: ['kind', 'where', 'takes', 'reads', 'runs', 'shows', 'try', 'name'],
  chat: ['kind', 'where', 'takes', 'reads', 'runs', 'name'],
  load: ['kind', 'where', 'reads', 'runs', 'shows', 'try', 'name'],
  steps: ['kind', 'where', 'takes', 'reads', 'runs', 'shows', 'try', 'name'],
};

// What choosing a kind sets: the fields that make it that kind, the others of another kind cleared.
// `fresh`: nothing chosen yet, so what it takes and its boxes start as that kind usually has them.
export function kindPatch(kind: ActionKind, d: WidgetAction, fresh: boolean): Partial<WidgetAction> {
  const plain = { openChat: undefined, when: undefined, steps: undefined, badge: undefined, chatButtons: undefined } as const;
  const clicked = d.input === 'none' && onLoad(d) ? 'selection' : d.input;
  switch (kind) {
    case 'model':
      return { ...plain, input: fresh ? 'selection' : clicked, ...(fresh && { besideSelection: true, outputs: [{ label: 'Answer' }] }) };
    case 'tool':
      return { ...plain, prompt: undefined, providerId: undefined, model: undefined, thinking: undefined, input: fresh ? 'text' : clicked, ...(fresh && { outputs: [{ label: 'Result' }] }) };
    case 'chat':
      return { ...plain, openChat: true, tool: '', args: {}, providerId: undefined, model: undefined, thinking: undefined, input: fresh ? 'none' : clicked };
    case 'load':
      return { ...plain, when: 'load', input: 'none', prompt: undefined, providerId: undefined, model: undefined, thinking: undefined, besideSelection: undefined, ...(fresh && { outputs: [{ label: 'Result' }] }) };
    case 'steps':
      return { openChat: undefined, tool: '', args: {}, prompt: undefined, steps: d.steps?.length ? d.steps : [{ name: 'page', read: '{{url}}' }], ...(fresh && { outputs: [{ label: 'Result' }] }) };
  }
}

// What the user may have set that a kind or an example replaces, by how the question names it.
const LOSABLE: [keyof WidgetAction, string][] = [
  ['name', 'its name'], ['icon', 'its icon'], ['prompt', 'its prompt'], ['tool', 'its tool'], ['args', "its tool's parameters"], ['steps', 'its steps'], ['reads', 'its values from the page'],
  ['outputs', 'its boxes'], ['badge', 'its badge'], ['chatButtons', 'its chat buttons'], ['providerId', 'its model'], ['model', 'its model'], ['thinking', 'its thinking level'],
  ['speak', 'its reading aloud'], ['besideSelection', 'Show beside selected text'], ['placeholder', 'the hint in its field'],
];
const empty = (v: unknown) => v === undefined || v === '' || v === false || (typeof v === 'object' && v !== null && !Object.keys(v).length);
// The boxes a kind or an example starts with: one, labeled, with nothing else set.
const plainBoxes = (outputs: WidgetAction['outputs']) => outputs.length <= 1 && outputs.every((o) => !o.from && !o.text && !o.link && ['', 'Result', 'Answer'].includes(o.label));

// What the action has that `next` would replace, each named once; none: nothing is lost, nothing to ask.
export function lostBy(d: WidgetAction, next: WidgetAction): string[] {
  const lost = LOSABLE.filter(([key]) => {
    const value = d[key];
    const was = typeof value === 'string' ? value.trim() : value;
    if (empty(was) || JSON.stringify(d[key]) === JSON.stringify(next[key])) return false;
    return key !== 'outputs' || !plainBoxes(d.outputs);
  }).map(([, said]) => said);
  return [...new Set(lost)];
}
// Whether the action has something of its own: a new one that has, opens as the kind it is.
export const hasWork = (d: WidgetAction) => !!(d.prompt?.trim() || d.tool || Object.keys(d.args).length || d.steps?.length || Object.keys(d.reads ?? {}).length || d.name.trim() || d.badge);
// A list said in words: "a, b and c".
export const listed = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0] ?? '');

// Examples a new action starts from.
export const ACTION_EXAMPLES: { title: string; kind: ActionKind; action: Partial<WidgetAction> }[] = [
  {
    title: 'Explain the selection',
    kind: 'model',
    action: { name: 'Explain', icon: '💡', input: 'selection', besideSelection: true, prompt: `Explain this in plain words, in a few sentences: ${INPUT}`, outputs: [{ label: 'Explanation' }] },
  },
  {
    title: 'Summarize the article',
    kind: 'model',
    action: { name: 'Summarize the article', icon: '📝', input: 'none', reads: { article: '{{page}}' }, prompt: 'Summarize this article in three bullet points: {article}', outputs: [{ label: 'Summary' }] },
  },
  {
    title: 'Ask the chat about this page',
    kind: 'chat',
    action: { name: 'Ask about this page', icon: '💬', input: 'none', openChat: true, prompt: 'What does this page say? Give me the main points.' },
  },
];

// A new action as an example has it: what it is (its id, whether it is on, its agent and sites) kept.
export const fromExample = (d: WidgetAction, example: Partial<WidgetAction>): WidgetAction => ({
  id: d.id, enabled: d.enabled, where: d.where, ...(d.agent && { agent: d.agent }), input: 'text', tool: '', args: {}, outputs: [{ label: 'Result' }], name: '', ...example,
});

// A field of the editor a problem sits beside, and the step it is in.
export type ActionField = 'kind' | 'where' | 'takes' | 'beside' | 'reads' | 'tool' | 'args' | 'prompt' | 'model' | 'steps' | 'boxes' | 'name';
const FIELD_STEP: Record<ActionField, ActionStepId> = {
  kind: 'kind', where: 'where', takes: 'takes', beside: 'takes', reads: 'reads', tool: 'runs', args: 'runs', prompt: 'runs', model: 'runs', steps: 'runs', boxes: 'shows', name: 'name',
};

// actionProblems' texts, each to the field it is about (its first words; none matching: what it runs).
const FIELD_OF: [RegExp, ActionField][] = [
  [/^The action needs a name|^Another action is already named/, 'name'],
  [/^An action with steps shows its answer in a card|^The chat opens on a click/, 'kind'],
  [/^An action on page load takes nothing typed/, 'takes'],
  [/is not a URL pattern/, 'where'],
  [/cannot name a value from the page|^The value ".*" is read with|^Two values are named/, 'reads'],
  [/^The parameter ".*" uses|^The action takes no input, but a parameter/, 'args'],
  [/^Write the message|^The action takes no input, but the prompt|runs no model/, 'prompt'],
  [/^Choose both the provider and the model/, 'model'],
  [/^Choose the tool it runs|^An action on page load runs a tool|^An action that opens the chat runs no tool/, 'tool'],
  [/^Box \d+|^Each box needs|^Add a box|^The badge takes/, 'boxes'],
  [/beside selected text/, 'beside'],
  [/^Step |no step before it|^The steps |runs no tool or prompt of its own/, 'steps'],
];
// None: a text no rule knows (a test fails on it); the editor shows it with what it runs.
export const knownFieldOf = (text: string): ActionField | undefined => FIELD_OF.find(([re]) => re.test(text))?.[1];
export const fieldOf = (text: string): ActionField => knownFieldOf(text) ?? 'tool';

// The step of a field, among those of the kind (one it lacks: the first step, where the kind is chosen).
export const stepOfField = (ids: ActionStepId[]) => (field: ActionField): ActionStepId => {
  const step = FIELD_STEP[field];
  return ids.includes(step) ? step : 'kind';
};

// A name for its button, from what it does: its tool ("wiki.search" → "Wiki search"), else the first
// words of its prompt; none when another action has it, or there is nothing to go on.
export function suggestActionName(d: WidgetAction, taken: string[]): string | undefined {
  const fromTool = (name: string) => name.replace(/^custom\./, '').split(/[._-]+/).filter(Boolean).join(' ');
  const fromPrompt = (p: string) => p.split(/[:.\n?!]/)[0]!.replace(/\{[^}]*\}/g, '').trim().split(/\s+/).slice(0, 4).join(' ');
  const step = d.steps?.find((s) => 'tool' in s && s.tool);
  const raw = d.prompt?.trim() ? fromPrompt(d.prompt) : d.tool ? fromTool(d.tool) : step && 'tool' in step ? fromTool(step.tool) : '';
  const name = raw ? raw[0]!.toUpperCase() + raw.slice(1) : '';
  return name && !taken.includes(name) ? name : undefined;
}

// The boxes of an action with a tool, as the boxes of a step named `name` that runs that tool: what
// "Make it steps" turns a page load action into, to show a badge.
export function asToolStep(d: WidgetAction, name = 'result'): Partial<WidgetAction> {
  const under = (from: string | undefined) => (!from?.trim() ? name : from.trim().startsWith('[') ? `${name}${from.trim()}` : `${name}.${from.trim()}`);
  return {
    tool: '',
    args: {},
    steps: [{ name, tool: d.tool, args: d.args }],
    outputs: d.outputs.map((o) => ({ ...o, from: under(o.from) })),
    badge: name,
  };
}

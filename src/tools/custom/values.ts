// What custom tools fill their templates with (tools/custom/runtime, tools/http): the tool's own parameters,
// written {name}.
import { fields } from '../define';
import type { CustomInput } from './types';

export const PLACEHOLDER = /\{([a-z][a-z0-9_]*)\}/g;

// A template with each {name} replaced by its value; `names`: what a name may be (the tool's
// parameters by default; the keys of an answer, for the page widget's boxes).
export const fillTemplate = (template: string, value: (name: string) => string, names = PLACEHOLDER) =>
  template.replace(names, (_, name: string) => value(name));

// The name, when the template is just "{name}": it then stands for the value as it is, not as text.
export const wholePlaceholder = (template: string, names = PLACEHOLDER) => new RegExp(`^${names.source}$`).exec(template)?.[1];

// The parameters a template uses.
export const placeholdersOf = (template: string) => [...template.matchAll(PLACEHOLDER)].map((m) => m[1]!);

// The tool's parameter values: what the model gave, else their defaults.
export const inputValues = (inputs: CustomInput[], args: unknown): Record<string, unknown> => {
  const given = fields(args);
  return Object.fromEntries(inputs.map((i) => [i.name, given[i.name] ?? i.default]));
};

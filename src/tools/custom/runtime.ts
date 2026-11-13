// Custom tools: a tool of the catalog (the base) offered again under a name and description of the
// user's. Either with the base's parameters, some set beforehand (hidden from the model) and others
// filled by the model, a text one maybe wrapped ("{value} site:reddit.com"); or with parameters of
// its own ("inputs"), each of the base's fixed or built from them ("https://{lang}.wikipedia.org/wiki/{title}").
// It runs as its base does: same effect, confirmation and site policy. The base may also be an HTTP
// request (tools/http), or a script for an API that takes several requests (tools/custom/script-tool). Made in
// Settings → Custom tools, or by the model (custom_tools.save; skills create-custom-tool and
// create-script-tool), reviewed by the user.
import { usedSecrets } from './secrets';
import type { JSONSchema, Tool } from '../../core/types';
import { fields } from '../define';
import { fillTemplate, inputValues, wholePlaceholder } from './values';
import { SCRIPT_BASE, scriptTool, type ScriptRunner } from './script-tool';
import { HTTP_BASE, httpTool } from '../http';
import { VALUE, type CustomTool, type ObjectSchema } from './types';

const NO_BASE = { inputSchema: {} }; // an HTTP request has no parameters but the tool's own

export const baseParams = (base: Pick<Tool, 'inputSchema'>) => (base.inputSchema as ObjectSchema).properties ?? {};

// What the model is offered: its own parameters; or the base's without the fixed ones, with the
// descriptions given.
export function customSchema(custom: CustomTool, base: Pick<Tool, 'inputSchema'>): JSONSchema {
  if (custom.inputs) {
    const properties = Object.fromEntries(
      custom.inputs.map((i) => [i.name, { type: i.type, description: i.description, ...(i.default !== undefined && { default: i.default }) }]),
    );
    return { type: 'object', properties, required: custom.inputs.filter((i) => i.required).map((i) => i.name) };
  }
  const schema = base.inputSchema as ObjectSchema;
  const fixed = (name: string) => custom.params[name]?.mode === 'fixed';
  const properties = Object.fromEntries(
    Object.entries(baseParams(base))
      .filter(([name]) => !fixed(name))
      .map(([name, prop]) => {
        const rule = custom.params[name];
        const description = rule?.mode === 'model' && rule.description?.trim();
        return [name, description ? { ...prop, description } : prop];
      }),
  );
  return { ...schema, type: 'object', properties, required: (schema.required ?? []).filter((n) => !fixed(n)) };
}

// A template filled with the inputs: one that is just "{name}" gives that value as it is; any other,
// a text, read as the base parameter's type when it is a number or true/false.
export function buildValue(template: string, values: Record<string, unknown>, type: string | undefined): unknown {
  const whole = wholePlaceholder(template);
  if (whole) return values[whole];
  const filled = fillTemplate(template, (name) => String(values[name] ?? ''));
  if ((type === 'number' || type === 'integer') && filled.trim() !== '' && !Number.isNaN(Number(filled))) return Number(filled);
  if (type === 'boolean' && (filled === 'true' || filled === 'false')) return filled === 'true';
  return filled;
}

// What the base gets: with inputs, the fixed values and those built from the model's arguments (or
// their defaults); otherwise the model's arguments (wrapped where asked) and the fixed values.
export function customArgs(custom: CustomTool, args: unknown, base?: Pick<Tool, 'inputSchema'>): Record<string, unknown> {
  const given = fields(args);
  if (custom.inputs) {
    const values = inputValues(custom.inputs, given);
    const types = base ? baseParams(base) : {};
    const out: Record<string, unknown> = {};
    for (const [name, rule] of Object.entries(custom.params)) {
      const value = rule.mode === 'fixed' ? rule.value : rule.mode === 'built' ? buildValue(rule.template, values, types[name]?.type) : undefined;
      if (value !== undefined) out[name] = value;
    }
    return out;
  }
  const out: Record<string, unknown> = { ...given };
  for (const [name, rule] of Object.entries(custom.params)) {
    if (rule.mode === 'fixed') out[name] = rule.value;
    else if (rule.mode === 'model' && rule.template && typeof out[name] === 'string') out[name] = rule.template.replaceAll(VALUE, out[name]);
  }
  return out;
}

// Whatever of the base reads the arguments gets them as the base takes them: its tab (the policy judges
// that tab's site) and whether it always asks (history.read in full) as much as what it runs.
function customTool(custom: CustomTool, base: Tool): Tool {
  const { describe, run, tabOf, alwaysAsk } = base;
  const own = (args: unknown) => customArgs(custom, args, base);
  return {
    ...base,
    name: custom.name,
    description: custom.description,
    inputSchema: customSchema(custom, base),
    source: 'custom',
    group: undefined,
    describe: describe && ((args, ctx) => describe.call(base, own(args), ctx)),
    run: (args, ctx) => run.call(base, own(args), ctx),
    tabOf: tabOf && ((args) => tabOf.call(base, own(args))),
    alwaysAsk: typeof alwaysAsk === 'function' ? (args) => alwaysAsk.call(base, own(args)) : alwaysAsk,
  };
}

// The enabled custom tools whose base is offered (not a custom tool itself), a request or a script
// (where there is a runner for it), none named like a tool of the catalog.
export function runtimeCustomTools(customs: CustomTool[], catalog: Tool[], runner?: ScriptRunner): Tool[] {
  const byName = new Map(catalog.map((t) => [t.name, t]));
  const made = (c: CustomTool): Tool[] => {
    if (c.base === HTTP_BASE) return c.enabled && c.http && !byName.has(c.name) ? [httpTool(c, customSchema(c, NO_BASE))] : [];
    if (c.base === SCRIPT_BASE) return c.enabled && c.http && c.script && runner && !byName.has(c.name) ? [scriptTool(c, customSchema(c, NO_BASE), runner)] : [];
    const base = byName.get(c.base);
    return c.enabled && base && base.source !== 'custom' && !byName.has(c.name) ? [customTool(c, base)] : [];
  };
  // One that sends a value saved for it ({{secret:name}}) is confirmed every time, whatever the site's policy.
  return customs.flatMap((c) => made(c).map((t) => ({ ...t, group: customGroup(c), ...(usedSecrets(c).length && { alwaysAsk: true }) })));
}

// The group a custom tool is listed under: its own section, or the custom tools'.
const customGroup = (c: Pick<CustomTool, 'group'>) => (c.group?.trim() ? `custom:${c.group.trim()}` : undefined);

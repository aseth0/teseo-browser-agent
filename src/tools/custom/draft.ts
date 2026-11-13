// A custom tool as the model drafts it (custom_tools.save and edit): made from its arguments, what
// keeps it from being saved, how the user reviews it, and back to arguments to read or change it.
import { keptSecrets } from './secrets';
import { errorText } from '../../core/errors';
import type { ActionDescription, ActionDetail, Tool } from '../../core/types';
import { hostOf, isObject } from '../../core/util';
import { fields } from '../define';
import { toolNamed, toWireName } from '../../core/tool-registry';
import { SCRIPT_BASE } from './script-tool';
import { HTTP_BASE, type HttpRequest } from '../http';
import { draftMeta, nameArg } from '../reviewed-save';
import { baseParams, customSchema } from './runtime';
import type { SaveArgs } from './schema';
import { customToolStore } from './store';
import { INPUT_TYPES, type CustomInput, type CustomTool, type ParamRule } from './types';
import { customProblems } from './validate';

// A call's arguments as custom_tools.save takes them, and what is wrong with their shape: a part of
// the wrong shape (a base's parameter given as a bare value) is left out, saying how to give it. One
// sent as its JSON text is already read as the value it holds (core/tool-args).
export function readSaveArgs(raw: unknown): { args: SaveArgs; problems: string[] } {
  const args: Record<string, unknown> = { ...fields(raw) };
  const problems: string[] = [];
  for (const [key, ok, shape] of SHAPES) {
    if (args[key] === null) delete args[key]; // none given
    else if (args[key] !== undefined && !ok(args[key])) {
      problems.push(typeof shape === 'string' ? shape : shape(args[key]));
      delete args[key];
    }
  }
  // null takes a parameter out (custom_tools.edit); a new object, the caller's left as it came.
  if (isObject(args.params)) {
    args.params = Object.fromEntries(Object.entries(args.params).filter(([name, p]) => {
      if (p === null || isObject(p)) return true;
      problems.push(`"${name}": give {"fixed": <value>} to set it, or {"template": "… {value} …"} to wrap the model's text (with inputs: {"template": "…{name}…"}).`);
      return false;
    }));
  }
  return { args: args as unknown as SaveArgs, problems };
}
// The parts of custom_tools.save's arguments that hold more than a text: what each must be, and how to give it.
const SHAPES: [key: keyof SaveArgs, ok: (v: unknown) => boolean, shape: string | ((given: unknown) => string)][] = [
  ['params', isObject, '"params" is an object by the base\'s parameter name: {"limit": {"fixed": 3}}.'],
  ['inputs', (v) => Array.isArray(v) && v.every(isObject), '"inputs" is a list of objects: [{"name": "title", "type": "string", "description": "…", "required": true}].'],
  ['http', isObject, '"http" is an object: {"method": "GET", "url": "https://api.example.com/search?q={query}"}.'],
  // Its two shapes are told with what it lacks once left out (validate's scriptProblems).
  ['script', isObject, (given) => `"script" is an object${typeof given === 'string' ? `, not a text: ${notJson(given)}` : '.'}`],
];

// Why a text sent for an object was not read as one: where its JSON breaks.
function notJson(given: string): string {
  try {
    JSON.parse(given);
    return 'send it as an object.';
  } catch (e) {
    return `this one is not JSON (${errorText(e)}). Send it as an object, or double each backslash of the code in its JSON text (a regular expression's \\d is written \\\\d).`;
  }
}

// The custom tool the arguments make (the existing one of that name updated), and what keeps it from
// being saved.
export async function draftCustomTool(args: SaveArgs, catalog: Tool[]): Promise<{ custom: CustomTool; existing?: CustomTool; base?: Tool; keptAccess: boolean; problems: string[] }> {
  const customs = await customToolStore.load();
  const name = nameArg(args);
  const existing = customs.find((c) => c.name === name);
  // With inputs, a template builds the parameter from them; without, it wraps the model's text.
  const inputs = args.inputs?.map(
    (i): CustomInput => ({
      name: String(i.name ?? '').trim(),
      type: INPUT_TYPES.includes(i.type as CustomInput['type']) ? (i.type as CustomInput['type']) : 'string',
      description: String(i.description ?? '').trim(),
      ...(i.required && { required: true }),
      ...(i.default !== undefined && { default: i.default }),
    }),
  );
  const params = Object.fromEntries(
    Object.entries(args.params ?? {}).map(([param, p]): [string, ParamRule] =>
      p && 'fixed' in p
        ? [param, { mode: 'fixed', value: p.fixed }]
        : inputs
          ? [param, { mode: 'built', template: String(p?.template ?? '') }]
          : [param, { mode: 'model', template: p?.template || undefined, description: p?.description || undefined }],
    ),
  );
  // A tool named as the model is offered it ("web__search") is the catalog's by its dotted name.
  const named = toolNamed(catalog.map((t) => t.name));
  const dotted = (n: string) => named(n) ?? n;
  const baseName = dotted(String(args.base ?? '').trim());
  // A request: the model may give it headers without secrets (a fixed text, a cookie of the site:
  // {{cookie:NAME}}) and the browser session, the user seeing them in the card; an update keeps the
  // headers and session there were, the model's left out.
  const kept = existing?.http;
  const keptAccess = !!(kept?.headers?.length || kept?.session);
  const asked = baseName === SCRIPT_BASE ? args.script : args.http;
  const given = (asked?.headers ?? []).map((h) => ({ name: String(h?.name ?? '').trim(), value: String(h?.value ?? '') })).filter((h) => h.name);
  const access = keptAccess && kept
    ? { ...(kept.headers?.length && { headers: kept.headers }), ...(kept.session && { session: true }) }
    : { ...(given.length && { headers: given }), ...(asked?.session === true && { session: true }) };
  // The values saved for it stay while its site does (tools/custom/secrets).
  const withKept = (url: string) => {
    const secrets = keptSecrets(existing?.http, url);
    return secrets ? { secrets } : {};
  };
  const scriptHost = String(args.script?.host ?? '').trim();
  // A script's requests go to its host, with the access an HTTP request would have.
  const http: HttpRequest | undefined =
    baseName === SCRIPT_BASE
      ? { method: 'GET', url: scriptHost, ...access, ...(existing?.http?.readOnly && { readOnly: true }), ...withKept(scriptHost) }
      : baseName === HTTP_BASE
      ? {
          method: String(args.http?.method ?? 'GET').toUpperCase() as HttpRequest['method'],
          url: String(args.http?.url ?? '').trim(),
          ...(args.http?.body && { body: String(args.http.body) }),
          ...(args.http?.extract && { extract: String(args.http.extract) }),
          ...access,
          ...(existing?.http?.readOnly && { readOnly: true }),
          ...withKept(String(args.http?.url ?? '').trim()),
        }
      : undefined;
  const custom: CustomTool = {
    id: existing?.id ?? crypto.randomUUID(),
    name,
    description: String(args.description ?? '').trim(),
    base: baseName,
    params: http ? {} : params,
    ...((inputs || http) && { inputs: inputs ?? [] }),
    ...(http && { http }),
    ...(baseName === SCRIPT_BASE && { script: String(args.script?.code ?? '') }),
    ...(baseName === SCRIPT_BASE && Array.isArray(args.script?.uses) && args.script.uses.length && { uses: args.script.uses.map((u) => dotted(String(u).trim())).filter(Boolean) }),
    ...(existing?.labels && { labels: existing.labels }), // the user's: the model sees none
    ...(existing?.group && { group: existing.group }), // the user's (or its source's) section
    ...draftMeta(existing),
  };
  const base = catalog.find((t) => t.name === custom.base && t.source !== 'custom');
  const offered = base ? Object.keys(baseParams(base)) : [];
  const unknown = base ? Object.keys(params).filter((p) => !offered.includes(p)) : [];
  // Those not named as a tool is (no dots) are told by customProblems.
  const notOffered = (custom.uses ?? []).filter((u) => u.includes('.') && !named(u));
  const hostChange = http && hostChangeProblem(existing?.http, http);
  const problems = [
    ...customProblems(custom, customs, catalog, true),
    ...(hostChange ? [hostChange] : []),
    ...(custom.base && custom.base !== HTTP_BASE && custom.base !== SCRIPT_BASE && !base ? [`"${custom.base}" is not a tool you are offered: the base must be one, "${HTTP_BASE}" or "${SCRIPT_BASE}".`] : []),
    ...unknown.map((p) => `"${custom.base}" has no parameter "${p}". Its parameters: ${offered.join(', ') || 'none'}.`),
    ...notOffered.map((u) => `"${u}" in uses is not a tool you are offered.`),
  ];
  return { custom, existing, base, keptAccess, problems };
}

// The user's headers (API keys) and session stay on an update: so the host must too, or the model
// could send them to another site. None for a new tool, or one with neither.
export function hostChangeProblem(existing: HttpRequest | undefined, next: HttpRequest): string | undefined {
  if (!existing || (!existing.headers?.length && !existing.session)) return undefined;
  const was = hostOf(existing.url);
  const now = hostOf(next.url);
  if (!was || was === now) return undefined;
  return `The request's host cannot change from ${was} to ${now}: the tool sends headers or the user's browser session. Make a new tool instead.`;
}

// The headers and session a request sends: kept as they were (an update), or the model's, each shown.
function accessDetails(http: HttpRequest, kept: boolean): ActionDetail[] {
  const host = hostOf(http.url) || 'its site';
  const headers = http.headers ?? [];
  return [
    kept
      ? { label: 'Headers', value: headers.length ? `${headers.length} kept as they were (Settings → Custom tools changes them)` : 'none' }
      : headers.length
        ? { label: 'Headers', value: headers.map((h) => `${h.name}: ${h.value}`).join('\n'), code: true }
        : { label: 'Headers', value: 'none: add them in Settings → Custom tools if the API needs a key' },
    ...(http.session ? [{ label: 'Signed in as you', value: `Sends your browser session for ${host}${kept ? ' (kept)' : ''}` }] : []),
  ];
}

// What it runs, as the user reads it on its cards.
export const customRuns = ({ base, http }: CustomTool) =>
  base === SCRIPT_BASE ? (http?.url ? `a script on ${http.url}` : 'a script that calls tools') : http ? `an HTTP request: ${http.method} ${http.url}` : `runs ${base}`;

export function customDescription(custom: CustomTool, base: Tool | undefined, update: boolean, keptAccess: boolean): ActionDescription {
  const http = custom.http;
  return {
    summary: `${update ? 'Update' : 'Save'} the custom tool "${custom.name}" (${customRuns(custom)})`,
    details: [
      { label: 'Description', value: custom.description },
      ...(custom.uses?.length ? [{ label: 'Tools it calls (only these, each asked as usual)', value: custom.uses.join('\n') }] : []),
      ...(custom.base === SCRIPT_BASE ? [{ label: 'Script (all of it)', value: custom.script ?? '', code: true }] : []),
      ...(http?.body ? [{ label: 'Request body', value: http.body, code: true }] : []),
      ...(http?.extract ? [{ label: 'Answer cut to', value: http.extract, code: true }] : []),
      ...(http ? accessDetails(http, keptAccess) : []),
      ...(custom.inputs ?? []).map((i) => ({
        label: `Its parameter "${i.name}" (${i.type}${i.required ? ', required' : ''}${i.default !== undefined ? `, default ${JSON.stringify(i.default)}` : ''})`,
        value: i.description,
      })),
      ...Object.entries(custom.params).map(([name, rule]) =>
        rule.mode === 'fixed'
          ? { label: `"${name}": fixed`, value: JSON.stringify(rule.value), code: true }
          : rule.mode === 'built'
            ? { label: `"${name}": built from its parameters`, value: rule.template, code: true }
            : { label: `"${name}": the model fills it`, value: [rule.template && `inside: ${rule.template}`, rule.description && `described: ${rule.description}`].filter(Boolean).join('\n') || 'as for the base' },
      ),
      ...(base || http ? [{ label: 'What the model is offered', value: JSON.stringify({ name: toWireName(custom.name), parameters: customSchema(custom, base ?? { inputSchema: {} }) }, null, 2), code: true }] : []),
    ],
  };
}

// A custom tool as custom_tools.save takes it, to read or change. Its headers go by name alone: their
// values are the user's (never shown to the model), and an update keeps them as they are.
export function savedArgs(c: CustomTool): SaveArgs {
  const access = c.http && { ...(c.http.session && { session: true }), ...(c.http.headers?.length && { headers: c.http.headers.map((h) => ({ name: h.name, value: HIDDEN_HEADER })) }) };
  return {
    name: c.name,
    description: c.description,
    base: c.base,
    ...(Object.keys(c.params).length && {
      params: Object.fromEntries(
        Object.entries(c.params).map(([param, rule]) => [
          param,
          rule.mode === 'fixed' ? { fixed: rule.value }
          : rule.mode === 'built' ? { template: rule.template }
          : { ...(rule.template && { template: rule.template }), ...(rule.description && { description: rule.description }) },
        ]),
      ),
    }),
    ...(c.inputs && { inputs: c.inputs }),
    ...(c.base === HTTP_BASE && c.http && {
      http: { method: c.http.method, url: c.http.url, ...(c.http.body && { body: c.http.body }), ...(c.http.extract && { extract: c.http.extract }), ...access },
    }),
    ...(c.base === SCRIPT_BASE && { script: { host: c.http?.url ?? '', code: c.script ?? '', ...(c.uses?.length && { uses: c.uses }), ...access } }),
  };
}
const HIDDEN_HEADER = '(set, not shown)';

// A custom_tools.edit call's changes over the tool as it is: the fields given replace its own; "http"
// and "script" change only what they give, and "params" only the parameters they name (null takes
// one out). Its name stays.
export function editedArgs(c: CustomTool, changes: Partial<SaveArgs>): SaveArgs {
  const now = savedArgs(c);
  const params = changes.params && Object.fromEntries(Object.entries({ ...now.params, ...changes.params }).filter(([, p]) => p !== null));
  return {
    ...now,
    ...changes,
    name: c.name,
    ...(params && { params }),
    ...(changes.http && { http: { ...now.http, ...changes.http } }),
    ...(changes.script && { script: { ...now.script, ...changes.script } }),
  };
}

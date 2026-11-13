// What makes a custom tool valid, for the options editor, custom_tools.save (the model) and an import.
import type { Tool } from '../../core/types';
import { PLACEHOLDER, placeholdersOf } from './values';
import { SCRIPT_BASE } from './script-tool';
import { cookiesIn, hasFixedHost, headerNameProblem, HTTP_BASE, HTTP_METHODS, type HttpRequest } from '../http';
import { VALUE, type CustomTool, type ObjectSchema } from './types';

const NAME = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const INPUT_NAME = /^[a-z][a-z0-9_]*$/;

// What keeps it from being saved. `hints`: for the model, how to give what is missing as
// custom_tools.save takes it.
export const customProblems = (custom: CustomTool, customs: CustomTool[], catalog: Pick<Tool, 'name' | 'source' | 'inputSchema'>[], hints = false): string[] =>
  customIssues(custom, customs, catalog, hints).map((i) => i.text);

// The part of the tool a problem is about, so the editor shows it beside that field: an input by its
// position, a base's parameter by its name.
export type IssueField =
  | 'name' | 'description' | 'base' | 'method' | 'url' | 'body' | 'headers' | 'site' | 'uses' | 'code'
  | `input:${number}` | `param:${string}`;
export interface Issue {
  field: IssueField;
  text: string;
}

// The same problems, each with the field it is about.
export function customIssues(custom: CustomTool, customs: CustomTool[], catalog: Pick<Tool, 'name' | 'source' | 'inputSchema'>[], hints = false): Issue[] {
  const problems: Issue[] = [];
  if (!NAME.test(custom.name)) problems.push({ field: 'name', text: 'The name is words in lowercase joined by dots, like "reddit.search".' });
  else if (customs.some((c) => c.id !== custom.id && c.name === custom.name)) problems.push({ field: 'name', text: `Another custom tool is named "${custom.name}".` });
  else if (catalog.some((t) => t.name === custom.name && t.source !== 'custom')) problems.push({ field: 'name', text: `A tool of the catalog is named "${custom.name}".` });
  if (!custom.base) problems.push({ field: 'base', text: 'Choose the tool it runs.' });
  if (!custom.description.trim()) problems.push({ field: 'description', text: 'The description tells the model when to use it: it cannot be empty.' });
  if (custom.base === HTTP_BASE) return [...problems, ...inputProblems(custom, undefined, hints), ...httpProblems(custom, hints)];
  if (custom.base === SCRIPT_BASE) return [...problems, ...inputProblems(custom, undefined, hints), ...scriptProblems(custom, hints)];
  if (custom.inputs) return [...problems, ...inputProblems(custom, catalog.find((t) => t.name === custom.base && t.source !== 'custom'), hints)];
  for (const [name, rule] of Object.entries(custom.params)) {
    if (rule.mode === 'model' && rule.template !== undefined && rule.template.trim() && !rule.template.includes(VALUE)) {
      problems.push({ field: `param:${name}`, text: `"${name}": the text around the model's value needs ${VALUE} where it goes.` });
    }
  }
  return problems;
}

// What `what` (a parameter, the URL, the body) uses that is no input, if any; with hints, how to declare
// them, and what {value} is for.
function undeclared(what: string, template: string, names: Set<string>, hints: boolean): string | undefined {
  const unknown = placeholdersOf(template).filter((p) => !names.has(p));
  if (!unknown.length) return undefined;
  const problem = `${what} uses ${unknown.map((u) => `{${u}}`).join(', ')}, not a parameter of this tool`;
  if (!hints) return `${problem}.`;
  const isValue = (u: string) => `{${u}}` === VALUE;
  const name = unknown.find((u) => !isValue(u)) ?? 'query';
  const value = unknown.some(isValue) ? " {value} only wraps a base's text parameter, without inputs." : '';
  return `${problem}: declare each one in "inputs", e.g. [{"name": "${name}", "type": "string", "description": "…", "required": true}].${value}`;
}

// With inputs: theirs well named and described, templates that use only them, and every parameter
// the base requires set.
function inputProblems(custom: CustomTool, base: Pick<Tool, 'inputSchema'> | undefined, hints: boolean): Issue[] {
  const problems: Issue[] = [];
  const names = new Set<string>();
  const example = custom.inputs?.[0]?.name || 'title';
  for (const [i, input] of (custom.inputs ?? []).entries()) {
    const field = `input:${i}` as const;
    if (!INPUT_NAME.test(input.name)) {
      const fixed = snakeCase(input.name);
      problems.push({ field, text: `"${input.name}": a parameter's name is lowercase letters, digits and _, ${fixed ? `so "${fixed}"` : 'like "title"'}.` });
    }
    else if (names.has(input.name)) problems.push({ field, text: `Two parameters are named "${input.name}".` });
    names.add(input.name);
    if (!input.description.trim()) problems.push({ field, text: `"${input.name}" needs a description: the model reads it to fill it.` });
  }
  for (const [name, rule] of Object.entries(custom.params)) {
    if (rule.mode !== 'built') continue;
    const field = `param:${name}` as const;
    if (!rule.template.trim()) problems.push({ field, text: `"${name}": write how it is built, e.g. {${example}}.` });
    const unknown = undeclared(`"${name}"`, rule.template, names, hints);
    if (unknown) problems.push({ field, text: unknown });
  }
  const required = (base?.inputSchema as ObjectSchema | undefined)?.required ?? [];
  for (const name of required) {
    const rule = custom.params[name];
    if (!rule || rule.mode === 'model') {
      const how = hints ? `set it with {"fixed": …} or build it from the inputs with {"template": "…{${example}}…"}.` : 'fix it or build it from the parameters.';
      problems.push({ field: `param:${name}`, text: `"${custom.base}" needs "${name}": ${how}` });
    }
  }
  return problems;
}

// A parameter's name as one may be: "timeoutSec" or "Timeout-Sec" as "timeout_sec".
const snakeCase = (name: string) =>
  name.trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^[^a-z]+|_+$/g, '');

// The two shapes of a script, as custom_tools.save takes them.
export const SCRIPT_SHAPES =
  'steps that call tools: {"uses": ["browser.find", "browser.type"], "code": "… await tool(\\"browser.find\\", {…}) …"} (no host); ' +
  'requests to an API: {"host": "https://api.example.com", "code": "… await request(\\"GET\\", \\"/path\\") …"}';

// A script: its site (an http(s) origin), its code, and headers as a request's. With hints, one that
// is neither shape yet (no tools it calls, no site) is told both, and what it lacks.
function scriptProblems(custom: CustomTool, hints: boolean): Issue[] {
  const access = custom.http;
  const problems: Issue[] = [];
  const site = access?.url.trim() ?? '';
  const code = custom.script?.trim() ?? '';
  const calls = !!custom.uses?.length;
  const callsTool = /\btool\s*\(/.test(code);
  const neither = hints && !calls && !site;
  if (neither && callsTool) problems.push({ field: 'uses', text: 'The code calls tool(): list the tools it calls in "script.uses", like ["browser.find", "browser.type"] (then it needs no host).' });
  else if (neither) problems.push({ field: 'site', text: `"script" has neither "uses" nor "host". It is one of: ${SCRIPT_SHAPES}.` });
  // Calling only tools, it needs no site.
  else if (!(calls && !site) && !/^https?:\/\/[^/{}]+\/?$/i.test(site)) problems.push({ field: 'site', text: 'Say its site: https:// and a host, like https://chat.example.com; its requests go there.' });
  // With a site, calling tool() still needs its uses: without them the script would be saved, then fail
  // at its first tool().
  if (site && !calls && callsTool) problems.push({ field: 'uses', text: 'The code calls tool() but has no "uses": list the tools it calls in "script.uses", like ["browser.find", "browser.type"].' });
  for (const name of custom.uses ?? []) if (!NAME.test(name)) problems.push({ field: 'uses', text: `"${name}" in uses is not a tool's name (dotted, like "browser.find").` });
  if (!code && !neither) problems.push({ field: 'code', text: `Write the script: the steps, with ${calls ? 'tool(name, args)' : 'request(method, path, body)'}, and what it returns.` });
  return [...problems, ...headerProblems(access)];
}

// An HTTP request: a known method, an http(s) URL, a body that is JSON (only to send one), and
// templates that use only the tool's parameters.
function httpProblems(custom: CustomTool, hints: boolean): Issue[] {
  const http = custom.http;
  if (!http) return [{ field: 'url', text: 'Write the request: its method and URL.' }];
  const problems: Issue[] = [];
  if (!HTTP_METHODS.includes(http.method)) problems.push({ field: 'method', text: `The method is one of ${HTTP_METHODS.join(', ')}.` });
  if (!hasFixedHost(http.url)) problems.push({ field: 'url', text: 'The URL starts with http:// or https:// and a fixed host, e.g. https://api.example.com/search?q={query}.' });
  const names = new Set((custom.inputs ?? []).map((i) => i.name));
  const body = http.method === 'GET' ? '' : (http.body ?? '');
  for (const [field, what, template] of [['url', 'The URL', http.url], ['body', 'The body', body]] as const) {
    const unknown = undeclared(what, template, names, hints);
    if (unknown) problems.push({ field, text: unknown });
  }
  if (/"\{[a-z][a-z0-9_]*\}"/.test(body)) problems.push({ field: 'body', text: 'In the body a parameter goes as {name}, without quotes: it is written as a JSON value (a text with its quotes).' });
  else if (body.trim()) {
    try {
      // A saved value may stand alone for a number: {{secret:pin}}.
      JSON.parse(body.replace(PLACEHOLDER, 'null').replace(/\{\{\s*secret:[^}]+\}\}/g, '0'));
    } catch {
      problems.push({ field: 'body', text: 'The body is not JSON (a parameter goes as {name}, without quotes: it is written as a JSON value).' });
    }
  }
  return [...problems, ...headerProblems(http)];
}

function headerProblems(http: HttpRequest | undefined): Issue[] {
  const headers = http?.headers ?? [];
  const texts = [
    ...(headers.some((h) => !h.name.trim() && h.value.trim()) ? ['A header has a value but no name.'] : []),
    ...headers.flatMap((h) => (h.name.trim() ? (headerNameProblem(h.name.trim()) ?? []) : [])),
    ...(!http?.session && headers.some((h) => cookiesIn(h.value).length) ? ['A header takes a cookie ({{cookie:…}}): it needs the browser session ("Send the browser\'s session for this site", or "session": true).'] : []),
  ];
  return texts.map((text) => ({ field: 'headers', text }));
}

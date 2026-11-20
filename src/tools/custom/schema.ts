// What custom_tools.save takes (custom_tools.edit, only the changes): its arguments and their schema.
import { INPUT_TYPES, type CustomInput } from './types';
import { HTTP_METHODS, type HttpRequest } from '../http';

export interface SaveArgs {
  name: string;
  description: string;
  base: string;
  group?: string;
  params?: Record<string, { fixed?: unknown; template?: string; description?: string }>;
  inputs?: Partial<CustomInput>[];
  http?: Partial<Pick<HttpRequest, 'method' | 'url' | 'body' | 'extract' | 'session' | 'headers'>>;
  script?: { host?: string; code?: string; uses?: string[] } & Partial<Pick<HttpRequest, 'session' | 'headers'>>;
}

const HEADERS_SCHEMA = { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } }, required: ['name', 'value'] } };

// What a custom tool is made of, as custom_tools.save takes it (custom_tools.edit, only the changes).
export const SAVE_PROPERTIES = {
  name: { type: 'string', description: 'Lowercase words joined by dots, e.g. "reddit.search". An existing name updates that tool.' },
  description: { type: 'string', description: 'What it does and when to use it: the model decides from it alone.' },
  base: { type: 'string', description: 'The tool it runs, by its name with dots ("web.search"), one you are offered; or "http", or "script".' },
  group: {
    type: 'string',
    description:
      'Optional: the group the user sees it under, in Settings and in the tools menus (e.g. "Chat"). Give the name exactly as an ' +
      'existing group has it to join that one; an empty text takes the tool out of its group. Left out, the group stays as it is.',
  },
  params: {
    type: 'object',
    description:
      'By the base\'s parameter name: {"fixed": value} sets it, hidden from the model; {"template": "{value} site:reddit.com", "description": "…"} ' +
      'wraps the model\'s text and describes it. A parameter not listed is filled by the model as for the base. With inputs, ' +
      '{"template": "https://{lang}.wikipedia.org/wiki/{title}"} builds it from them, and a parameter not listed is not sent.',
    additionalProperties: {
      type: 'object',
      properties: { fixed: {}, template: { type: 'string' }, description: { type: 'string' } },
    },
  },
  http: {
    type: 'object',
    description: 'For base "http": {"method", "url", "body", "extract", "session", "headers"}; templates use the inputs as {name}.',
    properties: {
      method: { type: 'string', enum: [...HTTP_METHODS] },
      url: { type: 'string' },
      body: { type: 'string' },
      extract: { type: 'string' },
      session: { type: 'boolean', description: "Send the user's browser session (their cookies) for the request's site, as when they are signed in there." },
      headers: {
        ...HEADERS_SCHEMA,
        description: '[{"name", "value"}]: a value is a fixed text ("XMLHttpRequest") or a cookie of the site, "{{cookie:MMCSRF}}" (a CSRF token). Never a key or token.',
      },
    },
  },
  script: {
    type: 'object',
    description:
      'For base "script": {"host": "https://chat.example.com", "code": "…", "session", "headers"}. request(method, path, body) takes ' +
      'a path on the host ("/api/v4/users/me"), a body as a value (sent as JSON), and resolves to {status, ok, data} (data: the JSON ' +
      'answer, or its text). session and headers as for "http".',
    properties: {
      host: { type: 'string' },
      code: { type: 'string' },
      uses: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Tools the script calls with tool(name, args), by name (e.g. ["browser.find", "browser.type"]): only these, each one asked as when you call it. ' +
          'Without it, the script reaches only its site, with request().',
      },
      session: { type: 'boolean' },
      headers: HEADERS_SCHEMA,
    },
  },
  inputs: {
    type: 'array',
    description:
      'The tool\'s own parameters: [{"name", "type": "string"|"number"|"boolean", "description", "required", "default"}]. ' +
      'With them, every base parameter is fixed or a template using them.',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string', enum: INPUT_TYPES },
        description: { type: 'string' },
        required: { type: 'boolean' },
        default: {},
      },
      required: ['name', 'description'],
    },
  },
};

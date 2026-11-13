// The user's custom tools (tools/custom/runtime), under their own storage key. What lets one send
// something or act without asking (its headers' values, the browser's session, read-only) and whether
// it is on are kept in storage/secrets (storage/secret-part), for what the tool does as saved
// (secretsBoundTo): a tool a page writes to storage.local, or one whose request or code a page changes
// there, is off, without them.
import { createCollection } from '../../storage/collection';
import { movedFirst, withSecretPart } from '../../storage/secret-part';
import type { HttpRequest } from '../http';
import { stableJson } from '../../core/util';
import type { CustomTool } from './types';

// What a tool does, as a sync compares it (tools/custom/sources): its request (with its headers' names)
// or code, and its parameters; not its description or labels, nor what only the user sets.
export const whatItDoes = (c: CustomTool) =>
  JSON.stringify([c.base, c.params, c.inputs ?? [], c.http && { method: c.http.method, url: c.http.url, body: c.http.body, extract: c.http.extract, headers: (c.http.headers ?? []).map((h) => h.name) }, c.script ?? '', c.uses ?? []]);

// What its secrets are kept for: whatItDoes, the same whatever order storage.local gives its keys in.
const secretsBoundTo = (c: CustomTool) => stableJson(JSON.parse(whatItDoes(c)));

type Part = { enabled: boolean } & Pick<HttpRequest, 'headers' | 'session' | 'readOnly' | 'secrets'>;

// The request without its headers' values: their names only.
const withoutValues = (http: HttpRequest): HttpRequest => {
  const { secrets: _secrets, ...rest } = http; // saved values ({{secret:name}}): in the secret part only
  return { ...rest, ...(http.headers && { headers: http.headers.map((h) => ({ name: h.name, value: '' })) }) };
};
const withoutSecrets = (c: CustomTool): CustomTool => (c.http ? { ...c, http: withoutValues(c.http) } : c);

const stored = createCollection<CustomTool>('customTools', []);
const store = withSecretPart<CustomTool, Part>(stored, {
  secret: 'customToolSecrets',
  pick: (c) => ({ enabled: c.enabled, ...(c.http && { headers: c.http.headers, session: c.http.session, readOnly: c.http.readOnly, secrets: c.http.secrets }) }),
  // The rest stays as it is, a copy never read for them (earlier versions read it).
  strip: withoutSecrets,
  put: (c, part) => {
    const { session: _s, readOnly: _r, ...http } = c.http ? withoutValues(c.http) : ({} as HttpRequest);
    if (!part) return { ...c, enabled: false, ...(c.http && { http }) };
    const { enabled, ...own } = part;
    return { ...c, enabled, ...(c.http && { http: { ...http, ...Object.fromEntries(Object.entries(own).filter(([, v]) => v !== undefined)) } }) };
  },
  boundTo: secretsBoundTo,
});

// Earlier versions kept them whole in storage.local: moved once.
export const customToolStore = movedFirst(store, 'customToolSecrets');

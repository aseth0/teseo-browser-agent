// A script's request() (script/quickjs), done by the extension: only to a path on the tool's site,
// with the tool's headers and the browser session when it has them, as an HTTP custom tool's request.
// The script gets the status and the answer (JSON when it is), never the headers or cookies sent.
import { requireAccess } from '../page/access';
import { HTTP_METHODS, NO_REDIRECT, refuseRedirect, requestHeaders, type HttpRequest } from '../tools/http';
import type { ScriptResponse } from './quickjs';
import { fillSecrets, maskSecrets } from '../tools/secrets';

// What a script's requests go with: the tool's site, headers, session and saved values.
export type ScriptAccess = Pick<HttpRequest, 'url' | 'headers' | 'session' | 'secrets'>;

// Values saved for the tool ({{secret:name}}) go in last, only to its site, and are masked in the answer.
export async function scriptRequest(access: ScriptAccess, method: string, path: string, body: unknown, signal?: AbortSignal): Promise<ScriptResponse> {
  const verb = method.toUpperCase() as HttpRequest['method'];
  if (!HTTP_METHODS.includes(verb)) throw new Error(`request(): the method is one of ${HTTP_METHODS.join(', ')}.`);
  const site = new URL(access.url).origin;
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error(`request(): a path on ${site}, starting with "/" (e.g. "/api/v4/users/me").`);
  const url = new URL(fillSecrets(path, access.secrets), site);
  if (url.origin !== site) throw new Error(`request(): only ${site}.`);
  await requireAccess(url.href, 'reach');
  const sent = verb === 'GET' || body === undefined ? undefined : fillSecrets(JSON.stringify(body), access.secrets);
  const filled = await requestHeaders(access, url.href, sent !== undefined);
  if ('problem' in filled) throw new Error(filled.problem);
  const res = await fetch(url, { method: verb, headers: filled.headers, body: sent, credentials: access.session ? 'include' : 'omit', redirect: NO_REDIRECT, signal });
  refuseRedirect(res, url);
  const raw = maskSecrets(await res.text(), access.secrets);
  let data: unknown = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    // not JSON: its text
  }
  return { status: res.status, ok: res.ok, data };
}

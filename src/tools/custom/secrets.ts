// The values a custom tool uses by {{secret:name}} (tools/secrets): the names its code, request and
// headers write, and, once the tool is saved, the ones a recording's review kept for it
// (recording/pending-secrets).
import { takePendingSecrets } from '../../recording/pending-secrets';
import { secretsIn } from '../secrets';
import { hostOf } from '../../core/util';
import type { HttpRequest } from '../http';
import type { CustomTool } from './types';

export const usedSecrets = (c: Pick<CustomTool, 'script' | 'http'>): string[] => [
  ...new Set([...secretsIn(c.script), ...secretsIn(c.http?.url), ...secretsIn(c.http?.body), ...(c.http?.headers ?? []).flatMap((h) => secretsIn(h.value))]),
];

// The tool with the pending values it uses saved in it (those it already has stay).
export async function adoptPendingSecrets(c: CustomTool): Promise<CustomTool> {
  const names = usedSecrets(c).filter((n) => !c.http?.secrets || !Object.hasOwn(c.http.secrets, n));
  if (!c.http || !names.length) return c;
  const taken = await takePendingSecrets(names, hostOf(c.http.url));
  return Object.keys(taken).length ? { ...c, http: { ...c.http, secrets: { ...c.http.secrets, ...taken } } } : c;
}

// A model's edit of a tool keeps its saved values while its site stays the same.
export function keptSecrets(before: Pick<HttpRequest, 'url' | 'secrets'> | undefined, url: string): Record<string, string> | undefined {
  if (!before?.secrets) return undefined;
  try {
    return new URL(before.url).origin === new URL(url).origin ? before.secrets : undefined;
  } catch {
    return undefined;
  }
}

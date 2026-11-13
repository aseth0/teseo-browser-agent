// A value the user saved for a custom tool (a recording's ••••[name], recording/pending-secrets): the
// tool's request or script writes {{secret:name}}, and the value goes in only when the request is sent,
// to the tool's own site; the model never sees it, and it is masked in what comes back.
import { hiddenLabel } from '../recording/recording';

const SECRET = /\{\{\s*secret:([^}]+?)\s*\}\}/g;

export const secretsIn = (text: string | undefined): string[] => [...(text ?? '').matchAll(SECRET)].map((m) => m[1]!.trim());

export function fillSecrets(text: string, secrets: Record<string, string> = {}): string {
  return text.replace(SECRET, (_, raw: string) => {
    const name = raw.trim();
    if (!Object.hasOwn(secrets, name)) throw new Error(`No saved value for "${name}": the user must save it for this tool (Settings → Custom tools).`);
    return secrets[name]!;
  });
}

// The value as it was saved, and as an answer may echo it: escaped in JSON, encoded in a URL.
// A value saved as written in a URL (encoded) or a JSON text (escaped) is masked as it reads too.
const forms = (value: string) => [...new Set([value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value), ...readForms(value)])].filter(Boolean);
function readForms(value: string): string[] {
  const out: string[] = [];
  try {
    out.push(decodeURIComponent(value.replace(/\+/g, ' ')));
  } catch { /* not encoded */ }
  try {
    out.push(JSON.parse(`"${value}"`) as string);
  } catch { /* not escaped */ }
  return out;
}

export function maskSecrets(text: string, secrets: Record<string, string> = {}): string {
  return Object.entries(secrets).reduce((out, [name, value]) => forms(value).reduce((t, form) => t.split(form).join(hiddenLabel(name)), out), text);
}

// What the model gives (a tool's arguments, a script's input) cannot name a saved value: its
// {{secret:…}} is broken up, so it goes as text and nothing is filled in.
export function neutralizeSecrets<T>(value: T): T {
  if (typeof value === 'string') return value.replace(/\{\{(\s*secret:)/gi, '{ {$1') as T;
  if (Array.isArray(value)) return value.map(neutralizeSecrets) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, neutralizeSecrets(v)])) as T;
  return value;
}

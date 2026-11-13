// The values the user chose, in a recording's review, to save for a tool made from it (••••[name]):
// kept in the extension's secret store (never sent to the model) until a custom tool that uses
// {{secret:name}} is saved and takes them, or for a day.
import { readSecret, updateSecret } from '../storage/secrets';

const KEY = 'pendingSecrets';
const KEPT_MS = 24 * 3600_000;
type Pending = Record<string, { value: string; at: number; host: string }>; // host: the site the recording called

// The names among `names` pending for that site.
const forSite = (pending: Pending, names: string[], host: string) => names.filter((n) => Object.hasOwn(pending, n) && pending[n]!.host === host);

const fresh = (p: Pending | undefined): Pending => Object.fromEntries(Object.entries(p ?? {}).filter(([, v]) => Date.now() - v.at < KEPT_MS));

export const savePendingSecret = (name: string, value: string, host: string) =>
  updateSecret<Pending>(KEY, (prev) => ({ value: { ...fresh(prev), [name]: { value, at: Date.now(), host } }, notify: false }));

// The names still pending for that site (no values): what a tool's save card says it will take.
export async function pendingSecretNames(names: string[], host: string): Promise<string[]> {
  const pending = fresh(await readSecret<Pending>(KEY));
  return forSite(pending, names, host);
}

// The ones named, recorded on that site, taken: they are no longer pending. A tool for another site
// gets none: a value goes only where the recording sent it.
export async function takePendingSecrets(names: string[], host: string): Promise<Record<string, string>> {
  const stored = await readSecret<Pending>(KEY);
  const pending = fresh(stored);
  const taken = Object.fromEntries(forSite(pending, names, host).map((n) => [n, pending[n]!.value]));
  // Written back when one is taken or some expired: an expired value does not stay stored.
  const expired = Object.keys(stored ?? {}).length !== Object.keys(pending).length;
  if (Object.keys(taken).length || expired) await updateSecret<Pending>(KEY, (prev) => ({ value: Object.fromEntries(Object.entries(fresh(prev)).filter(([n]) => !(n in taken))), notify: false }));
  return taken;
}

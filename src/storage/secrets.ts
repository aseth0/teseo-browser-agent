// Secrets (the providers' keys and headers, the MCP servers' headers, client secrets and OAuth
// sign-ins), kept apart from storage.local: any content script may read that area, and its onChanged
// tells every listener, the page widget's too, the values that change. These live in the extension's
// own IndexedDB (storage/secret-db) instead, which only its pages and its worker can open.
// A change is told through storage.local all the same, as a new random stamp per secret (SECRETS_REV),
// never anything of the value: the pages and the worker then read it again.
import { browser } from 'wxt/browser';
import { storageRecord } from './area';
import { dbGet, dbSet } from './secret-db';
import { serialized } from './serial';
import { watchKey, type KeyChange } from './watch';

export const SECRETS_REV = 'secretsRev'; // storage.local: { [secret name]: stamp }
// envKey: background/env-key. customToolSecrets and customToolSourceSecrets: their headers (tools/custom).
// sitePolicies, agentAccess and actionLog are not secret, but no content script may write a site's
// policy, Browser's or an agent's, nor what an agent may reach, nor read what was done where
// (policy/store, agents/profiles, logs/actions). agentSites: where earlier versions kept the agents' sites.
// moved: the moves out of storage.local already done (moveOnce, once). wordBlacklist: its terms and
// their placeholders (word-blacklist/store). pendingSecrets: values a recording's review saved for a tool
// made from it (recording/pending-secrets).
export type SecretName = 'settings' | 'mcpAuth' | 'envKey' | 'sitePolicies' | 'agentAccess' | 'agentSites' | 'customToolSecrets' | 'customToolSourceSecrets' | 'widgetActions' | 'actionLog' | 'moved' | 'wordBlacklist' | 'pendingSecrets';

export const readSecret = <T>(name: SecretName) => dbGet<T>(name);

// The writes of a secret, one at a time across the extension's pages; `change` gets the stored value.
const queue = serialized('secrets');

interface SecretUpdate<T> {
  value: T | undefined;
  notify: boolean;
  also?: Record<string, unknown>;
}

// Writes it (undefined deletes it); `notify`: the pages and the worker are told it changed. `also`:
// storage.local items written with the stamp, in the same write (one onChanged for both).
export function updateSecret<T>(
  name: SecretName,
  change: (prev: T | undefined) => SecretUpdate<T> | Promise<SecretUpdate<T>>,
): Promise<void> {
  return queue(async () => {
    const { value, notify, also = {} } = await change(await dbGet<T>(name));
    await dbSet(name, value);
    const revs = notify ? await storageRecord<string>('local', SECRETS_REV) : undefined;
    const stamp = crypto.randomUUID();
    if (revs) ownStamps.add(stamp);
    const items = { ...also, ...(revs && { [SECRETS_REV]: { ...revs, [name]: stamp } }) };
    if (Object.keys(items).length) await browser.storage.local.set(items);
  });
}

// The stamps this page or worker wrote: `elsewhere` tells apart the changes another one made.
const ownStamps = new Set<string>();

// Whether a change to storage.local says a secret changed (updateSecret with notify); `elsewhere`:
// only when another page or the worker changed it.
export function secretChanged(name: SecretName, changes: Record<string, KeyChange>, { elsewhere = false }: { elsewhere?: boolean } = {}): boolean {
  const stamp = (v: unknown) => (v as Record<string, string> | undefined)?.[name];
  const rev = changes[SECRETS_REV];
  if (!rev || stamp(rev.oldValue) === stamp(rev.newValue)) return false;
  return !elsewhere || !ownStamps.has(stamp(rev.newValue) ?? '');
}

// Calls back when a secret is said to have changed, here or in another page.
export function onSecretChanged(name: SecretName, cb: () => void): () => void {
  return watchKey('local', SECRETS_REV, (c) => secretChanged(name, { [SECRETS_REV]: c }) && cb());
}

// Moves what earlier versions kept in storage.local under `keys`, once: `move` gets what is there the
// first time, and the keys are removed. Later, anything under those keys is removed unread: a
// content script may have written it, and taking it would let a page write what the move protects.
export async function moveOnce(id: string, keys: string[], move: (stored: Record<string, unknown>) => Promise<void>): Promise<void> {
  const stored = keys.length ? await browser.storage.local.get(keys) : {};
  await once(id, async () => {
    if (Object.keys(stored).length) await move(stored);
  });
  if (Object.keys(stored).length) await browser.storage.local.remove(Object.keys(stored));
}

// Runs `move` the first time only, for a move out of storage.local that is not of whole keys (one
// field of what stays there). Two calls at once in this page or worker share one run; two pages may
// both run it, so a move must change nothing when run again.
const moving = new Map<string, Promise<void>>();
export function once(id: string, move: () => Promise<void>): Promise<void> {
  let run = moving.get(id);
  if (!run) {
    run = (async () => {
      if ((await dbGet<Record<string, true>>('moved'))?.[id]) return;
      await move();
      await updateSecret<Record<string, true>>('moved', (done = {}) => ({ value: { ...done, [id]: true }, notify: false }));
    })().finally(() => moving.delete(id));
    moving.set(id, run);
  }
  return run;
}

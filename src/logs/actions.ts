// The action log: every tool call of the chat, its sub-agents and the page widget, with what the
// policy decided and how it ended (Settings → Logs). Only the call's summary as the confirmation card
// shows it (which may name a URL, a title or a path), never its full arguments, headers, keys, page
// contents or results (only their size). Kept by Settings → Logs: off, for the browser session
// (storage.session), or in this browser (the extension's own IndexedDB, storage/secrets: content
// scripts can read storage.local, and must not learn what was done where), the latest first.
import { browser } from 'wxt/browser';
import { storageList } from '../storage/area';
import { stripMarks } from '../core/model-texts';
import type { ToolCallLog } from '../core/types';
import { moveOnce, onSecretChanged, readSecret, updateSecret } from '../storage/secrets';
import { serialized } from '../storage/serial';
import { watchKey } from '../storage/watch';

export type ActionLogMode = 'off' | 'session' | 'kept';
export const DEFAULT_LOG_MODE: ActionLogMode = 'session';

export type ActionSource = 'chat' | 'sub-agent' | 'widget';
// free: it ran without a card (a read, or a site that acts without asking); refused: by a policy
// (read only, a site not given to the agent…), or before it could run (unknown tool, missing
// arguments); the rest is the card's answer.
export type ActionDecision = 'free' | 'allow' | 'always' | 'session' | 'deny' | 'refused';

export interface ActionLogEntry {
  at: number; // Date.now(), when it started
  source: ActionSource;
  agent: string; // its label; "Browser" for none
  tool: string;
  summary?: string; // as the card shows it, when the policy looked at the call
  host?: string;
  decision: ActionDecision;
  ok: boolean;
  error?: string; // why it was refused, or the tool's error (cut)
  ms: number;
  size?: number; // characters of the result
  conversationId?: string;
}

const KEY = 'actionLog';
const MAX = 1000;
const MAX_TEXT = 300;

const cut = (raw: string) => {
  const s = stripMarks(raw);
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s;
};

// `agent`: its label; none: Browser.
export function logEntry(call: ToolCallLog, where: { source: ActionSource; agent?: string; conversationId?: string }): ActionLogEntry {
  const { seen = {} } = call;
  const decision: ActionDecision = seen.asked === 'deny' ? 'deny' : call.refused ? 'refused' : (seen.asked ?? 'free');
  const error = call.refused ?? call.error;
  return {
    at: call.at,
    ...where,
    agent: where.agent ?? 'Browser',
    tool: call.tool,
    ...(seen.summary && { summary: cut(seen.summary) }),
    ...(seen.host && { host: seen.host }),
    decision,
    ok: !error,
    ...(error && { error: cut(error) }),
    ms: call.ms,
    ...(call.size !== undefined && { size: call.size }),
  };
}

const serial = serialized(`${KEY}:session`);
const latestFirst = (entries: ActionLogEntry[]) => entries.sort((a, b) => b.at - a.at).slice(0, MAX);

// Appended in batches: the calls logged within BATCH_MS of the first one wait for it and are written
// together, so a run does not rewrite the whole log for every call. Each batch one at a time, also
// across the extension's pages, so calls logged together are all kept. A log that cannot be written
// never fails the call it logs.
const BATCH_MS = 300;
type Batch = { entries: ActionLogEntry[]; written: Promise<void> };
const batches: Partial<Record<Exclude<ActionLogMode, 'off'>, Batch>> = {};

export function logAction(entry: ActionLogEntry, mode: ActionLogMode): Promise<void> {
  if (mode === 'off') return Promise.resolve();
  const open = batches[mode];
  if (open) {
    open.entries.push(entry);
    return open.written;
  }
  const batch: Batch = { entries: [entry], written: Promise.resolve() };
  batches[mode] = batch;
  batch.written = new Promise<void>((resolve) => setTimeout(resolve, BATCH_MS))
    .then(() => {
      delete batches[mode]; // those logged from now on go in the next one
      const added = batch.entries.slice().reverse(); // the latest first
      return mode === 'kept'
        ? updateSecret<ActionLogEntry[]>(KEY, (list = []) => ({ value: [...added, ...list].slice(0, MAX), notify: true }))
        : serial(async () => {
            const { [KEY]: list = [] } = await browser.storage.session.get<{ [KEY]?: ActionLogEntry[] }>(KEY);
            await browser.storage.session.set({ [KEY]: [...added, ...list].slice(0, MAX) });
          });
    })
    .catch((e) => console.warn('[action log]', e));
  return batch.written;
}

// Both places: what was kept before the mode changed is still shown (and exported) until cleared.
export async function loadActionLog(): Promise<ActionLogEntry[]> {
  const [kept, session] = await Promise.all([readSecret<ActionLogEntry[]>(KEY), storageList<ActionLogEntry>('session', KEY)]);
  return [...(kept ?? []), ...session].sort((a, b) => b.at - a.at);
}

export const clearActionLog = () =>
  Promise.all([updateSecret(KEY, () => ({ value: undefined, notify: true })), browser.storage.session.remove(KEY)]).then(() => undefined);

export function onActionLogChanged(cb: () => void): () => void {
  const stops = [watchKey('session', KEY, () => cb()), onSecretChanged(KEY, cb)];
  return () => stops.forEach((stop) => stop());
}

// A log earlier versions kept in storage.local, moved here once (storage/secrets moveOnce), with what
// is here, the latest first. An entry already here is not added again (two pages may both move it).
const sameEntry = (a: ActionLogEntry, b: ActionLogEntry) => a.at === b.at && a.tool === b.tool;
export const moveLegacyActionLog = () =>
  moveOnce(KEY, [KEY], async ({ [KEY]: legacy }) => {
    const entries = Array.isArray(legacy) ? (legacy as ActionLogEntry[]) : [];
    await updateSecret<ActionLogEntry[]>(KEY, (list = []) => ({ value: latestFirst([...list, ...entries.filter((e) => !list.some((x) => sameEntry(x, e)))]), notify: true }));
  });

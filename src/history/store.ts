// Saved conversations, only in this browser (storage.local): each one under its own key, and an
// index of them all (title, site, model, dates) to list them without loading every one. Screenshots
// are not kept: they would take most of the space.
import { browser } from 'wxt/browser';
import { shownText } from '../core/messages';
import { stripMarks, text } from '../core/model-texts';
import { modelView } from '../context/compaction';
import { estimatedInput, estimateRequest } from '../context/usage';
import { searchDocFor } from './rank';
import { docVersion, type SearchDoc } from './search-doc';
import type { Message, Part } from '../core/types';
import { pdfNotKept } from '../context/attached-file';
import { pdfOf } from '../core/sources';
import { serialized } from '../storage/serial';
import type { HistorySettings } from '../storage/settings-types';
import { watchKey } from '../storage/watch';
import { finiteOr } from '../storage/import';
import { isObject } from '../core/util';
import { storageGet, storageList } from '../storage/area';
import { retentionLimit } from '../storage/retention';
import { heldConversations } from './held';

export interface ConversationMeta {
  id: string;
  title: string;
  titleSetByUser?: boolean;
  createdAt: number;
  updatedAt: number;
  site?: string; // the page it started on
  model?: string;
  providerId?: string;
  agentId?: string; // the agent it was last talked to (Settings → Agents); none: Default
  agent?: string; // its name, shown even once the agent is gone
  agents?: ConversationAgent[]; // every agent that took part, in that order (not kept by builds before it)
  turns: number; // your messages
  tokens?: number; // how much context it took at its last model call (to go on with it)
  pinned?: boolean; // listed first, never deleted by the retention, and searched in full (search/bm25)
  origin?: ConversationOrigin; // where it started, when not in the side panel or on a page (never changes)
  revision?: number; // one more on each save (none: saved by a build before it, as 0)
}

// Started in the Agents Panel (the agent manager's page).
export type ConversationOrigin = 'manager';

// An agent a conversation was talked to: its id (none: Default) and name as then.
export interface ConversationAgent {
  id?: string;
  name: string;
}

export interface Conversation extends ConversationMeta {
  history: Message[];
}

const INDEX = 'convIndex';
// The storage.local key a conversation is saved under (watched by a chat that shows it from another: sidepanel/floating).
export const conversationKey = (id: string) => `conv:${id}`;
const key = conversationKey;
// Each one's search document (history/search-doc), beside it: read by searches only, not by every list.
export const searchDocKey = (id: string) => `convSearch:${id}`;
const TITLE_MAX = 60;

// What you typed in your first message, shortened.
export function titleOf(history: Message[]): string {
  const first = history.find((m) => m.role === 'user');
  const typed = (first?.parts ?? []).map((p) => (p.type === 'text' && !p.context ? shownText(p) : '')).join(' ').replace(/\s+/g, ' ').trim();
  return typed.length > TITLE_MAX ? `${typed.slice(0, TITLE_MAX - 1)}…` : typed || 'New conversation';
}

// The history as it is kept: screenshots replaced by a note, the images you attached kept without
// their data (the model gets a note in their place if you go on), and the PDFs by their name only.
export function keptHistory(history: Message[]): Message[] {
  return history.map((m) => {
    const parts = m.parts.map(keptPart);
    return parts.every((p, i) => p === m.parts[i]) ? m : { ...m, parts };
  });
}

function keptPart(p: Part): Part {
  if (p.type === 'tool_result' && p.images?.length) return { ...p, content: text('result.screenshot_not_kept'), images: undefined };
  if (p.type === 'image' && p.data) return { ...p, data: '' };
  const pdf = p.type === 'text' ? pdfOf(p.source) : undefined;
  if (p.type !== 'text' || pdf === undefined || p.text === pdfNotKept(pdf)) return p;
  return { ...p, text: pdfNotKept(pdf) };
}

// Your messages in it.
const turnsOf = (history: Message[]) => history.filter((m) => m.role === 'user').length;

// The context its last model call took (input and answer), as recorded; estimated without one.
function tokensOf(history: Message[]): number {
  const last = history.findLast((m) => m.meta)?.meta;
  if (last) return last.input + last.output;
  const view = modelView(undefined, history);
  return estimatedInput(estimateRequest(view.system, [], view.messages));
}

// The index's entries, as far as they can be read: one of another shape (another build's) is left out.
const metas = (v: unknown): ConversationMeta[] => (Array.isArray(v) ? v.filter((c): c is ConversationMeta => isObject(c) && typeof c.id === 'string') : []);

export async function listConversations(): Promise<ConversationMeta[]> {
  return metas(await storageList<unknown>('local', INDEX)).sort((a, b) => finiteOr(b.updatedAt, 0) - finiteOr(a.updatedAt, 0));
}

// Whenever a conversation is saved, renamed or deleted (here or in another page).
export function onConversationsChanged(cb: () => void): () => void {
  return watchKey('local', INDEX, () => cb());
}

// The conversations deleted (here or in another page: the history panel, Settings → History, the retention).
export function onConversationsDeleted(cb: (ids: string[]) => void): () => void {
  return watchKey('local', INDEX, ({ oldValue, newValue }) => {
    const left = new Set(metas(newValue).map((c) => c.id));
    const gone = metas(oldValue).map((c) => c.id).filter((id) => !left.has(id));
    if (gone.length) cb(gone);
  });
}

// One stored otherwise than as a conversation (no history list): as if there were none.
const asConversation = (v: unknown): Conversation | undefined => (isObject(v) && Array.isArray(v.history) ? (v as unknown as Conversation) : undefined);

export async function loadConversation(id: string): Promise<Conversation | undefined> {
  return asConversation(await storageGet<unknown>('local', key(id)));
}

// Changes one at a time, so none drops another's (a pin while a turn is saved).
const serial = serialized('history');

const writeIndex = async (change: (index: ConversationMeta[]) => ConversationMeta[]) =>
  browser.storage.local.set({ [INDEX]: change(await listConversations()) });

// Its search document, unless it cannot be indexed (then left to the search, which leaves it out).
const docOf = (conv: Conversation): SearchDoc | undefined => {
  try {
    return searchDocFor(conv);
  } catch (e) {
    console.error('[history search]', conv.id, e);
    return undefined;
  }
};

// The conversation and its search document; without `indexed` (an import), none: a search builds it.
const writeConversation = async (conv: Conversation, indexed = true) => {
  const doc = indexed ? docOf(conv) : undefined;
  await browser.storage.local.set({ [key(conv.id)]: conv, ...(doc && { [searchDocKey(conv.id)]: doc }) });
  if (!doc) await browser.storage.local.remove(searchDocKey(conv.id));
};

const store = async (conv: Conversation, indexed = true) => {
  const { history: _history, ...meta } = conv;
  await writeConversation(conv, indexed);
  await writeIndex((index) => [meta, ...index.filter((c) => c.id !== conv.id)]);
};

const remove = async (ids: string[]) => {
  if (!ids.length) return;
  await browser.storage.local.remove([...ids.map(key), ...ids.map(searchDocKey)]);
  await writeIndex((index) => index.filter((c) => !ids.includes(c.id)));
};

// Settings → History: older than the days kept, or past the number kept (the latest are kept).
// Pinned ones are never deleted, nor counted. Those open in a chat now (history/held: another
// panel, an Agents Panel row, maybe running) are counted but not deleted: once let go, a later save does.
const beyond = async (retention: HistorySettings): Promise<string[]> => {
  const keepDays = retentionLimit(retention.keepDays);
  const keepCount = retentionLimit(retention.keepCount);
  if (!keepDays && !keepCount) return [];
  const list = (await listConversations()).filter((c) => !c.pinned);
  const held = await heldConversations();
  const tooOld = keepDays ? list.filter((c) => c.updatedAt < Date.now() - keepDays * 86_400_000) : [];
  const tooMany = keepCount ? list.slice(keepCount) : [];
  return [...new Set([...tooOld, ...tooMany].map((c) => c.id))].filter((id) => !held.has(id));
};
const retain = async (retention: HistorySettings) => remove(await beyond(retention));

// The agents of a conversation with `used` added, unless it took part already. One saved without the
// list (before it, or by an older build since) starts from the agent it was last talked to.
export function joinAgents(previous: Pick<ConversationMeta, 'agents' | 'agentId' | 'agent'> | undefined, used: ConversationAgent): ConversationAgent[] {
  const known = previous?.agents ?? (previous?.agent ? [{ ...(previous.agentId && { id: previous.agentId }), name: previous.agent }] : []);
  return known.some((a) => a.id === used.id) ? known : [...known, used];
}

// Its agents as the history shows them.
export const agentNames = (c: Pick<ConversationMeta, 'agents' | 'agent'>): string | undefined =>
  c.agents?.length ? c.agents.map((a) => a.name).join(' · ') : c.agent;

// The revision of each conversation this page (one chat) last loaded or saved, for the saves that check
// it (`checked`): a conversation several chats show (the pinned one, floating on several tabs) is never
// overwritten by one that has not seen what another saved since.
const revisions = new Map<string, number>();
export const noteRevision = (conv: Pick<ConversationMeta, 'id' | 'revision'>) => void revisions.set(conv.id, conv.revision ?? 0);
export const knownRevision = (id: string): number | undefined => revisions.get(id);
// Opened from something that does not say its revision (a handoff): none known, nothing checked against.
export const forgetRevision = (id: string) => void revisions.delete(id);
// Whether that saved one is not the one this page last loaded or saved (another chat saved it since,
// or it was deleted). One this page knows nothing of is not.
export const savedSince = (id: string, saved: Pick<ConversationMeta, 'revision'> | undefined): boolean => {
  const known = revisions.get(id);
  return known !== undefined && (saved ? saved.revision ?? 0 : -1) !== known;
};

// Saves it (title from the first message, unless you renamed it), then applies the retention.
// `talkedTo`: the agent of the turn saved, added to its agents. `checked`: only over the revision this
// page last loaded or saved (noteRevision), else not saved: false (another chat saved it since, or it
// was deleted). Every save counts one more revision, and a checked one is noted.
export const saveConversation = (conv: Omit<Conversation, 'title' | 'turns' | 'agents'> & { title?: string; talkedTo?: ConversationAgent }, retention: HistorySettings = {}, { checked = false } = {}): Promise<boolean> =>
  serial(async () => {
    const { talkedTo, ...rest } = conv;
    const previous = (await listConversations()).find((c) => c.id === conv.id);
    // The record's revision, which the chats note (loadConversation), and the index's: one write of the
    // two may have failed (or the page gone between them), so the record may be ahead.
    const record = previous ? asConversation(await storageGet<unknown>('local', key(conv.id))) : undefined;
    const stored = previous && { revision: Math.max(record?.revision ?? 0, previous.revision ?? 0) };
    if (checked && savedSince(conv.id, stored)) return false;
    const revision = (stored?.revision ?? 0) + 1;
    // Noted before the write, which its own chat sees (storage.onChanged) as its own; back as it was if
    // the write fails (the next save goes over what is stored, as before).
    const before = revisions.get(conv.id);
    if (checked) revisions.set(conv.id, revision);
    const agents = talkedTo ? joinAgents(previous, talkedTo) : previous?.agents;
    try {
      await store({
        ...rest,
        ...(agents && { agents }),
        // Where and when it started stay as they were.
        createdAt: previous?.createdAt ?? conv.createdAt,
        site: previous?.site ?? conv.site,
        origin: previous ? previous.origin : conv.origin,
        title: previous?.titleSetByUser ? previous.title : titleOf(conv.history),
        titleSetByUser: previous?.titleSetByUser,
        pinned: previous?.pinned,
        turns: turnsOf(conv.history),
        tokens: tokensOf(conv.history),
        history: keptHistory(conv.history),
        revision,
      });
    } catch (e) {
      if (checked) {
        if (before === undefined) revisions.delete(conv.id);
        else revisions.set(conv.id, before);
      }
      throw e;
    }
    await retain(retention);
    return true;
  });

// A turn whose checked save was refused (another chat saved that conversation since), kept as a
// conversation of its own: a new id, its title from it.
// `id`: the one it was kept under before in the same turn (a refusal mid-turn, then at its end): one copy.
export const keepApart = (conv: Parameters<typeof saveConversation>[0], id: string = crypto.randomUUID()) => saveConversation({ ...conv, id });

// A saved conversation changed (renamed, pinned), in it and in the index.
const change = (id: string, edit: (conv: Conversation) => Partial<Conversation>): Promise<void> =>
  serial(async () => {
    const conv = await loadConversation(id);
    if (!conv) return;
    const changed = { ...conv, ...edit(conv) };
    const { history: _history, ...meta } = changed;
    await writeConversation(changed);
    await writeIndex((index) => index.map((c) => (c.id === id ? meta : c)));
  });

export const renameConversation = (id: string, title: string) =>
  change(id, (conv) => ({ title: title.trim() || titleOf(conv.history), titleSetByUser: Boolean(title.trim()) }));

export const setPinned = (id: string, pinned: boolean) => change(id, () => ({ pinned }));

export const deleteConversations = (ids: string[]): Promise<void> => serial(() => remove(ids));

export const deleteAllConversations = () => serial(async () => remove((await listConversations()).map((c) => c.id)));

export const applyRetention = (retention: HistorySettings): Promise<void> => serial(() => retain(retention));
// How many conversations it would delete now (Settings → History asks first).
export const retentionCount = async (retention: HistorySettings): Promise<number> => (await beyond(retention)).length;

export async function loadConversations(ids: string[]): Promise<Conversation[]> {
  const all = await browser.storage.local.get(ids.map(key));
  return ids.flatMap((id) => {
    const conv = asConversation(all[key(id)]);
    return conv ? [conv] : [];
  });
}

// Search documents a search built (missing or stale), stored a batch at a time, those of a
// conversation saved, renamed, pinned or deleted since left out.
export const writeSearchDocs = (docs: [id: string, doc: SearchDoc][], batch: number): Promise<void> =>
  serial(async () => {
    const versions = new Map((await listConversations()).map((c) => [c.id, docVersion(c)]));
    const current = docs.filter(([id, doc]) => versions.get(id) === doc.version);
    for (let i = 0; i < current.length; i += batch)
      await browser.storage.local.set(Object.fromEntries(current.slice(i, i + batch).map(([id, doc]) => [searchDocKey(id), doc])));
  });

// A conversation's title and what was written (marks out), and for a pinned one also the reasoning
// and the tools' arguments: where snippets come from.
export const searchableText = (conv: Conversation) =>
  stripMarks(
    [
      conv.title,
      ...conv.history.flatMap((m) =>
        m.parts.map((p) => (p.type === 'text' ? p.text : !conv.pinned ? '' : p.type === 'reasoning' ? p.text : p.type === 'tool_call' ? JSON.stringify(p.args) : '')),
      ),
    ].join('\n'),
  );

export async function historyBytes(): Promise<number> {
  const list = await listConversations();
  return browser.storage.local.getBytesInUse([INDEX, ...list.flatMap((c) => [key(c.id), searchDocKey(c.id)])]);
}

// Every conversation, for a backup (and import back).
export async function exportAll(): Promise<string> {
  const list = await listConversations();
  return JSON.stringify({ conversations: await loadConversations(list.map((c) => c.id)) }, null, 1);
}

// A conversation of a backup, as far as storing it needs: an id, and messages with a role and parts.
function isConversation(v: unknown): v is Conversation {
  if (!isObject(v)) return false;
  const { id, history } = v;
  return (
    typeof id === 'string' &&
    id !== '' &&
    Array.isArray(history) &&
    history.every((m: unknown) => isObject(m) && typeof m.role === 'string' && Array.isArray(m.parts))
  );
}

// A part of a backup as the chat and the search read it: one without what its kind needs (a text's
// text, a result's content, a call's id and name) is dropped; one of a kind this build does not know
// (a newer build's) is kept, as saving it would.
function importedPart(p: unknown): Part[] {
  if (!isObject(p) || typeof p.type !== 'string') return [];
  const needs: Record<string, string[]> = { text: ['text'], reasoning: ['text'], tool_result: ['toolCallId', 'content'], tool_call: ['id', 'name'], image: ['mediaType'] };
  return (needs[p.type] ?? []).every((k) => typeof p[k] === 'string') ? [p as unknown as Part] : [];
}

// A conversation of a backup made whole: what it lacks or has wrong (its title, its times, its counts,
// its malformed parts) as saving it would set them, so that every list, search and mention can read it.
function imported(backup: Conversation): Conversation {
  const c = { ...backup, history: backup.history.map((m) => ({ ...m, parts: m.parts.flatMap(importedPart) })) };
  const updatedAt = finiteOr(c.updatedAt, Date.now());
  return {
    ...c,
    title: typeof c.title === 'string' && c.title.trim() ? c.title : titleOf(c.history),
    createdAt: finiteOr(c.createdAt, updatedAt),
    updatedAt,
    turns: turnsOf(c.history),
  };
}

// The conversations of a backup (exportAll), or one conversation exported alone (the history panel),
// made whole, and how many could not be read.
export function readConversations(json: string): { conversations: Conversation[]; skipped: number } {
  const parsed: unknown = JSON.parse(json);
  const conversations = isConversation(parsed) ? [parsed] : isObject(parsed) ? parsed.conversations : undefined;
  if (!Array.isArray(conversations)) throw new Error('No "conversations" list in this JSON');
  const valid = conversations.filter(isConversation).map(imported);
  return { conversations: valid, skipped: conversations.length - valid.length };
}

// Conversations stored, each in place of the one of its id. Their search documents are not (derived
// data, not in a backup): the first searches build them.
export async function storeConversations(list: Conversation[]): Promise<void> {
  await serial(async () => {
    for (const c of list) await store(c, false);
  });
}

// The conversations of a backup stored; the ones it cannot be are left out. How many were.
export async function importAll(json: string): Promise<number> {
  const { conversations } = readConversations(json);
  await storeConversations(conversations);
  return conversations.length; // those skipped are not counted
}

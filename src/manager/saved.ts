// The agent manager's rows, kept in this browser (storage.local) as they change, so that reopening the
// page lists them again, stopped: each with its tab, agent and saved conversation, until resumed or
// removed. Only rows whose conversation was said something are kept; on reading them back, only those
// whose conversation is still in the history.
import { browser } from 'wxt/browser';
import { hostOf, isObject } from '../core/util';
import type { Row } from './rows';

const KEY = 'managerRows';

export interface SavedRow {
  key: string;
  tabId: number;
  agentId?: string;
  conversationId: string;
  url?: string;
  title?: string;
  agentName?: string;
  parent?: string;
  parentName?: string;
}

// What is kept of the rows: the conversation each shows now (once said), else the one it went on with.
export function savedOf(rows: Row[]): SavedRow[] {
  return rows.flatMap((r) => {
    if (r.removing) return [];
    const conversationId = r.status?.said ? r.status.conversationId : r.conversationId;
    if (!conversationId) return [];
    const title = r.status?.said ? r.status.title : r.title;
    const agentName = r.status?.agentName ?? r.agentName;
    const url = r.status?.url ?? r.url;
    const { parent, parentName } = r;
    return [{ key: r.key, tabId: r.tabId, conversationId, ...(r.agentId && { agentId: r.agentId }), ...(url && { url }), ...(title && { title }), ...(agentName && { agentName }), ...(parent && { parent }), ...(parentName && { parentName }) }];
  });
}

const optString = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

// The rows kept, as stopped rows: what another build wrote and cannot be read is left out, as are
// those whose conversation is not in the history (`known`) any more.
export function restoredOf(saved: unknown, known: ReadonlySet<string>): Row[] {
  if (!Array.isArray(saved)) return [];
  return saved.flatMap((v: unknown): Row[] => {
    if (!isObject(v)) return [];
    const key = optString(v.key);
    const conversationId = optString(v.conversationId);
    const { tabId } = v;
    if (!key || !conversationId || !known.has(conversationId) || typeof tabId !== 'number' || !Number.isInteger(tabId)) return [];
    const [agentId, url, title, agentName, parent, parentName] = [v.agentId, v.url, v.title, v.agentName, v.parent, v.parentName].map(optString);
    return [{ key, tabId, conversationId, stopped: true, ...(agentId && { agentId }), ...(url && { url }), ...(title && { title }), ...(agentName && { agentName }), ...(parent && { parent }), ...(parentName && { parentName }) }];
  });
}

// Whether a stopped row goes on on its tab as it is now: open, on the same site as when it was kept
// (after a restart, its id may be another tab's), and no live row's.
export function canResumeOn(row: Pick<Row, 'tabId' | 'url'>, tab: { id?: number; url?: string } | undefined, taken: number[]): boolean {
  return !!tab && tab.id === row.tabId && !!row.url && hostOf(tab.url) === hostOf(row.url) && !taken.includes(row.tabId);
}

export async function loadSavedRows(known: ReadonlySet<string>): Promise<Row[]> {
  const { [KEY]: saved } = await browser.storage.local.get<Record<string, unknown>>(KEY);
  return restoredOf(saved, known);
}

export const saveRows = (rows: Row[]): Promise<void> => browser.storage.local.set({ [KEY]: savedOf(rows) });

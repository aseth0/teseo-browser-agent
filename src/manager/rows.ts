// The agent manager's rows (one per agent, each a chat in its own iframe) and what each one says. Those
// of the last time the page was open come back stopped (manager/saved): no chat until one is resumed.
// A row the agent of another started (agents/panel) goes under that one, and is given its task and
// messages: handed to its chat once that chat is there, and counted, to know when it has read them all.
import type { ManagerStatus, PanelMessage, PanelRow } from './protocol';

export interface Row {
  key: string;
  tabId: number; // the tab its agent works on
  agentId?: string; // chosen when it was made (none: Default)
  conversationId?: string; // the saved conversation it went on with (none: a new one)
  status?: ManagerStatus; // the latest its chat told
  removing?: boolean; // asked to stop, to go once it has
  stopped?: boolean; // from the last time the page was open: no chat until resumed
  url?: string; // a stopped one's page, as last told: its tab id may be another tab's after a restart
  title?: string; // what it says before its chat tells (a stopped one: as last told)
  agentName?: string;
  parent?: string; // the row whose agent started it (agents/panel)
  parentName?: string; // that agent's name, as it was
  pending?: PanelMessage[]; // messages given it, not yet handed to its chat
  handed?: number; // messages handed to its chat
}

export interface Rows {
  rows: Row[];
  selected?: string; // the row whose chat is shown
}

export type RowsAction =
  | { type: 'add'; row: Pick<Row, 'key' | 'tabId' | 'agentId' | 'conversationId' | 'agentName' | 'title' | 'parent' | 'parentName' | 'pending'> }
  | { type: 'give'; key: string; message: PanelMessage } // a message for its chat
  | { type: 'handed'; key: string; count: number } // that many of those given went to its chat
  | { type: 'select'; key: string }
  | { type: 'status'; key: string; status: ManagerStatus }
  | { type: 'removing'; key: string }
  | { type: 'remove'; key: string }
  | { type: 'restore'; rows: Row[] } // those of the last time, before any made since
  | { type: 'resume'; key: string; tabId: number; agentId?: string; select?: false }; // a stopped one's chat, on that tab (false: the user stays where they are)

export function rowsReducer(s: Rows, a: RowsAction): Rows {
  switch (a.type) {
    case 'add': {
      // One started by another row's agent: after that row and those it started, and not shown (the
      // user stays on the chat they look at).
      if (!a.row.parent) return { rows: [...s.rows, a.row], selected: a.row.key };
      const after = s.rows.findLastIndex((r) => r.key === a.row.parent || r.parent === a.row.parent) + 1 || s.rows.length;
      return { ...s, rows: [...s.rows.slice(0, after), a.row, ...s.rows.slice(after)] };
    }
    case 'give':
    case 'handed': {
      if (!s.rows.some((r) => r.key === a.key)) return s;
      const change = (r: Row): Row =>
        a.type === 'give' ? { ...r, pending: [...(r.pending ?? []), a.message] } : { ...r, pending: r.pending?.slice(a.count), handed: (r.handed ?? 0) + a.count };
      return { ...s, rows: s.rows.map((r) => (r.key === a.key ? change(r) : r)) };
    }
    case 'select':
      return { ...s, selected: a.key };
    case 'restore': {
      const restored = a.rows.filter((r) => !s.rows.some((o) => o.key === r.key));
      return restored.length ? { ...s, rows: [...restored, ...s.rows] } : s;
    }
    case 'resume': {
      if (!s.rows.some((r) => r.key === a.key && r.stopped)) return s;
      const { key, tabId, agentId } = a;
      return { rows: s.rows.map((r) => (r.key === key ? { ...r, tabId, agentId, stopped: false } : r)), selected: a.select === false ? s.selected : key };
    }
    case 'status':
    case 'removing': {
      if (!s.rows.some((r) => r.key === a.key)) return s;
      const change = a.type === 'status' ? { status: a.status } : { removing: true };
      return { ...s, rows: s.rows.map((r) => (r.key === a.key ? { ...r, ...change } : r)) };
    }
    case 'remove': {
      const i = s.rows.findIndex((r) => r.key === a.key);
      if (i < 0) return s;
      const rows = s.rows.filter((r) => r.key !== a.key);
      // The one shown goes: the next one shows, else the one before.
      const selected = s.selected === a.key ? (rows[i] ?? rows[i - 1])?.key : s.selected;
      return { rows, selected };
    }
  }
}

// The row whose chat shows that conversation now (none: no row has it; a stopped one has no chat).
export const rowOfConversation = (rows: Row[], conversationId: string): Row | undefined =>
  rows.find((r) => !r.stopped && (r.status?.conversationId ?? r.conversationId) === conversationId);

// Where a row is in the tree its list draws: one with rows under it ('parent'), one under another, the
// last of them ('last') or not ('child'); none, a row on its own (one whose parent was removed too).
export type TreePlace = 'parent' | 'child' | 'last' | undefined;
export function treeOf(rows: Row[], i: number): TreePlace {
  const row = rows[i]!;
  const next = rows[i + 1];
  if (row.parent && rows.some((r) => r.key === row.parent)) return next?.parent === row.parent ? 'child' : 'last';
  if (row.parent) return undefined;
  return next?.parent === row.key ? 'parent' : undefined;
}

// The rows the agent of `parent` started.
export const childrenOf = (rows: Row[], parent: string) => rows.filter((r) => r.parent === parent);

// What its row shows as its title: its chat's, else what it was given (the task, for one an agent started).
export const rowTitle = (row: Row): string | undefined => row.status?.title ?? row.title;

// How a row started by another is, for that one's panel.wait: working until its chat has sent every
// message it was given and its turn has ended; then its answer.
export function panelRowOf(row: Row): PanelRow {
  const agent = row.agentName ?? row.status?.agentName ?? ''; // as the agent that started it named it
  const base = { row: row.key, agent };
  if (row.stopped) return { ...base, state: 'stopped' };
  const { status } = row;
  if (status?.state === 'waiting') return { ...base, state: 'waiting' };
  const unread = (row.pending?.length ?? 0) > 0 || (status?.given ?? 0) < (row.handed ?? 0);
  if (!status || unread || status.state === 'working') return { ...base, state: 'working', step: status?.step ?? 0, maxSteps: status?.maxSteps };
  return { ...base, state: 'done', ...(status.answer !== undefined && { answer: status.answer }) };
}

// The tabs live rows work on: a new or resumed one takes another.
export const takenTabs = (rows: Row[]) => rows.filter((r) => !r.stopped).map((r) => r.tabId);

// Working, or waiting for you: removing it, or closing the page, would stop it.
export const isBusy = (row: Row) => row.status?.state === 'working' || row.status?.state === 'waiting';
export const mustWarn = (rows: Row[]) => rows.some(isBusy);

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

// What the row says its agent is doing: e.g. "browser.click · 7/15 · 1m" while it works.
export function nowText(status: ManagerStatus | undefined, now: number, stopped = false): string {
  if (stopped) return 'Stopped';
  if (!status) return '';
  if (status.state === 'waiting') return 'Waiting for you';
  if (status.state === 'working') {
    const time = status.turnStartedAt === undefined ? undefined : elapsed(now - status.turnStartedAt);
    return [status.lastTool, `${status.step}/${status.maxSteps}`, time].filter(Boolean).join(' · ');
  }
  return status.said ? 'Done' : '';
}

// The row whose iframe a message came from (none: not one of them).
export function rowOfSource(frames: ReadonlyMap<string, Window | null>, source: MessageEventSource | null): string | undefined {
  if (!source) return undefined;
  for (const [key, w] of frames) if (w === source) return key;
  return undefined;
}

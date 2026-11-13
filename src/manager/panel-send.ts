// panel.send to a row an agent started (agents/panel): the message waits for its chat (rows 'give'). A
// stopped row (the page was reloaded: manager/saved) goes on first on its tab, as the user's resume
// does, without taking the user to it; when it cannot, the agent is told so, by the row's title.
import type { Dispatch } from 'react';
import type { PanelMessage } from './protocol';
import { canResumeOn } from './saved';
import { panelRowOf, rowTitle, takenTabs, type Row, type RowsAction } from './rows';

export interface ResumeChecks {
  tab: (tabId: number) => Promise<{ id?: number; url?: string } | undefined>;
  held: () => Promise<ReadonlyMap<string, unknown>>; // the conversations another chat has open
}

export async function giveToRow(row: Row, message: PanelMessage, rows: () => Row[], dispatch: Dispatch<RowsAction>, checks: ResumeChecks): Promise<{ when: 'now' | 'later' } | { stopped: string }> {
  if (!row.stopped) {
    dispatch({ type: 'give', key: row.key, message });
    return { when: panelRowOf(row).state === 'done' ? 'now' : 'later' };
  }
  const id = row.conversationId;
  const [tab, held] = await Promise.all([checks.tab(row.tabId), checks.held()]);
  if (!id || held.has(id) || !canResumeOn(row, tab, takenTabs(rows()))) return { stopped: rowTitle(row) ?? '' };
  dispatch({ type: 'resume', key: row.key, tabId: row.tabId, agentId: row.agentId, select: false });
  dispatch({ type: 'give', key: row.key, message });
  return { when: 'later' };
}

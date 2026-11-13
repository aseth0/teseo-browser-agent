// What the background asks of this page for the Agents Panel's tools (agents/panel), for the rows here:
// start an agent under one of them on a new tab (PANEL_START), say how the ones it started are
// (PANEL_ROWS), give one of them a message (PANEL_SEND; a stopped one goes on first, manager/panel-send).
// Asked for a row this page does not have, it leaves the message to another page. The messages given a row go to its chat once that chat is there.
// An agent started that answers while the one that started it does not wait for it: that one is given a
// notice (manager/notices).
import { useEffect, useRef, type Dispatch, type MutableRefObject } from 'react';
import { browser, type Browser } from 'wxt/browser';
import { PANEL_ROWS, PANEL_SEND, PANEL_START } from '../../core/protocol';
import { onRuntime } from '../../core/runtime';
import { isExtensionPage } from '../../core/sender';
import { MANAGER_SAY, type ManagerToChat, type PanelMessage } from '../../manager/protocol';
import { childrenOf, panelRowOf, type Row, type RowsAction } from '../../manager/rows';
import { dueNotices, markTold, noticeOf, seenBy, settlingOf, type Settling } from '../../manager/notices';
import { giveToRow, type ResumeChecks } from '../../manager/panel-send';
import { heldConversations } from '../../history/held';
import { useStableCallback } from '../../ui/useStableCallback';

// A row's key as the agent that started it names it: short, as it writes it back.
const childKey = () => crypto.randomUUID().slice(0, 8);
const NOTICE_CHECK_MS = 1000; // how often the rows are looked at for a notice due
const RESUME_CHECKS: ResumeChecks = { tab: (id) => browser.tabs.get(id).catch(() => undefined), held: heldConversations };

export function usePanelRequests(rows: Row[], dispatch: Dispatch<RowsAction>, frames: MutableRefObject<Map<string, HTMLIFrameElement>>): void {
  const here = (key: string) => rows.find((r) => r.key === key);
  const latest = useRef(rows);
  useEffect(() => {
    latest.current = rows;
  }, [rows]);
  const settling = useRef(new Map<string, Settling>());
  useEffect(() => {
    settling.current = settlingOf(settling.current, rows, Date.now());
  }, [rows]);

  // Not this page's row: nothing answered (synchronously), so that the page that has it answers. Only
  // the background asks (agents/panel), never a page's content script.
  const start = useStableCallback((msg: { parent: string; agentId?: string; agentName: string; message: PanelMessage; url: string; max: number }, sender: Browser.runtime.MessageSender) => {
    if (!isExtensionPage(sender)) return undefined;
    const parent = here(msg.parent);
    if (!parent) return undefined;
    const count = childrenOf(rows, msg.parent).length;
    if (count >= msg.max) return { tooMany: count };
    const parentName = parent.status?.agentName ?? parent.agentName;
    return browser.tabs.create({ url: msg.url, active: false }).then((tab) => {
      if (tab.id === undefined) throw new Error('The browser gave the new tab no id');
      const key = childKey();
      const row = { key, tabId: tab.id, agentName: msg.agentName, title: msg.message.shown, parent: msg.parent, pending: [msg.message] };
      dispatch({ type: 'add', row: { ...row, ...(msg.agentId && { agentId: msg.agentId }), ...(parentName && { parentName }) } });
      return { row: key };
    });
  });
  const listRows = useStableCallback((msg: { parent: string; rows?: string[] }, sender: Browser.runtime.MessageSender) => {
    if (!isExtensionPage(sender) || !here(msg.parent)) return undefined;
    const told = childrenOf(rows, msg.parent).filter((r) => !msg.rows || msg.rows.includes(r.key)).map(panelRowOf);
    seenBy(settling.current, told);
    return { rows: told };
  });
  const send = useStableCallback((msg: { parent: string; row: string; message: PanelMessage }, sender: Browser.runtime.MessageSender) => {
    if (!isExtensionPage(sender) || !here(msg.parent)) return undefined;
    const children = childrenOf(rows, msg.parent);
    const row = children.find((r) => r.key === msg.row);
    if (!row) return { noRow: children.map((r) => r.key) };
    return giveToRow(row, msg.message, () => latest.current, dispatch, RESUME_CHECKS);
  });
  useEffect(() => {
    const offs = [onRuntime(PANEL_START, start), onRuntime(PANEL_ROWS, listRows), onRuntime(PANEL_SEND, send)];
    return () => offs.forEach((off) => off());
  }, [start, listRows, send]);

  // A notice to the agent that started a row which settled a while ago, unless a panel.wait told it.
  const notify = useStableCallback(() => {
    for (const row of dueNotices(settling.current, rows, Date.now())) {
      markTold(settling.current, row.key);
      dispatch({ type: 'give', key: row.parent, message: noticeOf(row) });
    }
  });
  useEffect(() => {
    const t = setInterval(notify, NOTICE_CHECK_MS);
    return () => clearInterval(t);
  }, [notify]);

  // The messages given a row, to its chat once it has said it is there (its first status), in order.
  useEffect(() => {
    for (const row of rows) {
      const frame = frames.current.get(row.key);
      if (!row.pending?.length || !row.status || row.stopped || !frame?.contentWindow) continue;
      for (const message of row.pending) frame.contentWindow.postMessage({ type: MANAGER_SAY, ...message } satisfies ManagerToChat, location.origin);
      dispatch({ type: 'handed', key: row.key, count: row.pending.length });
    }
  }, [rows, dispatch, frames]);
}

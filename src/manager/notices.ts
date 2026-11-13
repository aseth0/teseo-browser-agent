// When an agent a row's agent started (agents/panel) has finished, or waits for the user, and that one
// is not waiting for it (panel.wait would get it), the panel's page gives it a notice: it goes on by
// itself, as an orchestrator told its worker is done. Each time a row settles counts once: told by a
// panel.wait (seen), or by a notice (told). A notice goes a moment after it settles (GRACE_MS), for a
// panel.wait asking meanwhile to get it first. How many notices a chat sends before the user writes
// again is the chat's (Settings → Limits, manager-chat).
import { markValue, text } from '../core/model-texts';
import type { PanelMessage, PanelRow } from './protocol';
import { panelRowOf, rowTitle, type Row } from './rows';

export const GRACE_MS = 3000;

export interface Settling {
  settled: boolean; // done, or waiting for the user, as last seen
  times: number; // how many times it settled
  seen: number; // up to which a panel.wait told it
  told: number; // up to which a notice told it
  at: number; // when it last settled
}

const isSettled = (r: PanelRow) => r.state === 'done' || r.state === 'waiting';

// The rows started by another, as they are now: one that has just settled counts once more.
export function settlingOf(before: ReadonlyMap<string, Settling>, rows: Row[], now: number): Map<string, Settling> {
  const next = new Map<string, Settling>();
  for (const row of rows) {
    if (!row.parent || row.stopped) continue;
    const was = before.get(row.key) ?? { settled: false, times: 0, seen: 0, told: 0, at: 0 };
    const settled = isSettled(panelRowOf(row));
    next.set(row.key, settled && !was.settled ? { ...was, settled, times: was.times + 1, at: now } : { ...was, settled });
  }
  return next;
}

// A panel.wait told these rows as they are: what each settled so far is seen.
export function seenBy(settling: Map<string, Settling>, told: PanelRow[]): void {
  for (const r of told) {
    const s = settling.get(r.row);
    if (s && isSettled(r)) settling.set(r.row, { ...s, seen: s.times });
  }
}

// The rows to give their parent a notice of now: settled a while ago, and not told of since.
export function dueNotices(settling: ReadonlyMap<string, Settling>, rows: Row[], now: number): (Row & { parent: string })[] {
  return rows.filter((row): row is Row & { parent: string } => {
    const s = settling.get(row.key);
    return !!s && s.settled && s.times > Math.max(s.seen, s.told) && now - s.at >= GRACE_MS && rows.some((p) => p.key === row.parent && !p.stopped);
  });
}

// A notice went for what the row settled so far.
export function markTold(settling: Map<string, Settling>, key: string): void {
  const s = settling.get(key);
  if (s) settling.set(key, { ...s, told: s.times });
}

// The notice, as the parent's model gets it (with the row, for panel.send and panel.wait) and as its chat
// shows it (by the row's title, as the panel shows it: the id means nothing to the user).
export function noticeOf(row: Row): PanelMessage {
  const r = panelRowOf(row);
  const title = rowTitle(row)?.trim();
  const who = title ? `${r.agent} · ${title}` : r.agent;
  if (r.state === 'waiting') return { text: text('panel.waiting', { agent: r.agent, row: r.row }), shown: `${who} is waiting for you`, notice: true };
  const answer = text('result.agent_answer', { agent: r.agent, answer: markValue(r.answer || text('result.agent_no_answer'), 'tool') });
  return { text: `${text('panel.answered', { agent: r.agent, row: r.row })}\n${answer}`, shown: `${who} answered`, notice: true };
}

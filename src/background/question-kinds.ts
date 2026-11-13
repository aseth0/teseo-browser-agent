// The interaction a chat's question is (core/interaction-kinds), and the line its notification says.
// A chat of the Agents Panel waits as that panel's agent, whatever it asks.
import type { InteractionKind } from '../core/interaction-kinds';
import type { BackgroundToPanel } from '../core/protocol';

const MAX = 140;
const short = (s: string) => (s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s);

export function questionAlert(q: BackgroundToPanel, agentsPanel = false): { kind: InteractionKind; message: string } | undefined {
  const of = (kind: InteractionKind, message: string) => ({ kind: agentsPanel ? 'agent-waiting' as const : kind, message: short(message) });
  if (q.type === 'confirm') return of('action', q.host ? `${q.summary} (${q.host})` : q.summary);
  if (q.type === 'access') return of('access', 'Open the chat to allow it or not.');
  if (q.type === 'more-steps') return of('out-of-steps', `${q.agent} stopped after ${q.steps} steps: open the chat to go on or not.`);
  if (q.type !== 'user-request') return undefined;
  const r = q.request;
  if (r.kind === 'ask') return of('ask', r.questions[0]?.question || 'Open the chat to answer.');
  if (r.kind === 'pick') return of('pick', r.prompt || 'Pick it on the page, or cancel in the chat.');
  return of('sign-in', 'Sign in on the page it opened, then say so in the chat.');
}

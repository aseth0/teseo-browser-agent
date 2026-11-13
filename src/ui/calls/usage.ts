// What crossed at each message of the chat as the server reported it (ui/calls/ChatWithCalls).
import type { Message } from '../../core/types';
import { fmtTokens, seconds } from '../Usage';

// What crossed at a message, as the server reported it: ↓ its call's answer, ↑ what it sent.
export interface Usage {
  out?: { tokens: number; ms: number };
  sent: number[];
}
export const usageLabel = (u: Usage) => [u.out && `↓ ${fmtTokens(u.out.tokens)} · ${seconds(u.out.ms)}`, ...u.sent.map((n) => `↑ ${fmtTokens(n)}`)].filter(Boolean).join(' · ');
export const sum = (ns: number[]) => ns.reduce((a, n) => a + n, 0);

// A call's usage as the server reported it: none until it is, none when it does not report.
export const reported = (meta?: Message['meta']) => (meta?.reported ? meta : undefined);
export const reportedLabel = (n: number) => `${fmtTokens(n)} tokens`; // no "~": not an estimate

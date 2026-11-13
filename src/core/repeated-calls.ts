// A model sending a call that failed again, unchanged: the second failure of the same call (same
// tool, same arguments) in a turn says so after its error, and a third is not run (core/agent-loop).
// Counted from the turn's messages, so a turn that goes on after the step limit counts what came before.
import type { Message } from './types';
import { stableJson } from './util';

export const BLOCK_AFTER = 2; // failures of the same call in a turn, after which it is not run again

// The same key for the same arguments, whatever the order of their keys.
export const callKey = (name: string, args: unknown) => `${name} ${stableJson(args ?? {})}`;

// How many times each call failed in the latest turn (after your last message).
export function failuresInTurn(messages: Message[]): Map<string, number> {
  const from = messages.findLastIndex((m) => m.role === 'user') + 1;
  const keys = new Map<string, string>();
  const failed = new Map<string, number>();
  for (const m of messages.slice(from)) {
    for (const p of m.parts) {
      if (p.type === 'tool_call') keys.set(p.id, callKey(p.name, p.args));
      const key = p.type === 'tool_result' && p.isError ? keys.get(p.toolCallId) : undefined;
      if (key) failed.set(key, (failed.get(key) ?? 0) + 1);
    }
  }
  return failed;
}

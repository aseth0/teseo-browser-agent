// A tool whose arguments are read once, with their types, for its other functions. The model gives
// them as JSON; the required ones are there already (the loop checks them against the schema).
import type { ActionDescription, Tool, ToolContext, ToolResult } from '../core/types';

export function defineTool<A>(
  spec: Omit<Tool, 'tabOf' | 'describe' | 'run'> & {
    args: (raw: unknown) => A;
    tabOf?(a: A): number | undefined;
    describe?(a: A, ctx: ToolContext): Promise<ActionDescription>;
    run(a: A, ctx: ToolContext): Promise<ToolResult>;
  },
): Tool {
  const { args, tabOf, describe, run, ...tool } = spec;
  return {
    ...tool,
    ...(tabOf && { tabOf: (raw: unknown) => tabOf(args(raw)) }),
    ...(describe && { describe: (raw: unknown, ctx: ToolContext) => describe(args(raw), ctx) }),
    run: (raw, ctx) => run(args(raw), ctx),
  };
}

// The arguments as an object (none: empty), and one of them as a text, a number or a yes/no.
export const fields = (raw: unknown): Record<string, unknown> => (typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {});
export const optString = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : String(v));
export const optNumber = (v: unknown): number | undefined => (v === undefined || v === null ? undefined : Number(v));
// The same, none also when it is not a number ("ten").
export const optFinite = (v: unknown): number | undefined => {
  const n = optNumber(v);
  return n !== undefined && Number.isFinite(n) ? n : undefined;
};
// A count the model asks for (how many results): a whole number from 1 to `most`; `fallback` when it
// gave none, or not a number.
export const countArg = (v: unknown, fallback: number, most: number): number => {
  const n = Number(v ?? fallback);
  return Math.min(most, Math.max(1, Math.round(Number.isFinite(n) ? n : fallback)));
};
export const optBoolean = (v: unknown): boolean | undefined => (v === undefined || v === null ? undefined : v === true || v === 'true');

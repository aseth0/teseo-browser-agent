// A response's tool calls, as servers send them: in the stream, split into fragments by `index`, and
// whole in a complete body. Servers differ: some leave `index` out (a fragment then goes with its
// call's id, else with the call being written), some send every call under index 0 with its own id,
// some send arguments as an object, and some (vLLM-style tool parsers) send the arguments as a
// fragment of their own, or a call twice, once complete and once with no arguments (with no id of its
// own, or the same one).
import type { ChatEvent } from '../core/types';
import { unparsedArgs } from '../core/tool-args';

export interface WireToolCall {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: unknown };
}

interface Call {
  id: string;
  name: string;
  args: string;
}

// A tool call's arguments: {} when the server sent none; when they are not JSON, what came and why it
// does not parse, for the call to be answered with it instead of run (core/tool-args).
export function parseArgs(s: string): unknown {
  if (!s.trim()) return {};
  try {
    return JSON.parse(s);
  } catch (e) {
    return unparsedArgs(s, e instanceof Error ? e.message : String(e));
  }
}

const argsText = (a: unknown) => (typeof a === 'string' ? a : a === undefined || a === null ? '' : JSON.stringify(a));
const noArgs = (args: string) => !args.trim() || /^\s*\{\s*\}\s*$/.test(args);

export class ToolCallAccumulator {
  private calls: Call[] = [];
  private byIndex = new Map<number, Call>();
  private last: Call | undefined; // the call being written

  push(tc: WireToolCall): void {
    const name = tc.function?.name ?? '';
    const args = argsText(tc.function?.arguments);
    let call = this.callOf(tc, name);
    if (!call) {
      if (!name && !args) return; // nothing to keep, nothing to go with
      call = { id: tc.id ?? '', name: '', args: '' };
      this.calls.push(call);
    }
    if (typeof tc.index === 'number') this.byIndex.set(tc.index, call);
    if (tc.id && !call.id) call.id = tc.id;
    call.name += name;
    call.args += args;
    this.last = call;
  }

  // The call a fragment belongs to; undefined when it starts one.
  private callOf(tc: WireToolCall, name: string): Call | undefined {
    const byId = tc.id ? this.calls.find((c) => c.id === tc.id) : undefined;
    if (byId) return byId;
    const atIndex = typeof tc.index === 'number' ? this.byIndex.get(tc.index) : undefined;
    // Another call under an index already taken (some servers send every call under index 0).
    if (atIndex && !(tc.id && atIndex.id && name)) return atIndex;
    // A fragment with no name is never a call of its own: it goes with the call being written.
    if (!name) return this.last;
    return undefined;
  }

  events(): ChatEvent[] {
    return toolCallEvents(this.calls);
  }
}

// The calls as events: one with neither a name nor arguments is dropped, and so is a server's empty
// duplicate: no arguments, another call to the same tool in the response has them, and it has that
// call's id or none of its own. One with an id of its own is a call (read_page({}) beside
// read_page({ref})).
function toolCallEvents(calls: Call[]): ChatEvent[] {
  const kept = calls.filter((c) => c.name || c.args.trim());
  const full = kept.filter((c) => !noArgs(c.args));
  const duplicate = (c: Call) => noArgs(c.args) && full.some((f) => f.name === c.name && (!c.id || f.id === c.id));
  return kept
    .filter((c) => !duplicate(c))
    .map((c, i) => ({ type: 'tool-call', id: c.id || `call_${i}`, name: c.name, args: parseArgs(c.args) }));
}

// The calls of a complete body.
export function completionToolCalls(list: WireToolCall[]): ChatEvent[] {
  return toolCallEvents(list.map((tc) => ({ id: tc.id ?? '', name: tc.function?.name ?? '', args: argsText(tc.function?.arguments) })));
}

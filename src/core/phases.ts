// The phases of a turn, as they happen: what the agent does between your message and its last token
// (setting up, the context attached, each model call and its parts, each tool call, an agent asked),
// with when each began and how long it took. The background records them (PhaseRecorder) and sends
// each as it starts and as it ends; the panel shows the one going on in the chat, all of them in
// Layers, and keeps them in your message once the turn ends (Message.phases).
import type { Message, PhaseKind, TurnPhase } from './types';

export type { PhaseKind, TurnPhase } from './types';

// A phase going on: ended once (later calls do nothing), its detail changed meanwhile.
export interface PhaseHandle {
  id: string;
  end(detail?: string): void; // none: the detail it has
  note(detail: string): void;
}

interface PhaseStart {
  kind: PhaseKind;
  label: string;
  detail?: string;
  id?: string; // a known one (a tool call's: callPhaseId), else made up
  at?: number; // when it began, if before now
}

export interface PhaseRecorder {
  start(p: PhaseStart): PhaseHandle;
  // One already measured, ended now (or at `at` + `ms`).
  add(p: PhaseStart & { ms: number }): void;
  // `fn` timed as a phase, recorded only when `detail` gives one for its result: a step that found
  // nothing is left out. A step that throws is recorded as failed, and the error goes on.
  time<T>(p: Omit<PhaseStart, 'detail'>, fn: () => Promise<T> | T, detail: (result: T) => string | undefined): Promise<T>;
  // The phases recorded through it go under `parent` (a sub-agent's, under the call that asked it).
  under(parent: string | undefined): PhaseRecorder;
  note(id: string, detail: string): void; // a phase's detail, changed (also once it ended)
}

// The id of a tool call's phase, under whichever agent made it: so the agent it asks puts its own
// phases under it.
export const callPhaseId = (callId: string) => `tool:${callId}`;

// `emit`: each phase as it starts, as its detail changes and as it ends.
export function phaseRecorder(emit: (phase: TurnPhase) => void, now: () => number = Date.now): PhaseRecorder {
  const seq = { n: 0 };
  const base = now().toString(36); // unique across the runs of a message (Continue after the step limit)
  const known = new Map<string, TurnPhase>();
  const send = (p: TurnPhase) => {
    known.set(p.id, p);
    emit(p);
  };
  const make = (parent: string | undefined): PhaseRecorder => {
    const begin = (p: PhaseStart, ms?: number): TurnPhase => {
      const id = p.id ?? `${base}.${++seq.n}`;
      const at = p.at ?? (ms === undefined ? now() : now() - ms);
      return { id, kind: p.kind, label: p.label, at, ...(p.detail && { detail: p.detail }), ...(ms !== undefined && { ms: Math.max(0, ms) }), ...(parent && { parent }) };
    };
    const rec: PhaseRecorder = {
      start(p) {
        let phase = begin(p);
        let ended = false;
        send(phase);
        return {
          id: phase.id,
          end(detail) {
            if (ended) return;
            ended = true;
            phase = { ...(known.get(phase.id) ?? phase), ms: Math.max(0, now() - phase.at), ...(detail && { detail }) };
            send(phase);
          },
          note(detail) {
            rec.note(phase.id, detail);
          },
        };
      },
      add(p) {
        send(begin(p, p.ms));
      },
      async time(p, fn, detail) {
        const at = now();
        try {
          const result = await fn();
          const d = detail(result);
          if (d !== undefined) send(begin({ ...p, at, ...(d && { detail: d }) }, now() - at));
          return result;
        } catch (e) {
          send(begin({ ...p, at, detail: 'failed' }, now() - at));
          throw e;
        }
      },
      under: (to) => make(to),
      note(id, detail) {
        const p = known.get(id);
        if (p && p.detail !== detail) send({ ...p, detail });
      },
    };
    return rec;
  };
  return make(undefined);
}

// Records nothing (a run with no one to show it to).
export const noPhases: PhaseRecorder = {
  start: (p) => ({ id: p.id ?? '', end: () => undefined, note: () => undefined }),
  add: () => undefined,
  time: async (_p, fn) => fn(),
  under: () => noPhases,
  note: () => undefined,
};

// ---------- the panel's side ----------

export const MAX_KEPT_PHASES = 300; // of a message, the latest kept: a long run of tool calls stays small

// The phases with one as it came (new, or changed), in the order they started.
export function withPhase(list: TurnPhase[], phase: TurnPhase): TurnPhase[] {
  const at = list.findIndex((p) => p.id === phase.id);
  if (at < 0) return [...list, phase];
  const next = [...list];
  next[at] = phase;
  return next;
}

// The phase going on now that the chat names: the latest begun of those not ended.
export function currentPhase(list: TurnPhase[]): TurnPhase | undefined {
  let best: TurnPhase | undefined;
  for (const p of list) if (p.ms === undefined && (!best || p.at >= best.at)) best = p;
  return best;
}

// A turn's phases kept in the message that started it (the last of yours), after those of its runs
// before (Continue after the step limit).
export function keepPhases(history: Message[], phases: TurnPhase[]): Message[] {
  if (!phases.length) return history;
  const at = history.findLastIndex((m) => m.role === 'user');
  if (at < 0) return history;
  const m = history[at]!;
  const next = [...history];
  next[at] = { ...m, phases: [...(m.phases ?? []), ...phases].slice(-MAX_KEPT_PHASES) };
  return next;
}

// A duration as the views show it: ms under a second, else seconds with one decimal.
export const phaseTime = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);

export interface PhaseNode {
  phase: TurnPhase;
  children: PhaseNode[];
}

// The phases as a tree: each under its parent (one not there goes at the top), in the order they began.
export function phaseTree(list: TurnPhase[]): PhaseNode[] {
  const nodes = new Map(list.map((p) => [p.id, { phase: p, children: [] as PhaseNode[] }]));
  const roots: PhaseNode[] = [];
  for (const n of [...nodes.values()].sort((a, b) => a.phase.at - b.phase.at)) {
    const parent = n.phase.parent ? nodes.get(n.phase.parent) : undefined;
    (parent && parent !== n ? parent.children : roots).push(n);
  }
  return roots;
}

// What a turn's phases come to: how many, from the first one's start to the last one's end, and the
// slowest of those with no phases of their own (where the time went).
export function phaseSummary(list: TurnPhase[], now: number = Date.now()): { count: number; ms: number; slowest?: TurnPhase } {
  if (!list.length) return { count: 0, ms: 0 };
  const start = Math.min(...list.map((p) => p.at));
  const end = Math.max(...list.map((p) => p.at + (p.ms ?? Math.max(0, now - p.at))));
  const parents = new Set(list.flatMap((p) => (p.parent ? [p.parent] : [])));
  let slowest: TurnPhase | undefined;
  for (const p of list) if (!parents.has(p.id) && p.ms !== undefined && (!slowest || p.ms > slowest.ms!)) slowest = p;
  return { count: list.length, ms: end - start, ...(slowest && { slowest }) };
}

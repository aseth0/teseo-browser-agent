// Questions waiting for the user in the panel (confirm an action, allow a site, a user tool). A
// question asked with a run's signal is answered with its fallback when that run stops, also when it
// had already stopped: the panel no longer shows anything from it, so nobody would answer.
// Each is kept with its kind (the question's type): a reply answers only a question of its own kind,
// so the answer to one (a permission's "granted") never resolves another (an action's confirmation).
// `settled`: told of each that no longer waits, however it ended (background/alerts clears its alert).
export function createQuestions<Q extends { type: string }>(send: (question: Q) => void, settled?: (id: string) => void) {
  const awaiting = new Map<string, { kind: Q['type']; settle: (value: unknown) => void; fallback: unknown }>();

  const settle = (id: string, value: unknown) => {
    const q = awaiting.get(id);
    if (!q) return;
    q.settle(value);
    awaiting.delete(id);
    settled?.(id);
  };

  const answer = (id: string, kind: Q['type'], value: unknown) => {
    if (awaiting.get(id)?.kind === kind) settle(id, value);
  };

  const ask = <T,>(question: (id: string) => Q, fallback: T, signal?: AbortSignal) =>
    new Promise<T>((resolve) => {
      if (signal?.aborted) return resolve(fallback);
      const id = crypto.randomUUID();
      const asked = question(id);
      awaiting.set(id, { kind: asked.type, settle: resolve as (value: unknown) => void, fallback });
      signal?.addEventListener('abort', () => settle(id, fallback), { once: true });
      send(asked);
    });

  // Stopping or closing the panel answers every one with its fallback: no.
  const denyAll = () => {
    const all = [...awaiting];
    awaiting.clear();
    for (const [id, q] of all) {
      q.settle(q.fallback);
      settled?.(id);
    }
  };

  return { ask, answer, denyAll, isWaiting: (id: string) => awaiting.has(id) };
}

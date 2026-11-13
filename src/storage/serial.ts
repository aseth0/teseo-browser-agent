// Read-modify-writes of a storage key, one at a time, also across the extension's pages (the panel of
// each window, Options, the background): each reads what it changes inside its turn, so none drops
// another's change. Web Locks where there are (the browser), a queue otherwise (tests).
export function serialized(name: string) {
  let queue: Promise<unknown> = Promise.resolve();
  return <T,>(change: () => Promise<T>): Promise<T> => {
    if (globalThis.navigator?.locks) return navigator.locks.request(name, change);
    const next = queue.then(change, change);
    queue = next.catch(() => undefined);
    return next;
  };
}

import { useEffect, useState } from 'react';

// A stored value, read once and kept up to date with its changes (`subscribe` calls back with each
// one and returns how to stop). A change that comes while it is read wins over the read, which may be
// older; a read that fails is logged with `tag`. `key`: read and subscribed again when it changes.
export function useLive<T>(load: () => Promise<T>, subscribe: (set: (value: T) => void) => () => void, initial: T, tag: string, key?: unknown): T {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    let changed = false; // a change came first: the read may be older
    let current = true;
    const stop = subscribe((v) => {
      changed = true;
      setValue(v);
    });
    load().then((v) => current && !changed && setValue(v), (e) => console.error(tag, e));
    return () => {
      current = false;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` and `subscribe` are new functions on every render; `key` says what they read
  }, [key]);
  return value;
}

// A value read again on each signal (`listen` calls `again` and returns how to stop): only the
// latest read applies, an older one that comes after it does not; a read that fails is logged with
// `tag`. `key`: read and listened to again when it changes.
export function useReload<T>(read: () => Promise<T>, listen: (again: () => void) => () => void, initial: T, tag: string, key?: unknown): T {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    let asked = 0;
    let current = true;
    const again = () => {
      const n = ++asked;
      read().then((v) => current && n === asked && setValue(v), (e) => console.error(tag, e));
    };
    again();
    const stop = listen(again);
    return () => {
      current = false;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `read` and `listen` are new functions on every render; `key` says what they read
  }, [key]);
  return value;
}

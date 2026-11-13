import { useCallback, useLayoutEffect, useRef } from 'react';

// A function that keeps one identity for the component's life and always runs the latest `fn`: for
// handlers passed down to memoized children or used by effects that must not re-run when they change.
// Not to be called while rendering (it would run the previous render's `fn`).
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn);
  useLayoutEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: A) => latest.current(...args), []);
}

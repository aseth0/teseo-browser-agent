// A step raced against a time limit: its result, or once the time is up what `late` gives (thrown, an
// error). The timer is cleared either way: a pending one would keep the worker awake for nothing.
export async function withTimeout<T>(step: Promise<T>, ms: number, late: () => T | Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => void Promise.resolve().then(late).then(resolve, reject), ms);
  });
  try {
    return await Promise.race([step, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

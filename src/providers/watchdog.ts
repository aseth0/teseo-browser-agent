// A model request that hears nothing for too long is given up: a timer, re-armed as bytes arrive,
// that aborts the request and fails whatever waits on it. The caller's Stop aborts it at once.
export class Watchdog {
  private ctrl = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly unlink: () => void;
  readonly signal = this.ctrl.signal; // the caller's Stop, or the timer

  constructor(stop: AbortSignal) {
    const onStop = () => this.ctrl.abort(stop.reason);
    if (stop.aborted) onStop();
    else stop.addEventListener('abort', onStop, { once: true });
    this.unlink = () => stop.removeEventListener('abort', onStop);
  }

  // Gives the request up with `message` unless armed again within `ms`.
  arm(ms: number, message: string): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.ctrl.abort(new Error(message)), ms);
  }

  // `p`, or the reason the request was given up as soon as it is (a fetch or a read that does not
  // follow the signal still ends).
  guard<T>(p: Promise<T>): Promise<T> {
    const s = this.signal;
    if (s.aborted) return Promise.reject(s.reason as Error);
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(s.reason as Error);
      s.addEventListener('abort', onAbort, { once: true });
      p.then(
        (v) => {
          s.removeEventListener('abort', onAbort);
          resolve(v);
        },
        (e: unknown) => {
          s.removeEventListener('abort', onAbort);
          reject(e);
        },
      );
    });
  }

  // Waits `ms` with the timer off, or until the request is given up.
  async rest(ms: number): Promise<void> {
    clearTimeout(this.timer);
    let wait: ReturnType<typeof setTimeout> | undefined;
    try {
      await this.guard(new Promise<void>((resolve) => (wait = setTimeout(resolve, ms))));
    } finally {
      clearTimeout(wait);
    }
  }

  // `body`, each read guarded and re-arming the timer for `ms` once it brings bytes.
  watched(body: ReadableStream<Uint8Array>, ms: number, message: string): ReadableStream<Uint8Array> {
    const reader = body.getReader();
    return new ReadableStream<Uint8Array>({
      pull: async (c) => {
        const r = await this.guard(reader.read());
        if (r.done) return c.close();
        this.arm(ms, message);
        c.enqueue(r.value);
      },
      cancel: (why) => reader.cancel(why),
    });
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.unlink();
  }
}

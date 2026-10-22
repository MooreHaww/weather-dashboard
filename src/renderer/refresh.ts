// The 5-minute auto-refresh timer. It knows nothing about the DOM or the API:
// the caller passes what to run and how to tell if the window is visible, so
// the timing rules can be unit-tested with a fake clock.

export interface RefresherDeps {
  intervalMs: number;
  now: () => number;
  /** False while the window is minimized or hidden. */
  isVisible: () => boolean;
  /** Do one refresh. Resolve true if fresh data arrived, false if it failed. */
  run: () => Promise<boolean>;
  /** Repeating timer (setInterval-like); returns a handle for clearTimer. */
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

export interface Refresher {
  start(): void;
  stop(): void;
  /** Call when the window becomes visible again: refreshes right away if the data is older than the interval. */
  onVisible(): void;
  /** Note that fresh data arrived some other way (new city, units change, refresh button). */
  markFresh(): void;
  /** When data last arrived (ms), by the injected clock. */
  lastSuccess(): number;
}

export function createRefresher(deps: RefresherDeps): Refresher {
  let timer: unknown = null;
  let last = deps.now();
  let running = false;

  async function attempt(): Promise<void> {
    if (running) return;
    running = true;
    try {
      // A failure leaves `last` alone, so the old data keeps its old age and the
      // next tick (or return to the window) tries again.
      if (await deps.run()) last = deps.now();
    } catch {
      // run() reports its own errors; never let one stop the timer
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer !== null) return;
      timer = deps.setTimer(() => {
        if (deps.isVisible()) void attempt();
      }, deps.intervalMs);
    },
    stop() {
      if (timer === null) return;
      deps.clearTimer(timer);
      timer = null;
    },
    onVisible() {
      if (deps.isVisible() && deps.now() - last >= deps.intervalMs) void attempt();
    },
    markFresh() {
      last = deps.now();
    },
    lastSuccess: () => last,
  };
}

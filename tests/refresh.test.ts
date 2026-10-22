import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRefresher } from '../src/renderer/refresh';

const FIVE_MIN = 5 * 60_000;

function make(run: () => Promise<boolean>, isVisible: () => boolean = () => true) {
  return createRefresher({
    intervalMs: FIVE_MIN,
    now: () => Date.now(),
    isVisible,
    run,
    setTimer: (fn, ms) => setInterval(fn, ms),
    clearTimer: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  });
}

function setup(opts: { visible?: boolean; results?: boolean[] } = {}) {
  let visible = opts.visible ?? true;
  const results = [...(opts.results ?? [])];
  const run = vi.fn(async () => results.shift() ?? true);
  const refresher = make(run, () => visible);
  return { refresher, run, setVisible: (v: boolean) => (visible = v) };
}

describe('auto-refresh timer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('refreshes every 5 minutes, not before', async () => {
    const { refresher, run } = setup();
    refresher.start();
    await vi.advanceTimersByTimeAsync(FIVE_MIN - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(FIVE_MIN);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('skips ticks while the window is hidden', async () => {
    const { refresher, run, setVisible } = setup({ visible: false });
    refresher.start();
    await vi.advanceTimersByTimeAsync(FIVE_MIN * 3);
    expect(run).not.toHaveBeenCalled();
    setVisible(true);
    await vi.advanceTimersByTimeAsync(FIVE_MIN);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('refreshes right away on return if the data is older than 5 minutes', async () => {
    const { refresher, run, setVisible } = setup();
    refresher.start();
    setVisible(false);
    await vi.advanceTimersByTimeAsync(FIVE_MIN + 1000);
    expect(run).not.toHaveBeenCalled();
    setVisible(true);
    refresher.onVisible();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not refresh on return if the data is still young', async () => {
    const { refresher, run } = setup();
    refresher.start();
    await vi.advanceTimersByTimeAsync(60_000);
    refresher.onVisible();
    expect(run).not.toHaveBeenCalled();
  });

  it('does not refresh on a visibility event while still hidden', async () => {
    const { refresher, run, setVisible } = setup();
    refresher.start();
    setVisible(false);
    await vi.advanceTimersByTimeAsync(FIVE_MIN * 2);
    refresher.onVisible();
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps the old time when a refresh fails, and tries again on the next tick', async () => {
    const { refresher, run } = setup({ results: [false, true] });
    const start = Date.now();
    refresher.start();
    await vi.advanceTimersByTimeAsync(FIVE_MIN);
    expect(run).toHaveBeenCalledTimes(1);
    expect(refresher.lastSuccess()).toBe(start); // failed: still the old time
    await vi.advanceTimersByTimeAsync(FIVE_MIN);
    expect(run).toHaveBeenCalledTimes(2);
    expect(refresher.lastSuccess()).toBe(start + 2 * FIVE_MIN);
  });

  it('retries on return after a failed refresh, because the data is still old', async () => {
    const { refresher, run } = setup({ results: [false] });
    refresher.start();
    await vi.advanceTimersByTimeAsync(FIVE_MIN); // fails
    refresher.onVisible();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('survives a refresh that throws', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(true);
    const refresher = make(run);
    refresher.start();
    await vi.advanceTimersByTimeAsync(FIVE_MIN * 2);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not start a second refresh while one is running', async () => {
    let finish!: (ok: boolean) => void;
    const run = vi.fn(() => new Promise<boolean>((r) => (finish = r)));
    const refresher = make(run);
    refresher.start();
    await vi.advanceTimersByTimeAsync(FIVE_MIN * 2);
    expect(run).toHaveBeenCalledTimes(1);
    finish(true);
  });

  it('markFresh resets the age (a new city or the refresh button)', async () => {
    const { refresher, run, setVisible } = setup();
    refresher.start();
    setVisible(false);
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    refresher.markFresh(); // e.g. the user picked another city
    await vi.advanceTimersByTimeAsync(2 * 60_000); // 6 minutes since start, 2 since the new data
    setVisible(true);
    refresher.onVisible();
    expect(run).not.toHaveBeenCalled();
  });

  it('stop() ends the timer', async () => {
    const { refresher, run } = setup();
    refresher.start();
    refresher.stop();
    await vi.advanceTimersByTimeAsync(FIVE_MIN * 2);
    expect(run).not.toHaveBeenCalled();
  });
});

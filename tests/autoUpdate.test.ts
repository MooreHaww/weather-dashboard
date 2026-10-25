import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECK_INTERVAL_MS, FIRST_CHECK_DELAY_MS, startAutoUpdate, type Updater } from '../src/main/autoUpdate';
import { createUpdateTracker } from '../src/main/updateTracker';

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  logger: unknown = console;
  checkForUpdates = vi.fn<() => Promise<unknown> | unknown>(async () => null);
  quitAndInstall = vi.fn();
}

function setup(opts: { enabled?: boolean; loadFails?: number } = {}) {
  const updater = new FakeUpdater();
  let loadFails = opts.loadFails ?? 0;
  const loadUpdater = vi.fn(async () => {
    if (loadFails-- > 0) throw new Error('module failed to load');
    return updater as unknown as Updater;
  });
  const onReady = vi.fn();
  const log = vi.fn();
  const enabled = opts.enabled ?? true;
  const tracker = createUpdateTracker({ version: '1.4.7', enabled });
  const handle = startAutoUpdate({ enabled, loadUpdater, tracker, onReady, log });
  return { updater, loadUpdater, onReady, log, handle, tracker };
}

describe('auto-update scheduling', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits a little after startup before the first check', async () => {
    const { updater, loadUpdater } = setup();
    expect(FIRST_CHECK_DELAY_MS).toBeGreaterThanOrEqual(5_000);
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS - 1);
    expect(loadUpdater).not.toHaveBeenCalled(); // the updater is not even loaded yet
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('then checks every few hours', async () => {
    const { updater, loadUpdater } = setup();
    expect(CHECK_INTERVAL_MS).toBeGreaterThanOrEqual(60 * 60_000);
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS - 1);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(4);
    expect(loadUpdater).toHaveBeenCalledTimes(1);
  });

  it('downloads in the background and installs on quit, never restarting by itself', async () => {
    const { updater } = setup();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.logger).not.toBe(console);
  });

  it('does nothing in dev or when the app is not packaged', async () => {
    const { updater, loadUpdater } = setup({ enabled: false });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 3);
    expect(loadUpdater).not.toHaveBeenCalled();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('swallows a rejected check and tries again at the next check', async () => {
    const { updater, log } = setup();
    updater.checkForUpdates.mockRejectedValueOnce(new Error('net::ERR_INTERNET_DISCONNECTED'));
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('ERR_INTERNET_DISCONNECTED'));
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('swallows a check that throws synchronously', async () => {
    const { updater } = setup();
    updater.checkForUpdates.mockImplementationOnce(() => {
      throw new Error('HttpError: 403 rate limit exceeded');
    });
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + CHECK_INTERVAL_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('swallows a failed load of the updater and loads it again next time', async () => {
    const { updater, loadUpdater } = setup({ loadFails: 1 });
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(loadUpdater).toHaveBeenCalledTimes(2);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('swallows error events (bad file, GitHub down) without telling the page', async () => {
    const { updater, onReady, log } = setup();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(() => updater.emit('error', new Error('sha512 checksum mismatch'))).not.toThrow();
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('sha512 checksum mismatch'));
    expect(onReady).not.toHaveBeenCalled();
  });

  it('hands out the loaded updater (for "Update now"), and never calls quitAndInstall itself', async () => {
    const { updater, handle } = setup();
    expect(handle.updater()).toBeNull(); // not loaded before the first check
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(handle.updater()).toBe(updater);
    updater.emit('update-downloaded', { version: '1.4.7' });
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(setup({ enabled: false }).handle.updater()).toBeNull();
  });

  it('reports a downloaded update once per version', async () => {
    const { updater, onReady } = setup();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    updater.emit('update-downloaded', { version: '1.4.1' });
    updater.emit('update-downloaded', { version: '1.4.1' }); // found again at a later check
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith('1.4.1');
    updater.emit('update-downloaded', { version: '1.4.2' });
    expect(onReady).toHaveBeenCalledTimes(2);
    expect(onReady).toHaveBeenLastCalledWith('1.4.2');
  });
});

describe('what the Settings "Updates" section is told', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('knows nothing before the first check finishes', async () => {
    const { tracker } = setup();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS - 1);
    expect(tracker.state().status).toBe('idle');
  });

  it('a check that resolves without saying anything does not count as "up to date"', async () => {
    const { tracker } = setup(); // the fake's checkForUpdates resolves null and emits nothing
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(tracker.state().status).toBe('idle');
  });

  it('"update-not-available" means up to date', async () => {
    const { tracker, updater } = setup();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    updater.emit('update-not-available', { version: '1.4.7' });
    expect(tracker.state()).toMatchObject({ status: 'up-to-date', version: '1.4.7' });
  });

  it('a newer version goes downloading, then ready', async () => {
    const { tracker, updater } = setup();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    updater.emit('update-available', { version: '1.4.8' });
    expect(tracker.state()).toEqual({ status: 'downloading', version: '1.4.7', next: '1.4.8' });
    updater.emit('update-downloaded', { version: '1.4.8' });
    expect(tracker.state()).toEqual({ status: 'ready', version: '1.4.7', next: '1.4.8' });
  });

  it('a rejected check, a failed load and an error event are all "failed"', async () => {
    const a = setup();
    a.updater.checkForUpdates.mockRejectedValueOnce(new Error('net::ERR_INTERNET_DISCONNECTED'));
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(a.tracker.state().status).toBe('failed');

    const b = setup({ loadFails: 1 });
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(b.tracker.state().status).toBe('failed');

    const c = setup();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    c.updater.emit('error', new Error('HttpError: 503'));
    expect(c.tracker.state().status).toBe('failed');
  });

  it('the next successful check clears a failure', async () => {
    const { tracker, updater } = setup();
    updater.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(tracker.state().status).toBe('failed');
    updater.checkForUpdates.mockImplementationOnce(async () => void updater.emit('update-not-available', {}));
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(tracker.state().status).toBe('up-to-date');
  });

  it('a dev or unpackaged build never leaves "unavailable"', async () => {
    const { tracker } = setup({ enabled: false });
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
    expect(tracker.state()).toEqual({ status: 'unavailable', version: '1.4.7' });
  });
});


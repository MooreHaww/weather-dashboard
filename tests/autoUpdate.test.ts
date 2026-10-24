import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECK_INTERVAL_MS, FIRST_CHECK_DELAY_MS, startAutoUpdate, type Updater } from '../src/main/autoUpdate';

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  logger: unknown = console;
  checkForUpdates = vi.fn<() => Promise<unknown> | unknown>(async () => null);
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
  startAutoUpdate({ enabled: opts.enabled ?? true, loadUpdater, onReady, log });
  return { updater, loadUpdater, onReady, log };
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

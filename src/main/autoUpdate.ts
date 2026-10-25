// Auto-update scheduling, kept free of Electron imports so it can be unit-tested.
// main.ts passes the real electron-updater (loaded lazily) and the real timers.
//
// - Only runs when `enabled` (packaged app, not dev).
// - First check a little after startup, then every few hours.
// - Downloads in the background and installs when the app quits; never restarts the app
//   by itself (only "Update now" in Settings does, see updateRestart.ts).
// - Tells the tracker (updateTracker.ts) how each check went, for the Settings "Updates" section.
// - Every failure (offline, GitHub down, rate limit, bad file) is logged and ignored;
//   the next check simply tries again.

import type { UpdateTracker } from './updateTracker';

export const FIRST_CHECK_DELAY_MS = 10_000;
export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** The part of electron-updater's `autoUpdater` we use. */
export interface Updater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  logger: unknown;
  checkForUpdates(): Promise<unknown> | unknown;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: 'update-downloaded' | 'update-available', listener: (info: { version: string }) => void): unknown;
  on(event: 'update-not-available', listener: (info: unknown) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
}

type Level = 'info' | 'warn' | 'error';

export interface AutoUpdateOptions {
  enabled: boolean;
  loadUpdater: () => Promise<Updater>;
  /** What the Settings section shows; this module reports each check's outcome to it. */
  tracker: UpdateTracker;
  /** Called once per downloaded version. */
  onReady: (version: string) => void;
  log: (level: Level, message: string) => void;
  delayMs?: number;
  intervalMs?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  setInterval?: (fn: () => void, ms: number) => unknown;
}

export interface AutoUpdate {
  /** The loaded updater, or null before the first check (and always when disabled). */
  updater(): Updater | null;
}

export function startAutoUpdate(opts: AutoUpdateOptions): AutoUpdate {
  if (!opts.enabled) return { updater: () => null };
  const { log, onReady, tracker } = opts;
  const later = opts.setTimeout ?? setTimeout;
  const every = opts.setInterval ?? setInterval;
  let updater: Updater | null = null;
  let notified: string | null = null;

  const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

  async function load(): Promise<Updater> {
    if (updater) return updater;
    const u = await opts.loadUpdater();
    u.autoDownload = true;
    u.autoInstallOnAppQuit = true;
    u.logger = {
      info: (m: unknown) => log('info', `[update] ${String(m)}`),
      warn: (m: unknown) => log('warn', `[update] ${String(m)}`),
      error: (m: unknown) => log('warn', `[update] ${String(m)}`),
      debug: () => {},
    };
    u.on('error', (err) => {
      log('warn', `[update] ${message(err)}`);
      tracker.failed();
    });
    u.on('update-available', (info) => {
      if (typeof info?.version === 'string') tracker.available(info.version);
    });
    u.on('update-not-available', () => tracker.notAvailable());
    u.on('update-downloaded', (info) => {
      if (!info?.version || info.version === notified) return;
      notified = info.version;
      tracker.downloaded(info.version);
      onReady(info.version);
    });
    updater = u;
    return u;
  }

  async function check(): Promise<void> {
    try {
      await (await load()).checkForUpdates();
    } catch (err) {
      log('warn', `[update] check failed: ${message(err)}`);
      tracker.failed();
    }
  }

  later(() => {
    void check();
    every(() => void check(), opts.intervalMs ?? CHECK_INTERVAL_MS);
  }, opts.delayMs ?? FIRST_CHECK_DELAY_MS);

  return { updater: () => updater };
}

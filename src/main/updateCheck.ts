// "Check for updates" in Settings: the page's second message to the main process (sent by
// preload.ts, no arguments). Kept free of Electron imports so it can be unit-tested;
// main.ts passes the window, the tracker's state and the updater's check.
//
// It is ignored unless: it carries nothing, the updater is active (a packaged app), it comes
// from the app's own window, from its top frame, showing a page from the local server, the
// state is one where the button is shown (up to date, no check yet, last check failed), and
// the last accepted press was more than 30 seconds ago. The page cannot pass anything or set state.
// The same sender checks as the restart message (updateRestart.ts), which stays as it is.

import type { UpdateStatus } from '../shared/updateState';
import type { Frame, RestartEvent } from './updateRestart';

export const CHECK_CHANNEL = 'update-check';
export const CHECK_COOLDOWN_MS = 30_000;

/** The states where the button is shown. While downloading or ready it is hidden, and while a check runs it only says "Checking…". */
export const CHECKABLE: readonly UpdateStatus[] = ['idle', 'up-to-date', 'failed'];

type Level = 'info' | 'warn' | 'error';

export interface CheckOptions {
  window: () => { webContents: { mainFrame: Frame } } | null;
  /** The local server's origin, e.g. "http://127.0.0.1:51234". */
  origin: string;
  /** False in dev and in an unpackaged build. */
  active: () => boolean;
  status: () => UpdateStatus;
  /** Runs one check (updater.checkForUpdates); the tracker reports the outcome. */
  check: () => Promise<void> | void;
  now?: () => number;
  log: (level: Level, message: string) => void;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** The ipcMain listener for CHECK_CHANNEL. Returns true when it started a check (for tests). */
export function createCheckHandler(opts: CheckOptions): (event: RestartEvent, ...args: unknown[]) => boolean {
  const now = opts.now ?? Date.now;
  let lastAccepted = -Infinity;

  function rejection(event: RestartEvent, args: unknown[]): string | null {
    if (args.length > 0) return 'unexpected arguments'; // the preload never sends any
    const win = opts.window();
    if (!win || event.sender !== win.webContents) return 'not from the app window';
    const frame = event.senderFrame;
    const top = win.webContents.mainFrame;
    if (!frame || frame.parent !== null || frame.processId !== top.processId || frame.routingId !== top.routingId) {
      return 'not from the top frame';
    }
    if (originOf(frame.url) !== opts.origin) return 'not from the local server';
    if (!opts.active()) return 'updates are not active in this build';
    if (!CHECKABLE.includes(opts.status())) return 'a check is not possible in this state';
    if (now() - lastAccepted < CHECK_COOLDOWN_MS) return 'checked less than 30 seconds ago';
    return null;
  }

  return (event, ...args) => {
    const why = rejection(event, args);
    if (why) {
      opts.log('warn', `[update] check request ignored: ${why}`);
      return false;
    }
    lastAccepted = now();
    opts.log('info', '[update] checking for updates (asked in Settings)');
    // Started right away; an exception or a rejection is only logged.
    void (async () => {
      await opts.check();
    })().catch((err: unknown) => opts.log('warn', `[update] check failed: ${err instanceof Error ? err.message : String(err)}`));
    return true;
  };
}

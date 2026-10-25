// "Update now" in Settings: the page's only message to the main process (sent by
// preload.ts, no arguments). Kept free of Electron imports so it can be unit-tested;
// main.ts passes the window, the updater and the window-state saver.
//
// The message is ignored unless an update has been downloaded and it comes from the
// app's own window, from its top frame, showing a page from the local server. Then:
// 1. the window state is saved (the quit also saves it on close, but this path does not rely on that);
// 2. electron-updater quits the app, runs the installer silently and starts the new version
//    when it is done. The local server is closed by the app's before-quit handler.

export const RESTART_CHANNEL = 'update-restart';

type Level = 'info' | 'warn' | 'error';

/** The parts of Electron's WebFrameMain we check. */
export interface Frame {
  url: string;
  parent: unknown;
  processId: number;
  routingId: number;
}

/** The parts of Electron's IpcMainEvent we check. */
export interface RestartEvent {
  sender: unknown;
  senderFrame: Frame | null;
}

export interface RestartOptions {
  /** The app's window, or null when it is gone. */
  window: () => { webContents: { mainFrame: Frame } } | null;
  /** The local server's origin, e.g. "http://127.0.0.1:51234". */
  origin: string;
  /** The downloaded version, or null while there is none. */
  updateReady: () => string | null;
  updater: () => { quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void } | null;
  saveWindowState: () => void;
  log: (level: Level, message: string) => void;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Why a request must be ignored, or null if it may restart the app. */
function rejection(event: RestartEvent, args: unknown[], opts: RestartOptions): string | null {
  if (args.length > 0) return 'unexpected arguments'; // the preload never sends any
  const win = opts.window();
  if (!win || event.sender !== win.webContents) return 'not from the app window';
  const frame = event.senderFrame;
  const top = win.webContents.mainFrame;
  if (!frame || frame.parent !== null || frame.processId !== top.processId || frame.routingId !== top.routingId) {
    return 'not from the top frame';
  }
  if (originOf(frame.url) !== opts.origin) return 'not from the local server';
  if (!opts.updateReady() || !opts.updater()) return 'no update downloaded';
  return null;
}

/** The ipcMain listener for RESTART_CHANNEL. Returns true when it started the restart (for tests). */
export function createRestartHandler(opts: RestartOptions): (event: RestartEvent, ...args: unknown[]) => boolean {
  let restarting = false;
  return (event, ...args) => {
    const why = restarting ? 'already restarting' : rejection(event, args, opts);
    if (why) {
      opts.log('warn', `[update] restart request ignored: ${why}`);
      return false;
    }
    // Only once: a second quitAndInstall call resets electron-updater's "already installing"
    // flag, and the installer would then run a second time when the app quits.
    restarting = true;
    opts.saveWindowState();
    opts.log('info', `[update] restarting to install ${opts.updateReady()}`);
    opts.updater()!.quitAndInstall(true, true); // silent installer, then start the new version
    return true;
  };
}

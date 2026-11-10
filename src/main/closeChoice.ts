// The answer to "Close Weather Dashboard?" (v1.9): the page's third and only new message to the main process.
// Kept free of Electron imports so it can be unit-tested; main.ts passes the window and the two actions.
//
// Why a message at all: "Exit" or "Keep running" without "Remember my choice" applies once and has no setting
// to save, so it cannot go through PATCH /api/settings. An HTTP route would let any local process quit or hide
// the app and could not check the sending frame; this message can.
//
// Accepted only when: exactly one argument, 'exit' or 'hide'; sent by the app's own window, from its top frame,
// showing a page from the local server; and a close request is pending (main sent `close-request`). An accepted
// answer clears the request, so one close request allows one action. The page can never do more than exit or hide.

import type { Frame, RestartEvent } from './updateRestart';

export const CLOSE_CHOICE_CHANNEL = 'close-choice';
/** main -> page only: "show the close dialog". */
export const CLOSE_REQUEST_CHANNEL = 'close-request';

export type CloseChoice = 'exit' | 'hide';
export const CLOSE_CHOICES: readonly CloseChoice[] = ['exit', 'hide'];

type Level = 'info' | 'warn' | 'error';

export interface CloseChoiceOptions {
  window: () => { webContents: { mainFrame: Frame } } | null;
  origin: string;
  pending: () => boolean;
  clearPending: () => void;
  exit: () => void;
  hide: () => void;
  log: (level: Level, message: string) => void;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function rejection(event: RestartEvent, args: unknown[], opts: CloseChoiceOptions): string | null {
  if (args.length !== 1 || !CLOSE_CHOICES.includes(args[0] as CloseChoice)) return 'not exit or hide';
  const win = opts.window();
  if (!win || event.sender !== win.webContents) return 'not from the app window';
  const frame = event.senderFrame;
  const top = win.webContents.mainFrame;
  if (!frame || frame.parent !== null || frame.processId !== top.processId || frame.routingId !== top.routingId) {
    return 'not from the top frame';
  }
  if (originOf(frame.url) !== opts.origin) return 'not from the local server';
  if (!opts.pending()) return 'no close request pending';
  return null;
}

/** The ipcMain listener for CLOSE_CHOICE_CHANNEL. Returns what it did (for tests). */
export function createCloseChoiceHandler(opts: CloseChoiceOptions): (event: RestartEvent, ...args: unknown[]) => CloseChoice | null {
  return (event, ...args) => {
    const why = rejection(event, args, opts);
    if (why) {
      opts.log('warn', `[close] choice ignored: ${why}`);
      return null;
    }
    const choice = args[0] as CloseChoice;
    opts.clearPending();
    if (choice === 'exit') opts.exit();
    else opts.hide();
    return choice;
  };
}

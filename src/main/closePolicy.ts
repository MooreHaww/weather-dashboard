// What the window's close button does (v1.9), kept free of Electron imports so it can be unit-tested.
//
// `quitting` is set by everything that must never be blocked: app `before-quit` (tray Quit, the Exit choice,
// electron-updater's quitAndInstall, which calls app.quit()), the window's `query-session-end` / `session-end`
// (Windows shutdown, restart and sign-out). While it is set, the close always goes through.

import type { CloseBehavior } from '../shared/types';

export type CloseAction = 'close' | 'hide' | 'ask';

export interface CloseInput {
  behavior: CloseBehavior;
  /** The app is quitting (or Windows is ending the session): never stop the close. */
  quitting: boolean;
  /** The page can show the dialog (loaded, not crashed). If not, 'ask' falls back to a normal close. */
  pageReady: boolean;
}

export function decideClose({ behavior, quitting, pageReady }: CloseInput): CloseAction {
  if (quitting) return 'close';
  if (behavior === 'background') return 'hide';
  if (behavior === 'exit') return 'close';
  return pageReady ? 'ask' : 'close';
}

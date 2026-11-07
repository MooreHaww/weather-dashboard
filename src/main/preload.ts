// Preload (sandboxed): the window's only link to the main process. It can listen for
// "an update is ready" and for the update state shown in Settings (receive-only: the page
// can display the state, never set it), and send two messages back, "restart and install it"
// and "check for updates", which carry nothing (the main process checks both, see
// updateRestart.ts and updateCheck.ts).
// Since 1.6 it also passes on glass or solid (appearance.ts), receive-only: the mode the window was
// created with (an argument from the main process) and later changes. Nothing goes back.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('updates', {
  onReady(callback: (version: string) => void): void {
    ipcRenderer.on('update-ready', (_event, version: unknown) => {
      if (typeof version === 'string') callback(version);
    });
  },
  onState(callback: (state: unknown) => void): void {
    ipcRenderer.on('update-state', (_event, state: unknown) => {
      if (typeof state === 'object' && state !== null) callback(state); // the page checks its shape
    });
  },
  /** Takes no arguments and passes none on, whatever the page calls it with. */
  restart(): void {
    ipcRenderer.send('update-restart'); // RESTART_CHANNEL (a sandboxed preload can't import it)
  },
  /** Takes no arguments and passes none on. The main process decides whether a check happens. */
  checkNow(): void {
    ipcRenderer.send('update-check'); // CHECK_CHANNEL (updateCheck.ts)
  },
});

// The same strings as APPEARANCE_ARG and APPEARANCE_CHANNEL in appearance.ts (a sandboxed preload can't import;
// tests/appearance.test.ts checks they match).
type AppearanceMode = 'glass' | 'solid';
const isMode = (m: unknown): m is AppearanceMode => m === 'glass' || m === 'solid';
const fromArgs = process.argv.find((a) => a.startsWith('--wd-appearance='))?.slice('--wd-appearance='.length);
let mode: AppearanceMode | null = isMode(fromArgs) ? fromArgs : null;
const modeListeners: ((mode: AppearanceMode) => void)[] = [];
ipcRenderer.on('appearance', (_event, next: unknown) => {
  if (!isMode(next)) return;
  mode = next;
  for (const listener of modeListeners) listener(next);
});

contextBridge.exposeInMainWorld('appearance', {
  /** Glass or solid as the main process decided it; null outside the app (then the page stays solid). */
  current(): AppearanceMode | null {
    return mode;
  },
  onChange(callback: (mode: AppearanceMode) => void): void {
    modeListeners.push(callback);
  },
});

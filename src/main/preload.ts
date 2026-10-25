// Preload (sandboxed): the window's only link to the main process. It can listen for
// "an update is ready" and for the update state shown in Settings (receive-only: the page
// can display the state, never set it), and send one message back, "restart and install it",
// which carries nothing (the main process checks it, see updateRestart.ts).

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
});

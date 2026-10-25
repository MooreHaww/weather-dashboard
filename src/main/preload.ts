// Preload (sandboxed): the window's only link to the main process. It can listen for
// "an update is ready", and send one message back, "restart and install it", which
// carries nothing (the main process checks it, see updateRestart.ts).

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('updates', {
  onReady(callback: (version: string) => void): void {
    ipcRenderer.on('update-ready', (_event, version: unknown) => {
      if (typeof version === 'string') callback(version);
    });
  },
  /** Takes no arguments and passes none on, whatever the page calls it with. */
  restart(): void {
    ipcRenderer.send('update-restart'); // RESTART_CHANNEL (a sandboxed preload can't import it)
  },
});

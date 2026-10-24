// Preload (sandboxed): the window's only link to the main process. It can only
// listen for "an update is ready"; the page cannot send anything back.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('updates', {
  onReady(callback: (version: string) => void): void {
    ipcRenderer.on('update-ready', (_event, version: unknown) => {
      if (typeof version === 'string') callback(version);
    });
  },
});

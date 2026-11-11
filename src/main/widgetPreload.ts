// Preload of the desktop widget (v2.0), sandboxed and RECEIVE-ONLY: the main process pushes the weather to show, the
// blurred background's pixels and whether the widget is visible. Nothing ever goes back (no send, invoke or
// postMessage; tests/widget.test.ts checks this file's text).

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('widget', {
  onData(callback: (data: unknown) => void): void {
    ipcRenderer.on('widget-data', (_event, data: unknown) => {
      if (typeof data === 'object' && data !== null) callback(data); // the page checks its shape
    });
  },
  /** `null` = no picture: the plain tinted card. */
  onBackdrop(callback: (frame: unknown) => void): void {
    ipcRenderer.on('widget-backdrop', (_event, frame: unknown) => callback(frame ?? null));
  },
  onVisible(callback: (visible: boolean) => void): void {
    ipcRenderer.on('widget-visible', (_event, visible: unknown) => callback(visible === true));
  },
});

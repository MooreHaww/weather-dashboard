// Electron entry point: start the embedded Express server on localhost, then
// open a hardened window that loads the dashboard from it.

import { app, BrowserWindow, Menu, session, shell } from 'electron';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import path from 'node:path';
import { createApp } from '../server/app';
import { createLogger } from '../server/logger';

const devUrl = process.env.VITE_DEV_URL || undefined; // set by `npm run dev`; empty counts as unset
const log = createLogger(process.env.LOG_LEVEL);
let server: Server | null = null;
let win: BrowserWindow | null = null;

function dataDir(): string {
  if (process.env.WD_DATA_DIR) return process.env.WD_DATA_DIR; // tests and screenshots
  const base = app.getPath('userData'); // %APPDATA%\Weather Dashboard
  return devUrl ? path.join(base, 'dev') : base;
}

function startServer(): Promise<string> {
  const { app: api } = createApp({
    dataDir: dataDir(),
    // In dev, Vite serves the UI and proxies /api to the fixed port 5174.
    staticDir: devUrl ? undefined : path.join(__dirname, '..', 'renderer'),
    log,
  });
  return new Promise((resolve, reject) => {
    const port = devUrl ? Number(process.env.PORT ?? 5174) : 0; // 0 = any free port
    server = api.listen(port, '127.0.0.1', () => {
      const { port: actual } = server!.address() as AddressInfo;
      log('info', `Server on http://127.0.0.1:${actual}, data in ${dataDir()}`);
      resolve(`http://127.0.0.1:${actual}`);
    });
    server.once('error', reject);
  });
}

function createWindow(url: string): void {
  const origin = new URL(url).origin;
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 480,
    minHeight: 400,
    show: false,
    title: 'Weather Dashboard',
    backgroundColor: '#0e1729',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#e8edf5', height: 52 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // Only our own pages load inside the window; outside links open in the browser.
  win.webContents.on('will-navigate', (e, target) => {
    if (new URL(target).origin !== origin) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('https://')) void shell.openExternal(target);
    return { action: 'deny' };
  });

  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => (win = null));
  void win.loadURL(devUrl ?? url);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    // The dashboard needs no camera, location, notifications, etc.
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, callback) => callback(false));
    try {
      createWindow(await startServer());
    } catch (err) {
      log('error', `Failed to start: ${(err as Error).stack}`);
      app.quit();
    }
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => server?.close());
}

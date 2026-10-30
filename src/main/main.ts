// Electron entry point: start the embedded Express server on localhost, then
// open a hardened window that loads the dashboard from it.

import { app, BrowserWindow, ipcMain, Menu, screen, session, shell } from 'electron';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import path from 'node:path';
import { createApp } from '../server/app';
import { createLogger } from '../server/logger';
import { startAutoUpdate, type Updater } from './autoUpdate';
import { CHECK_CHANNEL, createCheckHandler } from './updateCheck';
import { createRestartHandler, RESTART_CHANNEL } from './updateRestart';
import { createUpdateTracker, type UpdateTracker } from './updateTracker';
import { loadWindowState, restoreBounds, saveWindowState } from './windowState';

const devUrl = process.env.VITE_DEV_URL || undefined; // set by `npm run dev`; empty counts as unset
const log = createLogger(process.env.LOG_LEVEL);
let server: Server | null = null;
let win: BrowserWindow | null = null;
let updateReady: string | null = null; // downloaded version, installs when the app quits
let tracker: UpdateTracker | null = null; // what Settings > Updates shows

function dataDir(): string {
  if (process.env.WD_DATA_DIR) return process.env.WD_DATA_DIR; // tests and screenshots
  const base = app.getPath('userData'); // %APPDATA%\Weather Dashboard
  return devUrl ? path.join(base, 'dev') : base;
}

const windowStateFile = () => path.join(dataDir(), 'window-state.json');

/** Save the window's size, position and maximized state (on close, and before an update restart). */
function saveWindow(): void {
  if (win) saveWindowState(windowStateFile(), { ...win.getNormalBounds(), maximized: win.isMaximized() });
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
  // Last size and position (window-state.json), checked against the screens there are now.
  const bounds = restoreBounds(loadWindowState(windowStateFile()), screen.getAllDisplays().map((d) => d.workArea));
  win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
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
      preload: path.join(__dirname, 'preload.js'), // relays "update ready", and "Update now" back
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

  win.webContents.on('did-finish-load', () => {
    sendUpdateState(true);
    sendUpdateReady(true);
  });
  win.once('ready-to-show', () => {
    if (bounds.maximized) win?.maximize();
    win?.show();
  });
  win.on('close', saveWindow);
  win.on('closed', () => (win = null));
  void win.loadURL(devUrl ?? url);
}

/**
 * Tell the page an update is ready (again after a reload, so it is never lost).
 * `loaded`: called from did-finish-load, where isLoading() is still true although the page's scripts have run.
 */
function sendUpdateReady(loaded = false): void {
  if (updateReady && win && (loaded || !win.webContents.isLoading())) win.webContents.send('update-ready', updateReady);
}

/** Tell the page the update state for Settings (the page only displays it; also sent again after a reload). `loaded`: see sendUpdateReady. */
function sendUpdateState(loaded = false): void {
  if (tracker && win && (loaded || !win.webContents.isLoading())) win.webContents.send('update-state', tracker.state());
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
    // Updates come from GitHub Releases (see electron-builder.yml `publish`), only in the installed app.
    const updatesEnabled = app.isPackaged && !devUrl;
    const updateTracker = createUpdateTracker({ version: app.getVersion(), enabled: updatesEnabled, onChange: () => sendUpdateState() });
    tracker = updateTracker;
    // The dashboard needs no camera, location, notifications, etc.
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, callback) => callback(false));
    let url: string;
    try {
      url = await startServer();
      createWindow(url);
    } catch (err) {
      log('error', `Failed to start: ${(err as Error).stack}`);
      app.quit();
      return;
    }
    const updates = startAutoUpdate({
      enabled: updatesEnabled,
      tracker: updateTracker,
      // Loaded on the first check, not at startup. `autoUpdater` is a getter on the CommonJS
      // exports, so a dynamic import only has it on `.default`.
      loadUpdater: async () => (await import('electron-updater')).default.autoUpdater as unknown as Updater,
      onReady: (version) => {
        updateReady = version; // the tracker has already told the page the new state
        sendUpdateReady();
      },
      log,
    });
    // "Update now" in Settings: no arguments; checked in updateRestart.ts.
    ipcMain.on(
      RESTART_CHANNEL,
      createRestartHandler({
        window: () => win,
        origin: new URL(url).origin,
        updateReady: () => updateReady,
        updater: updates.updater,
        saveWindowState: saveWindow,
        log,
      }),
    );
    // "Check for updates" in Settings: the page's second message (no arguments; checked in updateCheck.ts).
    ipcMain.on(
      CHECK_CHANNEL,
      createCheckHandler({
        window: () => win,
        origin: new URL(url).origin,
        active: () => updatesEnabled,
        status: () => updateTracker.state().status,
        check: updates.checkNow,
        log,
      }),
    );
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => server?.close());
}

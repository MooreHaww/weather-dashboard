// Electron entry point: start the embedded Express server on localhost, then
// open a hardened window that loads the dashboard from it.

import { app, BrowserWindow, ipcMain, Menu, nativeTheme, Notification, screen, session, shell } from 'electron';
import { execFile } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import type { Server } from 'node:http';
import path from 'node:path';
import { createApp } from '../server/app';
import type { Storage } from '../server/storage';
import type { AppState, Settings, Units, WeatherData, WindUnit } from '../shared/types';
import {
  APPEARANCE_ARG,
  APPEARANCE_CHANNEL,
  createAppearanceWatcher,
  GLASS_BACKGROUND,
  GLASS_MATERIAL,
  readTransparencyEffects,
  SOLID_BACKGROUND,
  type AppearanceEnv,
  type AppearanceMode,
  type AppearanceWatcher,
} from './appearance';
import { createLogger } from '../server/logger';
import { startAutoUpdate, type Updater } from './autoUpdate';
import { createBackgroundWeather, type TrayWeather } from './backgroundWeather';
import { CLOSE_CHOICE_CHANNEL, CLOSE_REQUEST_CHANNEL, createCloseChoiceHandler } from './closeChoice';
import { decideClose } from './closePolicy';
import { createRainAlerts, TEST_ALERT } from './rainAlert';
import { createStartup, launchedHidden, startupSupported } from './startup';
import { createAppTray, setTrayWeather } from './tray';
import { TRAY_PLAIN_TEXT, trayCity, trayText } from './trayCity';
import { CHECK_CHANNEL, createCheckHandler } from './updateCheck';
import { createRestartHandler, RESTART_CHANNEL } from './updateRestart';
import { createUpdateTracker, type UpdateTracker } from './updateTracker';
import { loadWindowState, restoreBounds, saveWindowState } from './windowState';

/** electron-builder's appId: the installer's shortcuts carry it, so Windows notifications show the app's name. */
const APP_USER_MODEL_ID = 'com.mhawwari.weatherdashboard';

const devUrl = process.env.VITE_DEV_URL || undefined; // set by `npm run dev`; empty counts as unset
const log = createLogger(process.env.LOG_LEVEL);
let server: Server | null = null;
let win: BrowserWindow | null = null;
let updateReady: string | null = null; // downloaded version, installs when the app quits
let tracker: UpdateTracker | null = null; // what Settings > Updates shows
let appearance: AppearanceWatcher | null = null; // glass or solid (v1.6)
let storage: Storage | null = null;
let weatherFor: ((lat: number, lon: number, units: Units, wind: WindUnit) => Promise<WeatherData>) | null = null;
let settings: Settings | null = null; // the saved settings, kept current by the storage's change callback (v1.9)
/**
 * v1.9: set by everything that must never be stopped by the close button: before-quit (tray Quit, Exit,
 * quitAndInstall), the window's query-session-end / session-end (Windows shutdown, restart, sign-out), and "Update now".
 */
let quitting = false;
let closePending = false; // the page was asked "Close Weather Dashboard?" and has not answered
let pageLoaded = false; // the page can show the close dialog
let pendingMaximize = false; // started hidden with a maximized window state: maximize on first show
const liveNotifications = new Set<Notification>(); // kept so their click handlers are not garbage-collected

const startup = createStartup({ supported: startupSupported({ isPackaged: app.isPackaged, devUrl }), items: app });

/** What decides glass or solid (appearance.ts): the Windows version, "Transparency effects", and nativeTheme. */
async function systemAppearance(): Promise<AppearanceEnv> {
  return {
    platform: process.platform,
    release: os.release(),
    transparencyEffects: await readTransparencyEffects(
      (file, args, opts, callback) => execFile(file, args, opts, (error, stdout) => callback(error, String(stdout))),
      process.platform,
    ),
    reducedTransparency: nativeTheme.prefersReducedTransparency,
    forcedColors: nativeTheme.inForcedColorsMode,
    highContrast: nativeTheme.shouldUseHighContrastColors,
  };
}

function dataDir(): string {
  if (process.env.WD_DATA_DIR) return process.env.WD_DATA_DIR; // tests and screenshots
  const base = app.getPath('userData'); // %APPDATA%\Weather Dashboard
  return devUrl ? path.join(base, 'dev') : base;
}

const windowStateFile = () => path.join(dataDir(), 'window-state.json');

/** Save the window's size, position and maximized state (on close, on hide, and before an update restart). */
function saveWindow(): void {
  if (win) saveWindowState(windowStateFile(), { ...win.getNormalBounds(), maximized: win.isMaximized() });
}

/** Show, restore and focus the window (tray click, "Open Weather Dashboard", a second launch, a notification click). */
function showWindow(): void {
  if (!win) return;
  if (pendingMaximize) {
    pendingMaximize = false;
    win.maximize();
  }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

function hideWindow(): void {
  if (!win) return;
  saveWindow();
  win.hide();
}

/** Quit for real (tray Quit, the Exit choice): a normal app.quit(), so electron-updater's install-on-quit runs. */
function exitApp(): void {
  quitting = true;
  app.quit();
}

function notify(text: { title: string; body: string }): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: text.title, body: text.body });
  n.on('click', () => {
    liveNotifications.delete(n);
    showWindow();
  });
  n.on('close', () => liveNotifications.delete(n));
  liveNotifications.add(n);
  n.show();
}

/** The tray city and its weather, through the local server's cache (same request as the page). */
async function loadTrayWeather(): Promise<TrayWeather> {
  if (!storage || !weatherFor) return null;
  const state = await storage.get();
  const place = trayCity(state);
  if (!place) return null;
  const { units, windUnit } = state.settings;
  return { place, weather: await weatherFor(place.latitude, place.longitude, units, windUnit) };
}

const backgroundWeather = createBackgroundWeather({
  load: loadTrayWeather,
  onUpdate: (value) => {
    if (value) setTrayWeather(value.weather.current.temperature, trayText(value.place, value.weather));
    else setTrayWeather(null, TRAY_PLAIN_TEXT);
  },
});

const rainAlerts = createRainAlerts({
  load: async () => {
    const got = await loadTrayWeather();
    return got && settings ? { ...got, timeFormat: settings.timeFormat } : null;
  },
  notify,
});

/** A saved change (settings, favorites, location, recent): apply what the main process owns. */
function applyState(state: AppState): void {
  settings = state.settings;
  if (settings.rainAlerts) rainAlerts.start();
  else rainAlerts.stop();
  void backgroundWeather.refresh();
}

function startServer(): Promise<string> {
  const created = createApp({
    dataDir: dataDir(),
    // In dev, Vite serves the UI and proxies /api to the fixed port 5174.
    staticDir: devUrl ? undefined : path.join(__dirname, '..', 'renderer'),
    log,
    onStateChange: applyState,
    background: { startup, testNotification: () => notify(TEST_ALERT) },
  });
  storage = created.storage;
  weatherFor = created.weather;
  const api = created.app;
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

function createWindow(url: string, mode: AppearanceMode, hidden: boolean): void {
  const origin = new URL(url).origin;
  const glass = mode === 'glass';
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
    // Glass: Windows' acrylic behind a see-through window (the page draws the tint). Solid: exactly 1.5.1.
    backgroundColor: glass ? GLASS_BACKGROUND : SOLID_BACKGROUND,
    ...(glass ? { backgroundMaterial: GLASS_MATERIAL } : {}),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#e8edf5', height: 52 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.js'), // relays "update ready", and "Update now" back
      additionalArguments: [`${APPEARANCE_ARG}${mode}`], // read by the preload before the page draws
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

  win.webContents.on('did-start-loading', () => (pageLoaded = false));
  win.webContents.on('render-process-gone', () => (pageLoaded = false));
  win.webContents.on('did-finish-load', () => {
    pageLoaded = true;
    sendUpdateState(true);
    sendUpdateReady(true);
    sendAppearance(true); // after a reload the creation-time argument may be out of date
  });
  // "Transparency effects" has no change event: look again whenever the window comes back to the front.
  win.on('focus', () => void appearance?.refresh());
  win.once('ready-to-show', () => {
    if (hidden) {
      pendingMaximize = bounds.maximized; // started by Windows at sign-in: stay in the tray
      return;
    }
    if (bounds.maximized) win?.maximize();
    win?.show();
  });
  // Windows is shutting down, restarting or signing out: never stop the close (v1.9).
  win.on('query-session-end', () => (quitting = true));
  win.on('session-end', () => (quitting = true));
  win.on('close', (e) => {
    saveWindow(); // every close attempt saves the size and position, whatever happens next (as before 1.9)
    const action = decideClose({
      behavior: settings?.closeBehavior ?? 'ask',
      quitting,
      pageReady: pageLoaded && !win!.webContents.isCrashed(),
    });
    if (action === 'hide') {
      e.preventDefault();
      hideWindow();
    } else if (action === 'ask') {
      e.preventDefault();
      closePending = true;
      win!.webContents.send(CLOSE_REQUEST_CHANNEL); // receive-only; the answer comes back on CLOSE_CHOICE_CHANNEL
    }
  });
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

/** Glass or solid changed while the app runs: switch the window, then tell the page. */
function applyAppearance(mode: AppearanceMode): void {
  if (!win) return;
  if (mode === 'glass') {
    win.setBackgroundColor(GLASS_BACKGROUND);
    win.setBackgroundMaterial(GLASS_MATERIAL);
  } else {
    win.setBackgroundMaterial('auto'); // what a 1.5.1 window has (none was ever set)
    win.setBackgroundColor(SOLID_BACKGROUND);
  }
  sendAppearance();
}

/** Tell the page glass or solid (receive-only). `loaded`: see sendUpdateReady. */
function sendAppearance(loaded = false): void {
  if (appearance && win && (loaded || !win.webContents.isLoading())) win.webContents.send(APPEARANCE_CHANNEL, appearance.current().mode);
}

/** Tell the page the update state for Settings (the page only displays it; also sent again after a reload). `loaded`: see sendUpdateReady. */
function sendUpdateState(loaded = false): void {
  if (tracker && win && (loaded || !win.webContents.isLoading())) win.webContents.send('update-state', tracker.state());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId(APP_USER_MODEL_ID);
  // A second launch (Start menu, desktop shortcut) shows the running app, also when it lives in the tray.
  app.on('second-instance', () => showWindow());

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
      appearance = await createAppearanceWatcher({ env: systemAppearance, onChange: (d) => applyAppearance(d.mode), log });
      // High contrast, forced colours and reduced transparency come through nativeTheme.
      nativeTheme.on('updated', () => void appearance?.refresh());
      createWindow(url, appearance.current().mode, launchedHidden(process.argv));
      createAppTray({ plainIcon: path.join(__dirname, 'icon.png'), onOpen: showWindow, onQuit: exitApp });
      applyState(await storage!.get());
      backgroundWeather.start();
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
        // Called right before quitAndInstall: from here on the close button must not hide or ask (v1.9).
        saveWindowState: () => {
          quitting = true;
          saveWindow();
        },
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
    // "Close Weather Dashboard?": the page's third message, 'exit' or 'hide' only (v1.9; checked in closeChoice.ts).
    ipcMain.on(
      CLOSE_CHOICE_CHANNEL,
      createCloseChoiceHandler({
        window: () => win,
        origin: new URL(url).origin,
        pending: () => closePending,
        clearPending: () => (closePending = false),
        exit: exitApp,
        hide: hideWindow,
        log,
      }),
    );
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    quitting = true;
    rainAlerts.stop();
    server?.close();
  });
}


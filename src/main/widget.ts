// The desktop widget (v2.0), Electron glue: one borderless, fixed-size window that lives while the setting is on and the
// app runs (also with the main window in the tray or after a hidden start), its right-click menu, its saved position,
// and its blurred background (the wallpaper under it, or a live capture of the screen behind it).
//
// It never keeps the app alive and never blocks a quit: it has no close handler, and main.ts quits when the main window
// is really closed. Its page has a receive-only preload (widgetPreload.ts): nothing comes back from it.

import { BrowserWindow, desktopCapturer, Menu, powerMonitor, screen, shell } from 'electron';
import path from 'node:path';
import type { Settings } from '../shared/types';
import { WIDGET_SIZES_DIP, type WidgetPayload } from '../shared/widget';
import { contentProtection, cropToRgba, frameKey, isBlackFrame, liveCropRect, nextCaptureIn, thumbnailSize } from './liveMath';
import { createWallpaperReader } from './wallpaper';
import { WALLPAPER_CHECK_MS, type Rect } from './wallpaperMath';
import { loadWidgetState, saveWidgetState, widgetPosition } from './widgetState';

export const WIDGET_DATA_CHANNEL = 'widget-data';
export const WIDGET_BACKDROP_CHANNEL = 'widget-backdrop';
export const WIDGET_VISIBLE_CHANNEL = 'widget-visible';

type WidgetSettings = Pick<Settings, 'widget' | 'widgetSize' | 'widgetOnTop' | 'widgetBackground' | 'widgetEffects'>;

export interface WidgetOptions {
  /** The local server's address (the page is /widget.html there, or on the dev server). */
  url: string;
  devUrl?: string;
  stateFile: string;
  onOpen: () => void;
  /** "Close widget" in its menu: switch the setting off (main saves it; the change comes back through apply). */
  onCloseWidget: () => void;
  log: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

/** The widget's right-click menu (built in the main process; the page sends nothing). */
export function widgetMenuTemplate(onOpen: () => void, onClose: () => void): Electron.MenuItemConstructorOptions[] {
  return [
    { label: 'Open Weather Dashboard', click: onOpen },
    { label: 'Close widget', click: onClose },
  ];
}

export function createWidget(opts: WidgetOptions) {
  let win: BrowserWindow | null = null;
  let current: WidgetSettings | null = null;
  let payload: WidgetPayload | null = null;
  let loaded = false;
  let moveTimer: NodeJS.Timeout | null = null;
  let wallpaperTimer: NodeJS.Timeout | null = null;
  let liveTimer: NodeJS.Timeout | null = null;
  let locked = false;
  let sameFrames = 0;
  let lastKey = -1;
  let liveFailed = false;
  let backdropToken = 0; // a newer backdrop request makes older answers stale
  const wallpaper = createWallpaperReader(opts.log);
  const origin = new URL(opts.url).origin;

  const alive = () => win !== null && !win.isDestroyed();
  const visible = () => alive() && win!.isVisible() && !win!.isMinimized();

  function send(channel: string, value: unknown): void {
    if (alive() && loaded) win!.webContents.send(channel, value);
  }

  function bounds(): Rect {
    return win!.getBounds();
  }

  // ---- background: wallpaper ----
  async function sendWallpaper(): Promise<void> {
    if (!alive() || current?.widgetBackground !== 'wallpaper') return;
    const token = ++backdropToken;
    const b = bounds();
    const display = screen.getDisplayMatching(b);
    const frame = await wallpaper.read(b, { bounds: display.bounds, scaleFactor: display.scaleFactor }, screen.getAllDisplays().map((d) => d.bounds));
    if (token === backdropToken) send(WIDGET_BACKDROP_CHANNEL, frame);
  }

  function startWallpaper(): void {
    stopWallpaper();
    void sendWallpaper();
    wallpaperTimer = setInterval(() => {
      if (!visible()) return;
      void wallpaper.changed(screen.getAllDisplays().length).then((changed) => {
        if (changed) void sendWallpaper();
      });
    }, WALLPAPER_CHECK_MS);
  }

  function stopWallpaper(): void {
    if (wallpaperTimer) clearInterval(wallpaperTimer);
    wallpaperTimer = null;
  }

  // ---- background: live ----
  function idle(): boolean {
    try {
      return powerMonitor.getSystemIdleState(300) === 'idle';
    } catch {
      return false;
    }
  }

  function lockedNow(): boolean {
    try {
      return locked || powerMonitor.getSystemIdleState(300) === 'locked';
    } catch {
      return locked;
    }
  }

  function scheduleLive(): void {
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = null;
    const wait = nextCaptureIn({
      live: alive() && current?.widgetBackground === 'live',
      visible: visible(),
      locked: lockedNow(),
      idle: idle(),
      sameFrames,
      failed: liveFailed,
    });
    if (wait !== null) liveTimer = setTimeout(() => void captureLive(), wait);
  }

  async function captureLive(): Promise<void> {
    liveTimer = null;
    if (!alive() || current?.widgetBackground !== 'live') return;
    const token = ++backdropToken;
    try {
      const b = bounds();
      const display = screen.getDisplayMatching(b);
      const size = thumbnailSize(display.bounds);
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size, fetchWindowIcons: false });
      const source = sources.find((s) => s.display_id === String(display.id)) ?? (sources.length === 1 ? sources[0] : undefined);
      if (!source || source.thumbnail.isEmpty()) throw new Error('none');
      const thumb = source.thumbnail.getSize();
      const rect = liveCropRect(b, display.bounds, thumb);
      if (!rect) throw new Error('off');
      const data = cropToRgba(source.thumbnail.toBitmap(), thumb.width, rect);
      if (isBlackFrame(data)) throw new Error('black');
      const key = frameKey(data);
      sameFrames = key === lastKey ? sameFrames + 1 : 0;
      lastKey = key;
      liveFailed = false;
      if (token === backdropToken && sameFrames <= 1) send(WIDGET_BACKDROP_CHANNEL, { width: rect.width, height: rect.height, data });
    } catch {
      liveFailed = true;
      lastKey = -1;
      if (token === backdropToken) send(WIDGET_BACKDROP_CHANNEL, null);
    }
    scheduleLive();
  }

  function startLive(): void {
    sameFrames = 0;
    lastKey = -1;
    liveFailed = false;
    scheduleLive();
    if (liveTimer) {
      clearTimeout(liveTimer);
      liveTimer = null;
      void captureLive();
    }
  }

  function stopLive(): void {
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = null;
  }

  function applyBackground(): void {
    backdropToken++;
    stopWallpaper();
    stopLive();
    if (!alive() || !current) return;
    win!.setContentProtection(contentProtection(current));
    if (current.widgetBackground === 'live') startLive();
    else startWallpaper();
  }

  powerMonitor.on('lock-screen', () => {
    locked = true;
    stopLive();
  });
  powerMonitor.on('suspend', () => {
    locked = true;
    stopLive();
  });
  const resume = () => {
    locked = false;
    if (current?.widgetBackground === 'live') startLive();
  };
  powerMonitor.on('unlock-screen', resume);
  powerMonitor.on('resume', resume);

  // ---- the window ----
  function create(s: WidgetSettings): void {
    const size = WIDGET_SIZES_DIP[s.widgetSize];
    const primary = screen.getPrimaryDisplay().workArea;
    const pos = widgetPosition(loadWidgetState(opts.stateFile), screen.getAllDisplays().map((d) => d.workArea), primary, size);
    loaded = false;
    win = new BrowserWindow({
      ...pos,
      ...size,
      show: false,
      frame: false,
      transparent: true, // the page draws an opaque rounded card; the corners outside it are see-through
      backgroundColor: '#00000000',
      type: 'toolbar', // a tool window: no taskbar button, not in Alt-Tab
      skipTaskbar: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      hasShadow: false,
      alwaysOnTop: s.widgetOnTop,
      title: 'Weather Dashboard widget',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        preload: path.join(__dirname, 'widgetPreload.js'),
      },
    });
    const w = win;
    w.webContents.on('will-navigate', (e, target) => {
      if (new URL(target).origin !== origin) e.preventDefault();
    });
    w.webContents.setWindowOpenHandler(({ url: target }) => {
      if (target.startsWith('https://')) void shell.openExternal(target);
      return { action: 'deny' };
    });
    w.webContents.on('did-start-loading', () => (loaded = false));
    w.webContents.on('did-finish-load', () => {
      loaded = true;
      if (payload) send(WIDGET_DATA_CHANNEL, payload);
      send(WIDGET_VISIBLE_CHANNEL, visible());
      applyBackground();
    });
    w.once('ready-to-show', () => {
      if (alive()) w.showInactive(); // never takes the focus from what the user is doing
    });
    // A right-click on the drag area would open Windows' system menu; show ours instead.
    w.on('system-context-menu', (e) => {
      e.preventDefault();
      Menu.buildFromTemplate(widgetMenuTemplate(opts.onOpen, opts.onCloseWidget)).popup({ window: w });
    });
    w.on('moved', () => {
      if (!alive()) return;
      saveWidgetState(opts.stateFile, { x: bounds().x, y: bounds().y });
      if (moveTimer) clearTimeout(moveTimer);
      moveTimer = setTimeout(() => {
        if (current?.widgetBackground === 'wallpaper') void sendWallpaper();
        else if (current?.widgetBackground === 'live') startLive();
      }, 300);
    });
    const shown = () => {
      send(WIDGET_VISIBLE_CHANNEL, true);
      if (current?.widgetBackground === 'live') startLive();
      else void sendWallpaper();
    };
    const hidden = () => {
      send(WIDGET_VISIBLE_CHANNEL, false);
      stopLive();
    };
    w.on('show', shown);
    w.on('restore', shown);
    w.on('hide', hidden);
    w.on('minimize', hidden);
    w.on('closed', () => {
      if (win === w) win = null;
      stopWallpaper();
      stopLive();
    });
    void w.loadURL(`${opts.devUrl ?? opts.url}/widget.html`);
  }

  function destroy(): void {
    stopWallpaper();
    stopLive();
    if (moveTimer) clearTimeout(moveTimer);
    if (alive()) win!.destroy();
    win = null;
  }

  return {
    /** Apply the widget settings: create, resize, keep on top, background, or remove it. */
    apply(s: WidgetSettings): void {
      const before = current;
      current = { widget: s.widget, widgetSize: s.widgetSize, widgetOnTop: s.widgetOnTop, widgetBackground: s.widgetBackground, widgetEffects: s.widgetEffects };
      if (!s.widget) {
        destroy();
        return;
      }
      if (!alive()) {
        create(s);
        return;
      }
      if (before?.widgetSize !== s.widgetSize) {
        const size = WIDGET_SIZES_DIP[s.widgetSize];
        const b = bounds();
        // Keep it on screen at the new size (Medium is wider).
        const pos = widgetPosition(b, screen.getAllDisplays().map((d) => d.workArea), screen.getPrimaryDisplay().workArea, size);
        win!.setBounds({ ...pos, ...size });
      }
      if (before?.widgetOnTop !== s.widgetOnTop) win!.setAlwaysOnTop(s.widgetOnTop);
      if (before?.widgetBackground !== s.widgetBackground || before?.widgetSize !== s.widgetSize) applyBackground();
    },
    /** New weather or settings for the page (sent now if the page is loaded, else when it is). */
    setData(next: WidgetPayload): void {
      payload = next;
      send(WIDGET_DATA_CHANNEL, next);
    },
    window: (): BrowserWindow | null => (alive() ? win : null),
    destroy,
  };
}

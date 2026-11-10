// The tray icon (v1.9): Electron glue around trayIcon.ts (the bitmap) and trayCity.ts (the text).
// Menu: a disabled line with the city and temperature, "Open Weather Dashboard", "Quit". A left click opens the window.

import { Menu, nativeImage, Tray, type NativeImage } from 'electron';
import { drawTrayBitmap, trayLabel } from './trayIcon';
import { TRAY_PLAIN_TEXT } from './trayCity';

export interface AppTrayOptions {
  /** The plain app icon (shown while there is no city or no weather yet). */
  plainIcon: string;
  onOpen: () => void;
  onQuit: () => void;
}

let tray: Tray | null = null;
let shown: { label: string | null; text: string } = { label: null, text: TRAY_PLAIN_TEXT };
let options: AppTrayOptions | null = null;
let currentMenu: Menu | null = null;

/** What the tray shows now. Read by the e2e tests through the main process; changes nothing. */
export function trayStatus(): { present: boolean; label: string | null; text: string } {
  return { present: tray !== null && !tray.isDestroyed(), ...shown };
}

/** The tray's current menu (the e2e tests press its items from the main process, as a user would from the tray). */
export function trayMenu(): Menu | null {
  return currentMenu;
}

export function temperatureImage(label: string): NativeImage {
  const small = drawTrayBitmap(label, 1);
  const large = drawTrayBitmap(label, 2);
  const image = nativeImage.createFromBitmap(small.bgra, { width: small.width, height: small.height, scaleFactor: 1 });
  image.addRepresentation({ scaleFactor: 2, width: large.width, height: large.height, buffer: large.bgra });
  return image;
}

function menu(text: string): Menu {
  return (currentMenu = Menu.buildFromTemplate([
    { label: text, enabled: false },
    { type: 'separator' },
    { label: 'Open Weather Dashboard', click: () => options?.onOpen() },
    { label: 'Quit', click: () => options?.onQuit() },
  ]));
}

export function createAppTray(opts: AppTrayOptions): void {
  options = opts;
  tray = new Tray(nativeImage.createFromPath(opts.plainIcon));
  tray.setToolTip(TRAY_PLAIN_TEXT);
  tray.setContextMenu(menu(TRAY_PLAIN_TEXT));
  tray.on('click', () => opts.onOpen());
}

/** Show a temperature (`temperature` null = the plain icon) and its text. Skips work when nothing changed. */
export function setTrayWeather(temperature: number | null, text: string): void {
  if (!tray || tray.isDestroyed() || !options) return;
  const label = temperature === null ? null : trayLabel(temperature);
  if (label === shown.label && text === shown.text) return;
  if (label !== shown.label) tray.setImage(label === null ? nativeImage.createFromPath(options.plainIcon) : temperatureImage(label));
  tray.setToolTip(text);
  tray.setContextMenu(menu(text));
  shown = { label, text };
}

export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
}

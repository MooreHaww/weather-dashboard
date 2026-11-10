// v1.9 Background mode and rain alerts in the real app (dev build), driven from the main process and the page's DOM
// (no real mouse or keyboard): the close button's three behaviours, the tray, a second launch, the hidden launch,
// Windows ending the session, the tray's Quit, and Settings > Background.
//
// The app runs with tests/e2e/support/fakeOs.cjs (NODE_OPTIONS): the Windows login item and notifications are faked,
// so nothing here touches this PC's startup entries or shows a real notification. "Your location" stays off (no GeoJS).
// Open-Meteo is live. Run with: npm run test:e2e

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { launchApp, waitForDashboard, type LaunchedApp, type Seed } from '../../scripts/launch';

const FAKE = path.join(__dirname, 'support', 'fakeOs.cjs').replace(/\\/g, '/');
const ENV = { NODE_OPTIONS: `--require ${FAKE}` };
const ROOT = path.resolve(__dirname, '..', '..');

const london = { id: 2643743, name: 'London', latitude: 51.50853, longitude: -0.12574, admin1: 'England', country: 'United Kingdom', countryCode: 'GB', timezone: 'Europe/London' };
const tokyo = { id: 1850147, name: 'Tokyo', latitude: 35.6895, longitude: 139.69171, admin1: 'Tokyo', country: 'Japan', countryCode: 'JP', timezone: 'Asia/Tokyo' };

let app: LaunchedApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function start(seed: Seed, args: string[] = []) {
  app = await launchApp(seed, { env: ENV, args });
  return app;
}

/** The window's state, from the main process. */
const windowState = (a: LaunchedApp) =>
  a.evaluateMain<{ count: number; visible: boolean; destroyed: boolean }>(
    `const { BrowserWindow } = process.mainModule.require('electron'); const w = BrowserWindow.getAllWindows()[0];
     return { count: BrowserWindow.getAllWindows().length, visible: Boolean(w && w.isVisible()), destroyed: !w || w.isDestroyed() };`,
  );
/** A normal close, as the window's X button does (from the main process, not the mouse). */
const closeWindow = (a: LaunchedApp) =>
  a.evaluateMain(`const { BrowserWindow } = process.mainModule.require('electron'); setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 20); return true;`);
/** The app's own tray module (the same instance main.js loaded), from the main process. */
const TRAY = `process.mainModule.require(process.mainModule.require('path').join(process.mainModule.require('electron').app.getAppPath(), 'dist', 'main', 'tray.js'))`;
const tray = (a: LaunchedApp) => a.evaluateMain<{ present: boolean; label: string | null; text: string }>(`return ${TRAY}.trayStatus();`);
const saved = async (a: LaunchedApp) => JSON.parse(await readFile(path.join(a.dataDir, 'weather-dashboard.json'), 'utf8')) as { settings: Record<string, unknown> };
const fakeOs = (a: LaunchedApp) => a.evaluateMain<{ notifications: { title: string; body: string }[]; setCalls: unknown[] }>(`return globalThis.__os;`);

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 10_000, what = 'condition') {
  for (const deadline = Date.now() + timeoutMs; ; await sleep(150)) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
  }
}

/** A second launch of the same app with the same profile: it must hand over to the running one and exit. */
function secondLaunch(a: LaunchedApp): Promise<number | null> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electronPath = require('electron') as unknown as string;
  const child = spawn(electronPath, [`--user-data-dir=${path.join(a.dataDir, 'profile')}`, ROOT], {
    cwd: ROOT,
    env: { ...process.env, ...ENV, WD_DATA_DIR: a.dataDir, VITE_DEV_URL: '' },
    stdio: 'ignore',
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('The second launch did not exit'));
    }, 20_000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

describe('closing the window', () => {
  it('"Exit" quits, exactly as before 1.9', async () => {
    const a = await start({ lastPlace: london, settings: { closeBehavior: 'exit' } });
    await waitForDashboard(a.page);
    await closeWindow(a);
    expect(await a.waitForExit(15_000)).toBe(0);
    app = undefined;
  });

  it('"Keep running" hides the window; the process keeps running with the tray, which shows the temperature', async () => {
    const a = await start({ lastPlace: london, favorites: [tokyo], settings: { closeBehavior: 'background' } });
    await waitForDashboard(a.page);
    await waitUntil(async () => (await tray(a)).label !== null, 30_000, 'the tray temperature');
    const t = await tray(a);
    expect(t.present).toBe(true);
    expect(t.text).toMatch(/^Tokyo -?\d+°C, \S/); // the first favorite (location is off)
    expect(t.label).toMatch(/^-?\d{1,3}$/);
    await closeWindow(a);
    await waitUntil(async () => !(await windowState(a)).visible, 5000, 'the window to hide');
    expect(await windowState(a)).toEqual({ count: 1, visible: false, destroyed: false });
    expect((await tray(a)).present).toBe(true);
    expect(a.errors).toEqual([]);
  });

  it('a second launch shows the hidden window and exits itself', async () => {
    const a = await start({ lastPlace: london, settings: { closeBehavior: 'background' } });
    await waitForDashboard(a.page);
    await closeWindow(a);
    await waitUntil(async () => !(await windowState(a)).visible, 5000, 'the window to hide');
    expect(await secondLaunch(a)).toBe(0);
    await waitUntil(async () => (await windowState(a)).visible, 5000, 'the window to show');
    expect((await windowState(a)).count).toBe(1);
  });

  it('Windows ending the session (shutdown, restart, sign-out) is never blocked, even with "Keep running"', async () => {
    const a = await start({ lastPlace: london, settings: { closeBehavior: 'background' } });
    await waitForDashboard(a.page);
    await a.evaluateMain(
      `const { BrowserWindow } = process.mainModule.require('electron'); const w = BrowserWindow.getAllWindows()[0];
       w.emit('query-session-end', { preventDefault() {}, reasons: ['logoff'] }); w.emit('session-end', { reasons: ['logoff'] });
       setTimeout(() => w.close(), 20); return true;`,
    );
    expect(await a.waitForExit(15_000)).toBe(0);
    app = undefined;
  });

  it('the tray\'s Quit quits, with "Keep running" set and the window hidden', async () => {
    const a = await start({ lastPlace: london, settings: { closeBehavior: 'background' } });
    await waitForDashboard(a.page);
    await closeWindow(a);
    await waitUntil(async () => !(await windowState(a)).visible, 5000, 'the window to hide');
    await a.evaluateMain(
      `const menu = ${TRAY}.trayMenu(); const quit = menu.items.find((i) => i.label === 'Quit');
       setTimeout(() => quit.click(), 20); return menu.items.map((i) => i.label);`,
    );
    expect(await a.waitForExit(15_000)).toBe(0);
    app = undefined;
  });

  it('"Ask" shows the dialog; Escape keeps the window open; Exit with "Remember my choice" saves it and quits', async () => {
    const a = await start({ lastPlace: london }); // closeBehavior not in the file: the default, Ask
    await waitForDashboard(a.page);
    await closeWindow(a);
    await a.page.waitFor(`document.getElementById('close-confirm')`, 5000);
    expect(await a.page.evaluate<string>(`document.querySelector('#close-confirm h3').textContent`)).toBe('Close Weather Dashboard?');
    expect(await a.page.evaluate<string>(`document.activeElement.textContent`)).toBe('Keep running');
    expect((await windowState(a)).visible).toBe(true);
    await a.page.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true`);
    await a.page.waitFor(`!document.getElementById('close-confirm')`, 2000);
    await sleep(500);
    expect((await windowState(a)).visible).toBe(true);
    expect(await a.page.evaluate<boolean>(`document.querySelector('.layout').inert`)).toBe(false);

    await closeWindow(a);
    await a.page.waitFor(`document.getElementById('close-confirm')`, 5000);
    await a.page.evaluate(`document.getElementById('close-remember').checked = true; document.querySelector('#close-confirm [data-action="exit"]').click(); true`);
    expect(await a.waitForExit(15_000)).toBe(0);
    expect((await saved(a)).settings.closeBehavior).toBe('exit');
    app = undefined;
    await a.close();
  });

  it('"Ask" then "Keep running" without remembering hides once and leaves the setting at Ask', async () => {
    const a = await start({ lastPlace: london });
    await waitForDashboard(a.page);
    await closeWindow(a);
    await a.page.waitFor(`document.getElementById('close-confirm')`, 5000);
    await a.page.evaluate(`document.querySelector('#close-confirm [data-action="hide"]').click(); true`);
    await waitUntil(async () => !(await windowState(a)).visible, 5000, 'the window to hide');
    expect((await saved(a)).settings.closeBehavior ?? 'ask').toBe('ask');
    // The page cannot act without a new close request: a late "exit" is ignored.
    await a.page.evaluate(`window.background.choose('exit'), true`);
    await sleep(800);
    expect(await windowState(a)).toEqual({ count: 1, visible: false, destroyed: false });
    expect(a.errors).toEqual([]);
  });
});

describe('started by Windows (the login item\'s argument)', () => {
  it('opens hidden in the tray, and a normal second launch shows the window', async () => {
    const a = await start({ lastPlace: london }, ['--wd-hidden']);
    await waitForDashboard(a.page);
    await sleep(1000);
    expect((await windowState(a)).visible).toBe(false);
    expect((await tray(a)).present).toBe(true);
    expect(await secondLaunch(a)).toBe(0);
    await waitUntil(async () => (await windowState(a)).visible, 5000, 'the window to show');
  });

  it('the tray icon is drawn in pure JS at 16 and 32 px', async () => {
    const a = await start({ lastPlace: london });
    await waitForDashboard(a.page);
    const img = await a.evaluateMain<{ empty: boolean; size: { width: number; height: number }; scales: number[] }>(
      `const i = ${TRAY}.temperatureImage('-130'); return { empty: i.isEmpty(), size: i.getSize(), scales: i.getScaleFactors() };`,
    );
    expect(img).toEqual({ empty: false, size: { width: 16, height: 16 }, scales: [1, 2] });
  });
});

describe('Settings > Background', () => {
  it('shows the three rows after Look; Start with Windows is off and disabled in a dev build; rain alerts save; Send a test notifies', async () => {
    const a = await start({ lastPlace: london });
    await waitForDashboard(a.page);
    const page = a.page;
    await page.evaluate(`document.getElementById('settings-button').click(), true`);
    await page.waitFor(`document.getElementById('settings').classList.contains('is-open')`, 3000);
    const ids = await page.evaluate<string[]>(`[...document.getElementById('settings-sections').children].map((s) => s.id)`);
    expect(ids.slice(0, 3)).toEqual(['settings-updates', 'settings-look', 'settings-background']);
    expect(await page.evaluate<string[]>(`[...document.querySelectorAll('#settings-background .settings-row-label')].map((l) => l.textContent)`)).toEqual([
      'When I close the window',
      'Start with Windows',
      'Rain alerts',
    ]);
    await page.waitFor(`document.getElementById('settings-startup').disabled`, 3000);
    expect(await page.evaluate<string>(`document.getElementById('settings-startup').getAttribute('aria-checked')`)).toBe('false');

    await page.evaluate(`document.getElementById('settings-rain-alerts').click(), true`);
    await page.waitFor(`document.getElementById('settings-rain-alerts').getAttribute('aria-checked') === 'true'`, 2000);
    await waitUntil(async () => (await saved(a)).settings.rainAlerts === true, 5000, 'rain alerts saved');

    await page.evaluate(`document.querySelector('#settings-background [data-value="background"]').click(), true`);
    await waitUntil(async () => (await saved(a)).settings.closeBehavior === 'background', 5000, 'close choice saved');
    // The main process applied it at once: closing now hides.
    await closeWindow(a);
    await waitUntil(async () => !(await windowState(a)).visible, 5000, 'the window to hide');
    await a.evaluateMain(`${TRAY}.trayMenu().items.find((i) => i.label === 'Open Weather Dashboard').click(); return true;`);
    await waitUntil(async () => (await windowState(a)).visible, 5000, 'the window to show');

    await page.evaluate(`document.getElementById('rain-alert-test').click(), true`);
    await waitUntil(async () => (await fakeOs(a)).notifications.length === 1, 5000, 'the test notification');
    expect((await fakeOs(a)).notifications[0]).toEqual({ title: 'Rain alerts are on', body: 'This is a test. Alerts look like this.' });
    expect((await fakeOs(a)).setCalls).toEqual([]); // a dev build never touches the login item
    expect(a.errors).toEqual([]);
  });
});

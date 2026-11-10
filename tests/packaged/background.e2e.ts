// v1.9 Background mode in the packaged app (release/win-unpacked): the close and quit paths that must never be blocked.
// The update restart and the tray's Quit with a downloaded update are in update.e2e.ts (they need its fake feed).
// Never with "Your location" on (the packaged exe ignores NODE_OPTIONS, so no fake can load), and nothing here
// changes the login item: Start with Windows is never switched. The updater is pointed at a closed local port.
// Run with: npx vitest run --config vitest.packaged.config.mts

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { launchApp, waitForDashboard, type LaunchedApp, type Seed } from '../../scripts/launch';

const root = path.join(__dirname, '..', '..');
const exe = path.join(root, 'release', 'win-unpacked', 'Weather Dashboard.exe');
const london = { id: 2643743, name: 'London', latitude: 51.50853, longitude: -0.12574, admin1: 'England', country: 'United Kingdom', countryCode: 'GB', timezone: 'Europe/London' };

let app: LaunchedApp | undefined;
let cacheDir: string | undefined;

afterEach(async () => {
  await app?.close();
  if (cacheDir) await rm(cacheDir, { recursive: true, force: true }).catch(() => {});
  app = cacheDir = undefined;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function start(seed: Seed, args: string[] = []) {
  cacheDir = await mkdtemp(path.join(tmpdir(), 'wd-bg-cache-'));
  app = await launchApp(seed, { executable: exe, env: { LOCALAPPDATA: cacheDir }, args });
  // No update check may reach GitHub from a test: a closed local port.
  await app.evaluateMain(`process.mainModule.require('electron-updater').autoUpdater.setFeedURL({ provider: 'generic', url: 'http://127.0.0.1:9/' }); return true;`);
  return app;
}

const windowState = (a: LaunchedApp) =>
  a.evaluateMain<{ count: number; visible: boolean }>(
    `const { BrowserWindow } = process.mainModule.require('electron'); const w = BrowserWindow.getAllWindows()[0];
     return { count: BrowserWindow.getAllWindows().length, visible: Boolean(w && w.isVisible()) };`,
  );
const TRAY = `process.mainModule.require(process.mainModule.require('path').join(process.mainModule.require('electron').app.getAppPath(), 'dist', 'main', 'tray.js'))`;
const closeWindow = (a: LaunchedApp) =>
  a.evaluateMain(`const { BrowserWindow } = process.mainModule.require('electron'); setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 20); return true;`);

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number, what: string) {
  for (const deadline = Date.now() + timeoutMs; ; await sleep(150)) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
  }
}

/** Record the quit events in a file (the process is gone afterwards). */
async function logQuit(a: LaunchedApp): Promise<string> {
  const file = path.join(a.dataDir, 'quit-log.txt');
  await a.evaluateMain(`
    const fs = process.mainModule.require('fs');
    const { app, BrowserWindow } = process.mainModule.require('electron');
    const note = (m) => fs.appendFileSync(${JSON.stringify(file)}, m + '\\n');
    for (const ev of ['before-quit', 'will-quit', 'quit']) app.on(ev, () => note(ev));
    BrowserWindow.getAllWindows()[0].on('close', () => note('window close'));
    return true;
  `);
  return file;
}

describe('the packaged app in the background', () => {
  it('Keep running: the close button hides the window; the process and the tray stay', async () => {
    const a = await start({ lastPlace: london, settings: { closeBehavior: 'background' } });
    await waitForDashboard(a.page);
    await closeWindow(a);
    await waitUntil(async () => !(await windowState(a)).visible, 5000, 'the window to hide');
    await sleep(1000);
    expect(await windowState(a)).toEqual({ count: 1, visible: false });
    expect((await a.evaluateMain<{ present: boolean }>(`return ${TRAY}.trayStatus();`)).present).toBe(true);
    expect(a.errors).toEqual([]);
  });

  it('Windows ending the session closes it even with Keep running: nothing blocks shutdown, restart or sign-out', async () => {
    const a = await start({ lastPlace: london, settings: { closeBehavior: 'background' } });
    await waitForDashboard(a.page);
    const file = await logQuit(a);
    await a.evaluateMain(
      `const { BrowserWindow } = process.mainModule.require('electron'); const w = BrowserWindow.getAllWindows()[0];
       w.emit('query-session-end', { preventDefault() {}, reasons: ['shutdown'] }); w.emit('session-end', { reasons: ['shutdown'] });
       setTimeout(() => w.close(), 20); return true;`,
    );
    expect(await a.waitForExit(15_000)).toBe(0);
    expect(readFileSync(file, 'utf8').trim().split(/\r?\n/)).toEqual(['window close', 'before-quit', 'will-quit', 'quit']);
    await a.close();
    app = undefined;
  });

  it('Ask: the close shows the dialog and the window stays; Exit from the dialog quits', async () => {
    const a = await start({ lastPlace: london }); // the default, Ask
    await waitForDashboard(a.page);
    await closeWindow(a);
    await a.page.waitFor(`document.getElementById('close-confirm')`, 5000);
    expect((await windowState(a)).visible).toBe(true);
    await a.page.evaluate(`document.querySelector('#close-confirm [data-action="exit"]').click(), true`);
    expect(await a.waitForExit(15_000)).toBe(0);
    await a.close();
    app = undefined;
  });

  it('a second launch shows the hidden window and exits itself; started with the login item\'s argument it opens hidden', async () => {
    const a = await start({ lastPlace: london }, ['--wd-hidden']);
    await waitForDashboard(a.page);
    await sleep(1000);
    expect((await windowState(a)).visible).toBe(false);
    const second = spawn(exe, [`--user-data-dir=${path.join(a.dataDir, 'profile')}`], {
      env: { ...process.env, WD_DATA_DIR: a.dataDir, LOCALAPPDATA: cacheDir! },
      stdio: 'ignore',
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        second.kill();
        reject(new Error('The second launch did not exit'));
      }, 20_000);
      second.once('exit', (c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
    expect(code).toBe(0);
    await waitUntil(async () => (await windowState(a)).visible, 5000, 'the window to show');
    expect((await windowState(a)).count).toBe(1);
    expect(a.errors).toEqual([]);
  });
});

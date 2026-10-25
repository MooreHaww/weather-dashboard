// Auto-update, end to end, in the PACKAGED app (release/win-unpacked): the updater
// only runs when app.isPackaged. GitHub is never contacted: right after launch the
// test points the app's own autoUpdater (through the main-process inspector) at a
// throwaway local feed, then lets the app's 10 s scheduler do the real check,
// download and "ready" message. LOCALAPPDATA is a temp folder, so the download never
// lands in the real updater cache, and the app is killed at the end, so nothing installs.
// "Update now": the updater's quitAndInstall/install are replaced in the test harness right
// after launch (stubInstaller), so the fake installer can never run, not even on quit.
// Run with: npm run test:update (rebuilds the installer first)

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { launchApp, waitForDashboard, type AppPage, type LaunchedApp } from '../../scripts/launch';
import { checkReleaseFiles } from '../../scripts/release-files';
import { FIRST_CHECK_DELAY_MS } from '../../src/main/autoUpdate';
import { UPDATE_NOTE_DETAIL, updateMessage } from '../../src/renderer/components/updateNote';

const root = path.join(__dirname, '..', '..');
const release = path.join(root, 'release');
const exe = path.join(release, 'win-unpacked', 'Weather Dashboard.exe');
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };

const NEXT = '9.9.9';
const INSTALLER = `Weather-Dashboard-Setup-${NEXT}.exe`;

type FeedMode = 'ok' | 'same' | 'down';

/**
 * A fake update feed. 'ok': latest.yml for version 9.9.9 and a small fake installer. 'same': latest.yml
 * for the installed version (nothing newer). 'down': a 503 for everything. `mode` can change while the
 * app runs. With `holdInstaller`, the installer request is not answered until `release()`, so the app
 * stays in "downloading".
 */
async function startFeed(initial: FeedMode, opts: { holdInstaller?: boolean } = {}) {
  const body = randomBytes(64 * 1024);
  const sha512 = createHash('sha512').update(body).digest('base64');
  const ymlFor = (v: string) =>
    [
      `version: ${v}`,
      'files:',
      `  - url: Weather-Dashboard-Setup-${v}.exe`,
      `    sha512: ${sha512}`,
      `    size: ${body.length}`,
      `path: Weather-Dashboard-Setup-${v}.exe`,
      `sha512: ${sha512}`,
      `releaseDate: '${new Date().toISOString()}'`,
      '',
    ].join('\n');
  let release: () => void = () => {};
  const gate = opts.holdInstaller ? new Promise<void>((r) => (release = r)) : Promise.resolve();
  const requests: string[] = [];
  const feed = { mode: initial, url: '', requests, release: () => release(), close: () => new Promise((r) => server.close(r)) };
  const server: Server = createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname.slice(1));
    requests.push(name);
    if (feed.mode === 'down') return void res.writeHead(503).end('Service Unavailable');
    if (name === 'latest.yml') return void res.writeHead(200, { 'Content-Type': 'text/yaml' }).end(ymlFor(feed.mode === 'same' ? version : NEXT));
    if (name === INSTALLER) return void gate.then(() => res.writeHead(200, { 'Content-Length': body.length }).end(body));
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  feed.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return feed;
}

let app: LaunchedApp | undefined;
let cacheDir: string | undefined;
let feed: Awaited<ReturnType<typeof startFeed>> | undefined;

afterEach(async () => {
  await app?.close();
  await feed?.close();
  if (cacheDir) await rm(cacheDir, { recursive: true, force: true }).catch(() => {});
  app = cacheDir = feed = undefined;
});

/** Launch the packaged app and point its updater at the local feed before the first check fires. */
async function launchWithFeed(mode: FeedMode, opts: { holdInstaller?: boolean } = {}) {
  feed = await startFeed(mode, opts);
  cacheDir = await mkdtemp(path.join(tmpdir(), 'wd-update-cache-'));
  const started = Date.now();
  app = await launchApp(undefined, { executable: exe, env: { LOCALAPPDATA: cacheDir } });
  await app.evaluateMain(`
    const { autoUpdater } = process.mainModule.require('electron-updater');
    autoUpdater.setFeedURL({ provider: 'generic', url: ${JSON.stringify(feed.url)} });
  `);
  await stubInstaller(app);
  // The feed must be set before the app's own first check, or this test would talk to GitHub.
  expect(Date.now() - started).toBeLessThan(FIRST_CHECK_DELAY_MS);
  return app;
}

/**
 * Test harness only: the updater never runs an installer. quitAndInstall records its arguments
 * and what window-state.json held at that moment; with `quit`, it then quits the app the way
 * electron-updater does (next tick, app.quit()). install/doInstall do nothing, so the
 * install-on-quit handler cannot start the fake installer either.
 */
async function stubInstaller(a: LaunchedApp, opts: { quit?: boolean } = {}) {
  const stateFile = path.join(a.dataDir, 'window-state.json');
  await a.evaluateMain(`
    const { autoUpdater } = process.mainModule.require('electron-updater');
    const fs = process.mainModule.require('fs');
    const { app } = process.mainModule.require('electron');
    globalThis.__installs = [];
    globalThis.__restarts = [];
    // With quit: the order of events, in a file (the process is gone afterwards).
    const quitLog = ${JSON.stringify(path.join(a.dataDir, 'quit-log.txt'))};
    const note = (m) => ${Boolean(opts.quit)} && fs.appendFileSync(quitLog, m + '\\n');
    for (const ev of ['before-quit', 'will-quit', 'quit']) app.on(ev, () => note(ev));
    const { BrowserWindow } = process.mainModule.require('electron');
    BrowserWindow.getAllWindows()[0].on('close', () => note('window close'));
    autoUpdater.install = () => { globalThis.__installs.push('install'); return false; };
    autoUpdater.doInstall = () => { globalThis.__installs.push('doInstall'); return false; };
    autoUpdater.quitAndInstall = (...args) => {
      const file = ${JSON.stringify(stateFile)};
      globalThis.__restarts.push({ args, state: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null });
      note('quitAndInstall ' + JSON.stringify(args) + ' state saved: ' + fs.existsSync(file));
      if (${Boolean(opts.quit)}) setImmediate(() => app.quit());
    };
  `);
}

const restarts = () => app!.evaluateMain<{ args: unknown[]; state: Record<string, unknown> | null }[]>(`return globalThis.__restarts;`);

async function clickOn(page: AppPage, selector: string) {
  const [x, y] = await page.evaluate<[number, number]>(
    `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`,
  );
  await page.click(x, y);
}
const activeId = (page: AppPage) => page.evaluate<string>(`document.activeElement?.id || document.activeElement?.dataset?.action || ''`);
const confirmOpen = `document.getElementById('update-confirm') !== null`;

async function openSettings(page: AppPage) {
  await clickOn(page, '#settings-button');
  await page.waitFor(`document.getElementById('settings').classList.contains('is-open')`, 2000);
  await new Promise((r) => setTimeout(r, 500));
}

/** The Updates section: its main line, and its small second line (null when there is none). */
const updatesLabel = `document.querySelector('#settings-updates .settings-row-label').textContent`;
const updatesDetail = `document.querySelector('#settings-updates .settings-row-description')?.textContent ?? null`;
const updateButton = `document.getElementById('update-now') !== null`;
/** "Version 1.4.7 · Up to date · checked 10:42 AM" (12-hour is the default setting). */
const upToDate = new RegExp(`^Version ${version.replaceAll('.', '\\.')} · Up to date · checked \\d{1,2}:\\d{2} (AM|PM)$`);
/** No red dot, no corner note and the plain gear label. */
const noSignals = `document.querySelectorAll('#settings-button .update-dot').length === 0 && document.getElementById('update-note').hidden && document.getElementById('settings-button').getAttribute('aria-label') === 'Settings'`;

const noteVisible =`!document.getElementById('update-note').hidden`;
const dotCount = `document.querySelectorAll('#settings-button .update-dot').length`;

describe('release files', () => {
  it('latest.yml, the installer and the blockmap agree with package.json', async () => {
    const { files, problems } = await checkReleaseFiles(release, version);
    expect(problems).toEqual([]);
    expect(files.map((f) => path.basename(f))).toEqual([
      `Weather-Dashboard-Setup-${version}.exe`,
      `Weather-Dashboard-Setup-${version}.exe.blockmap`,
      'latest.yml',
    ]);
  });

  it('the packaged app looks for updates on GitHub, with no signature check and no token', () => {
    const yml = readFileSync(path.join(release, 'win-unpacked', 'resources', 'app-update.yml'), 'utf8');
    expect(yml).toMatch(/^provider: github$/m);
    expect(yml).toMatch(/^owner: MooreHaww$/m);
    expect(yml).toMatch(/^repo: weather-dashboard$/m);
    expect(yml).not.toMatch(/publisherName/); // unsigned build: electron-updater skips the signature check
    expect(yml).not.toMatch(/token/i);
  });
});

describe('auto-update in the packaged app', () => {
  it('finds a newer version, downloads it and shows the message once', async () => {
    expect(existsSync(exe), 'run npm run dist first').toBe(true);
    const { page, errors } = await launchWithFeed('ok', { holdInstaller: true });
    await waitForDashboard(page);

    // The section says "downloading" while the installer is on its way: no button, no dot, no note yet.
    await openSettings(page);
    await page.waitFor(`/is downloading/.test(${updatesLabel})`, FIRST_CHECK_DELAY_MS + 30_000);
    expect(await page.evaluate<string>(updatesLabel)).toBe(`Version ${NEXT} is downloading…`);
    expect(await page.evaluate<string>(updatesDetail)).toBe(`Installed version ${version}`);
    expect(await page.evaluate<boolean>(updateButton)).toBe(false);
    expect(await page.evaluate<boolean>(noSignals)).toBe(true);
    await page.press('Escape');
    await page.waitFor(`document.getElementById('settings').hidden`, 2000);
    feed!.release();

    await page.waitFor(noteVisible, 30_000);
    expect(feed!.requests).toContain('latest.yml');
    expect(feed!.requests).toContain(INSTALLER);
    const pending = await readdir(path.join(cacheDir!, 'weather-dashboard-updater', 'pending'));
    expect(pending).toContain(INSTALLER);

    expect(await page.evaluate<string>(`document.querySelector('.update-note-title').textContent`)).toBe(updateMessage(NEXT));
    expect(await page.evaluate<string>(`document.querySelector('.update-note-detail').textContent`)).toBe(UPDATE_NOTE_DETAIL);
    expect(updateMessage(NEXT)).toBe(`New update available: version ${NEXT}`);
    // The red dot on the gear, with its label.
    expect(await page.evaluate<number>(dotCount)).toBe(1);
    expect(await page.evaluate<string>(`document.getElementById('settings-button').getAttribute('aria-label')`)).toBe('Settings, update ready');
    expect(await page.evaluate<string>(`document.getElementById('update-note').getAttribute('role')`)).toBe('status');
    expect(await page.evaluate<boolean>(`document.getElementById('banner').hidden`)).toBe(true);
    // It installs on quit, it does not restart the app by itself.
    expect(await app!.evaluateMain<boolean>(`return process.mainModule.require('electron-updater').autoUpdater.autoInstallOnAppQuit;`)).toBe(true);

    // Dismiss with a real click.
    const [x, y] = await page.evaluate<[number, number]>(
      `(() => { const r = document.querySelector('.update-note-close').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`,
    );
    await page.click(x, y);
    await page.waitFor(`!(${noteVisible})`, 2000);

    // A later check finds the same version again: no second message.
    await app!.evaluateMain(`await process.mainModule.require('electron-updater').autoUpdater.checkForUpdates();`);
    await new Promise((r) => setTimeout(r, 1000));
    expect(await page.evaluate<boolean>(noteVisible)).toBe(false);
    expect(await page.evaluate<number>(dotCount)).toBe(1); // dismissing the note keeps the dot

    // Settings: the Updates section on top says "Version 9.9.9 is ready", with Update now and the installed version.
    await openSettings(page);
    expect(await page.evaluate<string>(`document.querySelector('#settings-sections > section h3').textContent`)).toBe('Updates');
    expect(await page.evaluate<string>(updatesLabel)).toBe(`Version ${NEXT} is ready`);
    expect(await page.evaluate<string>(updatesDetail)).toBe(`Installed version ${version}`);
    expect(await page.evaluate<boolean>(`document.getElementById('settings-version') === null`)).toBe(true);
    expect(await page.evaluate<string>(`Object.keys(window.updates).sort().join()`)).toBe('onReady,onState,restart'); // receive-only, plus the one restart message

    // Update now asks first. Later and Escape change nothing.
    await clickOn(page, '#update-now');
    await page.waitFor(confirmOpen, 2000);
    expect(await page.evaluate<string>(`document.getElementById('update-confirm-title').textContent`)).toBe('Restart now?');
    expect(await activeId(page)).toBe('later');
    await clickOn(page, '[data-action="later"]');
    await page.waitFor(`!(${confirmOpen})`, 2000);
    expect(await activeId(page)).toBe('update-now');
    await page.press('Enter');
    await page.waitFor(confirmOpen, 2000);
    await page.press('Escape');
    await page.waitFor(`!(${confirmOpen})`, 2000);
    expect(await page.evaluate<boolean>(`!document.getElementById('settings').hidden`)).toBe(true);
    expect(await restarts()).toEqual([]);
    expect(await page.evaluate<number>(dotCount)).toBe(1);

    // Restart reaches the main process: window state saved first, then a silent install that reopens the app.
    await app!.resize(1111, 777);
    const bounds = await app!.evaluateMain<{ width: number; height: number; x: number; y: number }>(
      `return process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].getNormalBounds();`,
    );
    expect(existsSync(path.join(app!.dataDir, 'window-state.json'))).toBe(false); // nothing saved yet (the app was never closed)
    await clickOn(page, '#update-now');
    await page.waitFor(confirmOpen, 2000);
    await clickOn(page, '[data-action="restart"]');
    for (const deadline = Date.now() + 5000; (await restarts()).length === 0; ) {
      if (Date.now() > deadline) throw new Error('Restart never reached quitAndInstall');
      await new Promise((r) => setTimeout(r, 100));
    }
    const [call] = await restarts();
    expect(call!.args).toEqual([true, true]); // silent, run the app after installing
    expect(call!.state).toEqual({ ...bounds, maximized: false }); // already saved when quitAndInstall was called
    expect(await app!.evaluateMain<string[]>(`return globalThis.__installs;`)).toEqual([]);

    expect(errors).toEqual([]);
  });

  it('ignores "Update now" from the page while no update has been downloaded', async () => {
    const { page, errors } = await launchWithFeed('ok');
    await waitForDashboard(page);
    expect(await page.evaluate<number>(dotCount)).toBe(0);
    // Long before the first check (10 s), so nothing has been downloaded.
    await page.evaluate(`window.updates.restart()`);
    await new Promise((r) => setTimeout(r, 1000));
    expect(await restarts()).toEqual([]);
    expect(await app!.evaluateMain<number>(`return process.mainModule.require('electron').BrowserWindow.getAllWindows().length;`)).toBe(1);
    expect(errors).toEqual([]);
  });

  it('Restart quits by itself: window state saved (maximized too), nothing blocks the quit, and the app starts again', async () => {
    feed = await startFeed('ok');
    cacheDir = await mkdtemp(path.join(tmpdir(), 'wd-update-cache-'));
    app = await launchApp(undefined, { executable: exe, env: { LOCALAPPDATA: cacheDir } });
    await app.evaluateMain(`
      const { autoUpdater } = process.mainModule.require('electron-updater');
      autoUpdater.setFeedURL({ provider: 'generic', url: ${JSON.stringify(feed.url)} });
    `);
    await stubInstaller(app, { quit: true });
    const { page, errors, dataDir } = app;
    await waitForDashboard(page);
    await page.waitFor(noteVisible, FIRST_CHECK_DELAY_MS + 30_000);
    await app.maximize();
    await openSettings(page);
    await clickOn(page, '#update-now');
    await page.waitFor(confirmOpen, 2000);
    expect(errors).toEqual([]);
    await clickOn(page, '[data-action="restart"]');

    // The app exits on its own, cleanly (exit code 0): no close handler, single-instance lock or server holds it.
    expect(await app.waitForExit(15_000)).toBe(0);
    const saved = JSON.parse(readFileSync(path.join(dataDir, 'window-state.json'), 'utf8')) as { maximized: boolean };
    expect(saved.maximized).toBe(true);
    // Saved before quitAndInstall; then the normal quit: before-quit (closes the local server), the window's close, quit.
    const events = readFileSync(path.join(dataDir, 'quit-log.txt'), 'utf8').trim().split(/\r?\n/);
    expect(events).toEqual(['quitAndInstall [true,true] state saved: true', 'before-quit', 'window close', 'will-quit', 'quit']);
    await app.close({ keepData: true });

    // "Reopen": a new instance with the same profile and data starts (the lock was released) and comes back maximized.
    app = await launchApp(undefined, { executable: exe, dataDir, env: { LOCALAPPDATA: cacheDir } });
    await app.evaluateMain(`
      const { autoUpdater } = process.mainModule.require('electron-updater');
      autoUpdater.setFeedURL({ provider: 'generic', url: ${JSON.stringify(feed.url)} });
    `);
    await stubInstaller(app);
    await waitForDashboard(app.page);
    expect(await app.evaluateMain<boolean>(`return process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].isMaximized();`)).toBe(true);
    expect(app.errors).toEqual([]);
  });

  it('shows nothing when the update server fails, and the app keeps working', async () => {
    const { page, errors } = await launchWithFeed('down');
    await waitForDashboard(page);
    for (const deadline = Date.now() + FIRST_CHECK_DELAY_MS + 20_000; !feed!.requests.length; ) {
      if (Date.now() > deadline) throw new Error('the app never checked the feed');
      await new Promise((r) => setTimeout(r, 250));
    }
    await new Promise((r) => setTimeout(r, 2000));
    expect(await page.evaluate<boolean>(noteVisible)).toBe(false);
    expect(await page.evaluate<boolean>(`document.getElementById('banner').hidden`)).toBe(true);
    expect(await page.evaluate<number>(`document.querySelectorAll('.forecast .day').length`)).toBe(7);
    // No dot, no button, and "Update now" from the page does nothing.
    expect(await page.evaluate<boolean>(noSignals)).toBe(true);
    expect(await page.evaluate<boolean>(`document.getElementById('settings-version') === null`)).toBe(true);
    await page.evaluate(`window.updates.restart()`);
    await new Promise((r) => setTimeout(r, 1000));
    expect(await restarts()).toEqual([]);
    // The Updates section: the installed app's own version and a neutral line, never "Up to date".
    const appVersion = await app!.evaluateMain<string>(`return process.mainModule.require('electron').app.getVersion();`);
    expect(appVersion).toBe(version);
    await openSettings(page);
    expect(await page.evaluate<string>(updatesLabel)).toBe(`Version ${appVersion}`);
    expect(await page.evaluate<string>(updatesDetail)).toBe("Couldn't check for updates");
    expect(await page.evaluate<boolean>(updateButton)).toBe(false);
    expect(await page.evaluate<boolean>(`!/Up to date/.test(document.getElementById('settings-updates').textContent)`)).toBe(true);

    // The feed comes back: the next check clears the failure, and now it is a real "up to date".
    feed!.mode = 'same';
    await app!.evaluateMain(`await process.mainModule.require('electron-updater').autoUpdater.checkForUpdates();`);
    await page.waitFor(`/Up to date/.test(${updatesLabel})`, 5000);
    expect(await page.evaluate<string>(updatesLabel)).toMatch(upToDate);
    expect(await page.evaluate<string | null>(updatesDetail)).toBeNull();
    expect(errors).toEqual([]);
  });

  it('before the first check only the version shows; after a check that finds nothing newer it says "Up to date" and when', async () => {
    const { page, errors } = await launchWithFeed('same');
    await waitForDashboard(page);
    // Long before the first check (10 s): nothing has been asked, so nothing is claimed.
    expect(feed!.requests).toEqual([]);
    await openSettings(page);
    expect(await page.evaluate<string>(updatesLabel)).toBe(`Version ${version}`);
    expect(await page.evaluate<string | null>(updatesDetail)).toBeNull();
    expect(await page.evaluate<boolean>(updateButton)).toBe(false);
    expect(await page.evaluate<boolean>(noSignals)).toBe(true);

    await page.waitFor(`/Up to date/.test(${updatesLabel})`, FIRST_CHECK_DELAY_MS + 30_000);
    expect(feed!.requests).toContain('latest.yml');
    expect(feed!.requests).not.toContain(INSTALLER); // nothing newer, nothing downloaded
    const shown = await page.evaluate<string>(updatesLabel);
    expect(shown).toMatch(upToDate);
    expect(await page.evaluate<boolean>(updateButton)).toBe(false);
    expect(await page.evaluate<boolean>(noSignals)).toBe(true);

    // "checked" is the PC's time, within a minute or two of now.
    const [, hh, mm, ap] = /checked (\d{1,2}):(\d{2}) (AM|PM)$/.exec(shown)!;
    const now = new Date();
    const minutes = ((Number(hh) % 12) + (ap === 'PM' ? 12 : 0)) * 60 + Number(mm);
    const diff = Math.abs(minutes - (now.getHours() * 60 + now.getMinutes()));
    expect(Math.min(diff, 1440 - diff)).toBeLessThanOrEqual(2);

    // It follows the 24-hour setting.
    await clickOn(page, '#settings-time-format [data-value="24h"]');
    await page.waitFor(`/checked \\d{2}:\\d{2}$/.test(${updatesLabel})`, 3000);
    expect(await page.evaluate<string>(updatesLabel)).toMatch(new RegExp(`^Version ${version.replaceAll('.', '\\.')} · Up to date · checked \\d{2}:\\d{2}$`));
    expect(errors).toEqual([]);
  });
});

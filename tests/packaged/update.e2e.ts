// Auto-update, end to end, in the PACKAGED app (release/win-unpacked): the updater
// only runs when app.isPackaged. GitHub is never contacted: right after launch the
// test points the app's own autoUpdater (through the main-process inspector) at a
// throwaway local feed, then lets the app's 10 s scheduler do the real check,
// download and "ready" message. LOCALAPPDATA is a temp folder, so the download never
// lands in the real updater cache, and the app is killed at the end, so nothing installs.
// Run with: npm run test:update (rebuilds the installer first)

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { launchApp, waitForDashboard, type LaunchedApp } from '../../scripts/launch';
import { checkReleaseFiles } from '../../scripts/release-files';
import { FIRST_CHECK_DELAY_MS } from '../../src/main/autoUpdate';
import { updateMessage } from '../../src/renderer/components/updateNote';

const root = path.join(__dirname, '..', '..');
const release = path.join(root, 'release');
const exe = path.join(release, 'win-unpacked', 'Weather Dashboard.exe');
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };

const NEXT = '9.9.9';
const INSTALLER = `Weather-Dashboard-Setup-${NEXT}.exe`;

/** A fake update feed: latest.yml for version 9.9.9 and a small fake installer (or a 503 for everything). */
async function startFeed(mode: 'ok' | 'down') {
  const body = randomBytes(64 * 1024);
  const sha512 = createHash('sha512').update(body).digest('base64');
  const yml = [
    `version: ${NEXT}`,
    'files:',
    `  - url: ${INSTALLER}`,
    `    sha512: ${sha512}`,
    `    size: ${body.length}`,
    `path: ${INSTALLER}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    '',
  ].join('\n');
  const requests: string[] = [];
  const server: Server = createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname.slice(1));
    requests.push(name);
    if (mode === 'down') return void res.writeHead(503).end('Service Unavailable');
    if (name === 'latest.yml') return void res.writeHead(200, { 'Content-Type': 'text/yaml' }).end(yml);
    if (name === INSTALLER) return void res.writeHead(200, { 'Content-Length': body.length }).end(body);
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, requests, close: () => new Promise((r) => server.close(r)) };
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
async function launchWithFeed(mode: 'ok' | 'down') {
  feed = await startFeed(mode);
  cacheDir = await mkdtemp(path.join(tmpdir(), 'wd-update-cache-'));
  const started = Date.now();
  app = await launchApp(undefined, { executable: exe, env: { LOCALAPPDATA: cacheDir } });
  await app.evaluateMain(`
    const { autoUpdater } = process.mainModule.require('electron-updater');
    autoUpdater.setFeedURL({ provider: 'generic', url: ${JSON.stringify(feed.url)} });
  `);
  // The feed must be set before the app's own first check, or this test would talk to GitHub.
  expect(Date.now() - started).toBeLessThan(FIRST_CHECK_DELAY_MS);
  return app;
}

const noteVisible = `!document.getElementById('update-note').hidden`;

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
    const { page, errors } = await launchWithFeed('ok');
    await waitForDashboard(page);

    await page.waitFor(noteVisible, FIRST_CHECK_DELAY_MS + 30_000);
    expect(feed!.requests).toContain('latest.yml');
    expect(feed!.requests).toContain(INSTALLER);
    const pending = await readdir(path.join(cacheDir!, 'weather-dashboard-updater', 'pending'));
    expect(pending).toContain(INSTALLER);

    expect(await page.evaluate<string>(`document.getElementById('update-note').textContent`)).toBe(updateMessage(NEXT));
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

    expect(errors).toEqual([]);
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
    // The version in Settings is the installed app's own version.
    const appVersion = await app!.evaluateMain<string>(`return process.mainModule.require('electron').app.getVersion();`);
    expect(appVersion).toBe(version);
    expect(await page.evaluate<string>(`document.getElementById('settings-version').textContent`)).toBe(`Version ${appVersion}`);
    expect(errors).toEqual([]);
  });
});

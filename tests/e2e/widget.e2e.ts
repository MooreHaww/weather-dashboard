// v2.0 Desktop widget in the real app (dev build), driven from the main process and the pages (no real mouse or keyboard):
// it appears and goes with the setting, its sizes and Keep on top, its saved and recovered position, the wallpaper and
// live backgrounds and their fallbacks, content protection only in Live, that the live frames never contain the widget,
// and that it never keeps the app alive (Exit, Windows ending the session, the tray's Quit, all with the widget open).
//
// The app runs with fakeOs.cjs and fakeDesktop.cjs (NODE_OPTIONS): the wallpaper registry values, the wallpaper file (a
// made-up picture, tests/fixtures/wallpaper.png) and the screen capture are fakes, so this PC's wallpaper is never read
// and the screen is captured only by the one test that needs it. "Your location" stays off. Open-Meteo is live.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { launchApp, waitForDashboard, type LaunchedApp, type Seed } from '../../scripts/launch';
import { removeBackdrop, showBackdrop } from '../../scripts/screen';

const support = (f: string) => path.join(__dirname, 'support', f).replace(/\\/g, '/');
const ENV = { NODE_OPTIONS: `--require ${support('fakeOs.cjs')} --require ${support('fakeDesktop.cjs')}` };
const london = { id: 2643743, name: 'London', latitude: 51.50853, longitude: -0.12574, admin1: 'England', country: 'United Kingdom', countryCode: 'GB', timezone: 'Europe/London' };

let app: LaunchedApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(check: () => Promise<boolean>, timeoutMs = 15_000, what = 'condition') {
  for (const deadline = Date.now() + timeoutMs; ; await sleep(150)) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
  }
}

// Main-process helpers. W() is the widget window, D() the dashboard window.
const MAIN = `const { app: electronApp, BrowserWindow, desktopCapturer, screen } = process.mainModule.require('electron');
  const isWidget = (w) => w.webContents.getURL().includes('/widget.html');
  const W = () => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && isWidget(w));
  const D = () => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !isWidget(w) && !w.__backdrop);`;

async function start(seed: Seed, opts: { dataDir?: string } = {}) {
  app = await launchApp(seed, { env: ENV, ...opts });
  // Every page's console errors (uncaught exceptions included), the widget's too.
  await app.evaluateMain(`${MAIN}
    globalThis.__pageErrors = [];
    for (const w of BrowserWindow.getAllWindows()) w.webContents.on('console-message', (e) => { if (e.level === 'error') globalThis.__pageErrors.push(e.message); });
    electronApp.on('web-contents-created', (_e, wc) => wc.on('console-message', (e) => { if (e.level === 'error') globalThis.__pageErrors.push(e.message); }));
    return true;`);
  return app;
}

const widget = (a: LaunchedApp) =>
  a.evaluateMain<{ exists: boolean; visible?: boolean; bounds?: { x: number; y: number; width: number; height: number }; onTop?: boolean; focused?: boolean; resizable?: boolean; protected?: boolean; loaded?: boolean }>(
    `${MAIN} const w = W(); if (!w) return { exists: false };
     return { exists: true, visible: w.isVisible(), bounds: w.getBounds(), onTop: w.isAlwaysOnTop(), focused: w.isFocused(), resizable: w.isResizable(),
              protected: typeof w.isContentProtected === 'function' ? w.isContentProtected() : undefined, loaded: !w.webContents.isLoading() };`,
  );
/** Run JavaScript in the widget's page. */
const inWidget = <T>(a: LaunchedApp, js: string) => a.evaluateMain<T>(`${MAIN} return await W().webContents.executeJavaScript(${JSON.stringify(js)});`);
const patch = (a: LaunchedApp, body: Record<string, unknown>) =>
  a.page.evaluate(`fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.status)`);
const desk = (a: LaunchedApp, js: string) => a.evaluateMain(`const d = globalThis.__desk; ${js}; return true;`);
const pageErrors = (a: LaunchedApp) => a.evaluateMain<string[]>(`return globalThis.__pageErrors;`);
const backdropShown = (a: LaunchedApp) => inWidget<boolean>(a, `document.getElementById('backdrop').classList.contains('is-shown')`);
/** The middle pixel of the backdrop canvas (before the CSS blur). */
const backdropPixel = (a: LaunchedApp) =>
  inWidget<number[]>(a, `(() => { const c = document.getElementById('backdrop'); const d = c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data; return [d[0], d[1], d[2], c.width, c.height]; })()`);

describe('the widget window', () => {
  it('appears with the setting (Small, not on top, not focused, not resizable), changes size and Keep on top, and goes away', async () => {
    const a = await start({ lastPlace: london });
    await waitForDashboard(a.page);
    expect((await widget(a)).exists).toBe(false);
    expect(await patch(a, { widget: true })).toBe(200);
    await waitUntil(async () => Boolean((await widget(a)).visible), 15_000, 'the widget');
    const w = await widget(a);
    expect(w.bounds).toMatchObject({ width: 170, height: 170 });
    expect(w).toMatchObject({ onTop: false, focused: false, resizable: false, protected: false });
    // Top right of the primary display's work area.
    const area = await a.evaluateMain<{ x: number; y: number; width: number }>(`${MAIN} return screen.getPrimaryDisplay().workArea;`);
    expect(w.bounds).toMatchObject({ x: area.x + area.width - 170 - 16, y: area.y + 16 });
    // The tray's city and its weather (London is the last city; no favorites, location off).
    await waitUntil(async () => (await inWidget<string>(a, `document.querySelector('.place')?.textContent ?? ''`)) === 'London', 30_000, 'the widget weather');
    expect(await inWidget<string>(a, `document.querySelector('.temp')?.textContent ?? ''`)).toMatch(/^-?\d+°[CF]$/);

    expect(await patch(a, { widgetSize: 'medium', widgetOnTop: true })).toBe(200);
    await waitUntil(async () => (await widget(a)).bounds?.width === 360, 5000, 'Medium');
    expect((await widget(a)).bounds).toMatchObject({ width: 360, height: 170 });
    expect((await widget(a)).onTop).toBe(true);
    await waitUntil(async () => (await inWidget<number>(a, `document.querySelectorAll('.hour').length`)) === 4, 10_000, 'four hours');

    expect(await patch(a, { widget: false })).toBe(200);
    await waitUntil(async () => !(await widget(a)).exists, 5000, 'the widget to go');
    expect(await pageErrors(a)).toEqual([]);
    expect(a.errors).toEqual([]);
  });

  it('keeps its position in widget-state.json and recovers a spot that is no longer on any screen', async () => {
    const a = await start({ lastPlace: london, settings: { widget: true } });
    await waitForDashboard(a.page);
    await waitUntil(async () => Boolean((await widget(a)).visible), 15_000, 'the widget');
    await a.evaluateMain(`${MAIN} const w = W(); w.setPosition(200, 150); w.emit('moved'); return true;`);
    const file = path.join(a.dataDir, 'widget-state.json');
    await waitUntil(async () => (await readFile(file, 'utf8').catch(() => '')).includes('200'), 5000, 'the saved position');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ x: 200, y: 150 });
    const dataDir = a.dataDir;
    await a.close({ keepData: true });
    app = undefined;

    const b = await start({ lastPlace: london, settings: { widget: true } }, { dataDir });
    await waitUntil(async () => Boolean((await widget(b)).visible), 15_000, 'the widget again');
    expect((await widget(b)).bounds).toMatchObject({ x: 200, y: 150 });
    await b.close({ keepData: true });
    app = undefined;

    await writeFile(file, JSON.stringify({ x: 99_999, y: 99_999 }), 'utf8'); // a monitor that is gone
    const c = await start({ lastPlace: london, settings: { widget: true } }, { dataDir });
    await waitUntil(async () => Boolean((await widget(c)).visible), 15_000, 'the widget a third time');
    const area = await c.evaluateMain<{ x: number; y: number; width: number }>(`${MAIN} return screen.getPrimaryDisplay().workArea;`);
    expect((await widget(c)).bounds).toMatchObject({ x: area.x + area.width - 170 - 16, y: area.y + 16 });
  });
});

describe('Settings > Widget', () => {
  it('has its five rows in order, the last four disabled while the widget is off; the switch turns it on and off', async () => {
    const a = await start({ lastPlace: london });
    await waitForDashboard(a.page);
    await a.page.evaluate(`document.getElementById('settings-button').click()`);
    await a.page.waitFor(`document.getElementById('settings').classList.contains('is-open')`, 5000);
    const rows = () =>
      a.page.evaluate<{ label: string; disabled: boolean[] }[]>(`[...document.querySelectorAll('#settings-widget .settings-row')].map((r) => ({
        label: r.querySelector('.settings-row-label').textContent.trim(),
        disabled: [...r.querySelectorAll('.settings-row-control > button:not(.info-button), .segmented button')].map((b) => b.disabled),
      }))`);
    const before = await rows();
    expect(before.map((r) => r.label)).toEqual(['Widget', 'Size', 'Keep on top', 'Background', 'Weather effects']);
    expect(before[0]!.disabled.every((d) => !d)).toBe(true);
    expect(before.slice(1).every((r) => r.disabled.length > 0 && r.disabled.every(Boolean))).toBe(true);
    expect(await a.page.evaluate<number>(`document.querySelectorAll('#settings-widget .info-button').length`)).toBe(2); // Background and Weather effects

    await a.page.evaluate(`document.getElementById('settings-widget-on').click()`);
    await waitUntil(async () => Boolean((await widget(a)).visible), 15_000, 'the widget');
    expect((await rows()).every((r) => r.disabled.every((d) => !d))).toBe(true);
    await a.page.evaluate(`document.querySelector('#settings-widget [data-value="medium"]').click()`);
    await waitUntil(async () => (await widget(a)).bounds?.width === 360, 5000, 'Medium');

    await a.page.evaluate(`document.getElementById('settings-widget-on').click()`);
    await waitUntil(async () => !(await widget(a)).exists, 5000, 'the widget to go');
    expect(await pageErrors(a)).toEqual([]);
    expect(a.errors).toEqual([]);
  });
});

describe('the widget background', () => {
  it('Wallpaper: shows the (fake) wallpaper under the widget; a slideshow falls back to the plain card', async () => {
    const a = await start({ lastPlace: london, settings: { widget: true } });
    await waitForDashboard(a.page);
    await waitUntil(async () => Boolean((await widget(a)).loaded), 15_000, 'the widget page');
    await waitUntil(() => backdropShown(a), 10_000, 'the wallpaper');
    const [r, g, b, width, height] = await backdropPixel(a);
    expect([width, height]).toEqual([85, 85]);
    expect(r! + g! + b!).toBeGreaterThan(60); // the fixture's sky, not black
    expect((await widget(a)).protected).toBe(false);

    // A slideshow: the picture under the widget can't be known, so the plain card.
    await desk(a, `d.reg['HKCU\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Explorer\\\\Wallpapers'].BackgroundType = '0x2'`);
    await a.evaluateMain(`${MAIN} const w = W(); w.emit('moved'); return true;`); // re-reads after a move
    await waitUntil(async () => !(await backdropShown(a)), 10_000, 'the plain card');
    expect(await pageErrors(a)).toEqual([]);
  });

  it('Live: draws the captured frames, protects the widget from capture only while Live is on, stops while hidden, and drops black frames', async () => {
    const a = await start({ lastPlace: london, settings: { widget: true } });
    await waitForDashboard(a.page);
    await waitUntil(async () => Boolean((await widget(a)).loaded), 15_000, 'the widget page');
    expect(await patch(a, { widgetBackground: 'live' })).toBe(200);
    await waitUntil(async () => (await widget(a)).protected === true, 5000, 'content protection');
    await waitUntil(async () => (await backdropPixel(a))[1]! > 140, 10_000, 'a live frame'); // the fake capture's green
    const [r, g, b] = await backdropPixel(a);
    expect([r, g, b]).toEqual([40, 160, 90]);

    // Hidden: no more captures.
    await a.evaluateMain(`${MAIN} W().hide(); return true;`);
    await sleep(500);
    const before = await a.evaluateMain<number>(`return globalThis.__desk.captureCalls;`);
    await sleep(3500);
    expect(await a.evaluateMain<number>(`return globalThis.__desk.captureCalls;`)).toBe(before);
    await a.evaluateMain(`${MAIN} W().showInactive(); return true;`);

    // A black frame (some HDR and GPU setups): the plain card.
    await desk(a, `d.capture.color = [0, 0, 0]`);
    await waitUntil(async () => !(await backdropShown(a)), 10_000, 'the plain card');

    expect(await patch(a, { widgetBackground: 'wallpaper' })).toBe(200);
    await waitUntil(async () => (await widget(a)).protected === false, 5000, 'protection off');
    expect(await pageErrors(a)).toEqual([]);
  });

  it('the live frames never contain the widget itself (a real capture over a grey backdrop, the widget painted magenta)', async () => {
    const a = await start({ lastPlace: london, settings: { widget: true, widgetOnTop: true } });
    await waitForDashboard(a.page);
    await waitUntil(async () => Boolean((await widget(a)).loaded), 15_000, 'the widget page');
    await desk(a, `d.capture.mode = 'real'`);
    await showBackdrop(a, 'grey');
    await a.evaluateMain(`${MAIN} W().setAlwaysOnTop(true, 'screen-saver'); W().moveTop(); return true;`);
    await inWidget(a, `(() => { const s = document.createElement('style'); s.textContent = '.card { background: #ff00ff !important } .backdrop, .effects, .tint, .content { display: none !important }'; document.head.append(s); return true; })()`);
    await sleep(600);
    /** Share of magenta pixels inside the widget's rectangle in a full-resolution capture of its display. */
    const magenta = () =>
      a.evaluateMain<number>(`${MAIN}
        const w = W(); const r = w.getBounds(); const d = screen.getDisplayMatching(r); const k = d.scaleFactor;
        const [source] = (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: d.bounds.width * k, height: d.bounds.height * k } }))
          .filter((s) => s.display_id === String(d.id));
        const img = source.thumbnail.crop({ x: Math.round((r.x - d.bounds.x + 12) * k), y: Math.round((r.y - d.bounds.y + 12) * k), width: Math.round((r.width - 24) * k), height: Math.round((r.height - 24) * k) });
        const px = img.toBitmap(); let n = 0;
        for (let i = 0; i < px.length; i += 4) if (px[i] > 200 && px[i + 1] < 60 && px[i + 2] > 200) n++;
        return n / (px.length / 4);`);
    // Control: without protection a capture does see the magenta widget (so the check can fail).
    expect(await magenta()).toBeGreaterThan(0.9);
    expect(await patch(a, { widgetBackground: 'live' })).toBe(200);
    await waitUntil(async () => (await widget(a)).protected === true, 5000, 'content protection');
    await sleep(600);
    expect(await magenta()).toBe(0);
    await removeBackdrop(a);
  });
});

describe('the widget never keeps the app alive', () => {
  const open = async (seed: Seed) => {
    const a = await start({ lastPlace: london, ...seed, settings: { widget: true, ...seed.settings } });
    await waitForDashboard(a.page);
    await waitUntil(async () => Boolean((await widget(a)).visible), 15_000, 'the widget');
    return a;
  };

  it('"Exit" quits with the widget open', async () => {
    const a = await open({ settings: { closeBehavior: 'exit' } });
    await a.evaluateMain(`${MAIN} setTimeout(() => D().close(), 20); return true;`);
    expect(await a.waitForExit(15_000)).toBe(0);
    app = undefined;
  });

  it('Windows ending the session quits with the widget open and "Keep running" set', async () => {
    const a = await open({ settings: { closeBehavior: 'background' } });
    await a.evaluateMain(
      `${MAIN} const w = D(); w.emit('query-session-end', { preventDefault() {}, reasons: ['shutdown'] }); w.emit('session-end', { reasons: ['shutdown'] });
       setTimeout(() => w.close(), 20); return true;`,
    );
    expect(await a.waitForExit(15_000)).toBe(0);
    app = undefined;
  });

  it('the tray\'s Quit quits with the widget open and the window hidden in the tray', async () => {
    const a = await open({ settings: { closeBehavior: 'background' } });
    await a.evaluateMain(`${MAIN} setTimeout(() => D().close(), 20); return true;`);
    await waitUntil(async () => !(await a.evaluateMain<boolean>(`${MAIN} return D().isVisible();`)), 5000, 'the window to hide');
    expect((await widget(a)).visible).toBe(true); // the widget stays while the window is in the tray
    const TRAY = `process.mainModule.require(process.mainModule.require('path').join(process.mainModule.require('electron').app.getAppPath(), 'dist', 'main', 'tray.js'))`;
    await a.evaluateMain(`const menu = ${TRAY}.trayMenu(); const quit = menu.items.find((i) => i.label === 'Quit'); setTimeout(() => quit.click(), 20); return true;`);
    expect(await a.waitForExit(15_000)).toBe(0);
    app = undefined;
  });
});

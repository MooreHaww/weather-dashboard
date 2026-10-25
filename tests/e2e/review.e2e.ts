// v1.4.5: the review fixes and the small quality-of-life items, in the real app.
// - A failed city switch never puts the new city's name over the old city's weather.
// - Clear recent: clears, saves, and keeps keyboard focus somewhere useful.
// - F5 / Ctrl+R refresh the current city (Ctrl+K still opens search).
// - The offline note next to "Updated ... ago".
// - The app version (now in the Settings Updates section, v1.4.7).
// - The window's size and position come back after a restart (and an off-screen one is fixed).
// - v1.4.7: a server error on remove favorite / Clear recent shows the banner instead of failing silently.
// Run with: npm run test:e2e

import { readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchApp, waitForDashboard, type AppPage, type LaunchedApp } from '../../scripts/launch';

const tokyo = { id: 1850147, name: 'Tokyo', latitude: 35.6895, longitude: 139.69171, admin1: 'Tokyo', country: 'Japan', countryCode: 'JP' };
const london = { id: 2643743, name: 'London', latitude: 51.50853, longitude: -0.12574, admin1: 'England', country: 'United Kingdom', countryCode: 'GB' };
const paris = { id: 2988507, name: 'Paris', latitude: 48.85341, longitude: 2.3488, admin1: 'Île-de-France', country: 'France', countryCode: 'FR' };

const { version } = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')) as { version: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs before the app's scripts on every load:
 *  - holds the 5-minute refresh in window.__timers so a test fires it on demand;
 *  - counts weather requests (window.__w) and can fail them: all requests for one
 *    latitude (window.__failLat), or every fresh=1 request (window.__failFresh), with the
 *    server's real 502 answer; or relabel answers as the server's saved copy (window.__stale).
 */
const INIT_SCRIPT = `(() => {
  window.__timers = {};
  const realSetInterval = window.setInterval.bind(window);
  window.setInterval = (fn, ms, ...rest) => {
    if (ms === 300000) { window.__timers[ms] = fn; return 0; }
    return realSetInterval(fn, ms, ...rest);
  };
  window.__w = { total: 0, fresh: 0 };
  window.__failLat = null;
  window.__failFresh = false;
  window.__stale = false;
  const realFetch = window.fetch.bind(window);
  const fail = () => new Response(JSON.stringify({ error: 'The weather service is unavailable right now. Please try again shortly.' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (input, init) => {
    const url = String(input);
    if (!url.includes('/api/weather')) return realFetch(input, init);
    window.__w.total++;
    if (url.includes('fresh=1')) window.__w.fresh++;
    if (window.__failLat && url.includes('lat=' + window.__failLat)) return fail();
    if (window.__failFresh && url.includes('fresh=1')) return fail();
    const res = await realFetch(input, init);
    if (!window.__stale || !res.ok) return res;
    const body = await res.json();
    body.meta.cache = 'STALE';
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
})()`;

async function start(seed: Parameters<typeof launchApp>[0]): Promise<LaunchedApp> {
  const app = await launchApp(seed);
  await app.page.reloadWithScript(INIT_SCRIPT);
  await waitForDashboard(app.page);
  return app;
}

const textOf = (page: AppPage, selector: string) =>
  page.evaluate<string>(`document.querySelector(${JSON.stringify(selector)})?.textContent.trim() ?? ''`);
const storedState = (page: AppPage) =>
  page.evaluate<{ favorites: { name: string }[]; recent: { name: string }[] }>(`fetch('/api/state').then((r) => r.json())`);

describe('a city that fails to load', () => {
  let app: LaunchedApp;
  let page: AppPage;
  beforeAll(async () => {
    app = await start({ lastPlace: london, favorites: [], recent: [tokyo], settings: { units: 'metric', timeFormat: '12h' } });
    page = app.page;
  });
  afterAll(() => app?.close());

  it('keeps the shown city, its clock and its card together after any redraw', async () => {
    expect(await textOf(page, '.place-name')).toBe('London');
    await page.evaluate(`window.__failLat = '35.6895'`);
    await page.evaluate(`document.querySelector('#recent .place-card[data-id="${tokyo.id}"]').click()`);
    await page.waitFor(`!document.getElementById('banner').hidden`, 10_000);

    // Redraw from the weather already loaded: switch to the 24-hour clock in Settings.
    await page.evaluate(`document.getElementById('settings-button').click()`);
    await page.waitFor(`document.getElementById('settings').classList.contains('is-open')`, 2000);
    await page.evaluate(`document.querySelector('#settings-time-format button[data-value="24h"]').click()`);
    await page.evaluate(`document.querySelector('.settings-close').click()`);
    await sleep(500);

    expect(await textOf(page, '.place-name')).toBe('London');
    expect(await textOf(page, '.clock-tz')).toContain('Europe/London');
    expect(await page.evaluate<string>(`document.querySelector('.place-card.is-active')?.dataset.id ?? ''`)).not.toBe(String(tokyo.id));
  });

  it('the star saves the city that is shown', async () => {
    await page.evaluate(`document.getElementById('star').click()`);
    await page.waitFor(`document.querySelectorAll('#favorites .place-card').length === 1`, 5000);
    expect((await storedState(page)).favorites.map((f) => f.name)).toEqual(['London']);
  });

  it('Retry still loads the city that failed, once it can', async () => {
    await page.evaluate(`window.__failLat = null; document.getElementById('retry').click()`);
    await page.waitFor(`document.querySelector('.place-name').textContent === 'Tokyo'`, 15_000);
    expect(await textOf(page, '.clock-tz')).toContain('Asia/Tokyo');
    expect(await page.evaluate<boolean>(`document.getElementById('banner').hidden`)).toBe(true);
  });

  it('threw no page exceptions', () => {
    expect(app.errors).toEqual([]);
  });
});

describe('keys, clear recent, offline note and version', () => {
  let app: LaunchedApp;
  let page: AppPage;
  beforeAll(async () => {
    app = await start({ lastPlace: tokyo, favorites: [tokyo], recent: [paris, london], settings: { units: 'metric' } });
    page = app.page;
    await page.evaluate(`window.__alive = true`); // gone if the page ever reloads
  });
  afterAll(() => app?.close());

  const fresh = () => page.evaluate<number>(`window.__w.fresh`);
  const settled = () => page.waitFor(`!document.getElementById('main').classList.contains('is-loading')`, 15_000);

  /** Fresh weather requests caused by `action`, counted once things have gone quiet. */
  async function freshRequestsAfter(action: () => Promise<unknown>): Promise<number> {
    const before = await fresh();
    await action();
    await page.waitFor(`window.__w.fresh > ${before}`, 5000);
    await settled();
    for (let last = -1, now = await fresh(); now !== last; await sleep(800)) [last, now] = [now, await fresh()];
    return (await fresh()) - before;
  }
  let byButton = 0;

  it('F5 refreshes like the Refresh button, without reloading the page', async () => {
    byButton = await freshRequestsAfter(() => page.evaluate(`document.getElementById('refresh').click()`));
    expect(byButton).toBeGreaterThanOrEqual(1);
    await page.evaluate(`document.body.focus()`);
    expect(await freshRequestsAfter(() => page.press('F5'))).toBe(byButton);
    expect(await page.evaluate<boolean>(`window.__alive === true`)).toBe(true);
    expect(await textOf(page, '.place-name')).toBe('Tokyo');
  });

  it('Ctrl+R does the same', async () => {
    expect(await freshRequestsAfter(() => page.press('r', { ctrl: true }))).toBe(byButton);
    expect(await page.evaluate<boolean>(`window.__alive === true`)).toBe(true);
  });

  it('Ctrl+K still opens the search box', async () => {
    await page.evaluate(`document.body.focus()`);
    await page.press('k', { ctrl: true });
    expect(await page.evaluate<string>(`document.activeElement.id`)).toBe('search-input');
    await page.press('Escape');
    await page.evaluate(`document.activeElement.blur()`);
  });

  it('"Clear" empties Recent, saves it, and moves focus to the search box', async () => {
    expect(await page.evaluate<number>(`document.querySelectorAll('#recent .place-card').length`)).toBeGreaterThan(0);
    const button = `document.getElementById('clear-recent')`;
    expect(await page.evaluate<string>(`${button}.getAttribute('aria-label')`)).toBe('Clear recent cities');
    await page.evaluate(`${button}.focus()`);
    await page.press('Enter');
    await page.waitFor(`document.querySelectorAll('#recent .place-card').length === 0`, 5000);
    expect(await page.evaluate<boolean>(`${button}.hidden`)).toBe(true);
    expect(await page.evaluate<boolean>(`document.getElementById('recent-empty').hidden`)).toBe(false);
    expect((await storedState(page)).recent).toEqual([]);
    expect((await storedState(page)).favorites.map((f) => f.name)).toEqual(['Tokyo']); // favorites untouched
    expect(await page.evaluate<string>(`document.activeElement.id`)).toBe('search-input');
    expect(await page.evaluate<boolean>(`document.getElementById('search-results').hidden`)).toBe(true);
    await page.evaluate(`document.activeElement.blur()`);
  });

  const noteShown = `!document.getElementById('offline-note').hidden`;

  it('offline note: shown next to "Updated" while saved data is on screen', async () => {
    expect(await page.evaluate<boolean>(noteShown)).toBe(false);
    await page.evaluate(`window.__stale = true; document.getElementById('refresh').click()`);
    await page.waitFor(noteShown, 10_000);
    expect(await textOf(page, '#offline-note')).toBe('Weather service unreachable, showing saved data');
    expect(await page.evaluate<boolean>(`document.querySelector('.updated').contains(document.getElementById('offline-note'))`)).toBe(true);
    // At the narrowest window it wraps inside the footer instead of widening the page.
    await app.resize(480, 800);
    expect(
      await page.evaluate<boolean>(`(() => {
        const m = document.getElementById('main').getBoundingClientRect(), n = document.getElementById('offline-note').getBoundingClientRect();
        return document.documentElement.scrollWidth <= innerWidth + 1 && n.left >= m.left - 1 && n.right <= m.right + 1;
      })()`),
    ).toBe(true);
    await app.resize(1360, 900);
  });

  it('offline note: gone as soon as fresh data arrives', async () => {
    await page.evaluate(`window.__stale = false; document.getElementById('refresh').click()`);
    await page.waitFor(`!(${noteShown})`, 10_000);
    await settled();
  });

  it('offline note: a failed background refresh shows it and keeps the old data; the next good one removes it', async () => {
    const hourly = await page.evaluate<string>(`document.getElementById('temp-data').dataset.values`);
    await page.evaluate(`window.__failFresh = true; window.__timers[300000]()`);
    await page.waitFor(noteShown, 10_000);
    expect(await page.evaluate<string>(`document.getElementById('temp-data').dataset.values`)).toBe(hourly);
    expect(await page.evaluate<boolean>(`document.getElementById('banner').hidden`)).toBe(true); // still silent
    await page.evaluate(`window.__failFresh = false; window.__timers[300000]()`);
    await page.waitFor(`!(${noteShown})`, 10_000);
  });

  it('Settings shows the app version in the Updates section at the top (this build is unpackaged, so just the version)', async () => {
    await page.evaluate(`document.getElementById('settings-button').click()`);
    await page.waitFor(`document.getElementById('settings').classList.contains('is-open')`, 2000);
    expect(await textOf(page, '#settings-updates .settings-row-label')).toBe(`Version ${version}`);
    expect(await page.evaluate<string>(`document.getElementById('settings-sections').firstElementChild.id`)).toBe('settings-updates');
    expect(await page.evaluate<boolean>(`document.getElementById('settings-version') === null`)).toBe(true);
    await page.press('Escape');
  });

  it('threw no page exceptions', () => {
    expect(app.errors).toEqual([]);
  });
});

describe('window size and position', () => {
  const bounds = (app: LaunchedApp) =>
    app.evaluateMain<{ x: number; y: number; width: number; height: number }>(
      `const { BrowserWindow } = process.mainModule.require('electron'); return BrowserWindow.getAllWindows()[0].getBounds();`,
    );
  /** A normal close (the window's close button), not a kill. */
  async function closeNormally(app: LaunchedApp) {
    await app.evaluateMain(`const { BrowserWindow } = process.mainModule.require('electron'); setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 50); return true;`);
    await sleep(2000);
    await app.close({ keepData: true });
  }

  it('come back after a restart', async () => {
    const first = await launchApp({ lastPlace: london });
    await waitForDashboard(first.page);
    await first.evaluateMain(`const { BrowserWindow } = process.mainModule.require('electron'); BrowserWindow.getAllWindows()[0].setBounds({ x: 120, y: 90, width: 1010, height: 710 }); return true;`);
    await sleep(300);
    const set = await bounds(first);
    await closeNormally(first);

    const second = await launchApp(undefined, { dataDir: first.dataDir });
    try {
      await waitForDashboard(second.page);
      expect(await bounds(second)).toEqual(set);
      expect(second.errors).toEqual([]);
    } finally {
      await second.close();
    }
  });

  it('a position that is off every screen (a monitor was unplugged) opens on screen, same size', async () => {
    const first = await launchApp({ lastPlace: london });
    await first.close({ keepData: true });
    await writeFile(path.join(first.dataDir, 'window-state.json'), JSON.stringify({ x: -30000, y: -30000, width: 1000, height: 700, maximized: false }));
    const app = await launchApp(undefined, { dataDir: first.dataDir });
    try {
      await waitForDashboard(app.page);
      const b = await bounds(app);
      expect([b.width, b.height]).toEqual([1000, 700]);
      const onScreen = await app.evaluateMain<boolean>(
        `const { screen, BrowserWindow } = process.mainModule.require('electron'); const b = BrowserWindow.getAllWindows()[0].getBounds();
         return screen.getAllDisplays().some(({ workArea: a }) => b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + 52 > a.y);`,
      );
      expect(onScreen).toBe(true);
    } finally {
      await app.close();
    }
  });
});

describe('when the server cannot save (remove favorite, Clear recent)', () => {
  it('shows the neutral banner, keeps the lists, throws no page exception, and the app keeps working', async () => {
    const app = await launchApp({ lastPlace: tokyo, favorites: [tokyo, london], recent: [tokyo, london], settings: { units: 'metric' } });
    try {
      const { page } = app;
      await waitForDashboard(page);
      // The data file path becomes a folder, so the server's save (temp file + rename) really fails with a 500.
      const file = path.join(app.dataDir, 'weather-dashboard.json');
      await rm(file);
      await mkdir(file);
      const count = (list: string) => page.evaluate<number>(`document.querySelectorAll('${list} .place-card').length`);
      const banner = () => page.evaluate<string | null>(`document.getElementById('banner').hidden ? null : document.getElementById('banner').textContent.trim()`);

      await page.evaluate(`document.querySelector('#favorites .fav-remove').click()`);
      await page.waitFor(`!document.getElementById('banner').hidden`, 5000);
      expect(await banner()).toBe('Something went wrong');
      expect(await count('#favorites')).toBe(2);

      await page.evaluate(`document.getElementById('banner').hidden = true`);
      await page.evaluate(`document.getElementById('clear-recent').click()`);
      await page.waitFor(`!document.getElementById('banner').hidden`, 5000);
      expect(await banner()).toBe('Something went wrong');
      expect(await count('#recent')).toBe(2);

      // Nothing is stuck: another city still loads, and the banner goes away with it.
      await page.evaluate(`[...document.querySelectorAll('#favorites .place-card')].find((c) => c.textContent.includes('London')).click()`);
      await page.waitFor(`document.querySelector('.place-name')?.textContent === 'London' && !document.getElementById('main').classList.contains('is-loading')`, 20_000);
      expect(await banner()).toBeNull();
      expect(app.errors).toEqual([]);
    } finally {
      await app.close();
    }
  });
});

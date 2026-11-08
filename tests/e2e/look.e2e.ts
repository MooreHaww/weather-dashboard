// v1.7 in the real window: Settings > Look (Classic | Glass).
// - The choice applies at once (no reload) and is kept after a restart.
// - Without system support (Windows 10, faked with tests/e2e/support/fakeWindows10.cjs) the page is classic and Glass is disabled.
// - Classic follows the weather: a sunny and a rainy city get different backgrounds (computed style). The weather codes are
//   forced by rewriting /api/weather answers in the page (as scripts/screenshot.ts does), so live weather cannot make it flaky.
// - Settings blurs the dashboard in both looks.
// Run with: npm run test:e2e

import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchApp, waitForDashboard, type AppPage, type LaunchedApp } from '../../scripts/launch';
import { LOOK_GLASS_NEEDS } from '../../src/renderer/components/settings';
import { transparencyEffectsOn } from './support/dwm';

const tokyo = { id: 1850147, name: 'Tokyo', latitude: 35.6895, longitude: 139.69171, admin1: 'Tokyo', country: 'Japan', countryCode: 'JP', timezone: 'Asia/Tokyo' };
const oslo = { id: 3143244, name: 'Oslo', latitude: 59.91273, longitude: 10.74609, admin1: 'Oslo', country: 'Norway', countryCode: 'NO', timezone: 'Europe/Oslo' };
const FAKE_WINDOWS_10 = path.join(__dirname, 'support', 'fakeWindows10.cjs').split(path.sep).join('/');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const build = Number(os.release().split('.')[2]);
const GLASS_HERE = process.platform === 'win32' && build >= 22621 && transparencyEffectsOn();

/** Tokyo is always sunny, Oslo always raining, both by day. */
const WEATHER = `(() => {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await realFetch(input, init);
    const url = String(input);
    if (!url.includes('/api/weather') || !res.ok) return res;
    const body = await res.json();
    body.data.current.weatherCode = url.includes('lat=35.') ? 0 : 63;
    body.data.current.isDay = true;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
})()`;

const material = (page: AppPage) => page.evaluate<string>(`document.documentElement.dataset.material`);
const bodyBg = (page: AppPage) => page.evaluate<string>(`getComputedStyle(document.body).backgroundColor`);
const backdrop = (page: AppPage) => page.evaluate<string>(`getComputedStyle(document.querySelector('.backdrop')).backgroundImage`);
const lookButtons = (page: AppPage) =>
  page.evaluate<{ value: string; checked: string; disabled: boolean }[]>(
    `[...document.querySelectorAll('#settings-look [role="radio"]')].map((b) => ({ value: b.dataset.value, checked: b.getAttribute('aria-checked'), disabled: b.disabled }))`,
  );

async function openSettings(page: AppPage) {
  await page.evaluate(`document.getElementById('settings-button').click()`);
  await page.waitFor(`document.getElementById('settings').classList.contains('is-open')`, 5000);
  await sleep(500);
}
async function closeSettings(page: AppPage) {
  await page.evaluate(`document.querySelector('.settings-close').click()`);
  await page.waitFor(`document.getElementById('settings').hidden`, 5000);
}
const choose = (page: AppPage, value: string) => page.evaluate(`document.querySelector('#settings-look [data-value="${value}"]').click()`);
/** The blur behind the open Settings panel, wherever the look puts it (classic: the sheet's backdrop-filter; glass: a filter on the dashboard). */
const settingsBlur = (page: AppPage) =>
  page.evaluate<{ sheet: string; layout: string }>(`(() => ({
    sheet: getComputedStyle(document.querySelector('.settings-sheet')).backdropFilter,
    layout: getComputedStyle(document.querySelector('.layout')).filter,
  }))()`);

describe('a fresh install', () => {
  it('starts classic, and the decision is saved at once', async () => {
    const app = await launchApp();
    try {
      await waitForDashboard(app.page);
      expect(await material(app.page)).toBe('solid');
      const saved = JSON.parse(await readFile(path.join(app.dataDir, 'weather-dashboard.json'), 'utf8'));
      expect(saved.settings.appearance).toBe('classic');
      await openSettings(app.page);
      expect((await lookButtons(app.page)).find((b) => b.checked === 'true')!.value).toBe('classic');
      expect(app.errors).toEqual([]);
    } finally {
      await app.close();
    }
  });
});

describe('Settings > Look', () => {
  let app: LaunchedApp;
  let page: AppPage;
  const errors: string[] = [];

  beforeAll(async () => {
    app = await launchApp({ lastPlace: tokyo, favorites: [tokyo], recent: [tokyo, oslo], settings: { units: 'metric', appearance: 'classic' } });
    page = app.page;
    await page.reloadWithScript(WEATHER);
    await waitForDashboard(page);
  });
  afterAll(async () => {
    await app?.close();
  });

  it('is the second section, after Updates, with Classic and Glass and the info button', async () => {
    await openSettings(page);
    expect(await page.evaluate<string[]>(`[...document.querySelectorAll('#settings-sections h3')].map((h) => h.textContent)`)).toEqual([
      'Updates',
      'Look',
      'Units',
      'Time format',
      'Temperature chart',
      'Location',
    ]);
    const buttons = await lookButtons(page);
    expect(buttons.map((b) => [b.value, b.checked])).toEqual([
      ['classic', 'true'],
      ['glass', 'false'],
    ]);
    expect(buttons[1]!.disabled).toBe(!GLASS_HERE);
    await page.evaluate(`document.querySelector('#settings-look .info-button').click()`);
    expect(await page.evaluate<string>(`document.getElementById('look-info').textContent`)).toBe(LOOK_GLASS_NEEDS);
    await page.evaluate(`document.querySelector('#settings-look .info-button').click()`);
  });

  it('classic: Settings blurs the dashboard (the sheet\'s own backdrop-filter)', async () => {
    const b = await settingsBlur(page);
    expect(b.sheet).toMatch(/blur\(\d+px\)/);
    await closeSettings(page);
  });

  it('classic follows the weather: a sunny and a rainy city get different opaque backgrounds', async () => {
    await page.waitFor(`document.body.dataset.sky === 'clear-day'`, 15_000);
    await sleep(800); // the .backdrop's 600 ms fade
    const sunny = await backdrop(page);
    expect(await bodyBg(page)).toBe('rgb(11, 18, 32)');
    await page.evaluate(`document.querySelector('.place-card.recent[data-id="${oslo.id}"], .place-card[data-id="${oslo.id}"]').click()`);
    await page.waitFor(`document.body.dataset.sky === 'rain-day'`, 15_000);
    await sleep(800);
    const rainy = await backdrop(page);
    expect(sunny).toContain('linear-gradient(160deg');
    expect(rainy).toContain('linear-gradient(160deg');
    expect(rainy).not.toBe(sunny);
    // The colours are the ones styles.css gives the two states.
    expect(sunny).toContain('rgb(40, 27, 4)'); // clear-day --sky-1 #281b04
    expect(rainy).toContain('rgb(9, 23, 44)'); // rain-day --sky-1 #09172c
  });

  it.runIf(GLASS_HERE)('choosing Glass applies at once (no reload); Settings blurs the dashboard there too; Classic again at once', async () => {
    await page.evaluate(`window.__sameDocument = true`);
    await openSettings(page);
    await choose(page, 'glass');
    await page.waitFor(`document.documentElement.dataset.material === 'glass'`, 2000);
    expect(await bodyBg(page)).toBe('rgba(0, 0, 0, 0)');
    await sleep(500); // the dashboard's 220 ms blur
    expect((await settingsBlur(page)).layout).toMatch(/blur\(40px\)/);
    await choose(page, 'classic');
    await page.waitFor(`document.documentElement.dataset.material === 'solid'`, 2000);
    expect(await bodyBg(page)).toBe('rgb(11, 18, 32)');
    await choose(page, 'glass');
    await page.waitFor(`document.documentElement.dataset.material === 'glass'`, 2000);
    expect(await page.evaluate<boolean>(`window.__sameDocument === true`)).toBe(true);
    await closeSettings(page);
  });

  it.runIf(GLASS_HERE)('the choice is kept after a restart', async () => {
    const file = path.join(app.dataDir, 'weather-dashboard.json');
    const saved = async () => JSON.parse(await readFile(file, 'utf8')).settings.appearance;
    for (let i = 0; i < 40 && (await saved()) !== 'glass'; i++) await sleep(100);
    expect(await saved()).toBe('glass');
    errors.push(...app.errors);
    const dataDir = app.dataDir;
    await app.close({ keepData: true });
    app = await launchApp(undefined, { dataDir });
    page = app.page;
    await waitForDashboard(page);
    await page.waitFor(`document.documentElement.dataset.material === 'glass'`, 5000);
    await openSettings(page);
    expect((await lookButtons(page)).find((b) => b.checked === 'true')!.value).toBe('glass');
    await choose(page, 'classic'); // and back, kept too
    await page.waitFor(`document.documentElement.dataset.material === 'solid'`, 2000);
    for (let i = 0; i < 40 && (await saved()) !== 'classic'; i++) await sleep(100);
    errors.push(...app.errors);
    await app.close({ keepData: true });
    app = await launchApp(undefined, { dataDir });
    page = app.page;
    await waitForDashboard(page);
    expect(await material(page)).toBe('solid');
    await openSettings(page);
    expect((await lookButtons(page)).find((b) => b.checked === 'true')!.value).toBe('classic');
    await closeSettings(page);
  });

  it('threw no errors', () => {
    expect([...errors, ...app.errors]).toEqual([]);
  });
});

describe('without system support (Windows 10, faked for the test)', () => {
  let app: LaunchedApp;

  beforeAll(async () => {
    // A 1.6.1 user's file: no "appearance", so Glass is chosen; the system cannot show it.
    app = await launchApp({ lastPlace: tokyo, favorites: [tokyo], settings: { units: 'metric' } }, { env: { NODE_OPTIONS: `--require ${FAKE_WINDOWS_10}` } });
    await waitForDashboard(app.page);
  });
  afterAll(async () => {
    await app?.close();
  });

  it('shows classic, with Glass disabled and Classic checked; the choice itself is kept', async () => {
    const page = app.page;
    expect(await material(page)).toBe('solid');
    expect(await bodyBg(page)).toBe('rgb(11, 18, 32)');
    await openSettings(page);
    const buttons = await lookButtons(page);
    expect(buttons).toEqual([
      { value: 'classic', checked: 'true', disabled: false },
      { value: 'glass', checked: 'false', disabled: true },
    ]);
    expect(await page.evaluate<string | null>(`document.querySelector('#settings-look [data-value="glass"]').getAttribute('aria-disabled')`)).toBe('true');
    await choose(page, 'glass'); // a disabled button: nothing happens
    await sleep(300);
    expect(await material(page)).toBe('solid');
    expect((await settingsBlur(page)).sheet).toMatch(/blur\(\d+px\)/);
    await closeSettings(page);
    const saved = JSON.parse(await readFile(path.join(app.dataDir, 'weather-dashboard.json'), 'utf8'));
    expect(saved.settings.appearance).toBe('glass'); // when glass becomes possible, it applies (look.test.ts)
    expect(app.errors).toEqual([]);
  });

  it('when the system can show glass again, glass applies without a restart', async () => {
    const page = app.page;
    await app.evaluateMain(
      `const { BrowserWindow } = process.mainModule.require('electron'); BrowserWindow.getAllWindows()[0].webContents.send('appearance', 'glass');`,
    );
    await page.waitFor(`document.documentElement.dataset.material === 'glass'`, 3000);
    await openSettings(page);
    expect((await lookButtons(page)).map((b) => [b.value, b.checked, b.disabled])).toEqual([
      ['classic', 'false', false],
      ['glass', 'true', false],
    ]);
    await closeSettings(page);
    expect(app.errors).toEqual([]);
  });
});

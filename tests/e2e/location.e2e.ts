// v1.5 "Location" in the real window: the consent card, nothing looked up before the answer, the detected
// place on top of the sidebar, "Not now" remembered, a failed lookup, switching off, and the places the
// detected city must never end up in (Recent, the next start's city, the star).
//
// GeoJS is never contacted: the app is started with tests/e2e/support/fakeGeoJs.cjs preloaded into its
// main process (NODE_OPTIONS=--require), which answers with a fixed place (Paris) and records each request.
// Open-Meteo (the weather itself) is live, like the other e2e files.
// Run with: npm run test:e2e

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { launchApp, waitForDashboard, type AppPage, type LaunchedApp, type Seed } from '../../scripts/launch';

const FAKE = path.join(__dirname, 'support', 'fakeGeoJs.cjs').replace(/\\/g, '/');
const ENV = { NODE_OPTIONS: `--require ${FAKE}` };

const PRIVACY = 'Uses your IP address to guess your city. The IP address is sent to GeoJS.';
const IP = '203.0.113.77';
const tokyo = { id: 1850147, name: 'Tokyo', latitude: 35.6895, longitude: 139.69171, country: 'Japan', countryCode: 'JP', timezone: 'Asia/Tokyo' };
const paris = { id: -1, name: 'Paris', latitude: 48.86, longitude: 2.35, country: 'France', countryCode: 'FR', timezone: 'Europe/Paris' };

let app: LaunchedApp | undefined;
let page: AppPage;

async function start(seed?: Seed, opts: { dataDir?: string; width?: number; height?: number } = {}) {
  app = await launchApp(seed, { dataDir: opts.dataDir, env: ENV });
  page = app.page;
  await app.resize(opts.width ?? 1200, opts.height ?? 800);
  await waitForDashboard(page);
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

interface GeoCall {
  url: string;
  optionKeys: string[];
  headers: Record<string, string> | null;
  redirect: string | null;
  credentials: string | null;
}
const geoCalls = () => app!.evaluateMain<GeoCall[]>(`return JSON.parse(JSON.stringify(globalThis.__geo.calls));`);
const geoMode = (mode: string, delayMs = 0) => app!.evaluateMain(`globalThis.__geo.mode = ${JSON.stringify(mode)}; globalThis.__geo.delayMs = ${delayMs};`);
interface SavedFile {
  settings: { location: string };
  myLocation: unknown;
  recent: unknown[];
  favorites: unknown[];
  lastPlace: { id: number } | null;
}
const saved = async () => JSON.parse(await readFile(path.join(app!.dataDir, 'weather-dashboard.json'), 'utf8')) as SavedFile;
const savedText = () => readFile(path.join(app!.dataDir, 'weather-dashboard.json'), 'utf8');

async function centerOf(selector: string): Promise<[number, number]> {
  return page.evaluate<[number, number]>(
    `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`,
  );
}
async function clickOn(selector: string) {
  const [x, y] = await centerOf(selector);
  await page.click(x, y);
}
const text = (selector: string) => page.evaluate<string>(`document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? ''`);
const visible = (selector: string) =>
  page.evaluate<boolean>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return !!el && !el.hidden && el.getBoundingClientRect().height > 0; })()`);
const placeName = () => text('.place-name');
const settle = (ms = 800) => new Promise((r) => setTimeout(r, ms));

async function openSettings() {
  await clickOn('#settings-button');
  await page.waitFor(`document.getElementById('settings').classList.contains('is-open')`, 2000);
  await settle(500);
}
async function closeSettings() {
  await page.press('Escape');
  await page.waitFor(`document.getElementById('settings').hidden`, 2000);
}
const switchOn = () => page.evaluate<string>(`document.querySelector('#settings-location [role="switch"]').getAttribute('aria-checked')`);

describe('before the user answers', () => {
  it('shows the consent card, and makes no request to GeoJS: not at start, not after waiting', async () => {
    await start();
    await settle(1500);
    expect(await visible('#location-consent')).toBe(true);
    expect(await text('#location-consent-title')).toBe('Show weather where you are?');
    expect(await text('#location-consent-text')).toBe(PRIVACY);
    expect(await text('#location-allow')).toBe('Use my location');
    expect(await text('#location-decline')).toBe('Not now');
    expect(await visible('#location-section')).toBe(false);
    expect(await geoCalls()).toEqual([]);
    // The app shows its default city meanwhile.
    expect(await placeName()).toBe('London');
    await openSettings();
    expect(await switchOn()).toBe('false');
    expect(await text('#settings-location-status')).toBe('Off. No location lookup is made.');
    expect(await text('#settings-location .settings-section-description')).toBe(PRIVACY);
    await closeSettings();
    expect(await geoCalls()).toEqual([]);
    expect(app!.errors).toEqual([]);
  });

  it('a file from 1.4.7 (no location fields) starts the same way: consent card, no request, its own city kept', async () => {
    await start({ lastPlace: tokyo, favorites: [tokyo], recent: [tokyo], settings: { units: 'imperial', timeFormat: '24h', windUnit: 'mph', tempLabels: '2h' } });
    await settle(1000);
    expect(await visible('#location-consent')).toBe(true);
    expect(await geoCalls()).toEqual([]);
    expect(await placeName()).toBe('Tokyo');
    await openSettings();
    expect(await page.evaluate(`[...document.querySelectorAll('#settings-sections button[aria-checked="true"]')].map((b) => b.dataset.value)`)).toEqual(['imperial', 'mph', '24h', '2h']);
    await closeSettings();
  });

  it('"Not now" is remembered: no request, the card is gone, the switch is off, and it stays gone after a restart', async () => {
    await start();
    await clickOn('#location-decline');
    await page.waitFor(`document.getElementById('location-consent').hidden`, 3000);
    await settle(500);
    expect(await geoCalls()).toEqual([]);
    expect((await saved()).settings.location).toBe('off');
    expect((await saved()).myLocation).toBeNull();
    await openSettings();
    expect(await switchOn()).toBe('false');
    await closeSettings();

    const dataDir = app!.dataDir;
    await app!.close({ keepData: true });
    await start(undefined, { dataDir });
    await settle(1500);
    expect(await visible('#location-consent')).toBe(false);
    expect(await visible('#location-section')).toBe(false);
    expect(await geoCalls()).toEqual([]);
  });

  it('the card can be answered from the keyboard', async () => {
    await start();
    await page.evaluate(`document.getElementById('location-decline').focus()`);
    await page.press('Enter');
    await page.waitFor(`document.getElementById('location-consent').hidden`, 3000);
    await settle(500); // the answer is saved in the background
    expect((await saved()).settings.location).toBe('off');
    expect(await geoCalls()).toEqual([]);
  });
});

describe('"Use my location"', () => {
  it('asks GeoJS once with a minimal request, then shows the place on top and uses it on a first start', async () => {
    await start();
    await clickOn('#location-allow');
    await page.waitFor(`document.querySelector('#location-list .place-card')`, 15000);
    await page.waitFor(`document.querySelector('.place-name')?.textContent === 'Paris'`, 15000);

    // The request: one plain GET, nothing else.
    const calls = await geoCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      url: 'https://get.geojs.io/v1/ip/geo.json',
      optionKeys: ['credentials', 'headers', 'redirect', 'signal'],
      headers: { 'User-Agent': 'Weather-Dashboard', Accept: 'application/json' },
      redirect: 'error',
      credentials: 'omit',
    });

    // The screen.
    expect(await visible('#location-consent')).toBe(false);
    expect(await text('#location-title')).toBe('Your location');
    expect(await text('#location-list .fav-name')).toBe('Paris');
    expect(await page.evaluate(`document.querySelector('#location-list .place-card').classList.contains('is-active')`)).toBe(true);
    expect(await page.evaluate(`document.getElementById('star') === null`)).toBe(true);
    expect(await page.evaluate(`document.querySelector('#location-list .fav-remove') === null`)).toBe(true);
    expect(await page.evaluate(`document.title.startsWith('Paris')`)).toBe(true);
    await page.waitFor(`document.querySelector('#location-list .fav-weather').textContent.includes('°')`, 15000);

    // On top: above Favorites and Recent.
    const tops = await page.evaluate<number[]>(`['location-section', 'favorites-empty', 'recent-empty'].map((id) => document.getElementById(id).getBoundingClientRect().top)`);
    expect(tops[0]).toBeLessThan(tops[1]!);
    expect(tops[1]).toBeLessThan(tops[2]!);
    expect(await page.evaluate<string>(`document.querySelector('.sidebar > section:not([hidden]) .section-title').textContent`)).toBe('Your location');

    // What is stored: the place and the answer, nothing else.
    const file = await saved();
    expect(file.settings.location).toBe('on');
    expect(file.myLocation).toEqual(paris);
    expect(file.recent).toEqual([]);
    expect(file.favorites).toEqual([]);
    expect(file.lastPlace).toBeNull();
    expect(await savedText()).not.toContain(IP);
    expect(await savedText()).not.toContain('EXAMPLE-NET');

    // Settings agrees.
    await openSettings();
    expect(await switchOn()).toBe('true');
    expect(await text('#settings-location-status')).toBe('Near Paris, France. This is approximate.');
    await closeSettings();
    expect(app!.errors).toEqual([]);
  });

  it('does not take over a city the user already has (favorites), and does not add itself to Recent', async () => {
    await start({ favorites: [tokyo] });
    expect(await placeName()).toBe('Tokyo');
    await clickOn('#location-allow');
    await page.waitFor(`document.querySelector('#location-list .place-card')`, 15000);
    await settle(1000);
    expect(await placeName()).toBe('Tokyo');
    expect(await page.evaluate(`document.querySelector('#recent-empty').hidden`)).toBe(false);

    // Choosing it shows its weather, but it is not recorded as a recent search or as the next start's city.
    await clickOn('#location-list .place-card');
    await page.waitFor(`document.querySelector('.place-name')?.textContent === 'Paris'`, 15000);
    expect(await page.evaluate(`document.getElementById('star') === null`)).toBe(true);
    await settle(1000);
    const file = await saved();
    expect(file.recent).toEqual([]);
    expect(file.lastPlace).toBeNull();
    expect(await page.evaluate(`document.querySelectorAll('#recent .place-card').length`)).toBe(0);
    // Back to Tokyo with the keyboard.
    await page.evaluate(`document.querySelector('#favorites .place-card').focus()`);
    await page.press('Enter');
    await page.waitFor(`document.querySelector('.place-name')?.textContent === 'Tokyo'`, 15000);
    expect(await page.evaluate(`document.getElementById('star') !== null`)).toBe(true);
  });

  it('a city the user picks while the lookup runs is not replaced when the answer arrives', async () => {
    await start({ recent: [tokyo] });
    expect(await placeName()).toBe('London');
    await geoMode('ok', 1500);
    await clickOn('#location-allow');
    await clickOn('#recent .place-card');
    await page.waitFor(`document.querySelector('.place-name')?.textContent === 'Tokyo'`, 15000);
    await page.waitFor(`document.querySelector('#location-list .place-card')`, 15000);
    await settle(1000);
    expect(await placeName()).toBe('Tokyo');
    expect(await text('#location-list .fav-name')).toBe('Paris');
  });

  it('at every start it looks again (once), keeps the user\'s own last city on screen, and keeps the place on top', async () => {
    await start({ lastPlace: tokyo, favorites: [tokyo], recent: [tokyo], settings: { location: 'on' }, myLocation: paris });
    await page.waitFor(`document.querySelector('#location-list .place-card')`, 15000);
    await settle(1500);
    expect(await geoCalls()).toHaveLength(1);
    expect(await placeName()).toBe('Tokyo');
    expect(await text('#location-list .fav-name')).toBe('Paris');
    expect(await visible('#location-consent')).toBe(false);
    expect((await saved()).lastPlace).toEqual(expect.objectContaining({ id: tokyo.id }));
  });

  it('a lookup that fails shows a calm note, no error banner, and the app carries on with its default city', async () => {
    await start();
    await geoMode('fail');
    await clickOn('#location-allow');
    await page.waitFor(`document.getElementById('location-note') && !document.getElementById('location-note').hidden && document.getElementById('location-note').textContent.includes('find')`, 15000);
    expect(await text('#location-note')).toBe("Couldn't find your location. It tries again the next time the app starts.");
    expect(await visible('#banner')).toBe(false);
    expect(await placeName()).toBe('London');
    expect(await geoCalls()).toHaveLength(1); // one attempt, no retry
    expect(await page.evaluate(`document.querySelector('#location-list .place-card') === null`)).toBe(true);
    await openSettings();
    expect(await text('#settings-location-status')).toBe("Couldn't find your location. It tries again the next time the app starts.");
    expect(await switchOn()).toBe('true');
    await closeSettings();
    expect((await saved()).myLocation).toBeNull();
    expect(app!.errors).toEqual([]);
  });

  it('an answer that is not a place is treated the same way', async () => {
    await start();
    await geoMode('garbage');
    await clickOn('#location-allow');
    await page.waitFor(`document.getElementById('location-note').textContent.includes("find your location")`, 15000);
    expect(await text('#location-note')).toContain("Couldn't find your location");
    expect(await visible('#banner')).toBe(false);
  });
});

describe('turning it off', () => {
  it('forgets the place (also in the file), leaves the screen on a city of the user\'s own, and makes no more requests', async () => {
    await start();
    await clickOn('#location-allow');
    await page.waitFor(`document.querySelector('.place-name')?.textContent === 'Paris'`, 15000);
    expect(await geoCalls()).toHaveLength(1);

    await openSettings();
    await clickOn('#settings-location [role="switch"]');
    await page.waitFor(`document.querySelector('#settings-location [role="switch"]').getAttribute('aria-checked') === 'false'`, 3000);
    expect(await text('#settings-location-status')).toBe('Off. No location lookup is made.');
    await closeSettings();

    expect(await visible('#location-section')).toBe(false);
    expect(await visible('#location-consent')).toBe(false); // answered: it does not come back
    await page.waitFor(`document.querySelector('.place-name')?.textContent === 'London'`, 15000);
    await settle(500);
    const file = await saved();
    expect(file.settings.location).toBe('off');
    expect(file.myLocation).toBeNull();
    expect(await savedText()).not.toContain('Paris');
    expect(await geoCalls()).toHaveLength(1);

    // Back on: asks again, once.
    await openSettings();
    await clickOn('#settings-location [role="switch"]');
    await page.waitFor(`document.querySelector('#location-list .place-card')`, 15000);
    expect(await geoCalls()).toHaveLength(2);
    await closeSettings();
    expect(app!.errors).toEqual([]);
  });

  it('with the user\'s own last city on screen, it just disappears from the sidebar', async () => {
    await start({ lastPlace: tokyo, favorites: [tokyo], recent: [tokyo], settings: { location: 'on' }, myLocation: paris });
    await page.waitFor(`document.querySelector('#location-list .place-card')`, 15000);
    await openSettings();
    await clickOn('#settings-location [role="switch"]');
    await page.waitFor(`document.getElementById('location-section').hidden`, 3000);
    await closeSettings();
    expect(await placeName()).toBe('Tokyo');
    expect((await saved()).myLocation).toBeNull();
  });
});

describe('layout with the consent card and the location card', () => {
  const problems = (w: number) =>
    page.evaluate<string[]>(`(() => {
      const out = [];
      const vis = (el) => !el.hidden && el.getBoundingClientRect().height > 0;
      const blocks = [...document.querySelectorAll('.card, .sidebar > section')].filter(vis);
      const r = (el) => el.getBoundingClientRect();
      const name = (el) => el.id || el.className || el.tagName;
      for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
        const a = r(blocks[i]), b = r(blocks[j]);
        if (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1 && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1) out.push('overlap ' + name(blocks[i]) + ' / ' + name(blocks[j]));
      }
      if (document.documentElement.scrollWidth > innerWidth) out.push('horizontal scroll at ${w}');
      for (const el of document.querySelectorAll('#location-consent *, #location-section *')) {
        if (!vis(el)) continue;
        const parent = el.closest('#location-consent, #location-section');
        if (r(el).right > r(parent).right + 1) out.push('outside its card: ' + name(el));
      }
      return out;
    })()`);

  it('480 to 1400 px wide: no overlap, nothing outside its card, no horizontal scroll, with the consent card and with the location card', async () => {
    await start(undefined, { width: 480, height: 900 });
    for (const w of [480, 700, 1000, 1400]) {
      await app!.resize(w, 900);
      await settle(300);
      expect(await visible('#location-consent')).toBe(true);
      expect(await problems(w), `consent ${w}`).toEqual([]);
    }
    await clickOn('#location-allow');
    await page.waitFor(`document.querySelector('#location-list .place-card')`, 15000);
    for (const w of [480, 700, 1000, 1400]) {
      await app!.resize(w, 900);
      await settle(300);
      expect(await visible('#location-section')).toBe(true);
      expect(await problems(w), `location ${w}`).toEqual([]);
    }
  });
});

describe('Settings > Updates in this (unpackaged) build', () => {
  it('has no "Check for updates" button, because the updater does not run here', async () => {
    await start();
    await openSettings();
    expect(await page.evaluate(`document.getElementById('update-check') === null`)).toBe(true);
    await closeSettings();
  });
});

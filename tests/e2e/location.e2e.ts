// v1.5 "Location" in the real window: the consent card, nothing looked up before the answer, the detected
// place on top of the sidebar, "Not now" remembered, a failed lookup, switching off, and the places the
// detected city must never end up in (Recent, the next start's city, the star).
// v1.5.1: the purple card and pin, the one Settings line, and the "i" button with its popover.
//
// GeoJS is never contacted: the app is started with tests/e2e/support/fakeGeoJs.cjs preloaded into its
// main process (NODE_OPTIONS=--require), which answers with a fixed place (Paris) and records each request.
// Open-Meteo (the weather itself) is live, like the other e2e files.
// Run with: npm run test:e2e

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { launchApp, waitForDashboard, type AppPage, type LaunchedApp, type Seed } from '../../scripts/launch';
import { LOCATION_FACTS } from '../../src/shared/locationText';
import { contrast, cssColorOver, decodePng, type Rgb } from './support/pixels';

const FAKE = path.join(__dirname, 'support', 'fakeGeoJs.cjs').replace(/\\/g, '/');
const ENV = { NODE_OPTIONS: `--require ${FAKE}` };

const PRIVACY = 'Uses your IP address to guess your city. The IP address is sent to GeoJS.';
const SETTINGS_LINE = 'Uses your IP address, sent to GeoJS.';
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
    expect(await text('#settings-location .settings-section-description')).toBe(SETTINGS_LINE);
    // Only titles and controls: the one Location line and its status line are the only text lines shown (1.5.1).
    expect(
      await page.evaluate<string[]>(`[...document.querySelectorAll('#settings-sections p')].filter((p) => p.getBoundingClientRect().width > 1 && !p.closest('#location-info')).map((p) => p.textContent)`),
    ).toEqual([SETTINGS_LINE, 'Off. No location lookup is made.']);
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
    expect(await page.evaluate(`[...document.querySelectorAll('#settings-sections > :not(#settings-look) button[aria-checked="true"]')].map((b) => b.dataset.value)`)).toEqual(['imperial', 'mph', '24h', '2h']); // Look (1.7) depends on the PC
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

const london = { id: 2643743, name: 'London', latitude: 51.50853, longitude: -0.12574, country: 'United Kingdom', countryCode: 'GB', timezone: 'Europe/London' };
/** London on screen (a recent city), Tokyo a favorite, Paris detected. */
const THREE_KINDS: Seed = { lastPlace: london, favorites: [tokyo], recent: [london], settings: { location: 'on' }, myLocation: paris };

describe('purple "Your location" and the pin (1.5.1)', () => {
  /** The background and the accent bar of a card, as drawn. */
  const colors = (selector: string) =>
    page.evaluate<{ bg: string; bar: string }>(`(() => {
      const c = document.querySelector(${JSON.stringify(selector)});
      const s = getComputedStyle(c);
      const tint = s.backgroundColor; // plain rows in glass too (1.6.1)
      return { bg: tint, bar: getComputedStyle(c, '::before').backgroundColor };
    })()`);
  const show = async (selector: string, name: string) => {
    await clickOn(selector);
    await page.waitFor(`document.querySelector('.place-name')?.textContent === ${JSON.stringify(name)} && !document.getElementById('main').classList.contains('is-loading')`, 15000);
    await page.move(5, 700); // no hover on the cards
    await settle(400);
  };

  it('the active card has a purple bar and a subtle purple tint, unlike an active favorite or recent city; hover is purple too', async () => {
    await start(THREE_KINDS);
    await page.waitFor(`document.querySelector('#location-list .place-card')`, 15000);
    await page.move(5, 700);
    await settle(400);
    const recent = await colors('#recent .place-card.is-active');

    // Hover on the (not active) location card.
    const [x, y] = await centerOf('#location-list .place-card');
    await page.move(x, y);
    await settle(400);
    const hover = (await colors('#location-list .place-card')).bg;

    await show('#favorites .place-card', 'Tokyo');
    const favorite = await colors('#favorites .place-card.is-active');
    await show('#location-list .place-card', 'Paris');
    const loc = await colors('#location-list .place-card.is-active');

    expect(loc).toEqual({ bg: 'rgba(167, 139, 250, 0.1)', bar: 'rgb(167, 139, 250)' });
    expect(hover).toBe('rgba(167, 139, 250, 0.08)');
    // Favorites (gold) and Recent (blue) are as they were.
    expect(favorite).toEqual({ bg: 'rgba(251, 191, 36, 0.1)', bar: 'rgb(251, 191, 36)' });
    expect(recent).toEqual({ bg: 'rgba(96, 165, 250, 0.14)', bar: 'rgb(96, 165, 250)' });
    expect(new Set([loc.bar, favorite.bar, recent.bar]).size).toBe(3);
    expect(new Set([loc.bg, favorite.bg, recent.bg]).size).toBe(3);
    // The meaning does not rest on the colour: the section keeps its title.
    expect(await text('#location-title')).toBe('Your location');
    expect(app!.errors).toEqual([]);
  });

  it('text on the purple card and the pin are readable against what is really drawn behind them', async () => {
    await start(THREE_KINDS);
    await page.waitFor(`document.querySelector('#location-list .place-card')`, 15000);
    await show('#location-list .place-card', 'Paris');
    const at = await page.evaluate<{ card: number[]; name: string; sub: string; pin: number[]; pinColor: string }>(`(() => {
      const card = document.querySelector('#location-list .place-card').getBoundingClientRect();
      const pin = document.getElementById('loc-pin').getBoundingClientRect();
      return {
        card: [card.left + 7, card.top + card.height / 2],             // tint, right of the bar, left of the text
        name: getComputedStyle(document.querySelector('#location-list .fav-name')).color,
        sub: getComputedStyle(document.querySelector('#location-list .fav-sub')).color,
        pin: [pin.left + 2, pin.top + pin.height / 2],                 // the pin's own padding: the hero card behind it
        pinColor: getComputedStyle(document.getElementById('loc-pin')).color,
      };
    })()`);
    const shot = decodePng(await page.screenshot({ cssPixels: true }));
    const behindCard: Rgb = shot.at(at.card[0]!, at.card[1]!);
    const behindPin: Rgb = shot.at(at.pin[0]!, at.pin[1]!);
    const ratios = {
      name: contrast(cssColorOver(at.name, behindCard), behindCard),
      country: contrast(cssColorOver(at.sub, behindCard), behindCard),
      pin: contrast(cssColorOver(at.pinColor, behindPin), behindPin),
    };
    expect(at.pinColor).toBe('rgb(167, 139, 250)');
    expect(ratios.name, JSON.stringify({ ratios, behindCard })).toBeGreaterThanOrEqual(4.5);
    expect(ratios.country, JSON.stringify({ ratios, behindCard })).toBeGreaterThanOrEqual(4.5);
    expect(ratios.pin, JSON.stringify({ ratios, behindPin })).toBeGreaterThanOrEqual(3); // a graphic: 3:1
  });

  it('the pin is next to the name only while the city on screen is your location, named "Your location"; the pulsing dot is unchanged', async () => {
    await start(THREE_KINDS);
    await page.waitFor(`document.querySelector('#location-list .place-card')`, 15000);
    const pin = () => page.evaluate<{ label: string | null; role: string | null; afterName: boolean } | null>(`(() => {
      const p = document.getElementById('loc-pin');
      return p && { label: p.getAttribute('aria-label'), role: p.getAttribute('role'), afterName: p.previousElementSibling.classList.contains('place-name') };
    })()`);
    expect(await placeName()).toBe('London');
    expect(await pin()).toBeNull();
    expect(await page.evaluate(`document.getElementById('star') !== null`)).toBe(true);

    await show('#location-list .place-card', 'Paris');
    expect(await pin()).toEqual({ label: 'Your location', role: 'img', afterName: true });
    expect(await visible('#loc-pin')).toBe(true);
    expect(await page.evaluate(`document.getElementById('star') === null`)).toBe(true);
    // The current-time dot and its legend entry are still there, as before.
    expect(await page.evaluate<number>(`document.querySelectorAll('#now-dot.pulse-dot > .core, #now-dot.pulse-dot > .ring').length`)).toBe(2);
    expect(await visible('#legend-now')).toBe(true);

    await show('#favorites .place-card', 'Tokyo');
    expect(await pin()).toBeNull();
    expect(app!.errors).toEqual([]);
  });
});

describe('the "i" button next to "Use my location" (1.5.1)', () => {
  const popoverOpen = `!document.getElementById('location-info').hidden`;
  const expanded = () => page.evaluate<string>(`document.querySelector('#settings-location .info-button').getAttribute('aria-expanded')`);
  const focused = () => page.evaluate<string>(`document.activeElement.id || document.activeElement.className`);
  const settingsOpen = () => page.evaluate<boolean>(`document.getElementById('settings').classList.contains('is-open')`);
  const focusButton = () => page.evaluate(`document.querySelector('#settings-location .info-button').focus()`);

  it('opens on click, Enter and Space; Escape closes only the popover and focus returns; a click outside closes it', async () => {
    await start();
    await openSettings();
    expect(await page.evaluate<string>(`document.querySelector('#settings-location .info-button').getAttribute('aria-label')`)).toBe('How is my IP address used?');
    expect(await page.evaluate<string>(`document.querySelector('#settings-location .info-button').getAttribute('aria-controls')`)).toBe('location-info');
    expect(await expanded()).toBe('false');
    expect(await page.evaluate<boolean>(popoverOpen)).toBe(false);

    // Click.
    await page.evaluate(`document.querySelector('#settings-location .info-button').scrollIntoView({ block: 'center' })`);
    await clickOn('#settings-location .info-button');
    await page.waitFor(popoverOpen, 2000);
    expect(await expanded()).toBe('true');
    expect(await focused()).toBe('location-info');
    expect(await text('#location-info h4')).toBe(LOCATION_FACTS.title);
    expect(await page.evaluate<string[]>(`[...document.querySelectorAll('#location-info li')].map((li) => li.textContent)`)).toEqual([...LOCATION_FACTS.lines]);
    // Escape: only the popover closes.
    await page.press('Escape');
    await page.waitFor(`!(${popoverOpen})`, 2000);
    expect(await settingsOpen()).toBe(true);
    expect(await focused()).toBe('info-button');
    expect(await expanded()).toBe('false');

    // Enter, then Space, on the focused button.
    await page.press('Enter');
    await page.waitFor(popoverOpen, 2000);
    await page.press('Escape');
    await page.waitFor(`!(${popoverOpen})`, 2000);
    await page.press(' ');
    await page.waitFor(popoverOpen, 2000);
    expect(await expanded()).toBe('true');

    // A click outside (on a section title) closes it; Settings stays open.
    await clickOn('#settings-units .settings-section-title');
    await page.waitFor(`!(${popoverOpen})`, 2000);
    expect(await settingsOpen()).toBe(true);
    expect(await expanded()).toBe('false');

    // A click inside it does not close it.
    await focusButton();
    await page.press('Enter');
    await page.waitFor(popoverOpen, 2000);
    await clickOn('#location-info li');
    await settle(300);
    expect(await page.evaluate<boolean>(popoverOpen)).toBe(true);

    // Escape once more closes the popover, a second Escape closes Settings as before.
    await page.press('Escape');
    await page.waitFor(`!(${popoverOpen})`, 2000);
    expect(await settingsOpen()).toBe(true);
    await page.press('Escape');
    await page.waitFor(`document.getElementById('settings').hidden`, 2000);
    expect(app!.errors).toEqual([]);
  });

  it('Tab order stays sane: Shift+Tab goes back to the button, Tab moves on and closes it, focus stays in Settings', async () => {
    await start();
    await openSettings();
    await focusButton();
    await page.press('Enter');
    await page.waitFor(popoverOpen, 2000);
    await page.press('Tab', { shift: true });
    expect(await focused()).toBe('info-button');
    expect(await page.evaluate<boolean>(popoverOpen)).toBe(true); // still its own button
    await page.press('Enter'); // closes (toggle)
    await page.waitFor(`!(${popoverOpen})`, 2000);
    await page.press('Enter');
    await page.waitFor(popoverOpen, 2000);
    await page.press('Tab');
    await page.waitFor(`!(${popoverOpen})`, 2000);
    expect(await page.evaluate<boolean>(`document.getElementById('settings-sheet').contains(document.activeElement)`)).toBe(true);
    expect(await settingsOpen()).toBe(true);
    // Closing Settings with the popover open closes it too.
    await focusButton();
    await page.press('Enter');
    await page.waitFor(popoverOpen, 2000);
    await clickOn('.settings-close');
    await page.waitFor(`document.getElementById('settings').hidden`, 2000);
    expect(await page.evaluate<boolean>(popoverOpen)).toBe(false);
    expect(app!.errors).toEqual([]);
  });

  it('stays inside the window, never clipped, from 480 to 1400 px and in short windows (it scrolls inside itself), and respects reduced motion', async () => {
    await start();
    await openSettings();
    const SIZES: [number, number][] = [[480, 900], [600, 900], [601, 900], [860, 900], [960, 900], [1000, 900], [1240, 900], [1241, 900], [1400, 900], [1000, 400], [480, 400], [1400, 400]];
    for (const [w, h] of SIZES) {
      await app!.resize(w, h);
      await settle(250);
      await page.evaluate(`document.querySelector('#settings-location .info-button').scrollIntoView({ block: 'center' })`);
      await settle(100);
      await clickOn('#settings-location .info-button');
      await page.waitFor(popoverOpen, 2000);
      await settle(200);
      const box = await page.evaluate<{ problems: string[]; scrolls: boolean }>(`(() => {
        const p = document.getElementById('location-info');
        const r = p.getBoundingClientRect();
        const area = document.getElementById('settings-sections').getBoundingClientRect();
        const out = [];
        if (r.left < 15.5 || r.right > innerWidth - 15.5) out.push('sides ' + r.left + '..' + r.right + ' of ' + innerWidth);
        if (r.top < area.top + 15.5 || r.bottom > innerHeight - 15.5) out.push('height ' + r.top + '..' + r.bottom + ' of ' + area.top + '..' + innerHeight);
        if (r.width < 200) out.push('too narrow ' + r.width);
        // Not covered and not clipped: the points just inside each edge belong to the popover.
        for (const [x, y] of [[r.left + 20, r.top + 20], [r.right - 20, r.top + 20], [r.left + 20, r.bottom - 20], [r.right - 20, r.bottom - 20]]) {
          if (!p.contains(document.elementFromPoint(x, y))) out.push('covered or clipped at ' + Math.round(x) + ',' + Math.round(y));
        }
        if (p.scrollWidth > p.clientWidth + 1) out.push('horizontal scroll inside');
        if (document.getElementById('settings-sections').scrollWidth > document.getElementById('settings-sections').clientWidth + 1) out.push('sections scroll sideways');
        // The panel itself never moves: only its sections scroll (an absolute or fixed child sticking out once let it shift).
        const root = document.getElementById('settings');
        if (root.scrollTop !== 0 || root.scrollLeft !== 0 || document.getElementById('settings-sheet').getBoundingClientRect().top !== 0) out.push('panel shifted');
        if (root.scrollHeight > root.clientHeight || root.scrollWidth > root.clientWidth) out.push('panel can scroll');
        return { problems: out, scrolls: p.scrollHeight > p.clientHeight + 1 };
      })()`);
      expect(box.problems, `${w}x${h}`).toEqual([]);
      if (box.scrolls) {
        // It does not fit: its own content scrolls, all the way to the last line.
        await page.evaluate(`document.getElementById('location-info').scrollTop = 1e6`);
        expect(
          await page.evaluate<boolean>(`(() => { const p = document.getElementById('location-info'), li = p.querySelector('li:last-child'); return li.getBoundingClientRect().bottom <= p.getBoundingClientRect().bottom + 1; })()`),
          `${w}x${h}`,
        ).toBe(true);
      }
      await page.press('Escape');
      await page.waitFor(`!(${popoverOpen})`, 2000);
      // Closed again, with the sections scrolled to the top: still nothing for the panel itself to scroll.
      await page.evaluate(`document.getElementById('settings-sections').scrollTop = 0`);
      expect(
        await page.evaluate<number[]>(`(() => { const r = document.getElementById('settings'); return [r.scrollTop, r.scrollHeight - r.clientHeight]; })()`),
        `${w}x${h} closed`,
      ).toEqual([0, 0]);
    }
    // Focused, then the sections scrolled away (the button is out of sight): Enter still opens it, next to the button brought back into view.
    await focusButton();
    await page.evaluate(`document.getElementById('settings-sections').scrollTop = 0`);
    await page.press('Enter');
    await page.waitFor(popoverOpen, 2000);
    expect(
      await page.evaluate<boolean>(`(() => { const b = document.querySelector('#settings-location .info-button').getBoundingClientRect(), a = document.getElementById('settings-sections').getBoundingClientRect(); return b.top >= a.top && b.bottom <= a.bottom; })()`),
    ).toBe(true);
    expect(await page.evaluate<number>(`document.getElementById('settings').scrollTop`)).toBe(0);
    await page.press('Escape');
    await page.waitFor(`!(${popoverOpen})`, 2000);
    // Reduced motion: no fade-in animation.
    await page.emulateReducedMotion(true);
    await page.press('Enter');
    await page.waitFor(popoverOpen, 2000);
    expect(await page.evaluate<string>(`getComputedStyle(document.getElementById('location-info')).animationName`)).toBe('none');
    await page.emulateReducedMotion(false);
    await page.press('Escape');
    expect(app!.errors).toEqual([]);
  });
});

// v1.5.1: remove one city from Recent with the "×" on its card, in the real window.
// Only that city goes, the city on screen stays, the change is saved (and survives a restart), focus moves to
// the next card or the search box, a failed save shows the banner, "Your location" never gets an "×",
// and the "×" never covers a card's name or country from 480 to 1400 px.
//
// The app runs with "Your location" on, so GeoJS is replaced by tests/e2e/support/fakeGeoJs.cjs (as in
// location.e2e.ts): the real service is never contacted. Open-Meteo is live.
// Run with: npm run test:e2e

import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { launchApp, waitForDashboard, type AppPage, type LaunchedApp, type Seed } from '../../scripts/launch';

const FAKE = path.join(__dirname, 'support', 'fakeGeoJs.cjs').replace(/\\/g, '/');
const ENV = { NODE_OPTIONS: `--require ${FAKE}` };

const tokyo = { id: 1850147, name: 'Tokyo', latitude: 35.6895, longitude: 139.69171, admin1: 'Tokyo', country: 'Japan', countryCode: 'JP', timezone: 'Asia/Tokyo' };
const london = { id: 2643743, name: 'London', latitude: 51.50853, longitude: -0.12574, admin1: 'England', country: 'United Kingdom', countryCode: 'GB', timezone: 'Europe/London' };
const berlin = { id: 2950159, name: 'Berlin', latitude: 52.52437, longitude: 13.41053, admin1: 'Land Berlin', country: 'Germany', countryCode: 'DE', timezone: 'Europe/Berlin' };
const oslo = { id: 3143244, name: 'Oslo', latitude: 59.91273, longitude: 10.74609, admin1: 'Oslo', country: 'Norway', countryCode: 'NO', timezone: 'Europe/Oslo' };
const paris = { id: -1, name: 'Paris', latitude: 48.86, longitude: 2.35, country: 'France', countryCode: 'FR', timezone: 'Europe/Paris' };
/** A very long name, to see the ellipsis next to the "×". */
const longName = { id: 2644597, name: 'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch', latitude: 53.2239, longitude: -4.1979, country: 'United Kingdom', countryCode: 'GB', timezone: 'Europe/London' };

/** Tokyo on screen; four recent cities; "Your location" on. */
const SEED: Seed = { lastPlace: tokyo, favorites: [tokyo], recent: [tokyo, london, berlin, oslo], settings: { location: 'on' }, myLocation: paris };

let app: LaunchedApp | undefined;
let page: AppPage;

/** `seed` undefined with a `dataDir`: reopen that folder as it is. */
async function start(seed: Seed | undefined, opts: { dataDir?: string; width?: number } = {}) {
  app = await launchApp(seed, { dataDir: opts.dataDir, env: ENV });
  page = app.page;
  await app.resize(opts.width ?? 1200, 860);
  await waitForDashboard(page);
  await page.waitFor(`document.querySelector('#location-list .place-card')`, 15_000);
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const recentNames = () => page.evaluate<string[]>(`[...document.querySelectorAll('#recent .place-card .fav-name')].map((n) => n.textContent)`);
const saved = async () => JSON.parse(await readFile(path.join(app!.dataDir, 'weather-dashboard.json'), 'utf8')) as { recent: { name: string }[]; favorites: { name: string }[]; lastPlace: { name: string } | null };
const placeName = () => page.evaluate<string>(`document.querySelector('.place-name').textContent`);
const recentCard = (name: string) => `[...document.querySelectorAll('#recent .place-card')].find((c) => c.querySelector('.fav-name').textContent === ${JSON.stringify(name)})`;
const activeName = () => page.evaluate<string | null>(`document.activeElement.closest('.place-card')?.querySelector('.fav-name').textContent ?? document.activeElement.id`);
const xShown = (card: string) => page.evaluate<boolean>(`getComputedStyle(${card}.querySelector('.fav-remove')).display !== 'none'`);

async function rectOf(expr: string) {
  return page.evaluate<{ x: number; y: number; w: number; h: number }>(`(() => { const r = (${expr}).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
}
/** A real click on the "×" of a recent card: hover the card first (that is what shows it), then click it. */
async function clickX(name: string) {
  await page.evaluate(`${recentCard(name)}.scrollIntoView({ block: 'center' })`);
  const card = await rectOf(recentCard(name));
  await page.move(card.x + card.w / 2, card.y + card.h / 2);
  await settle(150);
  const x = await rectOf(`${recentCard(name)}.querySelector('.fav-remove')`);
  await page.click(x.x + x.w / 2, x.y + x.h / 2);
}

describe('the "×" on a Recent card', () => {
  it('shows on hover and on keyboard focus, is named "Remove <city> from recent", and is never on "Your location"', async () => {
    await start(SEED);
    expect(await recentNames()).toEqual(['Tokyo', 'London', 'Berlin', 'Oslo']);
    // Hidden at rest, like the favorites one.
    expect(await xShown(recentCard('London'))).toBe(false);
    // Hover.
    const card = await rectOf(recentCard('London'));
    await page.move(card.x + card.w / 2, card.y + card.h / 2);
    await settle(150);
    expect(await xShown(recentCard('London'))).toBe(true);
    expect(await xShown(recentCard('Berlin'))).toBe(false);
    await page.move(5, 400);
    await settle(150);
    expect(await xShown(recentCard('London'))).toBe(false);
    // Keyboard: Tab from the card reaches its "×".
    await page.evaluate(`${recentCard('Berlin')}.focus()`);
    expect(await xShown(recentCard('Berlin'))).toBe(true);
    await page.press('Tab');
    expect(await page.evaluate<string>(`document.activeElement.getAttribute('aria-label')`)).toBe('Remove Berlin from recent');
    expect(await page.evaluate<string[]>(`[...document.querySelectorAll('#recent .fav-remove')].map((b) => b.getAttribute('aria-label'))`)).toEqual([
      'Remove Tokyo from recent',
      'Remove London from recent',
      'Remove Berlin from recent',
      'Remove Oslo from recent',
    ]);
    // "Your location": no "×", even hovered or focused, and it is not in Recent.
    const loc = await rectOf(`document.querySelector('#location-list .place-card')`);
    await page.move(loc.x + loc.w / 2, loc.y + loc.h / 2);
    await page.evaluate(`document.querySelector('#location-list .place-card').focus()`);
    expect(await page.evaluate<number>(`document.querySelectorAll('#location-list .fav-remove').length`)).toBe(0);
    expect(await recentNames()).not.toContain('Paris');
    // The favorites "×" is unchanged.
    expect(await page.evaluate<string>(`document.querySelector('#favorites .fav-remove').getAttribute('aria-label')`)).toBe('Remove Tokyo from favorites');
    expect(app!.errors).toEqual([]);
  });

  it('removes only that city, keeps the city on screen, saves it, and focus moves to the next card, then to the search box', async () => {
    await start(SEED);
    // A city in the middle: the rest keep their order, focus goes to the card that took its place.
    await clickX('London');
    await page.waitFor(`document.querySelectorAll('#recent .place-card').length === 3`, 5000);
    expect(await recentNames()).toEqual(['Tokyo', 'Berlin', 'Oslo']);
    expect(await activeName()).toBe('Berlin');
    expect(await placeName()).toBe('Tokyo');
    expect((await saved()).recent.map((p) => p.name)).toEqual(['Tokyo', 'Berlin', 'Oslo']);

    // The city on screen itself: it leaves Recent but stays on screen, and stays a favorite.
    await clickX('Tokyo');
    await page.waitFor(`document.querySelectorAll('#recent .place-card').length === 2`, 5000);
    expect(await recentNames()).toEqual(['Berlin', 'Oslo']);
    expect(await activeName()).toBe('Berlin');
    expect(await placeName()).toBe('Tokyo');
    expect(await page.evaluate<boolean>(`document.querySelector('#favorites .place-card').classList.contains('is-active')`)).toBe(true);
    expect((await saved()).favorites.map((p) => p.name)).toEqual(['Tokyo']);

    // The last one, from the keyboard (Delete on the focused card): focus goes to the new last card.
    await page.evaluate(`${recentCard('Oslo')}.focus()`);
    await page.press('Delete');
    await page.waitFor(`document.querySelectorAll('#recent .place-card').length === 1`, 5000);
    expect(await activeName()).toBe('Berlin');

    // The "×" pressed with Enter on the keyboard, on the only one left: the list is empty, focus goes to the search box.
    await page.evaluate(`${recentCard('Berlin')}.querySelector('.fav-remove').focus()`);
    await page.press('Enter');
    await page.waitFor(`document.querySelectorAll('#recent .place-card').length === 0`, 5000);
    expect(await activeName()).toBe('search-input');
    expect(await page.evaluate<boolean>(`document.getElementById('recent-empty').hidden`)).toBe(false);
    expect(await page.evaluate<boolean>(`document.getElementById('clear-recent').hidden`)).toBe(true);
    expect(await placeName()).toBe('Tokyo');
    expect((await saved()).recent).toEqual([]);
    expect(await page.evaluate<boolean>(`document.getElementById('banner').hidden`)).toBe(true);
    expect(app!.errors).toEqual([]);
  });

  it('the removal survives a restart, and the next start still opens the last city shown', async () => {
    await start(SEED);
    await clickX('Tokyo');
    await page.waitFor(`document.querySelectorAll('#recent .place-card').length === 3`, 5000);
    await clickX('Oslo');
    await page.waitFor(`document.querySelectorAll('#recent .place-card').length === 2`, 5000);
    const dataDir = app!.dataDir;
    await app!.close({ keepData: true });

    await start(undefined, { dataDir });
    expect(await recentNames()).toEqual(['London', 'Berlin']);
    expect(await placeName()).toBe('Tokyo');
    expect((await saved()).lastPlace!.name).toBe('Tokyo');
    expect(app!.errors).toEqual([]);
  });

  it('"Clear" still empties the whole list', async () => {
    await start(SEED);
    await clickX('Berlin');
    await page.waitFor(`document.querySelectorAll('#recent .place-card').length === 3`, 5000);
    await page.evaluate(`document.getElementById('clear-recent').click()`);
    await page.waitFor(`document.querySelectorAll('#recent .place-card').length === 0`, 5000);
    expect((await saved()).recent).toEqual([]);
  });

  it('when the server cannot save, shows the banner and keeps the list as it was', async () => {
    await start(SEED);
    // The data file path becomes a folder, so the server's save (temp file + rename) really fails with a 500 (as in review.e2e.ts).
    const file = path.join(app!.dataDir, 'weather-dashboard.json');
    await rm(file);
    await mkdir(file);
    await clickX('London');
    await page.waitFor(`!document.getElementById('banner').hidden`, 5000);
    expect(await page.evaluate<string>(`document.getElementById('banner').textContent.trim()`)).toBe('Something went wrong');
    expect(await recentNames()).toEqual(['Tokyo', 'London', 'Berlin', 'Oslo']);
    expect(await placeName()).toBe('Tokyo');
    expect(app!.errors).toEqual([]);
  });
});

describe('layout with the "×" shown', () => {
  const WIDTHS = [480, 520, 600, 601, 700, 860, 960, 961, 1000, 1100, 1240, 1241, 1300, 1400];

  /** With each recent card focused (which shows its "×"): the "×" stays inside its card and off the visible name and country text. */
  const problems = (w: number) =>
    page.evaluate<string[]>(`(() => {
      const out = [];
      const r = (el) => el.getBoundingClientRect();
      const hit = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
      // The text a reader sees: the text's own extent, cut at its box (an ellipsis ends at the box edge).
      const ink = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const t = range.getBoundingClientRect(), box = r(el);
        return { left: Math.max(t.left, box.left), right: Math.min(t.right, box.right), top: Math.max(t.top, box.top), bottom: Math.min(t.bottom, box.bottom) };
      };
      for (const card of document.querySelectorAll('#recent .place-card')) {
        card.focus();
        const x = card.querySelector('.fav-remove');
        const name = card.querySelector('.fav-name').textContent;
        if (getComputedStyle(x).display === 'none') { out.push('× not shown on focus: ' + name); continue; }
        const xr = r(x), cr = r(card);
        if (xr.left < cr.left - 0.5 || xr.right > cr.right + 0.5 || xr.top < cr.top - 0.5 || xr.bottom > cr.bottom + 0.5) out.push('× outside its card: ' + name);
        for (const sel of ['.fav-name', '.fav-sub']) if (hit(xr, ink(card.querySelector(sel)))) out.push('× over ' + sel + ': ' + name);
      }
      document.activeElement.blur();
      const blocks = [...document.querySelectorAll('.card, .sidebar > section')].filter((el) => !el.hidden && r(el).height > 0);
      for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
        if (hit(r(blocks[i]), r(blocks[j]))) out.push('overlap ' + (blocks[i].id || blocks[i].className) + ' / ' + (blocks[j].id || blocks[j].className));
      }
      if (document.documentElement.scrollWidth > innerWidth) out.push('horizontal scroll at ${w}');
      return out;
    })()`);

  it('480 to 1400 px: the "×" never covers a city name or country, nothing overlaps, no horizontal scroll', async () => {
    await start({ ...SEED, recent: [tokyo, longName, london, berlin, oslo] }, { width: 480 });
    // Let every card get its weather first (the badge then has its normal width).
    await page.waitFor(`[...document.querySelectorAll('#recent .fav-weather')].every((w) => w.textContent.includes('°') || w.querySelector('.card-error'))`, 30_000);
    for (const w of WIDTHS) {
      await app!.resize(w, 860);
      await settle(250);
      expect(await page.evaluate<number>(`document.querySelectorAll('#recent .place-card').length`), `${w}`).toBe(5);
      expect(await problems(w), `width ${w}`).toEqual([]);
    }
    expect(app!.errors).toEqual([]);
  });
});

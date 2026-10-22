// v1.3 end-to-end tests: the full-day temperature chart (muted passed hours and the
// "now" dot) and the silent auto-refresh. Real Electron window, live Open-Meteo,
// animations on. Run with: npm run test:e2e

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  COLORS,
  countPixels,
  countPixelsBetween,
  launchApp,
  temperaturePainted,
  waitForDashboard,
  type AppPage,
  type LaunchedApp,
} from '../../scripts/launch';
import { localIsoIn } from '../../src/shared/time';

const tokyo = { id: 1850147, name: 'Tokyo', latitude: 35.6895, longitude: 139.69171, admin1: 'Tokyo', country: 'Japan', countryCode: 'JP', timezone: 'Asia/Tokyo' };

let app: LaunchedApp;
let page: AppPage;

/**
 * Runs before the app's own scripts on every load. It:
 *  - keeps the app's timers from firing by themselves (the 5-minute refresh and the
 *    1-minute "now" tick are held in window.__timers so a test can fire them on demand;
 *    the 30 s "Updated ... ago" redraw is sped up to 0.5 s);
 *  - lets a test shift what Date.now() returns (window.__skew) to make data look older;
 *  - records weather requests (window.__weather) and can make fresh=1 requests fail;
 *  - counts times the loading spinner class or the disabled refresh button showed up.
 */
const INIT_SCRIPT = `(() => {
  const realNow = Date.now.bind(Date);
  window.__skew = 0;
  Date.now = () => realNow() + window.__skew;

  window.__timers = {};
  const realSetInterval = window.setInterval.bind(window);
  window.setInterval = (fn, ms, ...rest) => {
    if (ms === 300000 || ms === 60000) { window.__timers[ms] = fn; return 0; }
    return realSetInterval(fn, ms === 30000 ? 500 : ms, ...rest);
  };

  window.__failFresh = false;
  window.__weather = { fresh: 0, failed: 0, lastFetchedAt: {}, lastCache: {} };
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = String(input);
    const isWeather = url.includes('/api/weather');
    const fresh = isWeather && url.includes('fresh=1');
    if (fresh) window.__weather.fresh++;
    if (fresh && window.__failFresh) {
      window.__weather.failed++;
      return new Response(JSON.stringify({ error: 'The weather service is unavailable' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
    const res = await realFetch(input, init);
    if (fresh && res.ok) {
      const body = await res.clone().json();
      window.__weather.lastFetchedAt[url] = body.data.fetchedAt;
      window.__weather.lastCache[url] = body.meta.cache;
      window.__skew = 0;
    }
    return res;
  };

  window.__spinnerSeen = 0;
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(() => {
      if (document.getElementById('main').classList.contains('is-loading') || document.getElementById('refresh').disabled) window.__spinnerSeen++;
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'disabled'] });
  });
})()`;

const text = (selector: string) => page.evaluate<string>(`document.querySelector(${JSON.stringify(selector)}).textContent.trim()`);

interface Geometry {
  nowX: number | null;
  nowY: number | null;
  dpr: number;
  cssWidth: number;
  /** Visible hourly strip items: hour index and the x of their centre on the chart. */
  items: { i: number; x: number }[];
}

const geometry = () =>
  page.evaluate<Geometry>(`(() => {
    const c = document.getElementById('temp-chart');
    const cr = c.getBoundingClientRect();
    const items = [...document.querySelectorAll('#temp-strip .hour')]
      .filter((e) => e.style.visibility !== 'hidden')
      .map((e) => { const r = e.getBoundingClientRect(); return { i: Number(e.dataset.index), x: r.left + r.width / 2 - cr.left }; });
    return { nowX: c.dataset.nowX === undefined ? null : Number(c.dataset.nowX), nowY: c.dataset.nowY === undefined ? null : Number(c.dataset.nowY), dpr: devicePixelRatio, cssWidth: cr.width, items };
  })()`);

/** Fractional hour of the day in Tokyo right now (the same clock the app uses). */
function tokyoPos(): number {
  const t = localIsoIn('Asia/Tokyo');
  return Number(t.slice(11, 13)) + Number(t.slice(14, 16)) / 60;
}

const countIn = (color: string, x0: string, x1: string) => page.evaluate<number>(countPixelsBetween('temp-chart', color, x0, x1));

const clickDay = (index: number) => page.evaluate(`document.querySelectorAll('.forecast .day')[${index}].click()`);

beforeAll(async () => {
  app = await launchApp({ lastPlace: tokyo, favorites: [tokyo], recent: [tokyo], settings: { units: 'metric', timeFormat: '12h' } });
  page = app.page;
  await page.reloadWithScript(INIT_SCRIPT);
  await waitForDashboard(page);
});

afterAll(async () => {
  await app.close();
});

describe('temperature chart covers the whole day', () => {
  it('titles the card "Temperature · Today" and plots 24 hours from 12 AM to 11 PM', async () => {
    expect(await text('#temp-title')).toBe('Temperature · Today');
    const labels = await page.evaluate<string[]>(`JSON.parse(document.getElementById('temp-chart').dataset.labels)`);
    expect(labels).toHaveLength(24);
    expect(labels.filter((l) => l === 'Now')).toHaveLength(1);
    expect(labels[0] === '12 AM' || labels[0] === 'Now').toBe(true);
    expect(labels[23] === '11 PM' || labels[23] === 'Now').toBe(true);
    const times = await page.evaluate<[string, number, number][]>(`JSON.parse(document.getElementById('temp-data').dataset.values)`);
    expect(times).toHaveLength(24);
    expect(times[0]![0].endsWith('T00:00')).toBe(true);
    expect(times[23]![0].endsWith('T23:00')).toBe(true);
    expect(await text('#temp-summary')).toMatch(/^High -?\d+° at \d{1,2} (AM|PM) · Low -?\d+° at \d{1,2} (AM|PM)$/);
  });

  it('the hourly strip covers the day and marks the current hour "Now"', async () => {
    const strip = await page.evaluate<string[]>(`[...document.querySelectorAll('#temp-strip .hour-time')].map((e) => e.textContent)`);
    expect(strip.filter((s) => s === 'Now')).toHaveLength(1);
    expect(strip.length).toBeGreaterThanOrEqual(7); // every 3rd hour, minus those next to "Now", plus "Now"
    expect(strip.every((s) => s === 'Now' || /^\d{1,2} (AM|PM)$/.test(s))).toBe(true);
  });

  it('draws the dot at the city\'s current time (Tokyo, whatever the PC clock says)', async () => {
    await page.waitFor(`document.getElementById('temp-chart').dataset.nowX !== undefined`, 8000);
    const before = tokyoPos();
    const g = await geometry();
    const after = tokyoPos();
    expect(g.nowX).not.toBeNull();

    // Two hourly strip items sit under their points; use them as a ruler for the x axis.
    const ruler = g.items.filter((it) => it.i >= 3 && it.i <= 20);
    expect(ruler.length).toBeGreaterThanOrEqual(2);
    const a = ruler[0]!;
    const b = ruler[ruler.length - 1]!;
    const perHour = (b.x - a.x) / (b.i - a.i);
    const expected = (pos: number) => a.x + perHour * (pos - a.i);
    const lo = Math.min(expected(before), expected(after)) - 3;
    const hi = Math.max(expected(before), expected(after)) + 3;
    expect(g.nowX!).toBeGreaterThanOrEqual(lo);
    expect(g.nowX!).toBeLessThanOrEqual(hi);

    // And the dot is really painted there: its centre is the series orange.
    const centre = await page.evaluate<boolean>(`(() => {
      const c = document.getElementById('temp-chart');
      const [r, g, b, a] = c.getContext('2d').getImageData(Math.round(${g.nowX} * devicePixelRatio), Math.round(${g.nowY} * devicePixelRatio), 1, 1).data;
      return a > 150 && r > 220 && g > 140 && g < 210 && b < 120;
    })()`);
    expect(centre).toBe(true);
  });

  it('the part of the day that has passed is grey, the rest keeps its colours', async () => {
    await page.waitFor(`${temperaturePainted()} > 150`, 8000);
    const g = await geometry();
    const gap = 14; // keep the dot and its halo out of both regions
    const leftEnd = `(${g.nowX} - ${gap}) * devicePixelRatio`;
    const rightStart = `(${g.nowX} + ${gap}) * devicePixelRatio`;
    const rightEnd = 'Infinity';

    // Nothing coloured has been drawn before now: no orange line or fill, no lilac feels-like.
    expect(await countIn(COLORS.temperature, '0', leftEnd)).toBe(0);
    expect(await countIn(COLORS.feelsLike, '0', leftEnd)).toBe(0);
    // And nothing grey after it.
    expect(await countIn(COLORS.passed, rightStart, rightEnd)).toBe(0);

    // Where there is room (early or late in Tokyo's day one side is tiny) each side has its own colour.
    if (g.nowX! > 90) expect(await countIn(COLORS.passed, '0', leftEnd)).toBeGreaterThan(20);
    if (g.cssWidth - g.nowX! > 60) {
      expect(await countIn(COLORS.temperature, rightStart, rightEnd)).toBeGreaterThan(20);
    }
  });

  it('other days are fully coloured with no dot, and today brings the dot back', async () => {
    await clickDay(1);
    await page.waitFor(`/^Temperature · Tomorrow/.test(document.getElementById('temp-title').textContent)`, 3000);
    await page.waitFor(`${countPixels('temp-chart', COLORS.temperature)} > 150`, 8000);
    await page.waitFor(`${countPixels('temp-chart', COLORS.feelsLike)} > 60`, 8000);
    expect((await geometry()).nowX).toBeNull();
    expect(await page.evaluate<number>(countPixels('temp-chart', COLORS.passed))).toBe(0);
    const labels = await page.evaluate<string[]>(`JSON.parse(document.getElementById('temp-chart').dataset.labels)`);
    expect(labels).toHaveLength(24);
    expect(labels).not.toContain('Now');

    await clickDay(0);
    await page.waitFor(`document.getElementById('temp-title').textContent === 'Temperature · Today'`, 3000);
    await page.waitFor(`document.getElementById('temp-chart').dataset.nowX !== undefined`, 8000);
  });

  it('the one-minute tick keeps the dot where the city\'s time says (no jump, no errors)', async () => {
    const before = (await geometry()).nowX!;
    await page.evaluate(`window.__timers[60000]()`);
    await new Promise((r) => setTimeout(r, 600));
    const after = (await geometry()).nowX!;
    expect(Math.abs(after - before)).toBeLessThan(3);
  });
});

describe('auto-refresh', () => {
  const ageText = () => text('#updated-text');
  const fresh = () => page.evaluate<number>(`window.__weather.fresh`);
  const tokyoFetchedAt = () =>
    page.evaluate<string | undefined>(`Object.entries(window.__weather.lastFetchedAt).find(([u]) => u.includes('lat=35.6895'))?.[1]`);

  it('is scheduled every 5 minutes', async () => {
    expect(await page.evaluate<boolean>(`typeof window.__timers[300000] === 'function'`)).toBe(true);
  });

  it('keeps old data and the old time when a refresh fails, without a spinner or banner', async () => {
    await page.evaluate(`window.__skew = 90000`); // pretend the data is 90 s old
    await page.waitFor(`/^Updated 1 minute ago/.test(document.getElementById('updated-text').textContent)`, 3000);
    const hourly = await page.evaluate<string>(`document.getElementById('temp-data').dataset.values`);
    await page.evaluate(`window.__spinnerSeen = 0; window.__failFresh = true; window.__timers[300000]()`);
    await page.waitFor(`window.__weather.failed >= 1`, 5000);
    await new Promise((r) => setTimeout(r, 1500)); // let the "Updated" text redraw (every 0.5 s here)

    expect(await ageText()).toMatch(/^Updated 1 minute ago/); // the old time, not "just now"
    expect(await page.evaluate<boolean>(`document.getElementById('banner').hidden`)).toBe(true);
    expect(await page.evaluate<number>(`window.__spinnerSeen`)).toBe(0);
    expect(await page.evaluate<string>(`document.getElementById('temp-data').dataset.values`)).toBe(hourly);
    expect(await page.evaluate<boolean>(`document.querySelector('.forecast .day[aria-checked="true"]') !== null`)).toBe(true);
    await page.waitFor(`${temperaturePainted()} > 150`, 3000);
  });

  it('refreshes by itself with fresh data, no spinner, and keeps day, scroll and the open Settings panel', async () => {
    await app.resize(1000, 480); // small enough that the page scrolls
    await clickDay(2);
    await page.evaluate(`document.querySelector('.layout').scrollTop = 120`);
    await page.evaluate(`document.getElementById('settings-button').click()`);
    await page.waitFor(`document.getElementById('settings').classList.contains('is-open')`, 2000);
    await new Promise((r) => setTimeout(r, 500));
    const scrollBefore = await page.evaluate<number>(`document.querySelector('.layout').scrollTop`);
    expect(scrollBefore).toBeGreaterThan(0);
    const titleBefore = await text('#temp-title');
    const fetchedBefore = await tokyoFetchedAt();

    await page.evaluate(`window.__skew = 90000; window.__failFresh = false; window.__spinnerSeen = 0`);
    await page.waitFor(`/^Updated 1 minute ago/.test(document.getElementById('updated-text').textContent)`, 3000);
    const freshBefore = await fresh();
    await page.evaluate(`window.__timers[300000]()`);
    // The refresh lands: a new server timestamp, and the age text goes back to "just now".
    await page.waitFor(`/^Updated just now/.test(document.getElementById('updated-text').textContent)`, 8000);
    expect(await fresh()).toBeGreaterThan(freshBefore);
    const fetchedAfter = await tokyoFetchedAt();
    expect(fetchedAfter).toBeDefined();
    expect(fetchedAfter).not.toBe(fetchedBefore);
    expect(await ageText()).not.toMatch(/from cache/); // a refresh never answers from the server's cache
    expect(await page.evaluate<string[]>(`Object.values(window.__weather.lastCache)`)).not.toContain('HIT');

    expect(await page.evaluate<number>(`window.__spinnerSeen`)).toBe(0);
    expect(await text('#temp-title')).toBe(titleBefore); // still the day we picked
    expect(await page.evaluate<number>(`[...document.querySelectorAll('.forecast .day')].findIndex((d) => d.getAttribute('aria-checked') === 'true')`)).toBe(2);
    expect(await page.evaluate<number>(`document.querySelector('.layout').scrollTop`)).toBe(scrollBefore);
    expect(await page.evaluate<boolean>(`document.getElementById('settings').classList.contains('is-open')`)).toBe(true);
    expect(await page.evaluate<boolean>(`document.getElementById('banner').hidden`)).toBe(true);
    await page.waitFor(`${temperaturePainted()} > 150`, 3000);
  });

  it('threw no page exceptions', () => {
    expect(app.errors).toEqual([]);
  });
});

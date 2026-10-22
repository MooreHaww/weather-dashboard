// Captures the three README theme screenshots (docs/theme-clear.png, docs/theme-night.png,
// docs/theme-rain.png) from the real, built app. Run with: npm run screenshot
//
// The weather decides the theme, so each scene is set up on purpose. The app is launched
// with an injected script (the same technique the e2e tests use) that:
//  - moves the clock: Date is shifted so London's local time reads the scene's time of day;
//  - rewrites every /api/weather response: today's weather code, the hourly codes and rain
//    chances, the 7-day codes and the day/night flag. Temperatures, wind and the rest stay
//    as Open-Meteo sent them.
// So these pictures show each theme; they are not a record of the real weather.
// All three use the same window size (1360x900), the same city and favorites, and a clean
// data folder with Settings closed. Images are captured at 1x and run through optimizePng
// (colour channels rounded to even values, which is invisible) so each file is about 250 KB or less.

import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { localIsoIn } from '../src/shared/time';
import type { Place } from '../src/shared/types';
import { COLORS, countPixels, launchApp, temperaturePainted, waitForDashboard } from './launch';
import { optimizePng } from './optimize-png';

const CITIES: Place[] = [
  { id: 2643743, name: 'London', latitude: 51.50853, longitude: -0.12574, admin1: 'England', country: 'United Kingdom', countryCode: 'GB', timezone: 'Europe/London' },
  { id: 1850147, name: 'Tokyo', latitude: 35.6895, longitude: 139.69171, admin1: 'Tokyo', country: 'Japan', countryCode: 'JP' },
  { id: 5128581, name: 'New York', latitude: 40.71427, longitude: -74.00597, admin1: 'New York', country: 'United States', countryCode: 'US' },
  { id: 1880252, name: 'Singapore', latitude: 1.28967, longitude: 103.85007, country: 'Singapore', countryCode: 'SG' },
  { id: 2147714, name: 'Sydney', latitude: -33.86785, longitude: 151.20732, admin1: 'New South Wales', country: 'Australia', countryCode: 'AU' },
];
const CITY = CITIES[0]!; // every shot is London, so only the weather and time of day differ
const SIZE = { width: 1360, height: 900 };

interface Scene {
  file: string;
  /** The theme this scene is for (document.body.dataset.theme). */
  theme: string;
  /** What the city's clock reads, as "HH:mm". */
  time: string;
  /** Open-Meteo weather code for today and the week: 0 = clear sky, 63 = rain. */
  code: number;
  rain: boolean;
}

const SCENES: Scene[] = [
  { file: 'theme-clear.png', theme: 'clear-day', time: '11:30', code: 0, rain: false },
  { file: 'theme-night.png', theme: 'clear-night', time: '22:30', code: 0, rain: false },
  { file: 'theme-rain.png', theme: 'rain-day', time: '15:20', code: 63, rain: true },
];

/** Runs in the page before the app's own scripts. */
function sceneScript(scene: Scene, skewMs: number): string {
  return `(() => {
    const scene = ${JSON.stringify(scene)};
    const RealDate = Date;
    const skew = ${skewMs};
    class FakeDate extends RealDate {
      constructor(...a) { if (a.length === 0) super(RealDate.now() + skew); else super(...a); }
      static now() { return RealDate.now() + skew; }
    }
    window.Date = FakeDate;

    const [hh, mm] = scene.time.split(':').map(Number);
    // Rain peaks mid-afternoon and fades out; a dry day has next to none.
    const chance = (h) => (scene.rain ? Math.max(8, 92 - Math.abs(h - 16) * 9) : h % 3);

    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const res = await realFetch(input, init);
      if (!String(input).includes('/api/weather') || !res.ok) return res;
      const body = await res.json();
      const d = body.data;
      const today = d.current.time.slice(0, 10);
      const idx = d.hourly.time.findIndex((t) => t.slice(0, 13) === today + 'T' + String(hh).padStart(2, '0'));
      d.current.time = today + 'T' + scene.time;
      d.current.isDay = d.hourly.isDay[idx];
      d.current.weatherCode = scene.code;
      d.hourly.time.forEach((t, i) => {
        if (!t.startsWith(today)) return;
        const p = chance(Number(t.slice(11, 13)));
        d.hourly.precipitationProbability[i] = p;
        d.hourly.weatherCode[i] = scene.rain && p >= 40 ? scene.code : scene.rain ? 3 : 0;
      });
      d.daily.weatherCode = d.daily.weatherCode.map(() => scene.code);
      d.daily.precipitationProbabilityMax = d.daily.precipitationProbabilityMax.map((_, i) => (scene.rain ? 88 - i * 6 : i % 3));
      d.fetchedAt = new Date().toISOString();
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  })()`;
}

async function capture(scene: Scene): Promise<void> {
  const favorites = CITIES;
  const recent = CITIES;
  const app = await launchApp({ favorites, recent, lastPlace: CITY, settings: { units: 'metric', timeFormat: '12h' } });
  const { page } = app;
  try {
    // Shift the clock so London reads the scene's time (same date, so the forecast days line up).
    const now = localIsoIn(CITY.timezone!);
    const nowMin = Number(now.slice(11, 13)) * 60 + Number(now.slice(14, 16));
    const [hh, mm] = scene.time.split(':').map(Number);
    await page.reloadWithScript(sceneScript(scene, ((hh! * 60 + mm!) - nowMin) * 60_000));
    await app.resize(SIZE.width, SIZE.height);
    await waitForDashboard(page);
    await page.waitFor(`document.body.dataset.theme === ${JSON.stringify(scene.theme)}`, 10_000);
    // Every city card has finished loading, and the charts have painted.
    await page.waitFor(`!document.querySelector('.fav-weather [aria-label="Loading weather"]')`, 30_000);
    await page.waitFor(`${temperaturePainted()} > 150`, 10_000);
    if (scene.rain) await page.waitFor(`${countPixels('rain-chart', COLORS.rainBars)} > 200`, 10_000);
    await new Promise((r) => setTimeout(r, 1500)); // let animations settle
    if (app.errors.length) throw new Error(`Page errors:\n${app.errors.join('\n')}`);

    const out = path.join(__dirname, '..', 'docs', scene.file);
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, optimizePng(await page.screenshot({ cssPixels: true }), 2));
    const kb = Math.round((await stat(out)).size / 1024);
    console.log(`Saved ${path.relative(process.cwd(), out)} (${scene.theme}, clock ${scene.time}, ${kb} KB)`);
  } finally {
    await app.close();
  }
}

async function main() {
  for (const scene of SCENES) await capture(scene);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Captures the README screenshots from the real, built app: the glass look (docs/theme-clear.png,
// docs/theme-night.png, docs/theme-rain.png) and, since 1.7, the classic look (docs/classic-clear.png,
// docs/classic-night.png, docs/classic-rain.png). Run with: npm run screenshot
// Only some: npm run screenshot -- classic (or glass, or part of a file name).
//
// The weather decides the theme, so each scene is set up on purpose. The app is launched
// with an injected script (the same technique the e2e tests use) that:
//  - moves the clock: Date is shifted so London's local time reads the scene's time of day (since 1.7.1 local
//    noon for clear and rain, local midnight for night, so none falls in sunset or dusk by accident);
//  - rewrites every /api/weather response: today's weather code, the hourly codes, rain chances and
//    amounts, the 7-day codes and the day/night flag. Temperatures, wind, sunrise, sunset and the rest stay
//    as Open-Meteo sent them.
// So these pictures show each theme; they are not a record of the real weather.
// All three use the same window size (1360x900), the same city and favorites, and a clean
// data folder with Settings closed. Images are captured at 1x and run through optimizePng
// (colour channels rounded to even values, which is invisible). Since 1.6 each file is about 220-240 KB
// (1.5.1's shots were about 250 KB).
//
// Since 1.6 the window is Windows' acrylic glass, which shows what is behind the window, and a page
// screenshot (CDP) cannot see it (Windows draws it behind the page). So each shot is taken over a
// controlled backdrop: a plain window filled with flat mid-grey #808080 covers the screen behind the app
// (scripts/screen.ts), the app is kept in front and focused (unfocused, Windows shows flat grey instead
// of the glass), and the window's area of the real screen is captured with Electron's desktopCapturer.
// On a PC without the glass effect the same steps give the plain dark look.

import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { localIsoIn } from '../src/shared/time';
import type { Place } from '../src/shared/types';
import { COLORS, countPixels, launchApp, temperaturePainted, waitForDashboard } from './launch';
import { optimizePng } from './optimize-png';
import { captureWindow, removeBackdrop, showBackdrop } from './screen';

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
  /** Settings > Look (1.7). Glass shows only where Windows can draw it. */
  look: 'glass' | 'classic';
  /** The theme this scene is for (document.body.dataset.theme). */
  theme: string;
  /** What the city's clock reads, as "HH:mm". */
  time: string;
  /** Open-Meteo weather code for today and the week: 0 = clear sky, 63 = rain. */
  code: number;
  rain: boolean;
}

const SCENES: Scene[] = [
  { file: 'theme-clear.png', look: 'glass', theme: 'clear-day', time: '12:00', code: 0, rain: false },
  { file: 'theme-night.png', look: 'glass', theme: 'clear-night', time: '00:00', code: 0, rain: false },
  { file: 'theme-rain.png', look: 'glass', theme: 'rain-day', time: '12:00', code: 63, rain: true },
  { file: 'classic-clear.png', look: 'classic', theme: 'clear-day', time: '12:00', code: 0, rain: false },
  { file: 'classic-night.png', look: 'classic', theme: 'clear-night', time: '00:00', code: 0, rain: false },
  { file: 'classic-rain.png', look: 'classic', theme: 'rain-day', time: '12:00', code: 63, rain: true },
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
    // The amount follows it: heavy at the peak, moderate around it, light on the way there, none on a dry day.
    const amount = (h) => {
      if (!scene.rain) return 0;
      const away = Math.abs(h - 16);
      return away === 0 ? 9 : away === 1 ? 5 : away === 2 ? 3 : away <= 5 ? 1 : 0;
    };

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
        if (d.hourly.precipitation) d.hourly.precipitation[i] = amount(Number(t.slice(11, 13)));
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
  const app = await launchApp({ favorites, recent, lastPlace: CITY, settings: { units: 'metric', timeFormat: '12h', appearance: scene.look } });
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
    if (scene.look === 'classic') await page.waitFor(`document.documentElement.dataset.material === 'solid'`, 5000);
    // Every city card has finished loading, and the charts have painted.
    await page.waitFor(`!document.querySelector('.fav-weather [aria-label="Loading weather"]')`, 30_000);
    await page.waitFor(`${temperaturePainted()} > 150`, 10_000);
    if (scene.rain) await page.waitFor(`${countPixels('rain-chart', COLORS.rainBars)} > 200`, 10_000);
    await showBackdrop(app, 'grey'); // also brings the app to the front and focuses it
    await new Promise((r) => setTimeout(r, 2500)); // let animations settle (the sky's fade is 2 s)
    if (app.errors.length) throw new Error(`Page errors:\n${app.errors.join('\n')}`);

    const out = path.join(__dirname, '..', 'docs', scene.file);
    await mkdir(path.dirname(out), { recursive: true });
    const png = await captureWindow(app);
    await removeBackdrop(app);
    await writeFile(out, optimizePng(png, 2));
    const kb = Math.round((await stat(out)).size / 1024);
    console.log(`Saved ${path.relative(process.cwd(), out)} (${scene.look}, ${scene.theme}, clock ${scene.time}, ${kb} KB)`);
  } finally {
    await app.close();
  }
}

async function main() {
  const only = process.argv[2];
  const scenes = only ? SCENES.filter((s) => s.look === only || s.file.includes(only)) : SCENES;
  if (!scenes.length) throw new Error(`No scene matches "${only}"`);
  for (const scene of scenes) await capture(scene);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

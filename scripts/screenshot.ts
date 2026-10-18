// Captures docs/screenshot.png for the README from the real, built app.
// Picks a favorite where rain is on the way today, so the rain section has something to show.
// Run with: npm run screenshot

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { forecast } from '../src/server/openMeteo';
import { rainSummary } from '../src/shared/rain';
import { localIsoIn } from '../src/shared/time';
import type { Place } from '../src/shared/types';
import { COLORS, countPixels, launchApp, waitForDashboard } from './launch';

const CITIES: Place[] = [
  { id: 1850147, name: 'Tokyo', latitude: 35.6895, longitude: 139.69171, admin1: 'Tokyo', country: 'Japan', countryCode: 'JP' },
  { id: 2643743, name: 'London', latitude: 51.50853, longitude: -0.12574, admin1: 'England', country: 'United Kingdom', countryCode: 'GB' },
  { id: 5128581, name: 'New York', latitude: 40.71427, longitude: -74.00597, admin1: 'New York', country: 'United States', countryCode: 'US' },
  { id: 1880252, name: 'Singapore', latitude: 1.28967, longitude: 103.85007, country: 'Singapore', countryCode: 'SG' },
  { id: 2147714, name: 'Sydney', latitude: -33.86785, longitude: 151.20732, admin1: 'New South Wales', country: 'Australia', countryCode: 'AU' },
  { id: 3413829, name: 'Reykjavík', latitude: 64.13548, longitude: -21.89541, admin1: 'Capital Region', country: 'Iceland', countryCode: 'IS' },
];

async function pickShowcase(): Promise<Place> {
  const rank = { likely: 2, chance: 1, none: 0 } as const;
  let best = { place: CITIES[0]!, score: -1 };
  for (const place of CITIES) {
    try {
      const w = await forecast(fetch, place.latitude, place.longitude, 'metric');
      const score = rank[rainSummary(w.hourly, localIsoIn(w.timezone)).level];
      if (score > best.score) best = { place, score };
      if (score === 2) break;
    } catch {
      // skip cities that fail
    }
  }
  return best.place;
}

async function main() {
  const showcase = await pickShowcase();
  console.log(`Showcase city: ${showcase.name}`);
  const favorites = CITIES.slice(0, 5);
  const recent = [showcase, ...CITIES.filter((c) => c.id !== showcase.id)].slice(0, 5);

  const app = await launchApp({ favorites, recent, lastPlace: showcase, settings: { units: 'metric' } });
  const { page } = app;
  try {
    await app.resize(1440, 960);
    await waitForDashboard(page);
    // Every city card has finished loading (icon, or "—" if Open-Meteo failed for it).
    await page.waitFor(`!document.querySelector('.fav-weather [aria-label="Loading weather"]')`, 30_000);
    // Wait until the charts have painted, then for the animation to settle.
    await page.waitFor(`${countPixels('temp-chart', COLORS.temperature)} > 150`, 10_000);
    await new Promise((r) => setTimeout(r, 1000));
    if (app.errors.length) throw new Error(`Page errors:\n${app.errors.join('\n')}`);

    const out = path.join(__dirname, '..', 'docs', 'screenshot.png');
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, await page.screenshot());
    console.log(`Saved ${path.relative(process.cwd(), out)}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

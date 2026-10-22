// End-to-end test of the built Electron app (real Open-Meteo calls, animations on).
// Run with: npm run test:e2e

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COLORS, countPixels, launchApp, temperaturePainted, waitForDashboard, type AppPage, type LaunchedApp } from '../../scripts/launch';
import { localIsoIn } from '../../src/shared/time';

const tokyo = { id: 1850147, name: 'Tokyo', latitude: 35.6895, longitude: 139.69171, admin1: 'Tokyo', country: 'Japan', countryCode: 'JP' };
const london = { id: 2643743, name: 'London', latitude: 51.50853, longitude: -0.12574, admin1: 'England', country: 'United Kingdom', countryCode: 'GB' };
const paris = { id: 2988507, name: 'Paris', latitude: 48.85341, longitude: 2.3488, admin1: 'Île-de-France', country: 'France', countryCode: 'FR' };

let app: LaunchedApp;
let page: AppPage;

const text = (selector: string) => page.evaluate<string>(`document.querySelector(${JSON.stringify(selector)}).textContent.trim()`);
const rainValues = () => page.evaluate<[string, number][]>(`JSON.parse(document.getElementById('rain-data').dataset.values)`);
const tempValues = () => page.evaluate<[string, number, number][]>(`JSON.parse(document.getElementById('temp-data').dataset.values)`);

/** Wait until the charts have actually painted their data (animations finish within ~0.5 s). */
async function expectChartsDrawn() {
  await page.waitFor(`${temperaturePainted()} > 150`, 8000);
  await page.waitFor(`${countPixels('temp-chart', COLORS.feelsLike)} + ${countPixels('temp-chart', COLORS.passed)} > 60`, 8000);
  // Hours that already passed are drawn very faintly, so only upcoming hours decide whether bars must show.
  const tokyoNow = localIsoIn('Asia/Tokyo').slice(0, 13);
  const upcoming = (await rainValues()).filter(([t]) => t.slice(0, 13) >= tokyoNow);
  const maxRain = Math.max(0, ...upcoming.map(([, p]) => p));
  if (maxRain >= 5) {
    await page.waitFor(`${countPixels('rain-chart', COLORS.rainBars)} > 30`, 8000);
  } else {
    expect(await text('#rain-summary')).toMatch(/^No rain expected/);
  }
}

beforeAll(async () => {
  app = await launchApp({ lastPlace: tokyo, favorites: [], recent: [london, paris], settings: { units: 'metric' } });
  page = app.page;
  await waitForDashboard(page);
});

afterAll(async () => {
  await app?.close();
});

describe('Weather Dashboard (built app)', () => {
  it('shows the last viewed city with current conditions', async () => {
    expect(await text('.place-name')).toBe('Tokyo');
    expect(await text('.hero-temp')).toMatch(/^-?\d+°C$/);
    const labels = await page.evaluate<string[]>(`[...document.querySelectorAll('.stat-label span')].map(e => e.textContent)`);
    expect(labels).toEqual(['Feels like', 'Wind', 'Humidity', 'Rain chance', 'Sunrise', 'Sunset']);
  });

  it("shows Tokyo's clock, not the PC's", async () => {
    expect(await text('#clock-offset')).toBe('UTC+9');
    const shownHour = Number((await text('#clock-time')).split(':')[0]);
    const tokyoHour = (h: Date) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric' }).format(h).split(' ')[0]);
    // Allow for the hour changing between the two reads.
    expect([tokyoHour(new Date()), tokyoHour(new Date(Date.now() - 5000))]).toContain(shownHour);
  });

  it('draws real data in both charts (not just empty axes)', async () => {
    expect((await tempValues()).length).toBe(24); // the whole local day, 12 AM to 11 PM
    expect((await rainValues()).length).toBe(24);
    await expectChartsDrawn();
  });

  it('renders 7 forecast cards with weekday, date, high/low and rain chance; today selected', async () => {
    const cards = await page.evaluate<{ text: string; checked: string | null }[]>(
      `[...document.querySelectorAll('.forecast .day')].map(d => ({ text: d.innerText, checked: d.getAttribute('aria-checked') }))`,
    );
    expect(cards).toHaveLength(7);
    expect(cards[0]!.text).toMatch(/^Today/);
    expect(cards.map((c) => c.checked)).toEqual(['true', 'false', 'false', 'false', 'false', 'false', 'false']);
    for (const c of cards) {
      expect(c.text).toMatch(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}/);
      expect(c.text).toMatch(/-?\d+°\s+-?\d+°/);
      expect(c.text).toMatch(/\d+%/);
    }
    expect(await text('#rain-title')).toBe('Rain today');
  });

  it('clicking a day switches the rain and temperature cards to that day', async () => {
    const dates = await page.evaluate<string[]>(`[...document.querySelectorAll('.forecast .day')].map(d => d.dataset.date)`);
    await page.evaluate(`document.querySelectorAll('.forecast .day')[1].click()`);

    expect(await page.evaluate(`document.querySelectorAll('.forecast .day')[1].getAttribute('aria-checked')`)).toBe('true');
    expect(await text('#rain-title')).toMatch(/^Rain · Tomorrow, \w{3} \d{1,2}$/);
    expect(await text('#temp-title')).toMatch(/^Temperature · Tomorrow, \w{3} \d{1,2}$/);

    const rain = await rainValues();
    expect(rain).toHaveLength(24);
    expect(rain.every(([t]) => t.startsWith(dates[1]!))).toBe(true);
    const temp = await tempValues();
    expect(temp).toHaveLength(24);
    expect(temp.every(([t]) => t.startsWith(dates[1]!))).toBe(true);

    // The summary line matches that day's data.
    const summary = await text('#rain-summary');
    const likely = rain.find(([, p]) => p >= 50);
    if (likely) expect(summary).toMatch(/^Rain likely at \d{1,2} (AM|PM) \(\d+%\)$/);
    else expect(summary).not.toMatch(/now|rest of today/);
    await expectChartsDrawn();
  });

  it('selects days with the keyboard (arrows, Home, End)', async () => {
    const checkedIndex = () =>
      page.evaluate<number>(`[...document.querySelectorAll('.forecast .day')].findIndex(d => d.getAttribute('aria-checked') === 'true')`);
    const focusedIndex = () => page.evaluate<number>(`[...document.querySelectorAll('.forecast .day')].indexOf(document.activeElement)`);

    await page.evaluate(`document.querySelector('.forecast .day[aria-checked="true"]').focus()`);
    await page.press('ArrowRight');
    expect(await checkedIndex()).toBe(2);
    expect(await focusedIndex()).toBe(2);
    expect(await text('#rain-title')).toMatch(/^Rain · \w+day, \w{3} \d{1,2}$/);

    await page.press('End');
    expect(await checkedIndex()).toBe(6);
    await page.press('Home');
    expect(await checkedIndex()).toBe(0);
    expect(await text('#rain-title')).toBe('Rain today');
    expect(await text('#temp-title')).toBe('Temperature · Today');
  });

  it('shows recent cities as full cards with weather', async () => {
    await page.waitFor(`document.querySelectorAll('#recent .place-card .fav-icon, #recent .place-card .card-error').length === 2`, 20_000);
    const cards = await page.evaluate<string[]>(`[...document.querySelectorAll('#recent .place-card')].map(c => c.innerText)`);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatch(/London\s+United Kingdom/);
    expect(cards[1]).toMatch(/Paris\s+France/);
  });

  it('saves a favorite to the local JSON file, with a gold accent', async () => {
    await page.evaluate(`document.getElementById('star').click()`);
    await page.waitFor(`document.querySelectorAll('#favorites .place-card.fav').length === 1`);
    const saved = JSON.parse(await readFile(path.join(app.dataDir, 'weather-dashboard.json'), 'utf8'));
    expect(saved.favorites.map((f: { name: string }) => f.name)).toEqual(['Tokyo']);
    const bar = await page.evaluate<string>(`getComputedStyle(document.querySelector('#favorites .place-card.is-active'), '::before').backgroundColor`);
    expect(bar).toBe('rgb(251, 191, 36)');
  });

  it('switches to Fahrenheit and redraws the charts', async () => {
    // Units are only changed in Settings now (no toggle in the title bar).
    await page.evaluate(`document.getElementById('settings-button').click()`);
    await page.waitFor(`document.querySelector('#settings-sections button[data-value="imperial"]')`);
    await page.evaluate(`document.querySelector('#settings-sections button[data-value="imperial"]').click()`);
    await page.waitFor(`document.querySelector('.hero-temp').textContent.endsWith('°F')`);
    // Wind speed is its own setting now: switching to °F no longer changes it.
    expect(await page.evaluate<string>(`document.querySelectorAll('.stat-value small')[0].textContent`)).toBe('km/h');
    await page.evaluate(`document.querySelector('.settings-close').click()`);
    await page.waitFor(`document.getElementById('settings').hidden`, 2000);
    await expectChartsDrawn();
  });

  it('threw no errors in the window', () => {
    expect(app.errors).toEqual([]);
  });
});

// @vitest-environment happy-dom
// The hero card is a polite live region (a new city or new weather is announced),
// but the live clock inside it changes every second and must not be announced.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderHero } from '../src/renderer/components/hero';
import { forecast } from '../src/server/openMeteo';
import { rainSummary } from '../src/shared/rain';
import type { HourlySeries, TimeFormat } from '../src/shared/types';

async function tokyoWeather() {
  const json = await readFile(path.join(__dirname, 'fixtures', 'forecast-tokyo.json'), 'utf8');
  return forecast(async () => new Response(json, { status: 200 }), 35.69, 139.69, 'metric');
}

/** One day of hours, with the given chances and, when given, amounts (any other hour 0). */
function day(chances: Record<number, number>, mm?: Record<number, number>): HourlySeries {
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const time = hours.map((h) => `2026-10-17T${String(h).padStart(2, '0')}:00`);
  return {
    time,
    precipitationProbability: hours.map((h) => chances[h] ?? 0),
    ...(mm ? { precipitation: hours.map((h) => mm[h] ?? 0) } : {}),
    temperature: hours.map(() => 20),
    apparentTemperature: hours.map(() => 19),
    weatherCode: hours.map(() => 0),
    isDay: hours.map(() => true),
  };
}

describe('hero card: the rain line follows the headline', () => {
  const NOW = '2026-10-17T08:00';

  async function rainLine(hourly: HourlySeries, format: TimeFormat = '12h') {
    const w = await tokyoWeather();
    const hero = document.createElement('section');
    renderHero(hero, { id: 1, name: 'Tokyo', latitude: 35.69, longitude: 139.69 }, { ...w, hourly }, false, NOW, format);
    const stat = [...hero.querySelectorAll('.stat')].find((s) => s.querySelector('.stat-label')!.textContent === 'Rain chance')!;
    return { sub: stat.querySelector('.stat-sub')!.textContent, headline: rainSummary(hourly, NOW, undefined, format).text };
  }

  it('only dry high-chance hours: dry in both', async () => {
    const { sub, headline } = await rainLine(day({ 9: 90 }, {}));
    expect(sub).toBe('Rest of today: dry');
    expect(headline).toBe('No rain expected · highest chance 90% at 9 AM');
  });

  it('a dry 90% hour before a 60% hour with 1.2 mm: both name the wet hour', async () => {
    const { sub, headline } = await rainLine(day({ 9: 90, 14: 60 }, { 14: 1.2 }));
    expect(sub).toBe('Peak 2 PM');
    expect(headline).toBe('60% chance of light rain around 2 PM · about 1.2 mm');
  });

  it('a low chance with a real amount: both name that hour', async () => {
    const { sub, headline } = await rainLine(day({ 11: 40, 15: 20 }, { 15: 0.3 }));
    expect(sub).toBe('Peak 3 PM');
    expect(headline).toBe('20% chance of light rain around 3 PM · about 0.3 mm');
  });

  it('old data without amounts: the chance alone decides, as before', async () => {
    const { sub, headline } = await rainLine(day({ 9: 90, 14: 60 }));
    expect(sub).toBe('Peak 9 AM');
    expect(headline).toBe('90% chance of rain around 9 AM');
  });

  it('follows the 24-hour format', async () => {
    const { sub, headline } = await rainLine(day({ 9: 90, 14: 60 }, { 14: 1.2 }), '24h');
    expect(sub).toBe('Peak 14:00');
    expect(headline).toBe('60% chance of light rain around 14:00 · about 1.2 mm');
  });
});

describe('hero card', () => {
  it('the live clock is not part of the live region', async () => {
    const w = await tokyoWeather();
    const hero = document.createElement('section');
    hero.setAttribute('aria-live', 'polite');
    document.body.append(hero);
    renderHero(hero, { id: 1, name: 'Tokyo', latitude: 35.69, longitude: 139.69 }, w, false, w.current.time, '12h');

    for (const id of ['clock-time', 'clock-date', 'clock-offset']) {
      expect(hero.querySelector(`#${id}`)!.closest('[aria-live]')!.getAttribute('aria-live'), id).toBe('off');
    }
    // The rest of the card is still announced.
    expect(hero.querySelector('.place-name')!.closest('[aria-live]')!.getAttribute('aria-live')).toBe('polite');
    expect(hero.querySelector('.hero-temp')!.closest('[aria-live]')!.getAttribute('aria-live')).toBe('polite');
  });
});

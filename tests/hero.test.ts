// @vitest-environment happy-dom
// The hero card is a polite live region (a new city or new weather is announced),
// but the live clock inside it changes every second and must not be announced.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderHero } from '../src/renderer/components/hero';
import { forecast } from '../src/server/openMeteo';

async function tokyoWeather() {
  const json = await readFile(path.join(__dirname, 'fixtures', 'forecast-tokyo.json'), 'utf8');
  return forecast(async () => new Response(json, { status: 200 }), 35.69, 139.69, 'metric');
}

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

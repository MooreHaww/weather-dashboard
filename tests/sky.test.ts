import { describe, expect, it } from 'vitest';
import { PHASES, phaseBlend } from '../src/shared/phase';
import { lookVars, skyLook, skyNow, skyOf, skyState, SKIES, WASH_MAX, WASH_STRENGTH } from '../src/shared/sky';
import { describeWeather } from '../src/shared/weatherCodes';

// Every code on Open-Meteo's list (https://open-meteo.com/en/docs, "WMO Weather interpretation codes", read 2026-11-07).
const OPEN_METEO_CODES = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 97, 99];

describe('the glass sky state from the weather code and is_day', () => {
  it('follows the brief: clear, mainly clear and partly cloudy, overcast, fog, drizzle and light rain, rain and showers, heavy rain, thunderstorm, snow', () => {
    const groups: Record<string, number[]> = {
      clear: [0],
      partly: [1, 2],
      overcast: [3],
      fog: [45, 48],
      drizzle: [51, 53, 55, 56, 57, 61, 66],
      rain: [63, 80, 81],
      'heavy-rain': [65, 67, 82],
      storm: [95, 96, 97, 99],
      snow: [71, 73, 75, 77, 85, 86],
    };
    for (const [sky, codes] of Object.entries(groups)) for (const c of codes) expect(skyOf(c), `code ${c}`).toBe(sky);
    expect(Object.values(groups).flat().sort((a, b) => a - b)).toEqual(OPEN_METEO_CODES);
  });

  it('the weather group and the phase name the state: 54 of them, each with its own look', () => {
    expect(skyState(0, 'noon')).toBe('clear-noon');
    expect(skyState(1, 'morning')).toBe('partly-morning');
    expect(skyState(99, 'night')).toBe('storm-night');
    const all = new Set<string>();
    for (const sky of SKIES) {
      for (const phase of PHASES) {
        const v = lookVars(skyLook(sky, phase));
        expect(Object.keys(v).sort()).toEqual(['--glow', '--sky-1', '--sky-2', '--sky-alpha', '--sky-tint']);
        all.add(JSON.stringify(v));
      }
    }
    expect(all.size).toBe(54);
  });

  it('every listed weather code gets a look, and skyNow names the nearest phase and blends the look', () => {
    for (const code of OPEN_METEO_CODES) for (const p of PHASES) expect(skyLook(skyOf(code), p).alpha).toBeGreaterThan(0);
    // 15 minutes around 09:00 solar: London-like sun 07:00-17:00, noon 12:00, boundary morning > noon at 10:30.
    const at = (t: string) => skyNow(0, phaseBlend(`2026-11-09T${t}`, '2026-11-09T07:00', '2026-11-09T17:00', true));
    expect(at('10:00').state).toBe('clear-morning');
    expect(at('10:31').state).toBe('clear-noon');
    expect(at('10:00').vars).toEqual(lookVars(skyLook('clear', 'morning')));
    expect(at('11:00').vars).toEqual(lookVars(skyLook('clear', 'noon')));
    expect(at('10:30').vars).not.toEqual(at('10:00').vars);
    expect(at('10:30').vars).not.toEqual(at('11:00').vars);
  });

  it('WASH_STRENGTH is one number that scales every glass alpha before the cap, and leaves the classic look alone', () => {
    expect(WASH_STRENGTH).toBe(1);
    expect(WASH_MAX).toBe(0.35);
    for (const sky of SKIES) {
      for (const phase of PHASES) {
        const one = skyLook(sky, phase, 1);
        const two = skyLook(sky, phase, 2);
        const half = skyLook(sky, phase, 0.5);
        expect(two.alpha).toBeCloseTo(Math.min(WASH_MAX, one.alpha * 2), 6);
        expect(half.alpha).toBeCloseTo(one.alpha / 2, 6);
        expect(two.tint).toEqual(one.tint);
        expect(two.sky1).toEqual(one.sky1);
        expect(skyLook(sky, phase).alpha).toBeCloseTo(one.alpha, 6); // the default is the constant
      }
    }
  });

  it('every listed code has a label; 97 "Heavy thunderstorm" is labelled "Thunderstorm" (2.0) and is a storm here', () => {
    const unknown = OPEN_METEO_CODES.filter((c) => describeWeather(c).label === 'Unknown');
    expect(unknown).toEqual([]);
    expect(describeWeather(97)).toMatchObject({ label: 'Thunderstorm', icon: 'thunder' });
    expect(skyOf(97)).toBe('storm');
  });

  it('a code Open-Meteo does not list is overcast, like describeWeather\'s "Unknown"', () => {
    expect(skyOf(4)).toBe('overcast');
    expect(skyOf(-1)).toBe('overcast');
    expect(describeWeather(4).theme).toBe('cloudy');
  });
});

import { describe, expect, it } from 'vitest';
import { skyOf, skyState } from '../src/shared/sky';
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

  it('is_day picks the day or night variant', () => {
    expect(skyState(0, true)).toBe('clear-day');
    expect(skyState(0, false)).toBe('clear-night');
    expect(skyState(99, false)).toBe('storm-night');
  });

  it('97 "Heavy thunderstorm" is the one listed code describeWeather does not know; it is a storm here', () => {
    const unknown = OPEN_METEO_CODES.filter((c) => describeWeather(c).label === 'Unknown');
    expect(unknown).toEqual([97]);
    expect(skyOf(97)).toBe('storm');
  });

  it('a code Open-Meteo does not list is overcast, like describeWeather\'s "Unknown"', () => {
    expect(skyOf(4)).toBe('overcast');
    expect(skyOf(-1)).toBe('overcast');
    expect(describeWeather(4).theme).toBe('cloudy');
  });
});

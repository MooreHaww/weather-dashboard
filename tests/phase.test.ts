// The six phases of the day (v1.7.1), from the city's own sunrise and sunset strings and its local clock. Nothing here depends on the PC's clock or zone.

import { describe, expect, it } from 'vitest';
import { nearestPhase, phaseBlend, PHASES, sunTimesOn, type Phase } from '../src/shared/phase';

const DAY = '2026-11-09';
const at = (time: string, rise = `${DAY}T07:00`, set = `${DAY}T17:00`, isDay = true) => phaseBlend(`${DAY}T${time}`, rise, set, isDay);
const pure = (from: Phase) => ({ from, to: from, t: 0 });

describe('the phases of a 10-hour day (sunrise 07:00, sunset 17:00, solar noon 12:00)', () => {
  it.each<[string, Phase]>([
    ['00:00', 'night'],
    ['06:14', 'night'],
    ['06:50', 'morning'], // from 30 minutes before sunrise
    ['10:14', 'morning'],
    ['10:46', 'noon'], // solar noon minus 1.5 hours
    ['12:00', 'noon'],
    ['13:14', 'noon'],
    ['13:46', 'afternoon'], // solar noon plus 1.5 hours
    ['15:44', 'afternoon'],
    ['16:16', 'sunset'], // the last hour before sunset
    ['16:44', 'sunset'],
    ['17:16', 'dusk'], // from sunset
    ['17:29', 'dusk'],
    ['18:01', 'night'], // 45 minutes after sunset
    ['23:59', 'night'],
  ])('%s is %s', (time, phase) => {
    expect(at(time)).toEqual(pure(phase));
  });

  it.each<[string, Phase, Phase]>([
    ['06:30', 'night', 'morning'],
    ['10:30', 'morning', 'noon'],
    ['13:30', 'noon', 'afternoon'],
    ['16:00', 'afternoon', 'sunset'],
    ['17:00', 'sunset', 'dusk'],
    ['17:45', 'dusk', 'night'],
  ])('at the boundary %s the look is half %s, half %s, over 30 minutes', (time, from, to) => {
    expect(at(time)).toEqual({ from, to, t: 0.5 });
    const [h, m] = time.split(':').map(Number) as [number, number];
    const shift = (d: number) => {
      const min = h * 60 + m + d;
      return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
    };
    expect(at(shift(-15))).toEqual({ from, to, t: 0 });
    expect(at(shift(-16))).toEqual(pure(from));
    expect(at(shift(14))).toEqual({ from, to, t: 29 / 30 });
    expect(at(shift(15))).toEqual(pure(to));
  });

  it('the blend moves smoothly through the whole day: never a jump', () => {
    // Each minute's look, as a position along the phases, moves at most 1/30 of a phase.
    const pos = (time: string) => {
      const b = at(time);
      return PHASES.indexOf(b.from) + ((PHASES.indexOf(b.to) - PHASES.indexOf(b.from) + 6) % 6) * b.t;
    };
    let last = pos('00:00');
    for (let m = 1; m < 1440; m++) {
      const now = pos(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
      const step = Math.abs(now - last);
      expect(Math.min(step, 6 - step), `minute ${m}`).toBeLessThanOrEqual(1 / 30 + 1e-9);
      last = now;
    }
  });

  it('nearestPhase names the closer side of a blend', () => {
    expect(nearestPhase({ from: 'night', to: 'morning', t: 0.49 })).toBe('night');
    expect(nearestPhase({ from: 'night', to: 'morning', t: 0.5 })).toBe('morning');
  });
});

describe('solar noon is the midpoint of sunrise and sunset, not 12:00', () => {
  it('uses the midpoint (sunrise 05:00, sunset 21:00: noon at 13:00)', () => {
    const rise = `${DAY}T05:00`;
    const set = `${DAY}T21:00`;
    expect(at('11:14', rise, set)).toEqual(pure('morning'));
    expect(at('11:30', rise, set)).toEqual({ from: 'morning', to: 'noon', t: 0.5 });
    expect(at('13:00', rise, set)).toEqual(pure('noon'));
    expect(at('14:30', rise, set)).toEqual({ from: 'noon', to: 'afternoon', t: 0.5 });
  });
});

describe('only the city-local strings count', () => {
  it('a city at +5:45 (Kathmandu) reads its own strings, whatever the minutes', () => {
    const rise = `${DAY}T06:27`;
    const set = `${DAY}T17:13`;
    expect(phaseBlend(`${DAY}T05:57`, rise, set, false)).toEqual({ from: 'night', to: 'morning', t: 0.5 }); // 30 minutes before sunrise
    expect(phaseBlend(`${DAY}T17:13`, rise, set, false)).toEqual({ from: 'sunset', to: 'dusk', t: 0.5 });
    expect(phaseBlend(`${DAY}T17:58`, rise, set, false)).toEqual({ from: 'dusk', to: 'night', t: 0.5 });
    expect(phaseBlend(`${DAY}T11:50`, rise, set, true)).toEqual(pure('noon')); // solar noon 11:50
  });

  it('is the same at seconds precision and in any PC time zone (no Date of the PC is read)', () => {
    expect(phaseBlend(`${DAY}T12:00:30`, `${DAY}T07:00`, `${DAY}T17:00`, true)).toEqual(pure('noon'));
    expect(at('12:00').from).toBe('noon');
  });

  it('is_day does not overrule the sun times when they are there', () => {
    expect(at('12:00', undefined, undefined, false)).toEqual(pure('noon'));
    expect(at('23:00', undefined, undefined, true)).toEqual(pure('night'));
  });

  it('a sunset after local midnight (far north in summer) stays in the evening, and carries over to the small hours', () => {
    const rise = `${DAY}T03:00`;
    const set = '2026-11-10T00:20';
    expect(phaseBlend(`${DAY}T23:50`, rise, set, true)).toEqual(pure('sunset'));
    expect(phaseBlend(`${DAY}T00:00`, rise, set, true).from).toBe('sunset');
    expect(phaseBlend(`${DAY}T00:40`, rise, set, false)).toEqual(pure('dusk'));
    expect(phaseBlend(`${DAY}T01:30`, rise, set, false)).toEqual(pure('night'));
  });
});

describe('very short days keep their order and stay continuous', () => {
  it('a 2-hour day: no afternoon, and every phase in order', () => {
    const rise = `${DAY}T11:00`;
    const set = `${DAY}T13:00`;
    const seen = new Set<Phase>();
    for (let m = 0; m < 1440; m += 5) {
      const b = phaseBlend(`${DAY}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, rise, set, true);
      if (b.t === 0) seen.add(b.from);
    }
    expect(seen.has('afternoon')).toBe(false);
    expect(seen.has('dusk')).toBe(true);
    expect(seen.has('night')).toBe(true);
  });

  it('a 20-minute day still has sunset and dusk, and no error', () => {
    const b = phaseBlend(`${DAY}T12:25`, `${DAY}T12:00`, `${DAY}T12:20`, true);
    expect(PHASES).toContain(b.from);
    expect(phaseBlend(`${DAY}T12:40`, `${DAY}T12:00`, `${DAY}T12:20`, true).from).toBe('dusk');
  });
});

describe('polar day and night: no usable sun times', () => {
  const NONE: [string, string | null | undefined, string | null | undefined][] = [
    ['null', null, null],
    ['undefined', undefined, undefined],
    ['empty', '', ''],
    ['garbage', 'x', 'y'],
    ['the 1970 placeholder', '1970-01-01T00:00', '1970-01-01T00:00'],
    ['sunset before sunrise', `${DAY}T17:00`, `${DAY}T07:00`],
    ['equal', `${DAY}T12:00`, `${DAY}T12:00`],
    ['a full day of sun', `${DAY}T00:00`, '2026-11-10T00:00'],
  ];

  it.each(NONE)('%s, is_day false: night all day', (_n, rise, set) => {
    for (const t of ['00:00', '06:00', '12:00', '18:00']) expect(phaseBlend(`${DAY}T${t}`, rise, set, false)).toEqual(pure('night'));
  });

  it.each(NONE)('%s, is_day true: the local clock, never sunset or dusk', (_n, rise, set) => {
    const on = (t: string) => phaseBlend(`${DAY}T${t}`, rise, set, true);
    expect(on('06:00')).toEqual(pure('morning'));
    expect(on('10:30')).toEqual({ from: 'morning', to: 'noon', t: 0.5 });
    expect(on('12:00')).toEqual(pure('noon'));
    expect(on('13:30')).toEqual({ from: 'noon', to: 'afternoon', t: 0.5 });
    expect(on('18:00')).toEqual(pure('afternoon'));
    expect(on('23:50').from).toBe('afternoon');
    expect(on('23:50').to).toBe('morning');
    expect(on('00:00')).toEqual({ from: 'afternoon', to: 'morning', t: 0.5 });
  });
});

describe('the sun times for the city-local date', () => {
  const daily = { time: ['2026-11-09', '2026-11-10'], sunrise: ['2026-11-09T07:00', '2026-11-10T07:02'], sunset: ['2026-11-09T17:00', '2026-11-10T16:58'] };

  it('picks the row of the date in nowLocal, not of the PC', () => {
    expect(sunTimesOn(daily, '2026-11-10T01:00')).toEqual({ sunrise: '2026-11-10T07:02', sunset: '2026-11-10T16:58' });
  });

  it('old data whose first day has passed uses the closest day', () => {
    expect(sunTimesOn(daily, '2026-11-12T01:00')).toEqual({ sunrise: '2026-11-10T07:02', sunset: '2026-11-10T16:58' });
    expect(sunTimesOn(daily, '2026-11-01T01:00')).toEqual({ sunrise: '2026-11-09T07:00', sunset: '2026-11-09T17:00' });
  });

  it('no data at all gives nothing, which is the polar fallback', () => {
    expect(sunTimesOn({ time: [], sunrise: [], sunset: [] }, '2026-11-12T01:00')).toEqual({ sunrise: null, sunset: null });
  });
});

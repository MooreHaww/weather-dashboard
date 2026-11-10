// v1.9 rain alerts: the decision (window, once per event, 3-hour gap, already raining, unknown amount, the rain box's
// rule, DST day), the wording (true to hourly data) and the timer (nothing before start, stop ends it, failures silent).

import { describe, expect, it, vi } from 'vitest';
import {
  ALERT_GAP_MS,
  ALERT_INTERVAL_MS,
  alertText,
  createRainAlerts,
  decideRainAlert,
  isRainHour,
  minutesBetween,
  type LastAlert,
} from '../src/main/rainAlert';
import type { HourlySeries, WeatherData } from '../src/shared/types';

/** Hourly series from a start hour: [probability, mm | null] per hour. */
function series(start: string, hours: [number, number | null][], withAmounts = true): HourlySeries {
  const t0 = Date.parse(`${start}:00Z`);
  const time = hours.map((_, i) => new Date(t0 + i * 3_600_000).toISOString().slice(0, 16));
  return {
    time,
    temperature: hours.map(() => 10),
    apparentTemperature: hours.map(() => 10),
    precipitationProbability: hours.map((h) => h[0]),
    ...(withAmounts ? { precipitation: hours.map((h) => h[1]) } : {}),
    weatherCode: hours.map(() => 3),
    isDay: hours.map(() => true),
  };
}

const NOW_MS = 1_800_000_000_000;
const decide = (hourly: HourlySeries, nowLocal: string, last: LastAlert | null = null, nowMs = NOW_MS) =>
  decideRainAlert({ hourly, nowLocal, nowMs, last });

describe('isRainHour (the rain box rule)', () => {
  it('needs at least 50% and at least 0.1 mm; no amount = the chance alone', () => {
    expect(isRainHour({ time: '', probability: 50, mm: 0.1 })).toBe(true);
    expect(isRainHour({ time: '', probability: 49, mm: 5 })).toBe(false);
    expect(isRainHour({ time: '', probability: 90, mm: 0.09 })).toBe(false);
    expect(isRainHour({ time: '', probability: 90, mm: 0 })).toBe(false);
    expect(isRainHour({ time: '', probability: 60, mm: null })).toBe(true);
    expect(isRainHour({ time: '', probability: 40, mm: null })).toBe(false);
  });
});

describe('decideRainAlert', () => {
  const dryThenRain = series('2026-11-10T14:00', [
    [10, 0],
    [20, 0],
    [70, 1.2],
    [80, 2],
  ]); // rain from 16:00

  it('alerts when the rainy hour starts within the next 60 minutes', () => {
    expect(decide(dryThenRain, '2026-11-10T15:20:00')?.time).toBe('2026-11-10T16:00');
    expect(decide(dryThenRain, '2026-11-10T15:00:00')?.time).toBe('2026-11-10T16:00'); // exactly 60 min
  });

  it('says nothing when the rain is more than an hour away', () => {
    expect(decide(dryThenRain, '2026-11-10T14:59:00')).toBeNull();
    expect(decide(dryThenRain, '2026-11-10T14:30:00')).toBeNull();
  });

  it('says nothing when it is already raining (the current hour is rainy)', () => {
    expect(decide(dryThenRain, '2026-11-10T16:10:00')).toBeNull();
    expect(decide(dryThenRain, '2026-11-10T16:59:00')).toBeNull();
  });

  it('at most one alert per rain event, and at least 3 hours between alerts', () => {
    const last: LastAlert = { at: NOW_MS - 4 * 3_600_000, event: '2026-11-10T16:00' };
    expect(decide(dryThenRain, '2026-11-10T15:30:00', last)).toBeNull(); // same event
    const other: LastAlert = { at: NOW_MS - ALERT_GAP_MS + 60_000, event: '2026-11-10T09:00' };
    expect(decide(dryThenRain, '2026-11-10T15:30:00', other)).toBeNull(); // 2 h 59 min ago
    const old: LastAlert = { at: NOW_MS - ALERT_GAP_MS, event: '2026-11-10T09:00' };
    expect(decide(dryThenRain, '2026-11-10T15:30:00', old)?.time).toBe('2026-11-10T16:00');
  });

  it('a high chance with a known amount under 0.1 mm is not rain; data without amounts goes by the chance', () => {
    const drizzleless = series('2026-11-10T14:00', [
      [10, 0],
      [90, 0.05],
    ]);
    expect(decide(drizzleless, '2026-11-10T14:30:00')).toBeNull();
    const noAmounts = series('2026-11-10T14:00', [
      [10, null],
      [60, null],
    ], false);
    expect(decide(noAmounts, '2026-11-10T14:30:00')).toMatchObject({ time: '2026-11-10T15:00', probability: 60, mm: null });
  });

  it('crosses midnight and works on a DST day (Open-Meteo labels every hour with one offset, compared as strings)', () => {
    // Europe/London, 2026-10-25: clocks go back at 02:00. The series stays one label per hour.
    const dst = series('2026-10-24T23:00', [
      [0, 0],
      [0, 0],
      [80, 1],
    ]);
    expect(decide(dst, '2026-10-25T00:30:00')?.time).toBe('2026-10-25T01:00');
    expect(decide(dst, '2026-10-24T23:45:00')).toBeNull(); // 75 min to the 01:00 rain
    expect(minutesBetween('2026-10-24T23:45:00', '2026-10-25T01:00')).toBe(75);
    // A gap in the labels (an hour missing) never produces an alert for an hour more than 60 minutes away.
    const gap = { ...dst, time: ['2026-03-29T00:00', '2026-03-29T02:00', '2026-03-29T03:00'] };
    expect(decide(gap, '2026-03-29T00:30:00')).toBeNull();
  });

  it('stale data (the current hour is not in the series) says nothing', () => {
    expect(decide(dryThenRain, '2026-11-12T15:30:00')).toBeNull();
  });
});

describe('alertText', () => {
  it('names the hour (the data is hourly), the city, the chance, and the kind and amount when known', () => {
    expect(alertText({ name: 'Istanbul' }, { time: '2026-11-10T16:00', probability: 70, mm: 1.2 })).toEqual({
      title: 'Rain expected around 4 PM',
      body: 'Istanbul · 70% chance of light rain · about 1.2 mm',
    });
    expect(alertText({ name: 'Istanbul' }, { time: '2026-11-10T16:00', probability: 70, mm: 1.2 }, '24h').title).toBe('Rain expected around 16:00');
    expect(alertText({ name: 'Oslo' }, { time: '2026-11-10T09:00', probability: 60, mm: null }).body).toBe('Oslo · 60% chance of rain');
    expect(alertText({ name: 'Oslo' }, { time: '2026-11-10T09:00', probability: 95, mm: 9 }).body).toBe('Oslo · 95% chance of heavy rain · about 9.0 mm');
  });

  it('never claims minutes', () => {
    const t = alertText({ name: 'A' }, { time: '2026-11-10T16:00', probability: 70, mm: 1 });
    expect(`${t.title} ${t.body}`).not.toMatch(/minute|\d+ min/i);
  });
});

describe('createRainAlerts', () => {
  const weather = (hourly: HourlySeries) => ({ timezone: 'UTC', hourly }) as unknown as WeatherData;
  const place = { id: 1, name: 'London', latitude: 51.5, longitude: -0.12 };
  const rainSoon = series('2026-11-10T14:00', [
    [10, 0],
    [80, 1],
    [80, 1],
  ]);
  const at = (iso: string) => Date.parse(`${iso}Z`);

  function setup(now: () => number, load = vi.fn(async () => ({ place, weather: weather(rainSoon), timeFormat: '12h' as const }))) {
    const notify = vi.fn();
    const timers: { fn: () => void; ms: number }[] = [];
    const cleared: unknown[] = [];
    const alerts = createRainAlerts({
      load,
      notify,
      now,
      setInterval: (fn, ms) => (timers.push({ fn, ms }), timers.length),
      clearInterval: (id) => cleared.push(id),
    });
    return { alerts, notify, load, timers, cleared };
  }

  it('nothing runs and nothing is sent before start()', async () => {
    const s = setup(() => at('2026-11-10T14:30:00'));
    expect(await s.alerts.check()).toBe(false);
    expect(s.load).not.toHaveBeenCalled();
    expect(s.timers).toHaveLength(0);
  });

  it('start checks at once and then every 12 minutes; one alert per event, even over many checks', async () => {
    let now = at('2026-11-10T14:30:00');
    const s = setup(() => now);
    s.alerts.start();
    expect(s.timers[0]!.ms).toBe(ALERT_INTERVAL_MS);
    await vi.waitFor(() => expect(s.notify).toHaveBeenCalledTimes(1));
    expect(s.notify.mock.calls[0]![0]).toEqual({ title: 'Rain expected around 3 PM', body: 'London · 80% chance of light rain · about 1.0 mm' });
    now += ALERT_INTERVAL_MS;
    expect(await s.alerts.check()).toBe(false);
    expect(s.notify).toHaveBeenCalledTimes(1);
  });

  it('stop ends the timer, and a check after stop sends nothing', async () => {
    const s = setup(() => at('2026-11-10T14:30:00'));
    s.alerts.start();
    s.alerts.stop();
    expect(s.cleared).toEqual([1]);
    expect(s.alerts.running()).toBe(false);
    expect(await s.alerts.check()).toBe(false);
  });

  it('failures are silent and the next check tries again', async () => {
    const load = vi.fn(async () => {
      throw new Error('offline');
    });
    const s = setup(() => at('2026-11-10T14:30:00'), load as never);
    s.alerts.start();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    expect(await s.alerts.check()).toBe(false);
    expect(s.notify).not.toHaveBeenCalled();
  });

  it('no city: nothing', async () => {
    const s = setup(() => at('2026-11-10T14:30:00'), vi.fn(async () => null) as never);
    s.alerts.start();
    expect(await s.alerts.check()).toBe(false);
    expect(s.notify).not.toHaveBeenCalled();
  });
});

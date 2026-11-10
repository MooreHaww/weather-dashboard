// Rain alerts (v1.9), kept free of Electron imports so they can be unit-tested.
//
// Precision: Open-Meteo's forecast has `minutely_15` precipitation, but it is real 15-minute model data only for
// North America (NOAA RRFS) and Central Europe (DWD ICON-D2, Meteo-France AROME); elsewhere it is interpolated from
// hourly. So the alerts use the hourly series the app already loads and name the hour ("around 4 PM"), never minutes.
//
// Rain means the rain box's rule (rain.ts): a chance of at least 50% and at least 0.1 mm; with no amount, the chance alone.
// An alert goes out when the next rainy hour starts within the next 60 minutes, it is not raining now, it is not the
// same rain event as the last alert, and the last alert was at least 3 hours ago. All times are city-local strings.

import { formatMm, intensity, LIKELY_THRESHOLD } from '../shared/rain';
import { formatHour, localIsoIn } from '../shared/time';
import type { HourlySeries, Place, TimeFormat, WeatherData } from '../shared/types';

export const ALERT_WINDOW_MIN = 60;
export const ALERT_GAP_MS = 3 * 60 * 60 * 1000;
export const ALERT_INTERVAL_MS = 12 * 60 * 1000;

export interface RainHour {
  time: string;
  probability: number;
  mm: number | null;
}

export interface LastAlert {
  /** When it was shown (epoch ms, the PC's clock: only used for the 3-hour gap). */
  at: number;
  /** The first hour of the rain it was about ("2026-11-10T16:00"). */
  event: string;
}

function hourAt(hourly: HourlySeries, i: number): RainHour {
  return { time: hourly.time[i]!, probability: hourly.precipitationProbability[i] ?? 0, mm: hourly.precipitation?.[i] ?? null };
}

/** The rain box's rule: at least 50% and at least 0.1 mm; an unknown amount is decided by the chance alone. */
export function isRainHour(h: RainHour): boolean {
  return h.probability >= LIKELY_THRESHOLD && (h.mm === null || h.mm >= 0.1);
}

/** Minutes from `a` to `b`, both city-local "YYYY-MM-DDTHH:mm[:ss]" strings (no offsets, so no PC time zone involved). */
export function minutesBetween(a: string, b: string): number {
  const ms = (s: string) => {
    const [d, t = '00:00'] = s.split('T');
    const [y, mo, da] = d!.split('-').map(Number);
    const [h, mi, se = 0] = t.split(':').map(Number);
    return Date.UTC(y!, mo! - 1, da!, h!, mi!, se!);
  };
  return (ms(b) - ms(a)) / 60_000;
}

/** The hour to alert about, or null. */
export function decideRainAlert(input: { hourly: HourlySeries; nowLocal: string; nowMs: number; last: LastAlert | null }): RainHour | null {
  const { hourly, nowLocal, nowMs, last } = input;
  const current = hourly.time.findIndex((t) => t.slice(0, 13) === nowLocal.slice(0, 13));
  if (current < 0) return null; // stale or foreign data: say nothing
  if (isRainHour(hourAt(hourly, current))) return null; // already raining
  for (let i = current + 1; i < hourly.time.length; i++) {
    const until = minutesBetween(nowLocal, hourly.time[i]!);
    if (until <= 0) continue;
    if (until > ALERT_WINDOW_MIN) return null;
    const h = hourAt(hourly, i);
    if (!isRainHour(h)) continue;
    if (last && last.event === h.time) return null; // once per rain event
    if (last && nowMs - last.at < ALERT_GAP_MS) return null;
    return h;
  }
  return null;
}

/** "Rain expected around 4 PM" / "Istanbul · 70% chance of light rain · about 1.2 mm". */
export function alertText(place: Pick<Place, 'name'>, h: RainHour, format: TimeFormat = '12h'): { title: string; body: string } {
  const kind = h.mm === null ? 'rain' : `${intensity(h.mm)} rain`;
  const amount = h.mm === null ? '' : ` · about ${formatMm(h.mm)}`;
  return {
    title: `Rain expected around ${formatHour(h.time, false, format)}`,
    body: `${place.name} · ${h.probability}% chance of ${kind}${amount}`,
  };
}

export const TEST_ALERT = { title: 'Rain alerts are on', body: 'This is a test. Alerts look like this.' } as const;

export interface RainAlertsOptions {
  /** The tray city with its weather and the time format, or null when there is none. Rejections are ignored. */
  load: () => Promise<{ place: Place; weather: WeatherData; timeFormat: TimeFormat } | null>;
  notify: (text: { title: string; body: string }) => void;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
  intervalMs?: number;
}

/** The alert timer. Nothing runs (and nothing is sent) until start(); stop() ends the timer. */
export function createRainAlerts(opts: RainAlertsOptions) {
  const now = opts.now ?? Date.now;
  const every = opts.setInterval ?? setInterval;
  const cancel = opts.clearInterval ?? ((id: unknown) => clearInterval(id as NodeJS.Timeout));
  let timer: unknown = null;
  let last: LastAlert | null = null;
  let running = false;

  async function check(): Promise<boolean> {
    if (!running) return false;
    try {
      const got = await opts.load();
      if (!got || !running) return false;
      const nowLocal = localIsoIn(got.weather.timezone, new Date(now()));
      const hour = decideRainAlert({ hourly: got.weather.hourly, nowLocal, nowMs: now(), last });
      if (!hour) return false;
      last = { at: now(), event: hour.time };
      opts.notify(alertText(got.place, hour, got.timeFormat));
      return true;
    } catch {
      return false; // failures are silent; the next check tries again
    }
  }

  return {
    check,
    running: () => running,
    start(): void {
      if (running) return;
      running = true;
      timer = every(() => void check(), opts.intervalMs ?? ALERT_INTERVAL_MS);
      void check();
    },
    stop(): void {
      running = false;
      if (timer !== null) cancel(timer);
      timer = null;
    },
  };
}

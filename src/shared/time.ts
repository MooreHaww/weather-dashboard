// Time helpers. Open-Meteo (with timezone=auto) returns city-local wall-clock
// strings like "2026-10-17T16:00" with no offset. Everything here works on
// those strings or on an explicit IANA timezone, never on the PC's timezone.

import type { TimeFormat } from './types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function partsIn(timeZone: string, date: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return out;
}

/** City-local wall-clock time as "YYYY-MM-DDTHH:mm:ss" (same shape as Open-Meteo, plus seconds). */
export function localIsoIn(timeZone: string, date: Date = new Date()): string {
  const p = partsIn(timeZone, date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/** City-local date as "YYYY-MM-DD". */
export function localDateIn(timeZone: string, date: Date = new Date()): string {
  return localIsoIn(timeZone, date).slice(0, 10);
}

/** UTC offset label for a timezone at a moment, e.g. "UTC+9", "UTC+5:45", "UTC". */
export function utcOffsetLabel(timeZone: string, date: Date = new Date()): string {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  return name.replace('GMT', 'UTC');
}

/**
 * The one place a clock time becomes text. `localTime` is "16:00", "16:00:05" or
 * "2026-10-17T16:00". 12-hour: "4 PM", "4:30 PM", "4:30:05 PM". 24-hour: "16:00",
 * "16:30:05" (the hour alone still shows ":00").
 */
export function formatTime(
  localTime: string,
  format: TimeFormat = '12h',
  opts: { minutes?: boolean; seconds?: boolean } = {},
): string {
  const hm = localTime.includes('T') ? localTime.split('T')[1]! : localTime;
  const [hStr, mStr = '00', sStr = '00'] = hm.split(':');
  const h = Number(hStr);
  const mm = mStr.slice(0, 2);
  const ss = sStr.slice(0, 2);
  if (format === '24h') {
    return `${String(h).padStart(2, '0')}:${mm}${opts.seconds ? `:${ss}` : ''}`;
  }
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const body = opts.seconds ? `${h12}:${mm}:${ss}` : opts.minutes ? `${h12}:${mm}` : `${h12}`;
  return `${body} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "2026-10-17T16:00" → "4 PM" / "16:00"; with minutes → "4:30 PM" / "16:30". */
export function formatHour(localTime: string, withMinutes = false, format: TimeFormat = '12h'): string {
  return formatTime(localTime, format, { minutes: withMinutes });
}

function dayOfWeek(isoDate: string): number {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

/** "2026-10-17" → "Sat" (or "Saturday" with long = true). */
export function weekday(isoDate: string, long = false): string {
  const i = dayOfWeek(isoDate);
  return (long ? WEEKDAYS_LONG : WEEKDAYS)[i]!;
}

/** "2026-10-17" → "Oct 17". */
export function shortDate(isoDate: string): string {
  const [, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return `${MONTHS[m! - 1]} ${d}`;
}

/** Live clock text for a city: { date: "Saturday, October 17, 2026", time: "2:32:05 PM" (or "14:32:05"), offset: "UTC+9" }. */
export function cityClock(timeZone: string, date: Date = new Date(), format: TimeFormat = '12h') {
  return {
    date: new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(date),
    time: formatTime(localIsoIn(timeZone, date), format, { seconds: true }),
    offset: utcOffsetLabel(timeZone, date),
  };
}

/** Compass label for a wind direction in degrees. */
export function compass(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]!;
}

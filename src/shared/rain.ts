import type { HourlySeries, TimeFormat } from './types';
import { formatHour } from './time';

export const LIKELY_THRESHOLD = 50;
export const CHANCE_THRESHOLD = 30;

export interface RainSummary {
  level: 'likely' | 'chance' | 'none';
  /** City-local hour the summary refers to, e.g. "2026-10-17T16:00". */
  at: string | null;
  probability: number | null;
  text: string;
}

export interface HourPoint {
  time: string;
  probability: number;
  isPast: boolean;
}

/**
 * The 24 hourly rain probabilities of one city-local day ("YYYY-MM-DD").
 * Only today can have hours that already passed.
 */
export function rainHoursForDay(hourly: HourlySeries, day: string, nowLocal: string): HourPoint[] {
  const currentHour = nowLocal.slice(0, 13); // "YYYY-MM-DDTHH"
  const out: HourPoint[] = [];
  hourly.time.forEach((t, i) => {
    if (!t.startsWith(day)) return;
    out.push({
      time: t,
      probability: hourly.precipitationProbability[i] ?? 0,
      isPast: t.slice(0, 13) < currentHour,
    });
  });
  return out;
}

/**
 * One clear line about rain for a day, e.g. "Rain likely at 4 PM (70%)".
 * `nowLocal` is the city-local time ("YYYY-MM-DDTHH:mm[:ss]"); `day` defaults
 * to today. For today only the remaining hours count.
 */
export function rainSummary(
  hourly: HourlySeries,
  nowLocal: string,
  day: string = nowLocal.slice(0, 10),
  format: TimeFormat = '12h',
): RainSummary {
  const isToday = day === nowLocal.slice(0, 10);
  const upcoming = rainHoursForDay(hourly, day, nowLocal).filter((h) => !h.isPast);
  const currentHour = nowLocal.slice(0, 13);

  const likely = upcoming.find((h) => h.probability >= LIKELY_THRESHOLD);
  if (likely) {
    const now = isToday && likely.time.slice(0, 13) === currentHour;
    return {
      level: 'likely',
      at: likely.time,
      probability: likely.probability,
      text: now
        ? `Rain likely now (${likely.probability}%)`
        : `Rain likely at ${formatHour(likely.time, false, format)} (${likely.probability}%)`,
    };
  }

  const peak = upcoming.reduce<HourPoint | null>(
    (best, h) => (best === null || h.probability > best.probability ? h : best),
    null,
  );
  if (peak && peak.probability >= CHANCE_THRESHOLD) {
    return {
      level: 'chance',
      at: peak.time,
      probability: peak.probability,
      text: `Slight chance of rain around ${formatHour(peak.time, false, format)} (${peak.probability}%)`,
    };
  }

  return {
    level: 'none',
    at: null,
    probability: peak?.probability ?? null,
    text: isToday ? 'No rain expected for the rest of today' : 'No rain expected',
  };
}

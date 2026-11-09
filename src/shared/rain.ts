import type { HourlySeries, TimeFormat } from './types';
import { formatHour } from './time';

export const LIKELY_THRESHOLD = 50;
export const CHANCE_THRESHOLD = 30;

/** The three blues of the bars, light to deep; the legend's swatches in styles.css are the same. */
export const RAIN_BLUES = { light: '#cde6ff', moderate: '#7ebcfb', heavy: '#3d8bf2' } as const;

export type Intensity = 'none' | keyof typeof RAIN_BLUES;

/** An hour known to bring under 0.1 mm: a fixed faint fill and a grey outline, so even a 90% chance with no amount does not look like rain. */
export const RAIN_DRY = { fill: 'rgba(170, 182, 200, 0.1)', outline: '#aab6c8' } as const;

/** From the hour's mm: under 0.1 none, under 2.5 light, 2.5 to 7.6 moderate, above 7.6 heavy. Snow counts as its water. */
export function intensity(mm: number): Intensity {
  if (mm < 0.1) return 'none';
  if (mm < 2.5) return 'light';
  return mm <= 7.6 ? 'moderate' : 'heavy';
}

export interface RainSummary {
  level: 'likely' | 'chance' | 'none';
  /** City-local hour the summary refers to, e.g. "2026-10-17T16:00"; the hero's "Peak" names the same hour. */
  at: string | null;
  probability: number | null;
  text: string;
}

export interface HourPoint {
  time: string;
  probability: number;
  /** Null when the data has no amount (older data, or a gap). */
  mm: number | null;
  isPast: boolean;
}

/**
 * The 24 hourly rain values of one city-local day ("YYYY-MM-DD").
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
      mm: hourly.precipitation?.[i] ?? null,
      isPast: t.slice(0, 13) < currentHour,
    });
  });
  return out;
}

/** An amount as shown: "1.2 mm". */
export const formatMm = (mm: number): string => `${mm.toFixed(1)} mm`;

/** One hour in words: "4 PM · 70% chance · 1.2 mm · light". Without an amount, the chance only. */
export function rainHourText(h: HourPoint, format: TimeFormat = '12h'): string {
  const head = `${formatHour(h.time, false, format)} · ${h.probability}% chance`;
  return h.mm === null ? head : `${head} · ${formatMm(h.mm)} · ${intensity(h.mm)}`;
}

/**
 * The headline of the rain box: the chance and the amount, e.g. "20% chance of light rain around 6 AM · about 0.3 mm", or when
 * dry "No rain expected · highest chance 5% at 6 AM". An hour with a known amount under 0.1 mm never counts as rain, whatever its
 * chance. Data without amounts is decided by the chance alone and shows the chance only.
 * `nowLocal` is the city-local time ("YYYY-MM-DDTHH:mm[:ss]"); `day` defaults to today. For today only the remaining hours count.
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
  const highest = (hours: HourPoint[]) =>
    hours.reduce<HourPoint | null>((best, h) => (best === null || h.probability > best.probability ? h : best), null);

  // The first likely hour that can bring rain, else the most likely with a real amount. With no amount, the chance alone decides.
  const canRain = upcoming.filter((h) => h.mm === null || h.mm >= 0.1);
  const pick = canRain.find((h) => h.probability >= LIKELY_THRESHOLD) ?? highest(canRain.filter((h) => h.mm !== null || h.probability >= CHANCE_THRESHOLD));
  if (pick) {
    const kind = pick.mm === null ? 'rain' : `${intensity(pick.mm)} rain`;
    const when = isToday && pick.time.slice(0, 13) === currentHour ? 'now' : `around ${formatHour(pick.time, false, format)}`;
    const amount = pick.mm === null ? '' : ` · about ${formatMm(pick.mm)}`;
    return {
      level: pick.probability >= LIKELY_THRESHOLD ? 'likely' : 'chance',
      at: pick.time,
      probability: pick.probability,
      text: `${pick.probability}% chance of ${kind} ${when}${amount}`,
    };
  }

  const top = highest(upcoming);
  return {
    level: 'none',
    at: null,
    probability: top?.probability ?? null,
    text: top ? `No rain expected · highest chance ${top.probability}% at ${formatHour(top.time, false, format)}` : 'No rain expected',
  };
}

/** The faint bar of an hour whose amount is known and under 0.1 mm; null for any other hour, also one with no amount data. A bar with no height has no outline. Passed hours are fainter, like the blue bars. */
export function dryBarStyle(h: HourPoint): { fill: string; outline: string; width: number } | null {
  if (h.mm === null || intensity(h.mm) !== 'none') return null;
  return {
    fill: h.isPast ? 'rgba(170, 182, 200, 0.05)' : RAIN_DRY.fill,
    outline: h.isPast ? `${RAIN_DRY.outline}59` : RAIN_DRY.outline, // 59 = 35 % alpha
    width: h.probability > 0 ? 1 : 0,
  };
}

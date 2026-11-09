// The time of day of the shown city (v1.7.1): one of six phases, from its own sunrise and sunset and its local clock.
// Everything works on Open-Meteo's city-local strings ("2026-11-09T06:42", no offset), parsed as plain numbers: the PC's clock
// and time zone play no part. Used only for the look (skyLook in sky.ts). The rain box and the charts have their own logic.
//
//   morning    30 minutes before sunrise, until 1.5 hours before solar noon (the midpoint of sunrise and sunset)
//   noon       solar noon, plus or minus 1.5 hours
//   afternoon  until 1 hour before sunset
//   sunset     the last hour before sunset
//   dusk       from sunset until 45 minutes after it
//   night      everything else
//
// On very short days some phases have no room. They keep their order and an empty one is skipped; dusk and sunset keep their
// own length first, then noon, then morning, then afternoon.
// With no usable sunrise or sunset (polar day or night): is_day false is night; is_day true goes by the local clock, morning
// until 10:30, noon until 13:30, afternoon after that, and never sunset or dusk.

export type Phase = 'morning' | 'noon' | 'afternoon' | 'sunset' | 'dusk' | 'night';

/** In the order they come through a day. */
export const PHASES: readonly Phase[] = ['morning', 'noon', 'afternoon', 'sunset', 'dusk', 'night'];

/** The whole blend is 30 minutes: 15 on each side of a boundary. */
export const BLEND_HALF_MINUTES = 15;

const DAY = 1440;

/** `t` of the way from `from` to `to` (0 = all `from`). Outside a blend, from === to and t is 0. */
export interface PhaseBlend {
  from: Phase;
  to: Phase;
  t: number;
}

interface Segment {
  phase: Phase;
  start: number;
  end: number;
}

const STAMP = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/;

/** Minutes since 1970-01-01 of a city-local string, or null. Date.UTC is only used as a calendar here: no time zone is involved. */
function minutes(stamp: string | null | undefined): number | null {
  const m = stamp ? STAMP.exec(stamp) : null;
  if (!m) return null;
  const days = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
  return days * DAY + Number(m[4] ?? 0) * 60 + Number(m[5] ?? 0);
}

/** The day's phases in order, each from its start to the next one's. Null when the sun times are not usable. */
function sunSegments(rise: number, set: number): Segment[] | null {
  const length = set - rise;
  if (!(length > 0) || length >= DAY) return null; // no sunset after the sunrise, or a sun that does not set
  const noon = (rise + set) / 2;
  const start = rise - 30;
  const stop = start + DAY;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const dusk = Math.min(set + 45, stop);
  const sunsetEnd = Math.min(set, dusk);
  const sunsetStart = clamp(set - 60, start, sunsetEnd);
  const noonStart = clamp(noon - 90, start, sunsetStart);
  const noonEnd = clamp(noon + 90, noonStart, sunsetStart);
  return [
    { phase: 'morning', start, end: noonStart },
    { phase: 'noon', start: noonStart, end: noonEnd },
    { phase: 'afternoon', start: noonEnd, end: sunsetStart },
    { phase: 'sunset', start: sunsetStart, end: sunsetEnd },
    { phase: 'dusk', start: sunsetEnd, end: dusk },
    { phase: 'night', start: dusk, end: stop },
  ];
}

/** Polar day: the local clock decides, from local midnight. */
const CLOCK_SEGMENTS: Segment[] = [
  { phase: 'morning', start: 0, end: 630 },
  { phase: 'noon', start: 630, end: 810 },
  { phase: 'afternoon', start: 810, end: DAY },
];

/** Where `at` falls in a full cycle of phases, with the 30-minute blend around each boundary. */
function blendOn(all: Segment[], at: number): PhaseBlend {
  const segs = all.filter((s) => s.end > s.start);
  const first = segs[0]!;
  const now = first.start + (((at - first.start) % DAY) + DAY) % DAY;
  const len = (s: Segment) => s.end - s.start;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    const next = segs[(i + 1) % segs.length]!;
    if (next === seg) break;
    // A blend never reaches past the middle of a phase, so two blends on a short phase meet there and stay continuous.
    const half = Math.min(BLEND_HALF_MINUTES, len(seg) / 2, len(next) / 2);
    const boundary = seg.end;
    // The last boundary of the cycle is also the first phase's start, one cycle earlier.
    for (const b of i === segs.length - 1 ? [boundary, boundary - DAY] : [boundary]) {
      if (now >= b - half && now < b + half) return { from: seg.phase, to: next.phase, t: (now - (b - half)) / (2 * half) };
    }
  }
  const seg = segs.find((s) => now >= s.start && now < s.end) ?? first;
  return { from: seg.phase, to: seg.phase, t: 0 };
}

/** The phase blend at city-local `nowLocal` for that day's `sunrise` and `sunset` (city-local strings too). */
export function phaseBlend(nowLocal: string, sunrise: string | null | undefined, sunset: string | null | undefined, isDay: boolean): PhaseBlend {
  const now = minutes(nowLocal) ?? 0;
  const today = now - (((now % DAY) + DAY) % DAY);
  const rise = minutes(sunrise);
  const set = minutes(sunset);
  // Further than a day from today (Open-Meteo's 1970 placeholder for a sun that does not rise or set) counts as no sun time.
  const near = (v: number | null): v is number => v !== null && Math.abs(v - today) < 2 * DAY;
  const segments = near(rise) && near(set) ? sunSegments(rise - today, set - today) : null;
  if (segments) return blendOn(segments, now - today);
  if (!isDay) return { from: 'night', to: 'night', t: 0 };
  return blendOn(CLOCK_SEGMENTS, now - today);
}

/** The phase closest to a blend: what body[data-sky] names. */
export const nearestPhase = (b: PhaseBlend): Phase => (b.t < 0.5 ? b.from : b.to);

/** The sun times for `nowLocal`'s date; if the data no longer has that date, its closest day. */
export function sunTimesOn(daily: { time: string[]; sunrise: (string | null)[]; sunset: (string | null)[] }, nowLocal: string): { sunrise: string | null; sunset: string | null } {
  const date = nowLocal.slice(0, 10);
  let i = daily.time.indexOf(date);
  if (i < 0) {
    const now = minutes(date) ?? 0;
    let best = Infinity;
    daily.time.forEach((d, n) => {
      const gap = Math.abs((minutes(d) ?? Infinity) - now);
      if (gap < best) {
        best = gap;
        i = n;
      }
    });
  }
  return { sunrise: daily.sunrise[i] ?? null, sunset: daily.sunset[i] ?? null };
}

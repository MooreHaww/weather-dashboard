// The background of both looks (v1.7.1), from ONE place: the weather group (skyOf, the only weather mapping) and the time of day
// (phase.ts). The group sets the base hue and density; the phase shifts warmth and lightness. 54 looks, no table of them.
// A look is a colour move, group + phase, in sRGB levels. So two phases differ by the same move in every group, and two groups in every phase:
//  - glass: the move is what the wash does to a dark desktop (#202020). The tint and alpha follow from it. A warm or cold hue comes from a dark,
//    saturated tint at low alpha, not from a near-white one, so only fog (and a little snow) whitens the glass. Glass has no glows any more.
//  - classic: the same move on an opaque dark grey, so both looks are the same colour family.
// Open-Meteo's code list (https://open-meteo.com/en/docs, "WMO Weather interpretation codes") also has 97 "Heavy
// thunderstorm"; describeWeather() labels it "Thunderstorm" (2.0) and here it is a thunderstorm.
// Open-Meteo has no tornado code: the most severe state is a thunderstorm with hail (96, 99).

import { nearestPhase, type Phase, type PhaseBlend } from './phase';

export type Sky = 'clear' | 'partly' | 'overcast' | 'fog' | 'drizzle' | 'rain' | 'heavy-rain' | 'storm' | 'snow';
export type SkyState = `${Sky}-${Phase}`;
export type Rgb = readonly [number, number, number];

export const SKIES: readonly Sky[] = ['clear', 'partly', 'overcast', 'fog', 'drizzle', 'rain', 'heavy-rain', 'storm', 'snow'];

const BY_CODE: Record<number, Sky> = {
  0: 'clear',
  1: 'partly', // mainly clear
  2: 'partly',
  3: 'overcast',
  45: 'fog',
  48: 'fog',
  51: 'drizzle',
  53: 'drizzle',
  55: 'drizzle',
  56: 'drizzle', // freezing drizzle
  57: 'drizzle',
  61: 'drizzle', // slight rain: "drizzle and light rain"
  63: 'rain',
  65: 'heavy-rain',
  66: 'drizzle', // light freezing rain
  67: 'heavy-rain', // heavy freezing rain
  71: 'snow',
  73: 'snow',
  75: 'snow',
  77: 'snow',
  80: 'rain', // rain showers
  81: 'rain',
  82: 'heavy-rain', // violent showers
  85: 'snow',
  86: 'snow',
  95: 'storm',
  96: 'storm',
  97: 'storm', // heavy thunderstorm (describeWeather: "Thunderstorm" since 2.0)
  99: 'storm',
};

/** The sky for a code; a code Open-Meteo does not list is overcast (like describeWeather's "Unknown"). */
export function skyOf(code: number): Sky {
  return BY_CODE[code] ?? 'overcast';
}

/** What body[data-sky] names. */
export function skyState(code: number, phase: Phase): SkyState {
  return `${skyOf(code)}-${phase}`;
}

/** Makes the whole glass look stronger or weaker: multiplies every glass alpha before the cap. Classic ignores it. */
export const WASH_STRENGTH = 1;
/** No glass alpha above this, whatever WASH_STRENGTH says. */
export const WASH_MAX = 0.35;

/** The desktop the wash's move is worked out on (dark #202020). */
const REFERENCE = 32;

export interface GroupLook {
  /** What the wash does to #202020 at noon, per channel. */
  move: Rgb;
  /** Glass: how dense the wash is (raised only if the move needs it). */
  density: number;
  /** Classic: the grey level the move starts from. */
  page: number;
  /** Added at night, for a group whose night is another hue than its day. */
  nightMove?: Rgb;
}

export interface PhaseShift {
  /** Added to the group's move. */
  move: Rgb;
  /** Classic: added to the group's grey level. */
  page: number;
  /** How much of a group's nightMove applies. */
  night: number;
}

export const GROUPS: Record<Sky, GroupLook> = {
  clear: { move: [8, 3, -2], density: 0.1, page: 22, nightMove: [3,-3,12] }, // warm by day, violet by night
  partly: { move: [-2, 4, 13], density: 0.08, page: 23 },
  overcast: { move: [11, 12, 14], density: 0.14, page: 14 },
  fog: { move: [27, 27, 27], density: 0.2, page: 11 },
  drizzle: { move: [-3, 8, 28], density: 0.1, page: 20 },
  rain: { move: [-3, 5, 40], density: 0.14, page: 20 },
  'heavy-rain': { move: [-4, -3, 42], density: 0.22, page: 16 },
  storm: { move: [9, -3, 30], density: 0.24, page: 20 },
  snow: { move: [12, 16, 27], density: 0.14, page: 20 },
};

export const PHASE_SHIFTS: Record<Phase, PhaseShift> = {
  morning: { move: [-3, -1, 6], page: -1, night: 0 }, // fresh
  noon: { move: [0, 0, 0], page: 0, night: 0 }, // the group's own colour, and its brightest
  afternoon: { move: [6,-3,-7], page: -1.5, night: 0 }, // slightly warmer
  sunset: { move: [14,-8,-2], page: -5, night: 0 }, // amber and pink
  dusk: { move: [3, -6, 14], page: -4, night: 0 }, // blue to violet
  night: { move: [-7, -7, -5], page: -6, night: 1 }, // deep
};

/** Classic: --sky-2 is --sky-1 at this share, and the glow has this alpha. */
const SKY_2_SHARE = 0.43;
const PAGE_GLOW = 0.05;

export interface SkyLook {
  /** Glass: the wash's colour and alpha. */
  tint: Rgb;
  alpha: number;
  /** Classic: the opaque gradient's two colours, and its glow (in the tint's colour). */
  sky1: Rgb;
  sky2: Rgb;
  skyGlow: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpRgb = (a: Rgb, b: Rgb, t: number): Rgb => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const eachChannel = (f: (i: 0 | 1 | 2) => number): Rgb => [f(0), f(1), f(2)];

/** The one function: the look of a weather group for a phase's shift. `strength` is there for its test; the app uses WASH_STRENGTH. */
function lookOf(g: GroupLook, shift: PhaseShift, strength: number): SkyLook {
  const move = eachChannel((i) => g.move[i] + shift.move[i] + (g.nightMove?.[i] ?? 0) * shift.night);
  // The smallest alpha that can make every channel's move: a tint can only go up to 255 and down to 0.
  const needed = Math.max(...move.map((m) => (m > 0 ? m / (255 - REFERENCE) : -m / REFERENCE)));
  const alpha = Math.max(g.density, needed);
  const level = g.page + shift.page;
  const sky1 = eachChannel((i) => clamp(level + move[i], 0, 255));
  return {
    tint: eachChannel((i) => clamp(REFERENCE + move[i] / alpha, 0, 255)),
    alpha: Math.min(WASH_MAX, alpha * strength),
    sky1,
    sky2: eachChannel((i) => sky1[i] * SKY_2_SHARE),
    skyGlow: PAGE_GLOW,
  };
}

export function skyLook(sky: Sky, phase: Phase, strength: number = WASH_STRENGTH): SkyLook {
  return lookOf(GROUPS[sky], PHASE_SHIFTS[phase], strength);
}

/** `t` of the way from one phase to the next. The moves are blended, not the tints, so a midpoint is never outside what its two phases do. */
export function blendedLook(sky: Sky, from: Phase, to: Phase, t: number, strength: number = WASH_STRENGTH): SkyLook {
  const a = PHASE_SHIFTS[from];
  const b = PHASE_SHIFTS[to];
  return lookOf(GROUPS[sky], { move: lerpRgb(a.move, b.move, t), page: lerp(a.page, b.page, t), night: lerp(a.night, b.night, t) }, strength);
}

const rgb = (c: Rgb) => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;

/** The custom properties both looks' .backdrop rules read (styles.css). */
export function lookVars(l: SkyLook): Record<string, string> {
  return {
    '--sky-tint': rgb(l.tint),
    '--sky-alpha': l.alpha.toFixed(3),
    '--sky-1': rgb(l.sky1),
    '--sky-2': rgb(l.sky2),
    '--glow': `rgba(${Math.round(l.tint[0])}, ${Math.round(l.tint[1])}, ${Math.round(l.tint[2])}, ${l.skyGlow.toFixed(3)})`,
  };
}

/** What the screen shows for a weather code at a moment: the look (blended near a boundary) and the state's name. */
export function skyNow(code: number, blend: PhaseBlend): { state: SkyState; vars: Record<string, string> } {
  const sky = skyOf(code);
  return { state: `${sky}-${nearestPhase(blend)}`, vars: lookVars(blendedLook(sky, blend.from, blend.to, blend.t)) };
}

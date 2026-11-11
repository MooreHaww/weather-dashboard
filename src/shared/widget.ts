// The desktop widget (v2.0): its sizes and what the main process sends to its page. Pure, unit-tested.
// The page only displays this; it never asks for anything (its preload is receive-only).

import { phaseBlend, sunTimesOn, type Phase } from './phase';
import { blendedLook, skyOf, type Sky } from './sky';
import { formatHour, localIsoIn } from './time';
import type { Place, TimeFormat, WeatherData, WidgetSize } from './types';
import { describeWeather, type IconId } from './weatherCodes';
import { widgetTint } from './widgetLook';

/** Device-independent pixels; Windows display scaling multiplies them. */
export const WIDGET_SIZES_DIP: Readonly<Record<WidgetSize, { width: number; height: number }>> = {
  small: { width: 170, height: 170 },
  medium: { width: 360, height: 170 },
};

/** Hours shown on the Medium widget. */
export const WIDGET_HOURS = 4;

export interface WidgetHour {
  /** City-local "2026-10-17T16:00". */
  time: string;
  /** "4 PM" / "16:00". */
  label: string;
  icon: IconId;
  isDay: boolean;
  temp: number;
}

export interface WidgetData {
  size: WidgetSize;
  effects: boolean;
  place: string;
  temp: number;
  /** "°C" / "°F". */
  unit: string;
  condition: string;
  icon: IconId;
  isDay: boolean;
  /** Today's highest rain chance (the dashboard's "Rain chance"), null if unknown. */
  rainChance: number | null;
  hours: WidgetHour[];
  sky: Sky;
  phase: Phase;
  /** The card's tint as a CSS colour (widgetLook.ts). */
  tint: string;
}

/** What the widget shows without a city: the card and the app's name. */
export interface WidgetEmpty {
  size: WidgetSize;
  effects: boolean;
  place: null;
  tint: string;
}

export type WidgetPayload = WidgetData | WidgetEmpty;

const round = (t: number) => {
  const r = Math.round(t);
  return r === 0 ? 0 : r; // never "-0"
};

/** The next `count` whole hours after the current one (city-local strings compared, never the PC's clock). */
export function nextHours(weather: Pick<WeatherData, 'hourly'>, nowLocal: string, count: number, format: TimeFormat): WidgetHour[] {
  const h = weather.hourly;
  const thisHour = `${nowLocal.slice(0, 13)}:00`;
  const out: WidgetHour[] = [];
  for (let i = 0; i < h.time.length && out.length < count; i++) {
    const t = h.time[i]!;
    if (t <= thisHour) continue;
    const temp = h.temperature[i];
    const code = h.weatherCode[i];
    if (typeof temp !== 'number' || typeof code !== 'number') continue;
    out.push({ time: t, label: formatHour(t, false, format), icon: describeWeather(code).icon, isDay: h.isDay[i] ?? true, temp: round(temp) });
  }
  return out;
}

export interface WidgetInput {
  place: Place | null;
  weather: WeatherData | null;
  size: WidgetSize;
  effects: boolean;
  timeFormat: TimeFormat;
  /** City-local now; defaults to the city's clock. */
  nowLocal?: string;
}

/** The plain card's tint (no city yet): the overcast look at noon. */
const EMPTY_TINT = widgetTint(blendedLook('overcast', 'noon', 'noon', 0));

export function widgetModel(input: WidgetInput): WidgetPayload {
  const { place, weather, size, effects, timeFormat } = input;
  if (!place || !weather) return { size, effects, place: null, tint: EMPTY_TINT };
  const nowLocal = input.nowLocal ?? localIsoIn(weather.timezone);
  const code = weather.current.weatherCode;
  const info = describeWeather(code);
  const sun = sunTimesOn(weather.daily, nowLocal);
  const blend = phaseBlend(nowLocal, sun.sunrise, sun.sunset, weather.current.isDay);
  const sky = skyOf(code);
  const today = weather.daily.time.indexOf(nowLocal.slice(0, 10));
  const chance = today >= 0 ? weather.daily.precipitationProbabilityMax[today] : null;
  return {
    size,
    effects,
    place: place.name,
    temp: round(weather.current.temperature),
    unit: weather.unitLabels.temperature,
    condition: info.label,
    icon: info.icon,
    isDay: weather.current.isDay,
    rainChance: typeof chance === 'number' ? Math.round(chance) : null,
    hours: size === 'medium' ? nextHours(weather, nowLocal, WIDGET_HOURS, timeFormat) : [],
    sky,
    phase: blend.t < 0.5 ? blend.from : blend.to,
    tint: widgetTint(blendedLook(sky, blend.from, blend.to, blend.t)),
  };
}

// Types shared by the Express server and the renderer.

export type Units = 'metric' | 'imperial';
export type TimeFormat = '12h' | '24h';
export type WindUnit = 'kmh' | 'mph' | 'ms';
/** How often the temperature chart's hourly strip shows a time: every 3 hours, every 2 hours or every hour. */
export type TempLabels = '3h' | '2h' | '1h';

export const TIME_FORMATS: readonly TimeFormat[] = ['12h', '24h'];
export const WIND_UNITS: readonly WindUnit[] = ['kmh', 'mph', 'ms'];
export const TEMP_LABELS: readonly TempLabels[] = ['3h', '2h', '1h'];
export const WIND_LABELS: Record<WindUnit, string> = { kmh: 'km/h', mph: 'mph', ms: 'm/s' };

/**
 * "Use my location": 'ask' = not answered yet (the page shows the consent card and nothing is looked up),
 * 'on' = the user allowed a lookup by IP address, 'off' = the user said no.
 */
export type LocationSetting = 'ask' | 'on' | 'off';
export const LOCATION_SETTINGS: readonly LocationSetting[] = ['ask', 'on', 'off'];
/**
 * The look (v1.7): 'classic' = the opaque dark look that follows the weather, 'glass' = Windows' acrylic glass
 * (shown only where the system supports it; otherwise the page shows classic).
 */
export type Appearance = 'classic' | 'glass';
export const APPEARANCES: readonly Appearance[] = ['classic', 'glass'];
/**
 * What closing the window does (v1.9): 'ask' = an in-app dialog asks, 'background' = the window hides and the app keeps
 * running in the tray, 'exit' = the app quits (as before 1.9).
 */
export type CloseBehavior = 'ask' | 'background' | 'exit';
export const CLOSE_BEHAVIORS: readonly CloseBehavior[] = ['ask', 'background', 'exit'];
/** The desktop widget (v2.0): its size, and what its blurred background shows. */
export type WidgetSize = 'small' | 'medium';
export const WIDGET_SIZES: readonly WidgetSize[] = ['small', 'medium'];
export type WidgetBackground = 'wallpaper' | 'live';
export const WIDGET_BACKGROUNDS: readonly WidgetBackground[] = ['wallpaper', 'live'];
/** The id of the detected place. Real places have positive ids, so this never collides with a favorite. */
export const LOCATION_PLACE_ID = -1;

/** A city returned by geocoding, also used for favorites and recent searches. */
export interface Place {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  country?: string;
  countryCode?: string;
  timezone?: string;
}

export interface CurrentConditions {
  /** City-local time, e.g. "2026-10-17T14:30" (no offset). */
  time: string;
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  weatherCode: number;
  isDay: boolean;
}

export interface HourlySeries {
  /** City-local times, e.g. "2026-10-17T16:00". */
  time: string[];
  temperature: number[];
  /** "Feels like" temperature per hour. */
  apparentTemperature: number[];
  precipitationProbability: (number | null)[];
  /** Precipitation per hour in mm (rain, showers and snow as water). Older data has none. */
  precipitation?: (number | null)[];
  weatherCode: number[];
  isDay: boolean[];
}

export interface DailySeries {
  /** City-local dates, e.g. "2026-10-17". */
  time: string[];
  weatherCode: number[];
  tempMax: number[];
  tempMin: number[];
  precipitationProbabilityMax: (number | null)[];
  /** City-local times, e.g. "2026-10-17T06:12". */
  sunrise: string[];
  sunset: string[];
}

export interface WeatherData {
  latitude: number;
  longitude: number;
  /** IANA timezone of the city, as returned by Open-Meteo (e.g. "Asia/Tokyo"). */
  timezone: string;
  timezoneAbbreviation: string;
  utcOffsetSeconds: number;
  units: Units;
  unitLabels: { temperature: string; windSpeed: string };
  current: CurrentConditions;
  hourly: HourlySeries;
  daily: DailySeries;
  /** When the server fetched this from Open-Meteo (ISO, UTC). */
  fetchedAt: string;
}

export type CacheStatus = 'HIT' | 'MISS' | 'STALE';

export interface WeatherResponse {
  data: WeatherData;
  meta: { cache: CacheStatus };
}

export interface GeocodeResponse {
  results: Place[];
  meta: { cache: CacheStatus };
}

export interface Settings {
  units: Units;
  timeFormat: TimeFormat;
  windUnit: WindUnit;
  tempLabels: TempLabels;
  location: LocationSetting;
  appearance: Appearance;
  /** v1.9: what the window's close button does. */
  closeBehavior: CloseBehavior;
  /** v1.9: Windows notifications before rain; off until the user turns it on. */
  rainAlerts: boolean;
  /** v2.0: the desktop widget, off until the user turns it on. */
  widget: boolean;
  widgetSize: WidgetSize;
  /** Above other windows (true) or a normal window they can cover (false). */
  widgetOnTop: boolean;
  widgetBackground: WidgetBackground;
  widgetEffects: boolean;
}

export interface AppState {
  favorites: Place[];
  recent: Place[];
  settings: Settings;
  lastPlace: Place | null;
  /** The place found by the IP lookup. Only kept while settings.location is 'on'; never in favorites or recent. */
  myLocation: Place | null;
}

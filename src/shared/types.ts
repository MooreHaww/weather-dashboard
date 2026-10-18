// Types shared by the Express server and the renderer.

export type Units = 'metric' | 'imperial';

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
}

export interface AppState {
  favorites: Place[];
  recent: Place[];
  settings: Settings;
  lastPlace: Place | null;
}

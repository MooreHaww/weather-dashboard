// Typed clients for the Open-Meteo geocoding and forecast APIs (no API key needed).

import { WIND_LABELS, type Place, type Units, type WeatherData, type WindUnit } from '../shared/types';

export const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string>; redirect?: 'error'; credentials?: 'omit' },
) => Promise<Response>;

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export const RETRY_DELAY_MS = 400;

/**
 * Fetch JSON from Open-Meteo. One quick retry on a network error or a 5xx,
 * because the service occasionally answers 503 for a moment. A timeout is not
 * retried: it has already made the user wait.
 */
async function getJson<T>(fetchImpl: FetchLike, url: string, timeoutMs: number, retries = 1): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (retries > 0 && (err as Error).name !== 'TimeoutError') {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      return getJson(fetchImpl, url, timeoutMs, retries - 1);
    }
    throw new UpstreamError(`Could not reach Open-Meteo: ${(err as Error).message}`);
  }
  if (res.status >= 500 && retries > 0) {
    await res.body?.cancel().catch(() => {});
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return getJson(fetchImpl, url, timeoutMs, retries - 1);
  }
  if (!res.ok) {
    let reason = '';
    try {
      reason = ((await res.json()) as { reason?: string }).reason ?? '';
    } catch {
      // body wasn't JSON; status is enough
    }
    throw new UpstreamError(`Open-Meteo returned ${res.status}${reason ? `: ${reason}` : ''}`, res.status);
  }
  return (await res.json()) as T;
}

interface RawGeocode {
  results?: {
    id: number;
    name: string;
    latitude: number;
    longitude: number;
    admin1?: string;
    country?: string;
    country_code?: string;
    timezone?: string;
  }[];
}

export async function geocode(fetchImpl: FetchLike, query: string, timeoutMs = 8000): Promise<Place[]> {
  const params = new URLSearchParams({ name: query, count: '8', language: 'en', format: 'json' });
  const raw = await getJson<RawGeocode>(fetchImpl, `${GEOCODING_URL}?${params}`, timeoutMs);
  return (raw.results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    admin1: r.admin1,
    country: r.country,
    countryCode: r.country_code,
    timezone: r.timezone,
  }));
}

interface RawForecast {
  latitude: number;
  longitude: number;
  timezone: string;
  timezone_abbreviation: string;
  utc_offset_seconds: number;
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
    weather_code: number;
    is_day: number;
  };
  hourly: {
    time: string[];
    temperature_2m: number[];
    apparent_temperature: number[];
    precipitation_probability: (number | null)[];
    weather_code: number[];
    is_day: number[];
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: (number | null)[];
    sunrise: string[];
    sunset: string[];
  };
}

/** Wind unit used when the caller doesn't pick one: imperial → mph, otherwise km/h. */
export const defaultWind = (units: Units): WindUnit => (units === 'imperial' ? 'mph' : 'kmh');

export function forecastUrl(lat: number, lon: number, units: Units, wind: WindUnit = defaultWind(units)): string {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current:
      'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code,is_day',
    hourly: 'temperature_2m,apparent_temperature,precipitation_probability,weather_code,is_day',
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    timezone: 'auto',
    forecast_days: '7',
    temperature_unit: units === 'imperial' ? 'fahrenheit' : 'celsius',
    wind_speed_unit: wind,
  });
  return `${FORECAST_URL}?${params}`;
}

export async function forecast(
  fetchImpl: FetchLike,
  lat: number,
  lon: number,
  units: Units,
  wind: WindUnit = defaultWind(units),
  timeoutMs = 8000,
): Promise<WeatherData> {
  const raw = await getJson<RawForecast>(fetchImpl, forecastUrl(lat, lon, units, wind), timeoutMs);
  return {
    latitude: raw.latitude,
    longitude: raw.longitude,
    timezone: raw.timezone,
    timezoneAbbreviation: raw.timezone_abbreviation,
    utcOffsetSeconds: raw.utc_offset_seconds,
    units,
    // Our own labels: Open-Meteo spells mph as "mp/h".
    unitLabels: {
      temperature: units === 'imperial' ? '°F' : '°C',
      windSpeed: WIND_LABELS[wind],
    },
    current: {
      time: raw.current.time,
      temperature: raw.current.temperature_2m,
      apparentTemperature: raw.current.apparent_temperature,
      humidity: raw.current.relative_humidity_2m,
      windSpeed: raw.current.wind_speed_10m,
      windDirection: raw.current.wind_direction_10m,
      weatherCode: raw.current.weather_code,
      isDay: raw.current.is_day === 1,
    },
    hourly: {
      time: raw.hourly.time,
      temperature: raw.hourly.temperature_2m,
      apparentTemperature: raw.hourly.apparent_temperature,
      precipitationProbability: raw.hourly.precipitation_probability,
      weatherCode: raw.hourly.weather_code,
      isDay: raw.hourly.is_day.map((d) => d === 1),
    },
    daily: {
      time: raw.daily.time,
      weatherCode: raw.daily.weather_code,
      tempMax: raw.daily.temperature_2m_max,
      tempMin: raw.daily.temperature_2m_min,
      precipitationProbabilityMax: raw.daily.precipitation_probability_max,
      sunrise: raw.daily.sunrise,
      sunset: raw.daily.sunset,
    },
    fetchedAt: new Date().toISOString(),
  };
}

// "Your location": a guess from the IP address, asked of GeoJS (https://www.geojs.io/).
// Runs in the local server, never in the page, so the page's CSP stays as it is.
//
// The provider is untrusted. Only the city, country, country code, rounded coordinates and
// timezone are read from its answer, each checked strictly; everything else in the answer
// (the IP address above all) is dropped here and is never stored, logged or passed on.

import { LOCATION_PLACE_ID, type Place } from '../shared/types';
import type { FetchLike } from './openMeteo';

export const LOCATION_URL = 'https://get.geojs.io/v1/ip/geo.json';
export const LOCATION_TIMEOUT_MS = 5000;
/** A real answer is about 400 bytes. Anything bigger is not read. */
export const MAX_ANSWER_BYTES = 16 * 1024;

/**
 * The whole request: a plain GET with these two headers. No cookies, no identifiers, no
 * query string, no body. The User-Agent names the app only (no version, no machine).
 */
export const LOCATION_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent': 'Weather-Dashboard',
  Accept: 'application/json',
};

const MAX_NAME = 100;
const MAX_TIMEZONE = 64;

/** Why a lookup failed. Fixed words only, so a log line can never carry anything from the provider. */
export type LocationFailure = 'timeout' | 'network' | 'http' | 'too-big' | 'not-json' | 'invalid-answer';

export class LocationError extends Error {
  constructor(readonly reason: LocationFailure) {
    super(`Location lookup failed: ${reason}`);
    this.name = 'LocationError';
  }
}

const CONTROL = /\p{Cc}/gu;

/** Trimmed text of 1..max characters without control characters, or undefined. */
function text(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(CONTROL, '').trim();
  return s.length >= 1 && s.length <= max ? s : undefined;
}

/** GeoJS sends the coordinates as strings ("48.8566"); a plain number is accepted too. */
function coordinate(v: unknown, limit: number): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && v.length <= 24 && /^-?\d+(\.\d+)?$/.test(v)) n = Number(v);
  else return null;
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

/** A timezone name Intl knows (e.g. "Europe/Paris"), in its canonical spelling, or null. */
function timezone(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > MAX_TIMEZONE || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(v)) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: v }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100; // about 1 km: a city, not a street

/**
 * The place in a GeoJS answer, or null if anything required is missing or wrong:
 * a non-empty city, latitude and longitude in range, a valid IANA timezone.
 * The country is optional (dropped if it does not fit). Nothing else is kept.
 */
export function parseLocation(raw: unknown): Place | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const name = text(o.city, MAX_NAME);
  const latitude = coordinate(o.latitude, 90);
  const longitude = coordinate(o.longitude, 180);
  const tz = timezone(o.timezone);
  if (!name || latitude === null || longitude === null || !tz) return null;
  const code = typeof o.country_code === 'string' && /^[A-Za-z]{2}$/.test(o.country_code) ? o.country_code.toUpperCase() : undefined;
  return {
    id: LOCATION_PLACE_ID,
    name,
    latitude: round2(latitude),
    longitude: round2(longitude),
    country: text(o.country, MAX_NAME),
    countryCode: code,
    timezone: tz,
  };
}

/** Read the body, but give up past MAX_ANSWER_BYTES. */
async function readBounded(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_ANSWER_BYTES) throw new LocationError('too-big');
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_ANSWER_BYTES) {
      await reader.cancel().catch(() => {});
      throw new LocationError('too-big');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * One request, about 5 seconds, no retry. Throws LocationError (with a fixed reason) on any failure.
 * `redirect: 'error'`: an answer from anywhere else than the address above is not followed.
 */
export async function detectLocation(fetchImpl: FetchLike, timeoutMs = LOCATION_TIMEOUT_MS): Promise<Place> {
  let body: string;
  try {
    const res = await fetchImpl(LOCATION_URL, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { ...LOCATION_HEADERS },
      redirect: 'error',
      credentials: 'omit',
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new LocationError('http');
    }
    body = await readBounded(res);
  } catch (err) {
    if (err instanceof LocationError) throw err;
    const name = (err as Error)?.name;
    throw new LocationError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new LocationError('not-json');
  }
  const place = parseLocation(raw);
  if (!place) throw new LocationError('invalid-answer');
  return place;
}

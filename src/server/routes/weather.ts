import { Router, type Response } from 'express';
import type { GeocodeResponse, Place, Units, WeatherData, WeatherResponse } from '../../shared/types';
import type { TtlCache } from '../cache';
import type { Metrics } from '../metrics';
import { forecast, geocode, type FetchLike } from '../openMeteo';
import { HttpError } from '../errors';

interface Deps {
  fetchImpl: FetchLike;
  weatherCache: TtlCache<WeatherData>;
  geocodeCache: TtlCache<Place[]>;
  metrics: Metrics;
}

function parseCoord(raw: unknown, name: string, limit: number): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(n) || Math.abs(n) > limit) {
    throw new HttpError(400, `"${name}" must be a number between -${limit} and ${limit}`);
  }
  // Round to ~1 km so the same city always maps to the same cache key.
  return Math.round(n * 100) / 100;
}

function parseUnits(raw: unknown): Units {
  if (raw === undefined || raw === 'metric') return 'metric';
  if (raw === 'imperial') return 'imperial';
  throw new HttpError(400, '"units" must be "metric" or "imperial"');
}

export function weatherRoutes({ fetchImpl, weatherCache, geocodeCache, metrics }: Deps): Router {
  const router = Router();

  const timed = (res: Response, start: number, status: WeatherResponse['meta']['cache']) => {
    metrics.record(status, performance.now() - start);
    res.setHeader('X-Cache', status);
  };

  router.get('/geocode', async (req, res) => {
    const start = performance.now();
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 2 || q.length > 100) throw new HttpError(400, '"q" must be 2–100 characters');

    const key = q.toLowerCase();
    const { value, status } = await geocodeCache.getOrLoad(key, () => geocode(fetchImpl, q));
    timed(res, start, status);
    const body: GeocodeResponse = { results: value, meta: { cache: status } };
    res.json(body);
  });

  router.get('/weather', async (req, res) => {
    const start = performance.now();
    const lat = parseCoord(req.query.lat, 'lat', 90);
    const lon = parseCoord(req.query.lon, 'lon', 180);
    const units = parseUnits(req.query.units);

    const key = `${lat},${lon},${units}`;
    const { value, status } = await weatherCache.getOrLoad(key, () => forecast(fetchImpl, lat, lon, units));
    timed(res, start, status);
    const body: WeatherResponse = { data: value, meta: { cache: status } };
    res.json(body);
  });

  return router;
}

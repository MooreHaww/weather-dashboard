import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import type { Place, WeatherData } from '../shared/types';
import { TtlCache } from './cache';
import { HttpError } from './errors';
import { Metrics } from './metrics';
import { UpstreamError, type FetchLike } from './openMeteo';
import { stateRoutes } from './routes/state';
import { weatherRoutes } from './routes/weather';
import { Storage } from './storage';

export interface AppOptions {
  /** Folder for the JSON data file. */
  dataDir: string;
  /** Built renderer to serve at "/" (omit in dev, where Vite serves it). */
  staticDir?: string;
  fetchImpl?: FetchLike;
  weatherTtlMs?: number;
  geocodeTtlMs?: number;
  now?: () => number;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

// The renderer only talks to this server; no remote scripts, styles or fonts.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

/**
 * The server listens on 127.0.0.1 only. Rejecting other Host headers blocks
 * DNS-rebinding attacks from web pages trying to reach it.
 */
const localHostOnly: RequestHandler = (req, res, next) => {
  const host = req.headers.host ?? '';
  if (/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) return next();
  res.status(403).json({ error: 'Forbidden host' });
};

export function createApp(opts: AppOptions) {
  const now = opts.now ?? Date.now;
  const fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const log = opts.log ?? (() => {});

  const weatherCache = new TtlCache<WeatherData>(opts.weatherTtlMs ?? 10 * 60_000, 200, now);
  const geocodeCache = new TtlCache<Place[]>(opts.geocodeTtlMs ?? 24 * 60 * 60_000, 500, now);
  const metrics = new Metrics();
  const storage = new Storage(opts.dataDir);
  const startedAt = new Date(now()).toISOString();

  const app = express();
  app.disable('x-powered-by');
  app.use(localHostOnly);
  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use(express.json({ limit: '16kb' }));

  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(weatherRoutes({ fetchImpl, weatherCache, geocodeCache, metrics }));
  api.use(stateRoutes(storage));
  api.get('/stats', (_req, res) => {
    const w = weatherCache.stats();
    const g = geocodeCache.stats();
    const hits = w.hits + g.hits;
    const misses = w.misses + g.misses;
    res.json({
      startedAt,
      cache: {
        weather: w,
        geocode: g,
        overall: { hits, misses, hitRate: hits + misses === 0 ? 0 : hits / (hits + misses) },
      },
      responseTimeMs: metrics.summary(),
    });
  });
  api.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use('/api', api);

  if (opts.staticDir) {
    app.use(express.static(opts.staticDir, { index: 'index.html', maxAge: 0 }));
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
    } else if (err instanceof UpstreamError) {
      log('warn', err.message);
      res.status(502).json({ error: 'The weather service is unavailable right now. Please try again shortly.' });
    } else if ((err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Invalid JSON body' });
    } else {
      log('error', (err as Error).stack ?? String(err));
      res.status(500).json({ error: 'Something went wrong' });
    }
  };
  app.use(onError);

  return { app, storage, weatherCache, geocodeCache, metrics };
}

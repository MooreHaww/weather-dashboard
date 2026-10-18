// Standalone API server for development (`npm run dev:server`).
// The packaged app does not use this file; src/main/main.ts starts the server itself.

import 'dotenv/config';
import path from 'node:path';
import { createApp } from './app';
import { createLogger } from './logger';

const port = Number(process.env.PORT ?? 5174);
const seconds = (name: string, fallback: number) => Number(process.env[name] ?? fallback) * 1000;
const log = createLogger(process.env.LOG_LEVEL);

const { app } = createApp({
  dataDir: path.resolve('.data'),
  weatherTtlMs: seconds('CACHE_TTL_WEATHER_SECONDS', 600),
  geocodeTtlMs: seconds('CACHE_TTL_GEOCODE_SECONDS', 86400),
  log,
});

app.listen(port, '127.0.0.1', () => {
  log('info', `API listening on http://127.0.0.1:${port} (data in .data/)`);
});

// Measures the server cache against the real Open-Meteo API by replaying one
// realistic app session, then reports cache hit rate and response times.
// Run with: npm run bench   (needs internet; writes docs/bench-results.json)

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server/app';
import { summarize } from '../src/server/metrics';

const CITIES = {
  london: { lat: 51.50853, lon: -0.12574 },
  tokyo: { lat: 35.6895, lon: 139.69171 },
  newYork: { lat: 40.71427, lon: -74.00597 },
  sydney: { lat: -33.86785, lon: 151.20732 },
  paris: { lat: 48.85341, lon: 2.3488 },
  amman: { lat: 31.95522, lon: 35.94503 },
};
type City = keyof typeof CITIES;
type Step = { geocode: string } | { weather: City; units?: 'metric' | 'imperial' };

const favorites: City[] = ['london', 'tokyo', 'newYork', 'sydney'];
const w = (city: City, units: 'metric' | 'imperial' = 'metric'): Step => ({ weather: city, units });

// One session, in the order the app makes requests.
const SESSION: Step[] = [
  // App opens on the last city, then loads mini-weather for each favorite.
  w('london'),
  ...favorites.map((c) => w(c)),
  // Searches for Paris (debounced: two queries while typing), opens it.
  { geocode: 'Par' },
  { geocode: 'Paris' },
  w('paris'),
  // Flips between favorites and recent cities a few times.
  ...(['tokyo', 'london', 'paris', 'newYork', 'tokyo', 'sydney', 'london', 'paris'] as City[]).map((c) => w(c)),
  // Switches to °F (current city + favorites refetch), looks around, switches back.
  w('paris', 'imperial'),
  ...favorites.map((c) => w(c, 'imperial')),
  w('tokyo', 'imperial'),
  w('paris'),
  ...favorites.map((c) => w(c)),
  // Searches Paris again later (cached), then a new city.
  { geocode: 'Paris' },
  { geocode: 'Amm' },
  { geocode: 'Amman' },
  w('amman'),
  w('london'),
  w('amman'),
  // Window regains focus: refresh current city and favorites.
  w('amman'),
  ...favorites.map((c) => w(c)),
];

async function main() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'wd-bench-'));
  const { app } = createApp({ dataDir });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const samples: Record<'HIT' | 'MISS' | 'STALE', number[]> = { HIT: [], MISS: [], STALE: [] };
  for (const step of SESSION) {
    const url =
      'geocode' in step
        ? `${base}/api/geocode?q=${encodeURIComponent(step.geocode)}`
        : `${base}/api/weather?lat=${CITIES[step.weather].lat}&lon=${CITIES[step.weather].lon}&units=${step.units ?? 'metric'}`;
    const t0 = performance.now();
    const res = await fetch(url);
    await res.arrayBuffer();
    const ms = performance.now() - t0;
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    samples[res.headers.get('x-cache') as keyof typeof samples].push(ms);
  }

  const stats = (await (await fetch(`${base}/api/stats`)).json()) as {
    cache: { overall: { hits: number; misses: number; hitRate: number } };
  };
  server.close();
  await rm(dataDir, { recursive: true, force: true });

  const hit = summarize(samples.HIT);
  const miss = summarize(samples.MISS);
  const result = {
    measuredAt: new Date().toISOString(),
    node: process.version,
    requests: SESSION.length,
    cache: stats.cache.overall,
    responseTimeMs: { cached: hit, uncached: miss },
    speedupP50: Math.round((miss.p50 / Math.max(hit.p50, 0.01)) * 10) / 10,
  };

  const out = path.join(__dirname, '..', 'docs', 'bench-results.json');
  await writeFile(out, JSON.stringify(result, null, 2) + '\n');

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  console.log(`\nReplayed ${result.requests} requests from one realistic session against live Open-Meteo.\n`);
  console.log(`Cache hit rate: ${pct(result.cache.hitRate)} (${result.cache.hits} hits / ${result.cache.misses} misses)\n`);
  console.log('|                      | requests | p50 (ms) | p95 (ms) |');
  console.log('|----------------------|---------:|---------:|---------:|');
  console.log(`| Cached (HIT)         | ${String(hit.count).padStart(8)} | ${hit.p50.toFixed(1).padStart(8)} | ${hit.p95.toFixed(1).padStart(8)} |`);
  console.log(`| Open-Meteo (MISS)    | ${String(miss.count).padStart(8)} | ${miss.p50.toFixed(1).padStart(8)} | ${miss.p95.toFixed(1).padStart(8)} |`);
  console.log(`\nCached responses are ~${result.speedupP50}× faster at the median. Saved to docs/bench-results.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

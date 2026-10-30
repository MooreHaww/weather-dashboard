import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app';
import type { FetchLike } from '../src/server/openMeteo';

const fixture = (name: string) => readFile(path.join(__dirname, 'fixtures', name), 'utf8');

let dir: string;
let fetchMock: ReturnType<typeof vi.fn<FetchLike>>;
let t: number;

async function routeFetch(url: string): Promise<Response> {
  if (url.startsWith('https://geocoding-api.open-meteo.com/')) {
    return new Response(await fixture('geocode-tokyo.json'), { status: 200 });
  }
  if (url.startsWith('https://api.open-meteo.com/')) {
    return new Response(await fixture('forecast-tokyo.json'), { status: 200 });
  }
  return new Response('not found', { status: 404 });
}

function makeApp(staticDir?: string) {
  return createApp({ dataDir: dir, fetchImpl: fetchMock, now: () => t, weatherTtlMs: 600_000, staticDir }).app;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wd-api-'));
  fetchMock = vi.fn<FetchLike>(routeFetch);
  t = 1_000_000;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('GET /api/weather', () => {
  it('returns normalized weather for a city', async () => {
    const res = await request(makeApp()).get('/api/weather?lat=35.6895&lon=139.69171').expect(200);
    const { data, meta } = res.body;

    expect(meta.cache).toBe('MISS');
    expect(res.headers['x-cache']).toBe('MISS');
    expect(data.timezone).toBe('Asia/Tokyo');
    expect(data.unitLabels).toEqual({ temperature: '°C', windSpeed: 'km/h' });
    expect(data.daily.time).toHaveLength(7);
    expect(data.hourly.time).toHaveLength(7 * 24);
    expect(typeof data.current.temperature).toBe('number');
    expect(typeof data.current.isDay).toBe('boolean');
    // Hourly feels-like and day/night (for the temperature chart and hourly icons).
    expect(data.hourly.apparentTemperature).toHaveLength(7 * 24);
    expect(data.hourly.isDay).toHaveLength(7 * 24);
    expect(data.hourly.isDay.every((d: unknown) => typeof d === 'boolean')).toBe(true);
    expect(data.hourly.isDay).toContain(true);
    expect(data.hourly.isDay).toContain(false);

    // Coordinates are rounded so nearby requests share a cache key.
    const url = fetchMock.mock.calls[0]![0];
    expect(url).toContain('latitude=35.69');
    expect(url).toContain('longitude=139.69');
    expect(url).toContain('timezone=auto');
    expect(decodeURIComponent(url)).toContain('hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code,is_day');
  });

  it('retries once when Open-Meteo answers 503, then succeeds', async () => {
    fetchMock.mockResolvedValueOnce(new Response('busy', { status: 503 }));
    const res = await request(makeApp()).get('/api/weather?lat=1&lon=2').expect(200);
    expect(res.body.meta.cache).toBe('MISS');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries once after a network error, then succeeds', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await request(makeApp()).get('/api/weather?lat=1&lon=2').expect(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after one retry and does not retry 4xx errors', async () => {
    fetchMock.mockImplementation(async () => new Response('busy', { status: 503 }));
    await request(makeApp()).get('/api/weather?lat=1&lon=2').expect(502);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockClear();
    fetchMock.mockImplementation(async () => new Response('{"reason":"bad"}', { status: 400 }));
    await request(makeApp()).get('/api/weather?lat=3&lon=4').expect(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves repeat requests from the cache', async () => {
    const app = makeApp();
    await request(app).get('/api/weather?lat=35.69&lon=139.69').expect(200);
    const res = await request(app).get('/api/weather?lat=35.6901&lon=139.6899').expect(200);

    expect(res.body.meta.cache).toBe('HIT');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const stats = await request(app).get('/api/stats').expect(200);
    expect(stats.body.cache.weather).toMatchObject({ hits: 1, misses: 1, hitRate: 0.5 });
    expect(stats.body.responseTimeMs.HIT.count).toBe(1);
  });

  it('caches metric and imperial separately and passes units upstream', async () => {
    const app = makeApp();
    await request(app).get('/api/weather?lat=1&lon=2').expect(200);
    const res = await request(app).get('/api/weather?lat=1&lon=2&units=imperial').expect(200);

    expect(res.body.meta.cache).toBe('MISS');
    expect(res.body.data.unitLabels).toEqual({ temperature: '°F', windSpeed: 'mph' });
    expect(fetchMock.mock.calls[1]![0]).toContain('temperature_unit=fahrenheit');
    expect(fetchMock.mock.calls[1]![0]).toContain('wind_speed_unit=mph');
  });

  it('lets the wind unit be chosen separately from the temperature unit', async () => {
    const app = makeApp();
    const ms = await request(app).get('/api/weather?lat=1&lon=2&units=imperial&wind=ms').expect(200);
    expect(ms.body.data.unitLabels).toEqual({ temperature: '°F', windSpeed: 'm/s' });
    expect(fetchMock.mock.calls[0]![0]).toContain('wind_speed_unit=ms');
    expect(fetchMock.mock.calls[0]![0]).toContain('temperature_unit=fahrenheit');

    const kmh = await request(app).get('/api/weather?lat=1&lon=2&units=imperial&wind=kmh').expect(200);
    expect(kmh.body.meta.cache).toBe('MISS'); // a different wind unit is a different cache entry
    expect(kmh.body.data.unitLabels.windSpeed).toBe('km/h');
  });

  it('rejects an unknown wind unit', async () => {
    await request(makeApp()).get('/api/weather?lat=1&lon=2&wind=knots').expect(400);
  });

  it('refetches after the TTL expires', async () => {
    const app = makeApp();
    await request(app).get('/api/weather?lat=1&lon=2').expect(200);
    t += 600_001;
    const res = await request(app).get('/api/weather?lat=1&lon=2').expect(200);
    expect(res.body.meta.cache).toBe('MISS');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fresh=1 skips a cached copy and refills the cache', async () => {
    const app = makeApp();
    await request(app).get('/api/weather?lat=1&lon=2').expect(200);
    const fresh = await request(app).get('/api/weather?lat=1&lon=2&fresh=1').expect(200);
    expect(fresh.body.meta.cache).toBe('MISS');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const after = await request(app).get('/api/weather?lat=1&lon=2').expect(200);
    expect(after.body.meta.cache).toBe('HIT');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fresh=1 returns the saved copy as STALE when Open-Meteo is down', async () => {
    const app = makeApp();
    await request(app).get('/api/weather?lat=1&lon=2').expect(200);
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const res = await request(app).get('/api/weather?lat=1&lon=2&fresh=1').expect(200);
    expect(res.body.meta.cache).toBe('STALE');
  });

  it('serves stale data when Open-Meteo is down', async () => {
    const app = makeApp();
    await request(app).get('/api/weather?lat=1&lon=2').expect(200);
    t += 3_600_000;
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const res = await request(app).get('/api/weather?lat=1&lon=2').expect(200);
    expect(res.body.meta.cache).toBe('STALE');
  });

  it('returns 502 when Open-Meteo is down and nothing is cached', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const res = await request(makeApp()).get('/api/weather?lat=1&lon=2').expect(502);
    expect(res.body.error).toMatch(/unavailable/);
  });

  it('returns 502 on upstream HTTP errors', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: true, reason: 'bad' }), { status: 400 }));
    await request(makeApp()).get('/api/weather?lat=1&lon=2').expect(502);
  });

  it.each([
    ['', 'lat'],
    ['lat=abc&lon=2', 'lat'],
    ['lat=91&lon=2', 'lat'],
    ['lat=1&lon=-181', 'lon'],
    ['lat=1&lon=2&units=kelvin', 'units'],
  ])('rejects bad query "%s"', async (qs, field) => {
    const res = await request(makeApp()).get(`/api/weather?${qs}`).expect(400);
    expect(res.body.error).toContain(field);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/geocode', () => {
  it('returns normalized places and caches case-insensitively', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/geocode?q=Tokyo').expect(200);
    expect(res.body.results[0]).toMatchObject({
      name: 'Tokyo',
      country: 'Japan',
      countryCode: 'JP',
      timezone: 'Asia/Tokyo',
    });

    const again = await request(app).get('/api/geocode?q=%20tokyo%20').expect(200);
    expect(again.body.meta.cache).toBe('HIT');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list when nothing matches', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ generationtime_ms: 0.1 }), { status: 200 }));
    const res = await request(makeApp()).get('/api/geocode?q=zzzzqqq').expect(200);
    expect(res.body.results).toEqual([]);
  });

  it('rejects too-short queries', async () => {
    await request(makeApp()).get('/api/geocode?q=a').expect(400);
  });
});

describe('favorites, recent and settings', () => {
  const tokyo = { id: 1850147, name: 'Tokyo', latitude: 35.6895, longitude: 139.69171, country: 'Japan' };

  it('round-trips through the JSON file', async () => {
    const app = makeApp();
    await request(app).put(`/api/favorites/${tokyo.id}`).send(tokyo).expect(200);
    await request(app).post('/api/recent').send(tokyo).expect(200);
    await request(app).patch('/api/settings').send({ units: 'imperial' }).expect(200);

    // A fresh app reading the same folder sees the same state.
    const state = await request(makeApp()).get('/api/state').expect(200);
    expect(state.body.favorites).toHaveLength(1);
    expect(state.body.recent[0].name).toBe('Tokyo');
    expect(state.body.lastPlace.name).toBe('Tokyo');
    expect(state.body.settings.units).toBe('imperial');

    const after = await request(app).delete(`/api/favorites/${tokyo.id}`).expect(200);
    expect(after.body).toEqual([]);
    expect((await request(app).delete('/api/recent').expect(200)).body).toEqual([]);
  });

  it('saves time format and wind unit, and an old state still loads with defaults', async () => {
    const app = makeApp();
    const defaults = await request(app).get('/api/settings').expect(200);
    expect(defaults.body).toEqual({ units: 'metric', timeFormat: '12h', windUnit: 'kmh', tempLabels: '3h', location: 'ask' });

    const res = await request(app).patch('/api/settings').send({ timeFormat: '24h', windUnit: 'mph', tempLabels: '2h' }).expect(200);
    expect(res.body).toEqual({ units: 'metric', timeFormat: '24h', windUnit: 'mph', tempLabels: '2h', location: 'ask' });
    expect((await request(makeApp()).get('/api/settings').expect(200)).body).toEqual(res.body);
  });

  it('rejects an invalid time format or wind unit', async () => {
    const app = makeApp();
    await request(app).patch('/api/settings').send({ timeFormat: '36h' }).expect(400);
    await request(app).patch('/api/settings').send({ windUnit: 'knots' }).expect(400);
    await request(app).patch('/api/settings').send({ tempLabels: '4h' }).expect(400);
    await request(app).patch('/api/settings').send({ tempLabels: 1 }).expect(400);
    expect((await request(app).get('/api/settings')).body.timeFormat).toBe('12h');
    expect((await request(app).get('/api/settings')).body.tempLabels).toBe('3h');
  });

  it('validates bodies', async () => {
    const app = makeApp();
    await request(app).put('/api/favorites/1').send({ id: 1 }).expect(400);
    await request(app).put('/api/favorites/2').send(tokyo).expect(400);
    await request(app).patch('/api/settings').send({ units: 'kelvin' }).expect(400);
    await request(app).post('/api/recent').set('Content-Type', 'application/json').send('{bad').expect(400);
  });
});

describe('security', () => {
  it('rejects requests with a foreign Host header (DNS rebinding)', async () => {
    await request(makeApp()).get('/api/health').set('Host', 'evil.example.com').expect(403);
  });

  it('sets a strict CSP and unknown API routes 404', async () => {
    const res = await request(makeApp()).get('/api/nope').expect(404);
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

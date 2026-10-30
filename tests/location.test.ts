import { copyFile, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app';
import { detectLocation, LOCATION_HEADERS, LOCATION_URL, LocationError, MAX_ANSWER_BYTES, parseLocation } from '../src/server/location';
import type { FetchLike } from '../src/server/openMeteo';
import { Storage } from '../src/server/storage';
import { LOCATION_PLACE_ID } from '../src/shared/types';

/** What GeoJS really sends (shape from https://get.geojs.io/v1/ip/geo.json); the IP and the other fields must never leave this test. */
const IP = '203.0.113.77';
const ANSWER = {
  ip: IP,
  organization_name: 'EXAMPLE-NET Example Telecom',
  organization: 'AS64500 EXAMPLE-NET Example Telecom',
  asn: 64500,
  area_code: '0',
  accuracy: 20,
  city: 'Paris',
  region: 'Île-de-France',
  country: 'France',
  country_code: 'FR',
  country_code3: 'FRA',
  continent_code: 'EU',
  latitude: '48.8566',
  longitude: '2.3522',
  timezone: 'Europe/Paris',
};

const json = (body: unknown, init: ResponseInit = { status: 200 }) => new Response(JSON.stringify(body), init);

describe('parseLocation', () => {
  it('keeps only the place: name, country, rounded coordinates, timezone', () => {
    expect(parseLocation(ANSWER)).toEqual({
      id: LOCATION_PLACE_ID,
      name: 'Paris',
      latitude: 48.86,
      longitude: 2.35,
      country: 'France',
      countryCode: 'FR',
      timezone: 'Europe/Paris',
    });
  });

  it('drops everything else GeoJS sends, the IP address above all', () => {
    const text = JSON.stringify(parseLocation(ANSWER));
    for (const secret of [IP, 'EXAMPLE-NET', 'AS64500', '64500', 'Île-de-France', 'FRA']) expect(text).not.toContain(secret);
    expect(Object.keys(parseLocation(ANSWER)!).sort()).toEqual(['country', 'countryCode', 'id', 'latitude', 'longitude', 'name', 'timezone']);
  });

  it('rounds the coordinates to 2 decimals (about 1 km), numbers or strings', () => {
    expect(parseLocation({ ...ANSWER, latitude: '51.50853', longitude: '-0.12574' })).toMatchObject({ latitude: 51.51, longitude: -0.13 });
    expect(parseLocation({ ...ANSWER, latitude: -33.8688, longitude: 151.2093 })).toMatchObject({ latitude: -33.87, longitude: 151.21 });
  });

  it('needs a city, valid coordinates and a known timezone', () => {
    const bad: Record<string, unknown>[] = [
      { ...ANSWER, city: '' },
      { ...ANSWER, city: '   ' },
      { ...ANSWER, city: undefined },
      { ...ANSWER, city: 42 },
      { ...ANSWER, city: 'x'.repeat(101) },
      { ...ANSWER, latitude: '91' },
      { ...ANSWER, latitude: '-90.5' },
      { ...ANSWER, longitude: '181' },
      { ...ANSWER, latitude: 'north' },
      { ...ANSWER, latitude: '1e2' },
      { ...ANSWER, latitude: null },
      { ...ANSWER, latitude: NaN },
      { ...ANSWER, longitude: Infinity },
      { ...ANSWER, timezone: undefined },
      { ...ANSWER, timezone: 'Mars/Olympus' },
      { ...ANSWER, timezone: '../../etc/passwd' },
      { ...ANSWER, timezone: 'Europe/Paris\n' },
      { ...ANSWER, timezone: 'x'.repeat(65) },
    ];
    for (const raw of bad) expect(parseLocation(raw), JSON.stringify(raw)).toBeNull();
    for (const raw of [null, undefined, 'Paris', 5, [], [ANSWER]]) expect(parseLocation(raw)).toBeNull();
  });

  it('cleans the text: control characters removed, spaces trimmed', () => {
    expect(parseLocation({ ...ANSWER, city: '  Pa\u0000ri\ts\n ' })!.name).toBe('Paris');
  });

  it('the country is optional and dropped if it is wrong', () => {
    const place = parseLocation({ ...ANSWER, country: undefined, country_code: 'fr' })!;
    expect(place.country).toBeUndefined();
    expect(place.countryCode).toBe('FR');
    expect(parseLocation({ ...ANSWER, country: 'x'.repeat(101), country_code: 'FRA' })).toMatchObject({ country: undefined, countryCode: undefined });
  });
});

describe('detectLocation: the request', () => {
  it('is one plain GET to the one address, with only a generic User-Agent and Accept', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => json(ANSWER));
    await detectLocation(fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://get.geojs.io/v1/ip/geo.json');
    expect(url).toBe(LOCATION_URL);
    expect(new URL(url).search).toBe(''); // nothing in the query string
    expect(Object.keys(init!).sort()).toEqual(['credentials', 'headers', 'redirect', 'signal']); // no method (GET), no body
    expect(init!.credentials).toBe('omit'); // no cookies
    expect(init!.redirect).toBe('error'); // an answer from anywhere else is not followed
    expect(init!.signal).toBeInstanceOf(AbortSignal);
  });

  it('FAILS if a header is added: exactly User-Agent "Weather-Dashboard" and Accept, no cookie, id, version or machine name', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => json(ANSWER));
    await detectLocation(fetchMock);
    const headers = fetchMock.mock.calls[0]![1]!.headers!;
    expect(headers).toEqual({ 'User-Agent': 'Weather-Dashboard', Accept: 'application/json' });
    expect(headers).toEqual(LOCATION_HEADERS);
    const names = Object.keys(headers).map((h) => h.toLowerCase());
    for (const forbidden of ['cookie', 'authorization', 'x-request-id', 'x-api-key', 'x-forwarded-for', 'referer', 'origin', 'x-client-id', 'x-device-id']) {
      expect(names).not.toContain(forbidden);
    }
    expect(JSON.stringify(headers)).not.toMatch(/\d+\.\d+\.\d+/); // no version number
  });

  it('makes one attempt only: a failure is not retried', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(detectLocation(fetchMock)).rejects.toMatchObject({ reason: 'network' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const bad = vi.fn<FetchLike>(async () => new Response('no', { status: 503 }));
    await expect(detectLocation(bad)).rejects.toMatchObject({ reason: 'http' });
    expect(bad).toHaveBeenCalledTimes(1);
  });
});

describe('detectLocation: the answer', () => {
  it('gives the place for a good answer', async () => {
    expect(await detectLocation(async () => json(ANSWER))).toMatchObject({ id: LOCATION_PLACE_ID, name: 'Paris' });
  });

  it('times out instead of hanging', async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)));
    await expect(detectLocation(hang, 30)).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('refuses an answer that is not JSON, not an object, or has no usable place', async () => {
    await expect(detectLocation(async () => new Response('<html>blocked</html>'))).rejects.toMatchObject({ reason: 'not-json' });
    await expect(detectLocation(async () => json([1, 2]))).rejects.toMatchObject({ reason: 'invalid-answer' });
    await expect(detectLocation(async () => json({ ...ANSWER, city: '' }))).rejects.toMatchObject({ reason: 'invalid-answer' });
    await expect(detectLocation(async () => json({ ip: IP }))).rejects.toMatchObject({ reason: 'invalid-answer' });
  });

  it('refuses a huge answer, by its declared size and by its real size', async () => {
    const big = JSON.stringify({ ...ANSWER, pad: 'x'.repeat(MAX_ANSWER_BYTES) });
    await expect(detectLocation(async () => new Response(big))).rejects.toMatchObject({ reason: 'too-big' });
    const declared = new Response(JSON.stringify(ANSWER), { headers: { 'content-length': String(MAX_ANSWER_BYTES + 1) } });
    await expect(detectLocation(async () => declared)).rejects.toMatchObject({ reason: 'too-big' });
  });

  it('a failure carries a fixed reason word and nothing from the provider or the network', async () => {
    const err = await detectLocation(async () => {
      throw new Error(`connect ECONNREFUSED ${IP}:443`);
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LocationError);
    expect((err as LocationError).message).toBe('Location lookup failed: network');
    expect(JSON.stringify(err) + String(err)).not.toContain(IP);
  });
});

describe('POST /api/location', () => {
  let dir: string;
  let fetchMock: ReturnType<typeof vi.fn<FetchLike>>;
  let log: ReturnType<typeof vi.fn<(level: 'info' | 'warn' | 'error', msg: string) => void>>;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'wd-loc-'));
    fetchMock = vi.fn<FetchLike>(async () => json(ANSWER));
    log = vi.fn();
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const makeApp = () => createApp({ dataDir: dir, fetchImpl: fetchMock, log }).app;
  const allow = (app: ReturnType<typeof makeApp>, location: 'on' | 'off' = 'on') => request(app).patch('/api/settings').send({ location }).expect(200);
  const savedText = () => readFile(path.join(dir, 'weather-dashboard.json'), 'utf8');

  it('makes NO request to the provider before the user has allowed it (the setting is "ask")', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/location').expect(403);
    expect(res.body.error).toMatch(/off/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('makes no request after "Not now" / off either', async () => {
    const app = makeApp();
    await allow(app, 'off');
    await request(app).post('/api/location').expect(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no request is made just by starting the server, reading the state or changing other settings', async () => {
    const app = makeApp();
    await request(app).get('/api/state').expect(200);
    await request(app).patch('/api/settings').send({ units: 'imperial' }).expect(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('when allowed: asks GeoJS once, stores the place and answers with it', async () => {
    const app = makeApp();
    await allow(app);
    const res = await request(app).post('/api/location').expect(200);
    expect(res.body).toEqual({ id: -1, name: 'Paris', latitude: 48.86, longitude: 2.35, country: 'France', countryCode: 'FR', timezone: 'Europe/Paris' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(LOCATION_URL);
    const state = (await request(app).get('/api/state')).body;
    expect(state.myLocation).toEqual(res.body);
    expect(state.settings.location).toBe('on');
  });

  it('never stores or logs the IP address, not in the file, not in the answers, not in the log', async () => {
    const app = makeApp();
    await allow(app);
    const ok = await request(app).post('/api/location').expect(200);
    fetchMock.mockImplementationOnce(async () => {
      throw new Error(`connect ECONNREFUSED ${IP}:443`);
    });
    const failed = await request(app).post('/api/location').expect(502);
    fetchMock.mockImplementationOnce(async () => json({ ...ANSWER, city: '' }));
    const invalid = await request(app).post('/api/location').expect(502);
    const everything = [await savedText(), JSON.stringify(ok.body), JSON.stringify(failed.body), JSON.stringify(invalid.body), JSON.stringify(log.mock.calls)];
    for (const text of everything) {
      expect(text).not.toContain(IP);
      expect(text).not.toContain('EXAMPLE-NET');
    }
    expect(log.mock.calls.map((c) => c[1])).toEqual(['Location lookup failed: network', 'Location lookup failed: invalid-answer']);
    for (const name of await readdir(dir)) expect(await readFile(path.join(dir, name), 'utf8')).not.toContain(IP);
  });

  it('a failed lookup answers 502 with a plain message and changes nothing', async () => {
    const app = makeApp();
    await allow(app);
    fetchMock.mockImplementationOnce(async () => new Response('down', { status: 500 }));
    const res = await request(app).post('/api/location').expect(502);
    expect(res.body.error).toBe('Could not find your location right now.');
    expect(fetchMock).toHaveBeenCalledTimes(1); // no retry
    expect((await request(app).get('/api/state')).body.myLocation).toBeNull();
  });

  it('takes no parameters: a query string or a body is refused before anything is asked', async () => {
    const app = makeApp();
    await allow(app);
    await request(app).post('/api/location?ip=8.8.8.8').expect(400);
    await request(app).post('/api/location').send({ ip: '8.8.8.8' }).expect(400);
    await request(app).post('/api/location').send([1]).expect(400);
    expect(fetchMock).not.toHaveBeenCalled();
    await request(app).post('/api/location').send({}).expect(200); // an empty object is no parameter
  });

  it('what the page sends never reaches the provider: the URL, headers and options stay the same', async () => {
    const app = makeApp();
    await allow(app);
    await request(app).post('/api/location').set('Cookie', 'session=abc').set('X-Custom', 'id-123').set('User-Agent', 'Mozilla/5.0 Electron/44 Machine-PC').expect(200);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(LOCATION_URL);
    expect(init!.headers).toEqual(LOCATION_HEADERS);
  });

  it('refuses a request with a foreign Host header, like every route', async () => {
    const app = makeApp();
    await allow(app);
    await request(app).post('/api/location').set('Host', 'evil.example').expect(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('only GET-able routes are unchanged: GET /api/location does not exist', async () => {
    await request(makeApp()).get('/api/location').expect(404);
  });

  it('if the setting is turned off while the lookup runs, nothing is stored', async () => {
    const app = makeApp();
    await allow(app);
    let release!: () => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = () => resolve(json(ANSWER)))));
    const pending = request(app).post('/api/location').then((r) => r);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await allow(app, 'off');
    release();
    expect((await pending).status).toBe(403);
    const state = (await request(app).get('/api/state')).body;
    expect(state.myLocation).toBeNull();
    expect(await savedText()).not.toContain('Paris');
  });

  it('turning the setting off deletes the stored place, from the file too', async () => {
    const app = makeApp();
    await allow(app);
    await request(app).post('/api/location').expect(200);
    expect(await savedText()).toContain('Paris');
    await allow(app, 'off');
    expect((await request(app).get('/api/state')).body.myLocation).toBeNull();
    expect(await savedText()).not.toContain('Paris');
  });

  it('the page can set "on" or "off" but never "ask"', async () => {
    const app = makeApp();
    await request(app).patch('/api/settings').send({ location: 'ask' }).expect(400);
    await request(app).patch('/api/settings').send({ location: 'maybe' }).expect(400);
    await request(app).patch('/api/settings').send({ location: true }).expect(400);
    expect((await request(app).get('/api/settings')).body.location).toBe('ask');
  });

  it('the detected place is never added to favorites or recent (no id -1 entries, not the next start city)', async () => {
    const app = makeApp();
    await allow(app);
    const place = (await request(app).post('/api/location').expect(200)).body;
    await request(app).put('/api/favorites/-1').send(place).expect(200);
    await request(app).post('/api/recent').send(place).expect(200);
    const state = (await request(app).get('/api/state')).body;
    expect(state.favorites).toEqual([]);
    expect(state.recent).toEqual([]);
    expect(state.lastPlace).toBeNull();
  });
});

describe('Storage and the location fields', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'wd-locstore-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const paris = parseLocation(ANSWER)!;

  it('a 1.4.7 file loads unchanged: every saved value kept, location "ask", no place', async () => {
    const fixture = path.join(__dirname, 'fixtures', 'state-1.4.7.json');
    await copyFile(fixture, path.join(dir, 'weather-dashboard.json'));
    const saved = JSON.parse(await readFile(fixture, 'utf8')) as { settings: Record<string, string> } & Record<string, unknown>;
    delete saved.version;
    expect(await new Storage(dir).get()).toEqual({ ...saved, settings: { ...saved.settings, location: 'ask' }, myLocation: null });
  });

  it('writes a 1.4.7 file back with the old fields untouched and the new ones added', async () => {
    const fixture = path.join(__dirname, 'fixtures', 'state-1.4.7.json');
    await copyFile(fixture, path.join(dir, 'weather-dashboard.json'));
    const before = JSON.parse(await readFile(fixture, 'utf8')) as { settings: Record<string, string> };
    await new Storage(dir).updateSettings({ units: 'metric' });
    const after = JSON.parse(await readFile(path.join(dir, 'weather-dashboard.json'), 'utf8')) as typeof before;
    expect(after).toEqual({ ...before, settings: { ...before.settings, units: 'metric', location: 'ask' }, myLocation: null });
  });

  it('setMyLocation stores the place only while the setting is "on", and only a place with the location id', async () => {
    const s = new Storage(dir);
    expect(await s.setMyLocation(paris)).toBeNull(); // still "ask"
    await s.updateSettings({ location: 'on' });
    expect(await s.setMyLocation({ ...paris, id: 123 })).toBeNull(); // not a detected place
    expect((await s.setMyLocation(paris))!.myLocation).toEqual(paris);
    expect((await new Storage(dir).get()).myLocation).toEqual(paris); // survives a restart
  });

  it('a place in the file is dropped unless the setting is "on" and its id is the location id', async () => {
    const file = path.join(dir, 'weather-dashboard.json');
    const write = (settings: unknown, myLocation: unknown) => import('node:fs/promises').then((fs) => fs.writeFile(file, JSON.stringify({ version: 1, settings, myLocation })));
    await write({ location: 'off' }, paris);
    expect((await new Storage(dir).get()).myLocation).toBeNull();
    await write({ location: 'on' }, { ...paris, id: 5 });
    expect((await new Storage(dir).get()).myLocation).toBeNull();
    await write({ location: 'on' }, paris);
    expect((await new Storage(dir).get()).myLocation).toEqual(paris);
    await write({ location: 'bogus' }, paris);
    const s = await new Storage(dir).get();
    expect([s.settings.location, s.myLocation]).toEqual(['ask', null]);
  });
});

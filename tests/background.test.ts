// v1.9 Background mode, server side: the two new settings (validated, defaults for 1.7.1 files, which load unchanged),
// the storage change callback the main process applies settings from, the startup and test-notification routes,
// the in-process weather for the tray (same cache as /api/weather), and the tray's refresh scheduler.

import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackgroundWeather, TRAY_INTERVAL_MS } from '../src/main/backgroundWeather';
import { createApp } from '../src/server/app';
import type { FetchLike } from '../src/server/openMeteo';
import { TEST_NOTIFICATION_GAP_MS, type StartupState } from '../src/server/routes/background';
import { defaultSettings, Storage, validSettings } from '../src/server/storage';
import type { AppState, WeatherData } from '../src/shared/types';

const FIXTURE = path.join(__dirname, 'fixtures', 'state-1.7.1.json');
const FORECAST = path.join(__dirname, 'fixtures', 'forecast-tokyo.json');

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wd-bg-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const file = () => path.join(dir, 'weather-dashboard.json');

describe('settings: closeBehavior and rainAlerts', () => {
  it('defaults: ask, and rain alerts off', () => {
    expect(defaultSettings()).toMatchObject({ closeBehavior: 'ask', rainAlerts: false });
  });

  it('a 1.7.1 file loads with every saved value unchanged, the new fields at their defaults, and is not rewritten', async () => {
    await copyFile(FIXTURE, file());
    const before = await readFile(file(), 'utf8');
    const saved = JSON.parse(before) as AppState & { version: 1 };
    const expected: Record<string, unknown> = { ...saved, settings: { ...saved.settings, closeBehavior: 'ask', rainAlerts: false } };
    delete expected.version;
    expect(await new Storage(dir).get()).toEqual(expected);
    expect(await readFile(file(), 'utf8')).toBe(before); // reading changes nothing on disk
  });

  it('keeps only valid values', () => {
    expect(validSettings({ closeBehavior: 'background', rainAlerts: true })).toEqual({ closeBehavior: 'background', rainAlerts: true });
    expect(validSettings({ closeBehavior: 'hide', rainAlerts: 'yes' })).toEqual({});
    expect(validSettings({ rainAlerts: 1 })).toEqual({});
  });

  it('PATCH /api/settings validates the enum and the boolean, and saves them', async () => {
    const { app } = createApp({ dataDir: dir, fetchImpl: vi.fn<FetchLike>() });
    await request(app).patch('/api/settings').send({ closeBehavior: 'minimize' }).expect(400);
    await request(app).patch('/api/settings').send({ rainAlerts: 'true' }).expect(400);
    await request(app).patch('/api/settings').send({ rainAlerts: null }).expect(400);
    const res = await request(app).patch('/api/settings').send({ closeBehavior: 'exit', rainAlerts: true }).expect(200);
    expect(res.body).toMatchObject({ closeBehavior: 'exit', rainAlerts: true });
    expect(JSON.parse(await readFile(file(), 'utf8')).settings).toMatchObject({ closeBehavior: 'exit', rainAlerts: true });
  });

  it('every saved change reaches the main process through onStateChange; reads do not', async () => {
    const onStateChange = vi.fn<(s: AppState) => void>();
    const { app } = createApp({ dataDir: dir, fetchImpl: vi.fn<FetchLike>(), onStateChange });
    await request(app).get('/api/state').expect(200);
    const calls = onStateChange.mock.calls.length; // a fresh install's first read writes the look decision (not through update)
    await request(app).patch('/api/settings').send({ rainAlerts: true }).expect(200);
    expect(onStateChange.mock.calls.length).toBe(calls + 1);
    expect(onStateChange.mock.lastCall![0].settings.rainAlerts).toBe(true);
    await request(app).patch('/api/settings').send({ rainAlerts: 'x' }).expect(400);
    expect(onStateChange.mock.calls.length).toBe(calls + 1);
  });

  it('a throwing listener never fails the save', async () => {
    const s = new Storage(dir, () => {
      throw new Error('boom');
    });
    await expect(s.updateSettings({ closeBehavior: 'background' })).resolves.toMatchObject({ settings: { closeBehavior: 'background' } });
  });
});

describe('GET/PUT /api/startup', () => {
  it('without the main process (plain browser): unsupported, and it cannot be set', async () => {
    const { app } = createApp({ dataDir: dir, fetchImpl: vi.fn<FetchLike>() });
    expect((await request(app).get('/api/startup').expect(200)).body).toEqual({ supported: false, enabled: false });
    await request(app).put('/api/startup').send({ enabled: true }).expect(409);
  });

  it('reads the OS every time and returns what the OS says after a change', async () => {
    let os = false;
    const set = vi.fn((on: boolean): StartupState => {
      os = on;
      return { supported: true, enabled: os };
    });
    const { app } = createApp({ dataDir: dir, fetchImpl: vi.fn<FetchLike>(), background: { startup: { get: () => ({ supported: true, enabled: os }), set } } });
    expect((await request(app).get('/api/startup')).body).toEqual({ supported: true, enabled: false });
    os = true; // changed in Windows Settings
    expect((await request(app).get('/api/startup')).body).toEqual({ supported: true, enabled: true });
    expect((await request(app).put('/api/startup').send({ enabled: false }).expect(200)).body).toEqual({ supported: true, enabled: false });
    expect(set).toHaveBeenCalledWith(false);
  });

  it('takes only { enabled: boolean }', async () => {
    const set = vi.fn(() => ({ supported: true, enabled: true }));
    const { app } = createApp({ dataDir: dir, fetchImpl: vi.fn<FetchLike>(), background: { startup: { get: () => ({ supported: true, enabled: false }), set } } });
    await request(app).put('/api/startup').send({ enabled: 'yes' }).expect(400);
    await request(app).put('/api/startup').send({ enabled: true, path: 'C:\\evil.exe' }).expect(400);
    await request(app).put('/api/startup').send({}).expect(400);
    expect(set).not.toHaveBeenCalled();
  });

  it('nothing about startup is stored in the data file', async () => {
    const { app } = createApp({
      dataDir: dir,
      fetchImpl: vi.fn<FetchLike>(),
      background: { startup: { get: () => ({ supported: true, enabled: true }), set: () => ({ supported: true, enabled: true }) } },
    });
    await request(app).put('/api/startup').send({ enabled: true }).expect(200);
    await request(app).patch('/api/settings').send({ startWithWindows: true }).expect(200);
    expect(await readFile(file(), 'utf8')).not.toMatch(/startup|startWithWindows|openAtLogin/i);
  });
});

describe('POST /api/rain-alerts/test', () => {
  it('shows the fixed test notification at most once per 5 seconds and takes no body', async () => {
    let t = 1000;
    const testNotification = vi.fn();
    const { app } = createApp({ dataDir: dir, fetchImpl: vi.fn<FetchLike>(), background: { testNotification, now: () => t } });
    await request(app).post('/api/rain-alerts/test').expect(204);
    await request(app).post('/api/rain-alerts/test').expect(429);
    t += TEST_NOTIFICATION_GAP_MS;
    await request(app).post('/api/rain-alerts/test').send({ title: 'x' }).expect(400);
    await request(app).post('/api/rain-alerts/test').expect(204);
    expect(testNotification).toHaveBeenCalledTimes(2);
    expect(testNotification.mock.calls.every((c) => c.length === 0)).toBe(true);
  });

  it('is refused without the main process', async () => {
    const { app } = createApp({ dataDir: dir, fetchImpl: vi.fn<FetchLike>() });
    await request(app).post('/api/rain-alerts/test').expect(409);
  });
});

describe('the tray weather (in the main process)', () => {
  it('uses the same cache entry and the same request as /api/weather', async () => {
    const body = await readFile(FORECAST, 'utf8');
    const fetchImpl = vi.fn<FetchLike>(async () => new Response(body, { status: 200 }));
    const { app, weather } = createApp({ dataDir: dir, fetchImpl, weatherTtlMs: 600_000 });
    await request(app).get('/api/weather?lat=35.6895&lon=139.69171&units=metric&wind=kmh').expect(200);
    const w = await weather(35.6895, 139.69171, 'metric', 'kmh');
    expect(fetchImpl).toHaveBeenCalledTimes(1); // the tray hit the page's cache entry
    expect(w.timezone).toBe('Asia/Tokyo');
    const url = String(fetchImpl.mock.calls[0]![0]);
    expect(url.startsWith('https://api.open-meteo.com/v1/forecast?')).toBe(true);
  });
});

describe('createBackgroundWeather', () => {
  const sample = { place: { id: 1, name: 'A', latitude: 0, longitude: 0 }, weather: {} as WeatherData };

  it('loads at start and then every 10 minutes', async () => {
    let tick: (() => void) | null = null;
    const every = vi.fn((fn: () => void) => (tick = fn));
    const onUpdate = vi.fn();
    const bw = createBackgroundWeather({ load: async () => sample, onUpdate, setInterval: every });
    bw.start();
    expect(every).toHaveBeenCalledWith(expect.any(Function), TRAY_INTERVAL_MS);
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    tick!();
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
  });

  it('a failure keeps the old value: nothing is reported', async () => {
    const onUpdate = vi.fn();
    const bw = createBackgroundWeather({ load: async () => Promise.reject(new Error('offline')), onUpdate, setInterval: () => 0 });
    await bw.refresh();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('overlapping refreshes merge into one more run', async () => {
    let release: () => void = () => {};
    const load = vi.fn(() => new Promise<typeof sample>((r) => (release = () => r(sample))));
    const bw = createBackgroundWeather({ load, onUpdate: () => {}, setInterval: () => 0 });
    const first = bw.refresh();
    void bw.refresh();
    void bw.refresh();
    release();
    await first;
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });
});

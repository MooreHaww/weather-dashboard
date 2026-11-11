// v2.0 Desktop widget: settings, sizes, position, the wallpaper and live background maths, the widget's data, and the
// rule that the widget's preload only receives.

import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  contentProtection,
  cropToRgba,
  frameKey,
  isBlackFrame,
  LIVE_INTERVAL_MS,
  LIVE_SAME_FRAMES,
  LIVE_SLOW_MS,
  liveCropRect,
  nextCaptureIn,
  thumbnailSize,
  type LiveConditions,
} from '../src/main/liveMath';
import {
  backdropSize,
  decideWallpaper,
  parseBackgroundColor,
  parseRegQuery,
  pictureAt,
  placedRect,
  sampleWallpaper,
  wallpaperStyle,
  type Bitmap,
  type Placement,
  type WallpaperFacts,
} from '../src/main/wallpaperMath';
import { WIDGET_MARGIN, widgetPosition } from '../src/main/widgetState';
import { widgetMenuTemplate } from '../src/main/widget';
import { createApp } from '../src/server/app';
import type { FetchLike } from '../src/server/openMeteo';
import { defaultSettings, Storage, validSettings } from '../src/server/storage';
import type { AppState, WeatherData } from '../src/shared/types';
import { nextHours, WIDGET_HOURS, WIDGET_SIZES_DIP, widgetModel, type WidgetData } from '../src/shared/widget';

vi.mock('electron', () => ({ BrowserWindow: class {}, desktopCapturer: {}, Menu: {}, powerMonitor: { on: () => {} }, screen: {}, shell: {}, nativeImage: {} }));

const WIDGET_DEFAULTS = { widget: false, widgetSize: 'small', widgetOnTop: false, widgetBackground: 'wallpaper', widgetEffects: true };

describe('widget settings', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'wd-widget-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('defaults: off, Small, not on top, Wallpaper, effects on', () => {
    expect(defaultSettings()).toMatchObject(WIDGET_DEFAULTS);
  });

  it('a 1.9.0 file loads with every saved value unchanged, the widget fields at their defaults, and is not rewritten', async () => {
    const file = path.join(dir, 'weather-dashboard.json');
    await copyFile(path.join(__dirname, 'fixtures', 'state-1.9.0.json'), file);
    const before = await readFile(file, 'utf8');
    const saved = JSON.parse(before) as AppState & { version?: 1 };
    const expected: Record<string, unknown> = { ...saved, settings: { ...saved.settings, ...WIDGET_DEFAULTS } };
    delete expected.version;
    expect(await new Storage(dir).get()).toEqual(expected);
    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('keeps only valid values', () => {
    expect(validSettings({ widget: true, widgetSize: 'medium', widgetOnTop: true, widgetBackground: 'live', widgetEffects: false })).toEqual({
      widget: true,
      widgetSize: 'medium',
      widgetOnTop: true,
      widgetBackground: 'live',
      widgetEffects: false,
    });
    expect(validSettings({ widget: 'yes', widgetSize: 'large', widgetOnTop: 1, widgetBackground: 'acrylic', widgetEffects: null })).toEqual({});
  });

  it('PATCH /api/settings rejects bad values with 400 and saves good ones', async () => {
    const { app } = createApp({ dataDir: dir, fetchImpl: vi.fn<FetchLike>() });
    for (const bad of [{ widget: 'true' }, { widgetSize: 'large' }, { widgetOnTop: 0 }, { widgetBackground: 'blur' }, { widgetEffects: null }]) {
      await request(app).patch('/api/settings').send(bad).expect(400);
    }
    const res = await request(app).patch('/api/settings').send({ widget: true, widgetSize: 'medium', widgetBackground: 'live' }).expect(200);
    expect(res.body).toMatchObject({ widget: true, widgetSize: 'medium', widgetBackground: 'live', widgetOnTop: false, widgetEffects: true });
  });
});

describe('widget size and position', () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1040 };
  const second = { x: 1920, y: 0, width: 1280, height: 984 };
  const small = WIDGET_SIZES_DIP.small;

  it('sizes in device-independent pixels: Small 170x170, Medium 360x170', () => {
    expect(WIDGET_SIZES_DIP).toEqual({ small: { width: 170, height: 170 }, medium: { width: 360, height: 170 } });
  });

  it('defaults to the top right of the primary work area', () => {
    expect(widgetPosition(undefined, [primary, second], primary, small)).toEqual({ x: 1920 - 170 - WIDGET_MARGIN, y: WIDGET_MARGIN });
    expect(widgetPosition({ x: 'a' }, [primary], primary, WIDGET_SIZES_DIP.medium)).toEqual({ x: 1920 - 360 - WIDGET_MARGIN, y: WIDGET_MARGIN });
  });

  it('keeps a saved spot that is on a screen, also on the second monitor', () => {
    expect(widgetPosition({ x: 100, y: 200 }, [primary, second], primary, small)).toEqual({ x: 100, y: 200 });
    expect(widgetPosition({ x: 2500, y: 300 }, [primary, second], primary, small)).toEqual({ x: 2500, y: 300 });
    expect(widgetPosition({ x: 1880, y: 10 }, [primary], primary, small)).toEqual({ x: 1880, y: 10 }); // 40 px still on screen
  });

  it('recovers a spot that is off-screen after a monitor change', () => {
    expect(widgetPosition({ x: 2500, y: 300 }, [primary], primary, small)).toEqual({ x: 1920 - 170 - WIDGET_MARGIN, y: WIDGET_MARGIN });
    expect(widgetPosition({ x: 1890, y: 10 }, [primary], primary, small)).toEqual({ x: 1734, y: 16 }); // only 30 px left
    expect(widgetPosition({ x: -500, y: -500 }, [primary], primary, small)).toEqual({ x: 1734, y: 16 });
  });
});

describe('the wallpaper setting', () => {
  const stdout = [
    '',
    'HKEY_CURRENT_USER\\Control Panel\\Desktop',
    '    WallpaperStyle    REG_SZ    10',
    '    TileWallpaper    REG_SZ    0',
    '    WallPaper    REG_SZ    C:\\Pictures\\my picture.jpg',
    '    TranscodedImageCount    REG_DWORD    0x1',
    '    Empty    REG_SZ',
    '',
  ].join('\r\n');

  it('parses reg.exe output, values with spaces included', () => {
    expect(parseRegQuery(stdout)).toEqual({
      WallpaperStyle: '10',
      TileWallpaper: '0',
      WallPaper: 'C:\\Pictures\\my picture.jpg',
      TranscodedImageCount: '0x1',
      Empty: '',
    });
  });

  it('maps WallpaperStyle and TileWallpaper to the six styles', () => {
    expect(wallpaperStyle('10', '0')).toBe('fill');
    expect(wallpaperStyle('6', '0')).toBe('fit');
    expect(wallpaperStyle('2', '0')).toBe('stretch');
    expect(wallpaperStyle('0', '0')).toBe('center');
    expect(wallpaperStyle('0', '1')).toBe('tile');
    expect(wallpaperStyle('22', '0')).toBe('span');
    expect(wallpaperStyle('7', '0')).toBeNull();
    expect(wallpaperStyle(undefined, undefined)).toBeNull();
  });

  const facts = (over: Partial<WallpaperFacts> = {}, desktop: Record<string, string> = {}, wallpapers: Record<string, string> = { BackgroundType: '0x0' }): WallpaperFacts => ({
    desktop: { WallPaper: 'C:\\w.jpg', WallpaperStyle: '10', TileWallpaper: '0', TranscodedImageCount: '0x1', ...desktop },
    wallpapers,
    spotlight: {},
    displays: 1,
    perMonitorFiles: false,
    ...over,
  });

  it('uses the picture only when it is certain (one picture, a known style)', () => {
    expect(decideWallpaper(facts())).toEqual({ ok: true, style: 'fill' });
    expect(decideWallpaper(facts({}, {}, {}))).toEqual({ ok: true, style: 'fill' }); // older Windows without BackgroundType
    expect(decideWallpaper(facts({ displays: 2 }))).toEqual({ ok: true, style: 'fill' }); // same picture on two monitors
  });

  it('falls back to the plain card for a slideshow, Spotlight, a solid colour, per-monitor pictures and unknown styles', () => {
    expect(decideWallpaper(facts({}, {}, { BackgroundType: '0x2' }))).toEqual({ ok: false, reason: 'slideshow' });
    expect(decideWallpaper(facts({}, {}, { BackgroundType: '0x1' }))).toEqual({ ok: false, reason: 'solid' });
    expect(decideWallpaper(facts({}, {}, { BackgroundType: '0x3' }))).toEqual({ ok: false, reason: 'spotlight' });
    expect(decideWallpaper(facts({ spotlight: { EnabledState: '0x1' } }))).toEqual({ ok: false, reason: 'spotlight' });
    expect(decideWallpaper(facts({}, { WallPaper: '' }))).toEqual({ ok: false, reason: 'solid' });
    expect(decideWallpaper(facts({}, { TranscodedImageCount: '0x2' }))).toEqual({ ok: false, reason: 'per-monitor' });
    expect(decideWallpaper(facts({ displays: 2, perMonitorFiles: true }))).toEqual({ ok: false, reason: 'per-monitor' });
    expect(decideWallpaper(facts({}, { WallpaperStyle: '99' }))).toEqual({ ok: false, reason: 'style' });
  });

  it('reads the background colour, black when unreadable', () => {
    expect(parseBackgroundColor('10 20 30')).toEqual([10, 20, 30]);
    expect(parseBackgroundColor('nope')).toEqual([0, 0, 0]);
    expect(parseBackgroundColor(undefined)).toEqual([0, 0, 0]);
  });
});

describe('the wallpaper under the widget', () => {
  // A 400x200 picture in four colours: red | green on top, blue | white below.
  const W = 400;
  const H = 200;
  const quad = (x: number, y: number): [number, number, number] =>
    y < H / 2 ? (x < W / 2 ? [255, 0, 0] : [0, 255, 0]) : x < W / 2 ? [0, 0, 255] : [255, 255, 255];
  function fixture(scale = 1): Bitmap {
    const w = W * scale;
    const h = H * scale;
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b] = quad(x / scale, y / scale);
        const i = (y * w + x) * 4;
        data.set([b, g, r, 255], i); // BGRA, like nativeImage.toBitmap on Windows
      }
    }
    return { width: w, height: h, data, order: 'bgra' };
  }
  const monitor = { x: 0, y: 0, width: 1000, height: 1000 };
  const base: Placement = { style: 'fill', image: { width: W, height: H }, monitor, scaleFactor: 1, desktop: monitor };
  const pixel = (out: Uint8ClampedArray, w: number, x: number, y: number) => [...out.slice((y * w + x) * 4, (y * w + x) * 4 + 3)];

  it('places the picture for every style', () => {
    expect(placedRect({ ...base, style: 'fill' })).toEqual({ x: -500, y: 0, width: 2000, height: 1000 }); // cover
    expect(placedRect({ ...base, style: 'fit' })).toEqual({ x: 0, y: 250, width: 1000, height: 500 }); // contain
    expect(placedRect({ ...base, style: 'stretch' })).toEqual(monitor);
    expect(placedRect({ ...base, style: 'center', scaleFactor: 2 })).toEqual({ x: 400, y: 450, width: 200, height: 100 }); // its own pixels at 200 %
    const desktop = { x: 0, y: 0, width: 2000, height: 1000 };
    expect(placedRect({ ...base, style: 'span', desktop })).toEqual(desktop); // across both monitors
  });

  it('fill: a widget in the top-left quarter of the screen sees red and green', () => {
    const out = sampleWallpaper(base, fixture(), { x: 400, y: 0, width: 200, height: 100 }, 4, 2, [9, 9, 9]);
    expect(pixel(out, 4, 0, 0)).toEqual([255, 0, 0]);
    expect(pixel(out, 4, 3, 0)).toEqual([0, 255, 0]);
  });

  it('fit: above the picture is the background colour', () => {
    const out = sampleWallpaper({ ...base, style: 'fit' }, fixture(), { x: 0, y: 0, width: 100, height: 100 }, 2, 2, [9, 8, 7]);
    expect(pixel(out, 2, 0, 0)).toEqual([9, 8, 7]);
    const inside = sampleWallpaper({ ...base, style: 'fit' }, fixture(), { x: 0, y: 700, width: 100, height: 40 }, 2, 2, [9, 8, 7]);
    expect(pixel(inside, 2, 0, 0)).toEqual([0, 0, 255]);
  });

  it('stretch: the bottom right corner of the screen is the white quarter', () => {
    const out = sampleWallpaper({ ...base, style: 'stretch' }, fixture(), { x: 900, y: 900, width: 100, height: 100 }, 2, 2, [0, 0, 0]);
    expect(pixel(out, 2, 1, 1)).toEqual([255, 255, 255]);
  });

  it('center: the picture at its own size in the middle, background around it', () => {
    const p = { ...base, style: 'center' as const };
    expect(pixelAt(p, 300, 400)).toEqual([0, 0]); // the picture starts at (300, 400)
    const out = sampleWallpaper(p, fixture(), { x: 0, y: 0, width: 100, height: 100 }, 2, 2, [1, 2, 3]);
    expect(pixel(out, 2, 0, 0)).toEqual([1, 2, 3]);
  });

  it('tile: repeats from the monitor corner', () => {
    const p = { ...base, style: 'tile' as const };
    const a = sampleWallpaper(p, fixture(), { x: 10, y: 10, width: 20, height: 20 }, 1, 1, [0, 0, 0]);
    const b = sampleWallpaper(p, fixture(), { x: W + 10, y: H + 10, width: 20, height: 20 }, 1, 1, [0, 0, 0]);
    expect(pixel(a, 1, 0, 0)).toEqual([255, 0, 0]);
    expect(pixel(b, 1, 0, 0)).toEqual([255, 0, 0]);
  });

  it('span: a widget on the second monitor sees the right half of the picture', () => {
    const desktop = { x: 0, y: 0, width: 2000, height: 1000 };
    const p = { ...base, style: 'span' as const, monitor: { x: 1000, y: 0, width: 1000, height: 1000 }, desktop };
    const out = sampleWallpaper(p, fixture(), { x: 1800, y: 800, width: 100, height: 100 }, 1, 1, [0, 0, 0]);
    expect(pixel(out, 1, 0, 0)).toEqual([255, 255, 255]);
  });

  it('a scaled-down copy of the picture gives the same colours', () => {
    const full = sampleWallpaper(base, fixture(1), { x: 300, y: 300, width: 400, height: 400 }, 8, 8, [0, 0, 0]);
    const half = sampleWallpaper(base, { ...fixture(1), ...halve(fixture(1)) }, { x: 300, y: 300, width: 400, height: 400 }, 8, 8, [0, 0, 0]);
    expect(half).toEqual(full);
  });

  it('the page gets half the widget size', () => {
    expect(backdropSize({ width: 170, height: 170 })).toEqual({ width: 85, height: 85 });
    expect(backdropSize({ width: 360, height: 170 })).toEqual({ width: 180, height: 85 });
  });

  function pixelAt(p: Placement, x: number, y: number) {
    return pictureAt(p, x, y);
  }
  function halve(b: Bitmap): Bitmap {
    const w = b.width / 2;
    const h = b.height / 2;
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(b.data.slice(((y * 2) * b.width + x * 2) * 4, ((y * 2) * b.width + x * 2) * 4 + 4), (y * w + x) * 4);
    return { width: w, height: h, data, order: 'bgra' };
  }
});

describe('the live background', () => {
  const display = { x: 0, y: 0, width: 3440, height: 1440 };

  it('captures each display at a quarter of its size', () => {
    expect(thumbnailSize(display)).toEqual({ width: 860, height: 360 });
  });

  it('crops the widget out of the thumbnail, clamped, and only on its own display', () => {
    const thumb = thumbnailSize(display);
    expect(liveCropRect({ x: 400, y: 200, width: 170, height: 170 }, display, thumb)).toEqual({ x: 100, y: 50, width: 43, height: 43 });
    expect(liveCropRect({ x: 3400, y: 0, width: 170, height: 170 }, display, thumb)).toEqual({ x: 850, y: 0, width: 10, height: 43 });
    expect(liveCropRect({ x: 4000, y: 0, width: 170, height: 170 }, display, thumb)).toBeNull();
    const second = { x: 3440, y: 0, width: 1920, height: 1080 };
    expect(liveCropRect({ x: 3440 + 480, y: 0, width: 360, height: 170 }, second, thumbnailSize(second))).toEqual({ x: 120, y: 0, width: 90, height: 43 });
  });

  const on: LiveConditions = { live: true, visible: true, locked: false, idle: false, sameFrames: 0, failed: false };

  it('captures once a second while Live is on and the widget can be seen', () => {
    expect(nextCaptureIn(on)).toBe(LIVE_INTERVAL_MS);
  });

  it('stops when Live is off, the widget is hidden, or the screen is locked', () => {
    expect(nextCaptureIn({ ...on, live: false })).toBeNull();
    expect(nextCaptureIn({ ...on, visible: false })).toBeNull();
    expect(nextCaptureIn({ ...on, locked: true })).toBeNull();
  });

  it('slows down when nothing changes, after a failure, and when the PC is idle', () => {
    expect(nextCaptureIn({ ...on, sameFrames: LIVE_SAME_FRAMES - 1 })).toBe(LIVE_INTERVAL_MS);
    expect(nextCaptureIn({ ...on, sameFrames: LIVE_SAME_FRAMES })).toBe(LIVE_SLOW_MS);
    expect(nextCaptureIn({ ...on, failed: true })).toBe(LIVE_SLOW_MS);
    expect(nextCaptureIn({ ...on, idle: true })).toBe(LIVE_SLOW_MS);
  });

  it('hides the widget from captures only while Live is on', () => {
    expect(contentProtection({ widget: true, widgetBackground: 'live' })).toBe(true);
    expect(contentProtection({ widget: true, widgetBackground: 'wallpaper' })).toBe(false);
    expect(contentProtection({ widget: false, widgetBackground: 'live' })).toBe(false);
  });

  it('knows an all-black frame', () => {
    expect(isBlackFrame(new Uint8Array(400))).toBe(true);
    const frame = new Uint8Array(400);
    frame.fill(90);
    expect(isBlackFrame(frame)).toBe(false);
    expect(isBlackFrame(new Uint8Array(0))).toBe(true);
  });

  it('crops BGRA into RGBA and tells changed frames apart', () => {
    const src = new Uint8Array(4 * 4 * 4);
    src.set([10, 20, 30, 255], (1 * 4 + 2) * 4); // pixel (2, 1) in BGRA
    const out = cropToRgba(src, 4, { x: 2, y: 1, width: 1, height: 1 });
    expect([...out]).toEqual([30, 20, 10, 255]);
    expect(frameKey(out)).toBe(frameKey(new Uint8ClampedArray([30, 20, 10, 255])));
    expect(frameKey(out)).not.toBe(frameKey(new Uint8ClampedArray([31, 20, 10, 255])));
  });
});

describe('what the widget shows', () => {
  const hours = Array.from({ length: 30 }, (_, i) => `2026-11-10T${String(i % 24).padStart(2, '0')}:00`).map((t, i) => (i >= 24 ? t.replace('11-10', '11-11') : t));
  const weather = {
    timezone: 'Europe/London',
    unitLabels: { temperature: '°C', windSpeed: 'km/h' },
    current: { time: '2026-11-10T14:20', temperature: -0.4, apparentTemperature: 0, humidity: 80, windSpeed: 5, windDirection: 0, weatherCode: 63, isDay: true },
    hourly: {
      time: hours,
      temperature: hours.map((_, i) => i + 0.4),
      apparentTemperature: hours.map(() => 0),
      precipitationProbability: hours.map(() => 70),
      weatherCode: hours.map((_, i) => (i === 15 ? 97 : 3)),
      isDay: hours.map((_, i) => i % 24 >= 7 && i % 24 < 17),
    },
    daily: {
      time: ['2026-11-10', '2026-11-11'],
      weatherCode: [63, 3],
      tempMax: [10, 9],
      tempMin: [2, 1],
      precipitationProbabilityMax: [80, 20],
      sunrise: ['2026-11-10T07:10', '2026-11-11T07:12'],
      sunset: ['2026-11-10T16:20', '2026-11-11T16:18'],
    },
  } as unknown as WeatherData;
  const london = { id: 1, name: 'London', latitude: 51.5, longitude: -0.1 };

  it('without a city: the plain card', () => {
    const m = widgetModel({ place: null, weather: null, size: 'small', effects: true, timeFormat: '12h' });
    expect(m).toMatchObject({ place: null, size: 'small', effects: true });
    expect(m.tint).toMatch(/^rgba\(/);
  });

  it('Small: temperature, city, condition, and no hours', () => {
    const m = widgetModel({ place: london, weather, size: 'small', effects: false, timeFormat: '12h', nowLocal: '2026-11-10T14:20:00' }) as WidgetData;
    expect(m).toMatchObject({ place: 'London', temp: 0, unit: '°C', condition: 'Rain', icon: 'rain', isDay: true, rainChance: 80, hours: [], sky: 'rain', effects: false });
  });

  it('Medium: the next four whole hours, with the 12/24-hour format', () => {
    const m = widgetModel({ place: london, weather, size: 'medium', effects: true, timeFormat: '24h', nowLocal: '2026-11-10T14:20:00' }) as WidgetData;
    expect(m.hours.map((h) => h.label)).toEqual(['15:00', '16:00', '17:00', '18:00']);
    expect(m.hours[0]).toMatchObject({ icon: 'thunder', temp: 15, isDay: true });
    expect(m.hours[3]!.isDay).toBe(false);
    expect(nextHours(weather, '2026-11-10T22:59:00', WIDGET_HOURS, '12h').map((h) => h.label)).toEqual(['11 PM', '12 AM', '1 AM', '2 AM']);
  });
});

describe('the widget has no way to talk to the main process', () => {
  const read = (f: string) => readFileSync(path.join(__dirname, '..', f), 'utf8');

  it('its preload only listens (no send, invoke, sendSync, sendToHost or postMessage)', () => {
    const src = read('src/main/widgetPreload.ts');
    expect(src).not.toMatch(/\.(send|invoke|sendSync|sendToHost|postMessage)\s*\(/);
    expect([...src.matchAll(/ipcRenderer\.(\w+)\(/g)].map((m) => m[1])).toEqual(['on', 'on', 'on']);
  });

  it('the main window preload still sends only the three v1.9 messages', () => {
    const sends = [...read('src/main/preload.ts').matchAll(/ipcRenderer\.send\('([^']+)'/g)].map((m) => m[1]);
    expect(sends).toEqual(['update-restart', 'update-check', 'close-choice']);
  });

  it('the main process listens for exactly those three messages', () => {
    const on = [...read('src/main/main.ts').matchAll(/ipcMain\.(on|handle)\(\s*(\w+)/g)].map((m) => m[2]);
    expect(on).toEqual(['RESTART_CHANNEL', 'CHECK_CHANNEL', 'CLOSE_CHOICE_CHANNEL']);
    expect(read('src/main/widget.ts')).not.toMatch(/ipcMain/);
  });

  it('the widget menu has "Open Weather Dashboard" and "Close widget"', () => {
    const open = vi.fn();
    const close = vi.fn();
    const items = widgetMenuTemplate(open, close);
    expect(items.map((i) => i.label)).toEqual(['Open Weather Dashboard', 'Close widget']);
    (items[1]!.click as () => void)();
    expect(close).toHaveBeenCalledOnce();
  });
});

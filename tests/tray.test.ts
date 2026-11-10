// v1.9: the tray icon's bitmap (pure JS pixel font), its label, the tray city rule and its text,
// and "Start with Windows" (decision, hidden launch, the OS as the truth).

import { describe, expect, it, vi } from 'vitest';
import { createStartup, HIDDEN_ARG, launchedHidden, startupSupported } from '../src/main/startup';
import { trayCity, trayText } from '../src/main/trayCity';
import { BADGE, BASE, drawTrayBitmap, GLYPH_HEIGHT, INK, labelWidth, trayLabel } from '../src/main/trayIcon';
import { LOCATION_PLACE_ID, type AppState, type Place, type WeatherData } from '../src/shared/types';
import { defaultSettings } from '../src/server/storage';

/** The bitmap as text: '#' digit, '.' badge, ' ' transparent; in base pixels (every scale-th pixel). */
function picture(text: string, scale: 1 | 2 = 1): string[] {
  const bmp = drawTrayBitmap(text, scale);
  const rows: string[] = [];
  for (let y = 0; y < bmp.height; y += scale) {
    let row = '';
    for (let x = 0; x < bmp.width; x += scale) {
      const o = (y * bmp.width + x) * 4;
      const [b, g, r, a] = [bmp.bgra[o], bmp.bgra[o + 1], bmp.bgra[o + 2], bmp.bgra[o + 3]];
      if (a === 0) row += ' ';
      else if (r === INK[0] && g === INK[1] && b === INK[2]) row += '#';
      else if (r === BADGE[0] && g === BADGE[1] && b === BADGE[2]) row += '.';
      else row += '?';
    }
    rows.push(row);
  }
  return rows;
}

/** The label's own columns of the 7 digit rows ('#' digit, '.' badge). */
const digitRows = (rows: string[], text: string) => {
  const left = Math.floor((BASE - labelWidth(text)) / 2);
  const top = Math.floor((BASE - GLYPH_HEIGHT) / 2);
  return rows.slice(top, top + GLYPH_HEIGHT).map((r) => r.slice(left, left + labelWidth(text)));
};

describe('trayLabel', () => {
  it('rounds to a whole number, with no "-0"', () => {
    expect(trayLabel(12.4)).toBe('12');
    expect(trayLabel(12.5)).toBe('13');
    expect(trayLabel(-4.6)).toBe('-5');
    expect(trayLabel(-0.4)).toBe('0');
    expect(trayLabel(0)).toBe('0');
  });

  it('three-digit and negative values in both units stay within 4 characters', () => {
    expect(trayLabel(104.2)).toBe('104'); // °F
    expect(trayLabel(-130)).toBe('-130'); // °F, coldest on record
    expect(trayLabel(-40)).toBe('-40'); // °C and °F
    expect(trayLabel(5000)).toBe('999');
    expect(trayLabel(-5000)).toBe('-199');
    for (const t of [-199, -130, -40, -5, 0, 9, 42, 104, 999]) expect(labelWidth(trayLabel(t))).toBeLessThanOrEqual(BASE - 1);
  });
});

describe('drawTrayBitmap', () => {
  it('is 16 x 16 and 32 x 32 BGRA', () => {
    expect(drawTrayBitmap('12', 1)).toMatchObject({ width: 16, height: 16 });
    expect(drawTrayBitmap('12', 1).bgra.length).toBe(16 * 16 * 4);
    expect(drawTrayBitmap('12', 2)).toMatchObject({ width: 32, height: 32 });
    expect(drawTrayBitmap('12', 2).bgra.length).toBe(32 * 32 * 4);
  });

  it('draws only opaque badge and digit pixels and transparent corners (readable on any taskbar)', () => {
    const rows = picture('-130');
    expect(rows.join('')).not.toContain('?');
    expect(rows[0]![0]).toBe(' ');
    expect(rows[15]![15]).toBe(' ');
    expect(rows[8]![0]).toBe('.'); // the badge reaches the edges
  });

  it('draws the digits from the pixel font, centred', () => {
    expect(digitRows(picture('12'), '12')).toEqual(['.#..###', '##....#', '.#....#', '.#..###', '.#..#..', '.#..#..', '###.###']);
  });

  it('a minus is a single middle bar; "-5" and "-130" keep it', () => {
    const minus = picture('-5');
    expect(minus[7]).toContain('###');
    const four = picture('-130');
    const inkCols = (row: string) => [...row].map((c, i) => (c === '#' ? i : -1)).filter((i) => i >= 0);
    expect(inkCols(four[7]!)[0]).toBe(0 + Math.floor((BASE - labelWidth('-130')) / 2)); // the minus starts the label
    expect(labelWidth('-130')).toBe(15);
  });

  it('32 px is the same drawing at 2x (crisp, no blur)', () => {
    expect(picture('104', 2)).toEqual(picture('104', 1));
    const big = drawTrayBitmap('8', 2);
    const small = drawTrayBitmap('8', 1);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const o = (y * 32 + x) * 4;
        const s = (Math.floor(y / 2) * 16 + Math.floor(x / 2)) * 4;
        expect(big.bgra.subarray(o, o + 4).equals(small.bgra.subarray(s, s + 4))).toBe(true);
      }
    }
  });

  it('every digit looks different', () => {
    const shapes = new Set([...'0123456789'].map((d) => digitRows(picture(d), d).join('|')));
    expect(shapes.size).toBe(10);
  });
});

const place = (id: number, name: string): Place => ({ id, name, latitude: 1, longitude: 2 });
const state = (over: Partial<AppState> = {}): AppState => ({
  favorites: [],
  recent: [],
  settings: defaultSettings(),
  lastPlace: null,
  myLocation: null,
  ...over,
});

describe('trayCity', () => {
  const me = { ...place(LOCATION_PLACE_ID, 'Here') };
  it('Your location while it is on, else the first favorite, else the last shown city, else none', () => {
    const fav = place(1, 'Tokyo');
    const last = place(2, 'Paris');
    expect(trayCity(state({ settings: { ...defaultSettings(), location: 'on' }, myLocation: me, favorites: [fav], lastPlace: last }))).toBe(me);
    expect(trayCity(state({ settings: { ...defaultSettings(), location: 'off' }, myLocation: me, favorites: [fav], lastPlace: last }))).toBe(fav);
    expect(trayCity(state({ settings: { ...defaultSettings(), location: 'on' }, myLocation: null, favorites: [fav], lastPlace: last }))).toBe(fav);
    expect(trayCity(state({ lastPlace: last }))).toBe(last);
    expect(trayCity(state())).toBeNull();
  });
});

describe('trayText', () => {
  const w = (temperature: number, code: number, unit: string) =>
    ({ current: { temperature, weatherCode: code }, unitLabels: { temperature: unit } }) as unknown as WeatherData;
  it('"Istanbul 12°C, Mainly clear", rounded, in the unit the weather came in', () => {
    expect(trayText(place(1, 'Istanbul'), w(11.6, 1, '°C'))).toBe('Istanbul 12°C, Mainly clear');
    expect(trayText(place(1, 'Phoenix'), w(104.4, 0, '°F'))).toBe('Phoenix 104°F, Clear sky');
    expect(trayText(place(1, 'Oslo'), w(-0.3, 71, '°C'))).toBe('Oslo 0°C, Light snow');
  });
});

describe('Start with Windows', () => {
  it('only the installed app supports it', () => {
    expect(startupSupported({ isPackaged: true, devUrl: undefined })).toBe(true);
    expect(startupSupported({ isPackaged: false, devUrl: undefined })).toBe(false);
    expect(startupSupported({ isPackaged: true, devUrl: 'http://localhost:5173' })).toBe(false);
  });

  it('a launch by the login item (with its argument) starts hidden; a normal launch shows the window', () => {
    expect(launchedHidden(['Weather Dashboard.exe', HIDDEN_ARG])).toBe(true);
    expect(launchedHidden(['Weather Dashboard.exe'])).toBe(false);
    expect(launchedHidden(['Weather Dashboard.exe', '--wd-hidden=0'])).toBe(false);
  });

  it('registers the login item with the hidden argument and reports what the OS says', () => {
    let os = false;
    const items = {
      getLoginItemSettings: vi.fn(() => ({ openAtLogin: os })),
      setLoginItemSettings: vi.fn((s: { openAtLogin: boolean }) => void (os = s.openAtLogin)),
    };
    const s = createStartup({ supported: true, items });
    expect(s.get()).toEqual({ supported: true, enabled: false });
    expect(s.set(true)).toEqual({ supported: true, enabled: true });
    expect(items.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, args: [HIDDEN_ARG] });
    expect(items.getLoginItemSettings).toHaveBeenCalledWith({ args: [HIDDEN_ARG] });
    os = false; // turned off in Windows Settings
    expect(s.get().enabled).toBe(false);
  });

  it('unsupported: never touches the OS and reads as off', () => {
    const items = { getLoginItemSettings: vi.fn(() => ({ openAtLogin: true })), setLoginItemSettings: vi.fn() };
    const s = createStartup({ supported: false, items });
    expect(s.set(true)).toEqual({ supported: false, enabled: false });
    expect(items.setLoginItemSettings).not.toHaveBeenCalled();
    expect(items.getLoginItemSettings).not.toHaveBeenCalled();
  });
});

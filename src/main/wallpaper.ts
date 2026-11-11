// The widget's "Wallpaper" background (v2.0): read the Windows wallpaper setting with reg.exe (fixed arguments, no shell),
// decode the picture Windows shows with nativeImage, and cut out what lies under the widget. The picture stays in
// memory: never saved, logged or sent anywhere but to the widget page. The path is never logged; a failure logs a word.

import { execFile } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { nativeImage } from 'electron';
import {
  backdropSize,
  decideWallpaper,
  parseBackgroundColor,
  parseRegQuery,
  sampleWallpaper,
  WALLPAPER_MAX_BYTES,
  type Bitmap,
  type Placement,
  type Rect,
  type WallpaperStyle,
} from './wallpaperMath';

const KEYS = {
  desktop: 'HKCU\\Control Panel\\Desktop',
  wallpapers: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Wallpapers',
  spotlight: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\DesktopSpotlight\\Settings',
  colors: 'HKCU\\Control Panel\\Colors',
} as const;

/** The largest side a decoded wallpaper is kept at (sampling a 1024 px copy is cheap; the page blurs it). */
const KEEP_SIDE = 1024;

function query(key: string): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', key], { timeout: 2000, windowsHide: true }, (error, stdout) => resolve(error ? {} : parseRegQuery(String(stdout))));
  });
}

const themesDir = () => path.join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Themes');

export interface DisplayInfo {
  bounds: Rect;
  scaleFactor: number;
}

export interface WallpaperFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

interface Decoded {
  key: string;
  style: WallpaperStyle;
  image: { width: number; height: number };
  source: Bitmap;
  background: [number, number, number];
}

export function createWallpaperReader(log: (level: 'info' | 'warn' | 'error', msg: string) => void) {
  let decoded: Decoded | null = null;
  let lastSignature = '';

  /** What decides the picture: the registry values and the file's size and time. Cheap; checked every 30 s. */
  async function signature(displays: number): Promise<{ sig: string; decision: ReturnType<typeof decideWallpaper>; file: string | null; desktop: Record<string, string> }> {
    const [desktop, wallpapers, spotlight] = await Promise.all([query(KEYS.desktop), query(KEYS.wallpapers), query(KEYS.spotlight)]);
    const perMonitorFiles = existsSync(path.join(themesDir(), 'Transcoded_000'));
    const decision = decideWallpaper({ desktop, wallpapers, spotlight, displays, perMonitorFiles });
    let file: string | null = null;
    let stamp = '';
    if (decision.ok) {
      // Center and tile draw the picture at its own pixel size: only the original file has it. The others need
      // only its shape, and the transcoded copy is what Windows actually shows.
      file = decision.style === 'center' || decision.style === 'tile' ? (desktop.WallPaper ?? '') : path.join(themesDir(), 'TranscodedWallpaper');
      try {
        const st = await fs.stat(file);
        stamp = `${st.size}:${st.mtimeMs}`;
      } catch {
        stamp = 'missing';
      }
    }
    const sig = JSON.stringify([desktop.WallPaper, desktop.WallpaperStyle, desktop.TileWallpaper, desktop.TranscodedImageCount, wallpapers.BackgroundType, spotlight.EnabledState, perMonitorFiles, displays, stamp]);
    return { sig, decision, file, desktop };
  }

  async function decode(file: string, style: WallpaperStyle, key: string): Promise<Decoded | null> {
    if (decoded?.key === key) return decoded;
    const st = await fs.stat(file);
    if (!st.isFile() || st.size === 0 || st.size > WALLPAPER_MAX_BYTES) throw new Error('size');
    const image = nativeImage.createFromBuffer(await fs.readFile(file));
    if (image.isEmpty()) throw new Error('format');
    const size = image.getSize();
    const scale = Math.min(1, KEEP_SIDE / Math.max(size.width, size.height));
    const small = scale < 1 ? image.resize({ width: Math.max(1, Math.round(size.width * scale)), quality: 'good' }) : image;
    const smallSize = small.getSize();
    const colors = await query(KEYS.colors);
    decoded = {
      key,
      style,
      image: size,
      source: { width: smallSize.width, height: smallSize.height, data: small.toBitmap(), order: 'bgra' },
      background: parseBackgroundColor(colors.Background),
    };
    return decoded;
  }

  return {
    /** True if the wallpaper setting or file changed since the last read (the 30 s check). */
    async changed(displays: number): Promise<boolean> {
      return (await signature(displays)).sig !== lastSignature;
    },
    /** The wallpaper under `widget`, or null for the plain card (anything uncertain or failed). */
    async read(widget: Rect, display: DisplayInfo, allDisplays: Rect[]): Promise<WallpaperFrame | null> {
      try {
        const s = await signature(allDisplays.length);
        lastSignature = s.sig;
        if (!s.decision.ok || !s.file) {
          decoded = null;
          return null;
        }
        const d = await decode(s.file, s.decision.style, s.sig);
        if (!d) return null;
        const left = Math.min(...allDisplays.map((r) => r.x));
        const top = Math.min(...allDisplays.map((r) => r.y));
        const right = Math.max(...allDisplays.map((r) => r.x + r.width));
        const bottom = Math.max(...allDisplays.map((r) => r.y + r.height));
        const placement: Placement = {
          style: d.style,
          image: d.image,
          monitor: display.bounds,
          scaleFactor: display.scaleFactor,
          desktop: { x: left, y: top, width: right - left, height: bottom - top },
        };
        const out = backdropSize(widget);
        return { ...out, data: sampleWallpaper(placement, d.source, widget, out.width, out.height, d.background) };
      } catch (err) {
        decoded = null;
        const word = err instanceof Error && (err.message === 'size' || err.message === 'format') ? err.message : 'read';
        log('warn', `Wallpaper not used: ${word}`);
        return null;
      }
    },
  };
}

// The widget's "Wallpaper" background (v2.0), the pure part: which wallpaper setting Windows has, whether we can be sure
// what is on the widget's monitor, and which wallpaper pixels lie under the widget. No Electron imports; unit-tested.
//
// Windows keeps the wallpaper in HKCU\Control Panel\Desktop (WallPaper, WallpaperStyle, TileWallpaper) and its kind in
// HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Wallpapers (BackgroundType: 0 picture, 1 solid colour,
// 2 slideshow, 3 Spotlight). The picture Windows actually shows is cached as %APPDATA%\Microsoft\Windows\Themes\TranscodedWallpaper.
// Whenever the picture under the widget can't be known for sure, the answer is "plain card", never a guess.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type WallpaperStyle = 'fill' | 'fit' | 'stretch' | 'center' | 'tile' | 'span';

/** Values of a `reg.exe query <key>` (name -> data as printed; REG_DWORD as "0x1"). */
export function parseRegQuery(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s{2,}(\S(?:.*?\S)?)\s{2,}(REG_\w+)\s{2,}(.*)$/.exec(line) ?? /^\s{2,}(\S(?:.*?\S)?)\s{2,}(REG_\w+)\s*$/.exec(line);
    if (m) out[m[1]!] = (m[3] ?? '').trim();
  }
  return out;
}

const dword = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** WallpaperStyle (+ TileWallpaper) -> style; null for values Windows 11 does not offer. */
export function wallpaperStyle(style: string | undefined, tile: string | undefined): WallpaperStyle | null {
  switch ((style ?? '').trim()) {
    case '10':
      return 'fill';
    case '6':
      return 'fit';
    case '2':
      return 'stretch';
    case '22':
      return 'span';
    case '0':
      return (tile ?? '').trim() === '1' ? 'tile' : 'center';
    default:
      return null;
  }
}

export interface WallpaperFacts {
  desktop: Record<string, string>; // HKCU\Control Panel\Desktop
  wallpapers: Record<string, string>; // ...\Explorer\Wallpapers
  spotlight: Record<string, string>; // ...\DesktopSpotlight\Settings (absent on most PCs)
  displays: number;
  /** A per-monitor cache file (Transcoded_000 ...) exists: different pictures per monitor. */
  perMonitorFiles: boolean;
}

export type WallpaperDecision = { ok: true; style: WallpaperStyle } | { ok: false; reason: WallpaperFallback };
export type WallpaperFallback = 'solid' | 'slideshow' | 'spotlight' | 'per-monitor' | 'style' | 'none';

/** Can we be sure which picture is on the widget's monitor? */
export function decideWallpaper(f: WallpaperFacts): WallpaperDecision {
  const type = dword(f.wallpapers.BackgroundType);
  if (type === 1) return { ok: false, reason: 'solid' };
  if (type === 2) return { ok: false, reason: 'slideshow' };
  if (type === 3 || dword(f.spotlight.EnabledState) === 1) return { ok: false, reason: 'spotlight' };
  if (type !== null && type !== 0) return { ok: false, reason: 'none' };
  if (!(f.desktop.WallPaper ?? '').trim()) return { ok: false, reason: 'solid' };
  const count = dword(f.desktop.TranscodedImageCount);
  if ((count !== null && count > 1) || (f.displays > 1 && f.perMonitorFiles)) return { ok: false, reason: 'per-monitor' };
  const style = wallpaperStyle(f.desktop.WallpaperStyle, f.desktop.TileWallpaper);
  if (!style) return { ok: false, reason: 'style' };
  return { ok: true, style };
}

/** "Control Panel\Colors" Background, "r g b" -> [r, g, b]; black if unreadable. Fit and center show it around the picture. */
export function parseBackgroundColor(v: string | undefined): [number, number, number] {
  const parts = (v ?? '').trim().split(/\s+/).map(Number);
  return parts.length === 3 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? (parts as [number, number, number]) : [0, 0, 0];
}

export interface Placement {
  style: WallpaperStyle;
  /** The picture's size in its own pixels. */
  image: { width: number; height: number };
  /** The monitor the widget is on (DIP). */
  monitor: Rect;
  /** The monitor's scale factor (center and tile draw the picture at its own pixel size). */
  scaleFactor: number;
  /** Every monitor's bounding box (DIP): span covers it. */
  desktop: Rect;
}

/** Where the whole picture sits on screen (DIP), for every style but tile. */
export function placedRect(p: Placement): Rect {
  const { image, monitor } = p;
  if (p.style === 'stretch') return { ...monitor };
  if (p.style === 'center' || p.style === 'tile') {
    const width = image.width / p.scaleFactor;
    const height = image.height / p.scaleFactor;
    return { x: monitor.x + (monitor.width - width) / 2, y: monitor.y + (monitor.height - height) / 2, width, height };
  }
  const area = p.style === 'span' ? p.desktop : monitor;
  const scale = p.style === 'fit' ? Math.min(area.width / image.width, area.height / image.height) : Math.max(area.width / image.width, area.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2, width, height };
}

/** The picture pixel under a screen point (DIP), or null where the background colour shows (fit, center). */
export function pictureAt(p: Placement, sx: number, sy: number): [number, number] | null {
  if (p.style === 'tile') {
    const tw = p.image.width / p.scaleFactor;
    const th = p.image.height / p.scaleFactor;
    const mod = (a: number, n: number) => ((a % n) + n) % n;
    return [(mod(sx - p.monitor.x, tw) / tw) * p.image.width, (mod(sy - p.monitor.y, th) / th) * p.image.height];
  }
  const r = placedRect(p);
  if (sx < r.x || sy < r.y || sx >= r.x + r.width || sy >= r.y + r.height) return null;
  return [((sx - r.x) / r.width) * p.image.width, ((sy - r.y) / r.height) * p.image.height];
}

export interface Bitmap {
  width: number;
  height: number;
  /** 4 bytes a pixel. `order` says which. */
  data: Uint8Array;
  order: 'rgba' | 'bgra';
}

/**
 * The wallpaper under the widget: `widget` (screen DIP) sampled into an RGBA image of outW x outH (nearest pixel; the
 * page blurs it anyway). `source` may be a scaled-down copy of the picture: positions are scaled to it.
 */
export function sampleWallpaper(
  p: Placement,
  source: Bitmap,
  widget: Rect,
  outW: number,
  outH: number,
  background: [number, number, number],
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(outW * outH * 4);
  const fx = source.width / p.image.width;
  const fy = source.height / p.image.height;
  const [ri, bi] = source.order === 'rgba' ? [0, 2] : [2, 0];
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const sx = widget.x + ((x + 0.5) / outW) * widget.width;
      const sy = widget.y + ((y + 0.5) / outH) * widget.height;
      const at = pictureAt(p, sx, sy);
      const o = (y * outW + x) * 4;
      if (!at) {
        out[o] = background[0];
        out[o + 1] = background[1];
        out[o + 2] = background[2];
      } else {
        const px = Math.min(source.width - 1, Math.max(0, Math.floor(at[0] * fx)));
        const py = Math.min(source.height - 1, Math.max(0, Math.floor(at[1] * fy)));
        const i = (py * source.width + px) * 4;
        out[o] = source.data[i + ri]!;
        out[o + 1] = source.data[i + 1]!;
        out[o + 2] = source.data[i + bi]!;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

/** The size of what the page gets: half the widget's DIP size (it is blurred by 24 px and more). */
export function backdropSize(widget: { width: number; height: number }): { width: number; height: number } {
  return { width: Math.max(1, Math.round(widget.width / 2)), height: Math.max(1, Math.round(widget.height / 2)) };
}

/** Largest wallpaper file read (bytes): anything bigger falls back to the plain card. */
export const WALLPAPER_MAX_BYTES = 32 * 1024 * 1024;
/** How often the wallpaper setting is checked while the widget is visible. */
export const WALLPAPER_CHECK_MS = 30_000;

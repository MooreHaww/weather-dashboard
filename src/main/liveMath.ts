// The widget's "Live" background (v2.0), the pure part: which part of a screen thumbnail lies under the widget, when the
// next capture runs, and which frames are useless (all black: some HDR and GPU setups). No Electron imports; unit-tested.

import type { Rect } from './wallpaperMath';

/** A thumbnail is the display at 1/LIVE_DIVISOR of its DIP size: the smallest that still blurs smoothly. */
export const LIVE_DIVISOR = 4;
export const LIVE_INTERVAL_MS = 1000;
/** After this many frames with no change, or after a failure, capture only every LIVE_SLOW_MS. */
export const LIVE_SAME_FRAMES = 10;
export const LIVE_SLOW_MS = 5000;

export function thumbnailSize(display: { width: number; height: number }): { width: number; height: number } {
  return { width: Math.max(1, Math.round(display.width / LIVE_DIVISOR)), height: Math.max(1, Math.round(display.height / LIVE_DIVISOR)) };
}

/** The widget's rectangle in a thumbnail's pixels, clamped to it; null if the widget is not on this display. */
export function liveCropRect(widget: Rect, display: Rect, thumb: { width: number; height: number }): Rect | null {
  const sx = thumb.width / display.width;
  const sy = thumb.height / display.height;
  const x0 = Math.max(0, Math.floor((widget.x - display.x) * sx));
  const y0 = Math.max(0, Math.floor((widget.y - display.y) * sy));
  const x1 = Math.min(thumb.width, Math.ceil((widget.x + widget.width - display.x) * sx));
  const y1 = Math.min(thumb.height, Math.ceil((widget.y + widget.height - display.y) * sy));
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export interface LiveConditions {
  /** The setting is Live and the widget exists. */
  live: boolean;
  /** The widget window is shown (not hidden or minimized). */
  visible: boolean;
  /** Screen locked, PC suspended, or the session idle state is "locked". */
  locked: boolean;
  /** No input for minutes (the display may be off): capture slowly. */
  idle: boolean;
  /** Frames in a row that looked the same as the one before. */
  sameFrames: number;
  /** The last capture failed or was black. */
  failed: boolean;
}

/** Milliseconds until the next capture, or null to stop capturing. */
export function nextCaptureIn(c: LiveConditions): number | null {
  if (!c.live || !c.visible || c.locked) return null;
  if (c.failed || c.idle || c.sameFrames >= LIVE_SAME_FRAMES) return LIVE_SLOW_MS;
  return LIVE_INTERVAL_MS;
}

/** Content protection (hidden from every screen capture, ours included) only while Live is on. */
export function contentProtection(settings: { widget: boolean; widgetBackground: 'wallpaper' | 'live' }): boolean {
  return settings.widget && settings.widgetBackground === 'live';
}

/** True if almost every pixel is black (captures that failed silently). `data` is 4 bytes a pixel, any channel order. */
export function isBlackFrame(data: Uint8Array | Uint8ClampedArray, share = 0.98, level = 8): boolean {
  const pixels = Math.floor(data.length / 4);
  if (pixels === 0) return true;
  let dark = 0;
  for (let i = 0; i < pixels * 4; i += 4) {
    if (data[i]! < level && data[i + 1]! < level && data[i + 2]! < level) dark++;
  }
  return dark / pixels >= share;
}

/** A cheap fingerprint to tell whether a frame changed (sum of every 7th byte, with position). */
export function frameKey(data: Uint8Array | Uint8ClampedArray): number {
  let h = 0;
  for (let i = 0; i < data.length; i += 7) h = (h * 31 + data[i]!) >>> 0;
  return h;
}

/** BGRA (nativeImage.toBitmap on Windows) -> RGBA, cropped. */
export function cropToRgba(src: Uint8Array, srcWidth: number, rect: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      const i = ((rect.y + y) * srcWidth + rect.x + x) * 4;
      const o = (y * rect.width + x) * 4;
      out[o] = src[i + 2]!;
      out[o + 1] = src[i + 1]!;
      out[o + 2] = src[i]!;
      out[o + 3] = 255;
    }
  }
  return out;
}

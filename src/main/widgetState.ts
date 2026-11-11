// Remembers where the desktop widget sits (v2.0), in its own file widget-state.json (like window-state.json).
// Pure apart from the file read/write; main.ts passes the screens.

import { loadWindowState, saveWindowState } from './windowState';
import type { Rect } from './wallpaperMath';

/** Gap from the work area's edges for the default spot (top right of the primary display). */
export const WIDGET_MARGIN = 16;
/** Least part of the widget that must be on a screen to keep the saved position (so it can still be grabbed). */
const GRAB = 40;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Where the widget goes: the saved spot if at least 40x40 px of it is on a screen now, else the top right of the
 * primary display's work area (a monitor was unplugged, the resolution changed, or nothing was saved).
 */
export function widgetPosition(saved: unknown, workAreas: Rect[], primary: Rect, size: { width: number; height: number }): { x: number; y: number } {
  const s = (typeof saved === 'object' && saved !== null ? saved : {}) as Record<string, unknown>;
  if (finite(s.x) && finite(s.y)) {
    const r = { x: Math.round(s.x), y: Math.round(s.y), ...size };
    const visible = workAreas.some((a) => {
      const w = Math.min(r.x + r.width, a.x + a.width) - Math.max(r.x, a.x);
      const h = Math.min(r.y + r.height, a.y + a.height) - Math.max(r.y, a.y);
      return w >= Math.min(GRAB, size.width) && h >= Math.min(GRAB, size.height);
    });
    if (visible) return { x: r.x, y: r.y };
  }
  return { x: primary.x + primary.width - size.width - WIDGET_MARGIN, y: primary.y + WIDGET_MARGIN };
}

export const loadWidgetState = loadWindowState;

/** Atomic and never throws, like saveWindowState. */
export function saveWidgetState(file: string, pos: { x: number; y: number }): void {
  saveWindowState(file, pos as never);
}

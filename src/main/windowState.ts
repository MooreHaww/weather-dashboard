// Remembers the window's size and position between launches, in its own small file
// (window-state.json next to weather-dashboard.json, which stays exactly as before).
// Kept free of Electron imports so it can be unit-tested; main.ts passes the screens.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

export const DEFAULT_SIZE = { width: 1360, height: 900 };
export const MIN_SIZE = { width: 480, height: 400 }; // same as the BrowserWindow minimums
const TITLEBAR = 52; // the draggable strip at the top of the window
/** Least part of the title bar that must be on a screen to keep the saved position (so it can be dragged). */
const GRAB = { width: 100, height: 30 };

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

/**
 * Turn whatever was saved into safe window bounds for the screens there are now.
 * The size is kept within the minimum and the largest screen. The position is only
 * kept if enough of the title bar is on some screen; otherwise x/y are left out and
 * Electron centres the window (e.g. it was on a monitor that has been unplugged).
 */
export function restoreBounds(saved: unknown, workAreas: Rect[]): WindowState {
  const s = (typeof saved === 'object' && saved !== null ? saved : {}) as Record<string, unknown>;
  if (!finite(s.width) || !finite(s.height)) return { ...DEFAULT_SIZE, maximized: false };

  const maxW = Math.max(MIN_SIZE.width, ...workAreas.map((a) => a.width));
  const maxH = Math.max(MIN_SIZE.height, ...workAreas.map((a) => a.height));
  const width = Math.round(Math.min(Math.max(s.width, MIN_SIZE.width), maxW));
  const height = Math.round(Math.min(Math.max(s.height, MIN_SIZE.height), maxH));
  const maximized = s.maximized === true;

  if (finite(s.x) && finite(s.y)) {
    const x = Math.round(s.x);
    const y = Math.round(s.y);
    const titlebar = { x, y, width, height: TITLEBAR };
    const visible = workAreas.some((a) => {
      const o = overlap(titlebar, a);
      return o.width >= GRAB.width && o.height >= GRAB.height;
    });
    if (visible) return { x, y, width, height, maximized };
  }
  return { width, height, maximized };
}

/** The saved state, or undefined if there is none or it can't be read. */
export function loadWindowState(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Save atomically (temp file, then rename). Never throws: losing the window size is not worth an error. */
export function saveWindowState(file: string, state: WindowState): void {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(tmp, JSON.stringify(state), 'utf8');
    renameSync(tmp, file);
  } catch {
    // ignore
  }
}

// What the Settings "Updates" section knows about auto-update. The main process keeps
// the state (src/main/updateTracker.ts) and sends it to the page, which only displays it.

import { formatTime } from './time';
import type { TimeFormat } from './types';

export type UpdateStatus =
  | 'unavailable' // dev or unpackaged build: the updater does not run
  | 'idle' // packaged, but no check has finished yet
  | 'checking' // "Check for updates" was pressed and the check is running
  | 'up-to-date' // the last check succeeded and found nothing newer
  | 'downloading'
  | 'ready' // downloaded, installs on quit or with "Update now"
  | 'failed'; // the last check (or the download) failed: offline, GitHub down, bad file

export interface UpdateState {
  status: UpdateStatus;
  /** The installed app's version. */
  version: string;
  /** The newer version being downloaded or ready (those two states only). */
  next?: string;
  /** When the last successful check finished, in ms since 1970 (`up-to-date` only). */
  checkedAt?: number;
}

const STATUSES: readonly string[] = ['unavailable', 'idle', 'checking', 'up-to-date', 'downloading', 'ready', 'failed'];

/** The page does not trust what arrives: anything that is not a well-formed state is dropped. */
export function parseUpdateState(value: unknown): UpdateState | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.status !== 'string' || !STATUSES.includes(v.status)) return null;
  if (typeof v.version !== 'string' || v.version === '' || v.version.length > 64) return null;
  const status = v.status as UpdateStatus;
  const state: UpdateState = { status, version: v.version };
  if (status === 'downloading' || status === 'ready') {
    if (typeof v.next !== 'string' || v.next === '' || v.next.length > 64) return null;
    state.next = v.next;
  }
  if (status === 'up-to-date' && typeof v.checkedAt === 'number' && Number.isFinite(v.checkedAt)) state.checkedAt = v.checkedAt;
  return state;
}

export function sameUpdateState(a: UpdateState | null, b: UpdateState | null): boolean {
  return a?.status === b?.status && a?.version === b?.version && a?.next === b?.next && a?.checkedAt === b?.checkedAt;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "checked 10:42" in the user's time format. It is the user's own PC clock (when the check ran), not a city's. */
export function checkedText(checkedAt: number, format: TimeFormat): string {
  const d = new Date(checkedAt);
  const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `checked ${formatTime(local, format, { minutes: true })}`;
}

export interface UpdateText {
  /** The row's main line. */
  label: string;
  /** A smaller neutral line under it, or null. */
  detail: string | null;
  /** Whether the "Update now" button belongs in the row. */
  ready: boolean;
  /** The "Check for updates" button: not shown, shown, or shown as "Checking…" (disabled) while a check runs. */
  check: 'none' | 'idle' | 'checking';
}

/** The words for each state. Without a state (plain browser, nothing sent yet) only the version shows. */
export function describeUpdate(state: UpdateState | null, installed: string, format: TimeFormat = '12h'): UpdateText {
  if (!state) return { label: `Version ${installed}`, detail: null, ready: false, check: 'none' };
  const version = state.version;
  switch (state.status) {
    case 'up-to-date': {
      const base = `Version ${version} · Up to date`;
      return { label: state.checkedAt === undefined ? base : `${base} · ${checkedText(state.checkedAt, format)}`, detail: null, ready: false, check: 'idle' };
    }
    case 'downloading':
      return { label: `Version ${state.next} is downloading…`, detail: `Installed version ${version}`, ready: false, check: 'none' };
    case 'ready':
      return { label: `Version ${state.next} is ready`, detail: `Installed version ${version}`, ready: true, check: 'none' };
    case 'failed':
      return { label: `Version ${version}`, detail: "Couldn't check for updates", ready: false, check: 'idle' };
    case 'checking':
      return { label: `Version ${version}`, detail: null, ready: false, check: 'checking' };
    case 'idle':
      return { label: `Version ${version}`, detail: null, ready: false, check: 'idle' };
    default:
      return { label: `Version ${version}`, detail: null, ready: false, check: 'none' };
  }
}

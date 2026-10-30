// What the Settings "Updates" section shows, kept free of Electron imports so it can be
// unit-tested. autoUpdate.ts feeds it the updater's events; main.ts sends each change to
// the page. The one rule: "up to date" only follows a check that really succeeded.

import type { UpdateState } from '../shared/updateState';

export interface UpdateTrackerOptions {
  /** The installed app's version (`app.getVersion()`). */
  version: string;
  /** False in dev and in an unpackaged build: the updater never runs. */
  enabled: boolean;
  now?: () => number;
  onChange?: (state: UpdateState) => void;
}

export interface UpdateTracker {
  state(): UpdateState;
  /** A check succeeded and found a newer version, now downloading. */
  available(version: string): void;
  /** A check succeeded and found nothing newer. */
  notAvailable(): void;
  /** The download finished. */
  downloaded(version: string): void;
  /** A check or a download failed. */
  failed(): void;
  /**
   * "Check for updates" was pressed: show "Checking…". Returns false (and changes nothing) when a
   * check makes no sense: no updater, an update is downloading or ready, or one is already running.
   */
  checking(): boolean;
  /** The check returned. If no event moved the state on (still "checking"), go back to what it was. */
  settle(): void;
}

export function createUpdateTracker(opts: UpdateTrackerOptions): UpdateTracker {
  const now = opts.now ?? Date.now;
  let state: UpdateState = { status: opts.enabled ? 'idle' : 'unavailable', version: opts.version };
  let before: UpdateState = state; // what "checking" replaced

  const set = (next: UpdateState) => {
    state = next;
    opts.onChange?.(state);
  };
  // A downloaded version stays "ready" (it installs on quit) whatever a later check says;
  // only a newer download replaces it.
  const isReady = () => state.status === 'ready';

  return {
    state: () => state,
    available(version) {
      if (!opts.enabled || isReady()) return;
      set({ status: 'downloading', version: opts.version, next: version });
    },
    notAvailable() {
      if (!opts.enabled || isReady()) return;
      set({ status: 'up-to-date', version: opts.version, checkedAt: now() });
    },
    downloaded(version) {
      if (!opts.enabled) return;
      set({ status: 'ready', version: opts.version, next: version });
    },
    failed() {
      if (!opts.enabled || isReady() || state.status === 'failed') return;
      set({ status: 'failed', version: opts.version });
    },
    checking() {
      if (!opts.enabled || !['idle', 'up-to-date', 'failed'].includes(state.status)) return false;
      before = state;
      set({ status: 'checking', version: opts.version });
      return true;
    },
    settle() {
      if (state.status === 'checking') set(before);
    },
  };
}

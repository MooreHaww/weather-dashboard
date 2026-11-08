// Which look the page shows (v1.7). The user chooses Classic or Glass in Settings; glass is shown only where the
// system can show it: the main process's decision (Windows 11 22H2+, "Transparency effects" on, no high contrast,
// no reduced transparency; src/main/appearance.ts) and, in the page itself, no forced colours and no reduced
// transparency. Anything else shows classic.

import type { Appearance } from './types';

export interface LookSystem {
  /** The main process decided glass is possible (window.appearance says 'glass'). */
  systemGlass: boolean;
  /** `(forced-colors: active)` matches. */
  forcedColors: boolean;
  /** `(prefers-reduced-transparency: reduce)` matches. */
  reducedTransparency: boolean;
}

/** Whether this PC can show glass right now. */
export function glassSupported(s: LookSystem): boolean {
  return s.systemGlass && !s.forcedColors && !s.reducedTransparency;
}

/** The look the page shows: glass only when the user chose it AND the system supports it. */
export function pageLook(choice: Appearance | null | undefined, s: LookSystem): Appearance {
  return choice === 'glass' && glassSupported(s) ? 'glass' : 'classic';
}

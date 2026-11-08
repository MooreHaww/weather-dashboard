// The look on screen, shown as `<html data-material="glass|solid">` (styles.css draws glass only under
// html[data-material='glass']). Since 1.7 it follows two things (src/shared/look.ts, pageLook):
// - the user's choice in Settings > Look (Classic or Glass), set with `setChoice`;
// - whether the system can show glass: the main process's decision (src/main/appearance.ts), received through the
//   preload's receive-only `window.appearance`, and, in the page, forced colours and reduced transparency.
// Until the settings arrive the page shows classic. Nothing is sent to the main process: in classic the opaque page
// simply covers the window's material. Without `window.appearance` (a plain browser) glass is not supported.

import { glassSupported, pageLook, type LookSystem } from '../shared/look';
import type { Appearance } from '../shared/types';

export type AppearanceMode = 'glass' | 'solid';

declare global {
  interface Window {
    appearance?: {
      current(): AppearanceMode | null;
      onChange(callback: (mode: AppearanceMode) => void): void;
    };
  }
}

export interface LookController {
  /** The user's choice (from the settings, or Settings > Look). */
  setChoice(choice: Appearance): void;
  /** Whether this PC can show glass right now. */
  supported(): boolean;
  /** Called when support changes (the main process re-decided, or a media query changed). */
  onSupportChange(fn: () => void): void;
}

export function setupAppearance(root: HTMLElement = document.documentElement): LookController {
  let systemGlass = window.appearance?.current() === 'glass';
  let choice: Appearance | null = null;
  const listeners = new Set<() => void>();
  const media = (q: string) => (typeof window.matchMedia === 'function' ? window.matchMedia(q) : null);
  const forced = media('(forced-colors: active)');
  const reduced = media('(prefers-reduced-transparency: reduce)');
  const system = (): LookSystem => ({ systemGlass, forcedColors: !!forced?.matches, reducedTransparency: !!reduced?.matches });

  const show = () => {
    root.dataset.material = pageLook(choice, system()) === 'glass' ? 'glass' : 'solid';
  };
  const changed = () => {
    show();
    listeners.forEach((fn) => fn());
  };
  show();
  window.appearance?.onChange((mode) => {
    systemGlass = mode === 'glass';
    changed();
  });
  forced?.addEventListener?.('change', changed);
  reduced?.addEventListener?.('change', changed);

  return {
    setChoice(next) {
      choice = next;
      show();
    },
    supported: () => glassSupported(system()),
    onSupportChange: (fn) => void listeners.add(fn),
  };
}

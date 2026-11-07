// Glass or solid (v1.6), as the main process decided it (src/main/appearance.ts), shown as
// `<html data-material="glass|solid">`. The page only displays it: the preload's
// `window.appearance` is receive-only. Without it (a plain browser) the page stays solid.
// styles.css draws glass only under html[data-material='glass'], and falls back to solid under
// forced colours or reduced transparency even then.

export type AppearanceMode = 'glass' | 'solid';

declare global {
  interface Window {
    appearance?: {
      current(): AppearanceMode | null;
      onChange(callback: (mode: AppearanceMode) => void): void;
    };
  }
}

export function setupAppearance(root: HTMLElement = document.documentElement): void {
  const show = (mode: unknown) => {
    root.dataset.material = mode === 'glass' ? 'glass' : 'solid';
  };
  show(window.appearance?.current() ?? 'solid');
  window.appearance?.onChange(show);
}

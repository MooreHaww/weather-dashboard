// "Version X is ready" note. The main process downloads updates in the background
// (src/main/autoUpdate.ts) and tells the page through the preload's `window.updates`.
// Missing in dev:server (plain browser), where nothing happens.

import { $, esc } from '../dom';
import { glyphs } from '../icons';

declare global {
  interface Window {
    updates?: { onReady(callback: (version: string) => void): void };
  }
}

export function updateMessage(version: string): string {
  return `Version ${version} is ready. It installs when you close the app.`;
}

export function setupUpdateNote(): void {
  const note = $('#update-note');
  let shown: string | null = null;
  window.updates?.onReady((version) => {
    if (version === shown) return; // once per version, even after dismissing
    shown = version;
    note.innerHTML =
      `<span class="update-note-text">${esc(updateMessage(version))}</span>` +
      `<button type="button" class="icon-button update-note-close" aria-label="Dismiss" title="Dismiss">${glyphs.close}</button>`;
    note.querySelector('.update-note-close')!.addEventListener('click', () => (note.hidden = true));
    note.hidden = false;
  });
}

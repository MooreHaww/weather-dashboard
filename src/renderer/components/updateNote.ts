// Update signals. The main process checks for updates and downloads them in the
// background (src/main/autoUpdate.ts) and tells the page through the preload's `window.updates`.
// - The Settings "Updates" section, always there: the installed version and the state
//   (up to date, downloading, ready, or just the version). It only displays what the main
//   process sends (`onState`); the page cannot set it.
// When a version is ready:
// - a red dot on the gear (its label becomes "Settings, update ready");
// - the corner note, once per version (dismissing it leaves the dot);
// - an "Update now" button in the Updates section. It asks to confirm, then sends the
//   page's only message to the main process, which restarts into the new version
//   (src/main/updateRestart.ts). Without it, the update still installs on close.
// Missing in dev:server (plain browser): the section shows only the version, nothing else happens.

import { $, esc } from '../dom';
import { glyphs } from '../icons';
import { describeUpdate, parseUpdateState, sameUpdateState, type UpdateState } from '../../shared/updateState';
import type { TimeFormat } from '../../shared/types';
import { onSettingsSync, settingsRow, settingsSection } from './settings';

declare global {
  interface Window {
    updates?: { onReady(callback: (version: string) => void): void; onState(callback: (state: unknown) => void): void; restart(): void };
  }
}

/** The app version from package.json, set at build time (vite.config.mts `define`): shown until the main process sends the state. */
declare const __APP_VERSION__: string;

export const GEAR_LABEL = 'Settings';
export const GEAR_LABEL_READY = 'Settings, update ready';
export const UPDATE_NOTE_DETAIL = 'Update now in Settings';

export function updateMessage(version: string): string {
  return `New update available: version ${version}`;
}

export function setupUpdateReady(opts: { timeFormat?: () => TimeFormat } = {}): void {
  const note = $('#update-note');
  const gear = $('#settings-button');
  const sections = $('#settings-sections');
  const timeFormat = opts.timeFormat ?? (() => '12h');
  let shown: string | null = null;

  // The Updates section, first in the panel.
  let body!: HTMLElement;
  const section = settingsSection({
    id: 'updates',
    title: 'Updates',
    render(b) {
      body = b;
    },
  });
  sections.prepend(section);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button button-primary';
  button.id = 'update-now';
  button.textContent = 'Update now';
  button.addEventListener('click', () => confirmRestart(button));

  let state: UpdateState | null = null;
  let painted = '';
  function paint(): void {
    const text = describeUpdate(state, __APP_VERSION__, timeFormat());
    const key = JSON.stringify(text);
    if (key === painted) return; // the minute tick must not rebuild the row (the button may have focus)
    painted = key;
    const row = settingsRow({ label: text.label, description: text.detail ?? undefined, control: text.ready ? button : undefined });
    if (text.ready) {
      // A <label for> would rename the button to the label's text. Keep "Update now" as its
      // name and the version as its description (and clicking the text does nothing).
      const label = row.querySelector('label')!;
      label.removeAttribute('for');
      label.id = 'update-ready-label';
      const desc = row.querySelector('.settings-row-description');
      button.setAttribute('aria-describedby', desc ? `${label.id} ${desc.id}` : label.id);
    }
    body.replaceChildren(row);
  }
  paint();
  onSettingsSync(paint); // "checked 10:42" follows the 12/24-hour setting

  window.updates?.onState((raw) => {
    const next = parseUpdateState(raw);
    if (!next || sameUpdateState(state, next)) return;
    state = next;
    paint();
  });

  window.updates?.onReady((version) => {
    if (version === shown) return; // once per version, even after dismissing
    shown = version;

    // The dot stays until the app restarts; the note can be dismissed.
    if (!gear.querySelector('.update-dot')) gear.insertAdjacentHTML('beforeend', '<span class="update-dot" aria-hidden="true"></span>');
    gear.setAttribute('aria-label', GEAR_LABEL_READY);
    gear.title = GEAR_LABEL_READY;

    note.innerHTML =
      `<span class="update-note-text"><span class="update-note-title">${esc(updateMessage(version))}</span>` +
      `<span class="update-note-detail">${esc(UPDATE_NOTE_DETAIL)}</span></span>` +
      `<button type="button" class="icon-button update-note-close" aria-label="Dismiss" title="Dismiss">${glyphs.close}</button>`;
    note.querySelector('.update-note-close')!.addEventListener('click', () => (note.hidden = true));
    note.hidden = false;
  });
}

/**
 * "Restart now?" in the Settings panel's glass style. Later and Escape close it and change
 * nothing. Focus starts on Later, stays inside while it is open, and returns to `trigger`.
 */
export function confirmRestart(trigger: HTMLElement): void {
  const sheet = $('#settings-sheet');
  if (document.getElementById('update-confirm')) return;
  const behind = [...sheet.children].filter((el): el is HTMLElement => el instanceof HTMLElement);

  const layer = document.createElement('div');
  layer.className = 'confirm';
  layer.id = 'update-confirm';
  layer.tabIndex = -1; // a click on its text keeps focus inside, not on the page
  layer.innerHTML =
    '<div class="confirm-box" role="alertdialog" aria-modal="true" aria-labelledby="update-confirm-title" aria-describedby="update-confirm-text">' +
    '<h3 class="confirm-title" id="update-confirm-title">Restart now?</h3>' +
    '<p class="confirm-text" id="update-confirm-text">The app will close, update and reopen.</p>' +
    '<div class="confirm-actions">' +
    '<button type="button" class="button button-primary" data-action="restart">Restart</button>' +
    '<button type="button" class="button" data-action="later">Later</button>' +
    '</div></div>';
  const restart = $<HTMLButtonElement>('[data-action="restart"]', layer);
  const later = $<HTMLButtonElement>('[data-action="later"]', layer);

  const close = () => {
    layer.remove();
    behind.forEach((el) => (el.inert = false));
    trigger.focus();
  };
  later.addEventListener('click', close);
  restart.addEventListener('click', () => {
    close();
    window.updates?.restart();
  });
  layer.addEventListener('keydown', (e) => {
    // Handled here, so the Settings panel neither closes (Escape) nor moves focus (Tab).
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      (document.activeElement === restart ? later : restart).focus();
    }
  });

  behind.forEach((el) => (el.inert = true));
  sheet.append(layer);
  later.focus();
}

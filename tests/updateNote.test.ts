// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GEAR_LABEL_READY, setupUpdateReady, UPDATE_NOTE_DETAIL, updateMessage } from '../src/renderer/components/updateNote';
import { syncSettingsControls } from '../src/renderer/components/settings';
import type { TimeFormat } from '../src/shared/types';
import type { UpdateState } from '../src/shared/updateState';

const { version: INSTALLED } = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string };

let fire: (version: string) => void;
let fireState: (state: unknown) => void;
let restart: ReturnType<typeof vi.fn<() => void>>;
let format: TimeFormat;

beforeEach(() => {
  document.body.innerHTML =
    '<button id="settings-button" aria-label="Settings" title="Settings"><svg class="glyph"></svg></button>' +
    '<div id="update-note" role="status" hidden></div>' +
    '<div id="settings"><section id="settings-sheet"><header class="settings-header"><button class="settings-close"></button></header>' +
    '<div id="settings-sections"><section id="settings-units"></section></div></section></div>';
  restart = vi.fn<() => void>();
  format = '12h';
  window.updates = { onReady: (cb) => (fire = cb), onState: (cb) => (fireState = cb), restart };
  setupUpdateReady({ timeFormat: () => format });
});

const note = () => document.getElementById('update-note')!;
const gear = () => document.getElementById('settings-button')!;
const sections = () => document.getElementById('settings-sections')!;
const updatesSection = () => document.getElementById('settings-updates')!;
const label = () => updatesSection().querySelector('.settings-row-label')!.textContent;
const detail = () => updatesSection().querySelector('.settings-row-description')?.textContent ?? null;
const dots = () => gear().querySelectorAll('.update-dot');
const confirmLayer = () => document.getElementById('update-confirm');
const key = (k: string, shift = false) =>
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true }));
const state = (s: Partial<UpdateState> & Pick<UpdateState, 'status'>) => fireState({ version: INSTALLED, ...s });
/** What the main process does when a download finishes: the state, then the "ready" message. */
const ready = (version: string) => {
  state({ status: 'ready', next: version });
  fire(version);
};

describe('the Updates section', () => {
  it('is always there, first in Settings, titled "Updates"', () => {
    expect(sections().firstElementChild).toBe(updatesSection());
    expect(updatesSection().querySelector('h3')!.textContent).toBe('Updates');
    expect(document.getElementById('settings-version')).toBeNull(); // the old bottom line is gone
  });

  it('before the main process says anything: just the installed version, no button, no extra line', () => {
    expect(label()).toBe(`Version ${INSTALLED}`);
    expect(detail()).toBeNull();
    expect(document.getElementById('update-now')).toBeNull();
  });

  it('no check finished yet (idle) and dev builds (unavailable): just the version', () => {
    for (const status of ['idle', 'unavailable'] as const) {
      state({ status, version: '1.4.7' });
      expect(label()).toBe('Version 1.4.7');
      expect(detail()).toBeNull();
    }
  });

  it('up to date: "Version 1.4.7 · Up to date · checked 10:42 AM", and it follows the 12/24-hour setting', () => {
    state({ status: 'up-to-date', version: '1.4.7', checkedAt: new Date(2026, 9, 25, 10, 42).getTime() });
    expect(label()).toBe('Version 1.4.7 · Up to date · checked 10:42 AM');
    format = '24h';
    syncSettingsControls();
    expect(label()).toBe('Version 1.4.7 · Up to date · checked 10:42');
    expect(document.getElementById('update-now')).toBeNull();
  });

  it('downloading: "Version 1.4.8 is downloading…" and the installed version, no button', () => {
    state({ status: 'downloading', version: '1.4.7', next: '1.4.8' });
    expect(label()).toBe('Version 1.4.8 is downloading…');
    expect(detail()).toBe('Installed version 1.4.7');
    expect(document.getElementById('update-now')).toBeNull();
    expect(dots()).toHaveLength(0); // the dot is for "ready" only
    expect(note().hidden).toBe(true);
  });

  it('a failed check: the version and "Couldn\'t check for updates"', () => {
    state({ status: 'failed', version: '1.4.7' });
    expect(label()).toBe('Version 1.4.7');
    expect(detail()).toBe("Couldn't check for updates");
    expect(document.getElementById('update-now')).toBeNull();
  });

  it('goes up to date -> downloading -> ready, and replaces its row each time (never two)', () => {
    state({ status: 'up-to-date', version: '1.4.7', checkedAt: 1 });
    state({ status: 'downloading', version: '1.4.7', next: '1.4.8' });
    ready('1.4.8');
    expect(updatesSection().querySelectorAll('.settings-row')).toHaveLength(1);
    expect(document.querySelectorAll('#settings-updates')).toHaveLength(1);
    expect(label()).toBe('Version 1.4.8 is ready');
  });

  it('ignores states that are not well formed, and the minute tick does not rebuild an unchanged row', () => {
    state({ status: 'failed', version: '1.4.7' });
    const row = updatesSection().querySelector('.settings-row');
    fireState({ status: 'ready', version: '1.4.7' }); // no new version
    fireState({ status: 'what', version: '1.4.7' });
    fireState('ready');
    state({ status: 'failed', version: '1.4.7' }); // same again
    syncSettingsControls();
    expect(updatesSection().querySelector('.settings-row')).toBe(row);
    expect(detail()).toBe("Couldn't check for updates");
  });

  it('shows version text as text, never as HTML', () => {
    state({ status: 'ready', version: '<i>1</i>', next: '<b>9</b>' });
    expect(updatesSection().querySelector('b, i')).toBeNull();
    expect(label()).toBe('Version <b>9</b> is ready');
  });
});

describe('when an update is ready', () => {
  it('there is no dot and no note until then', () => {
    expect(note().hidden).toBe(true);
    expect(dots()).toHaveLength(0);
    expect(gear().getAttribute('aria-label')).toBe('Settings');
  });

  it('puts a red dot on the gear and names it "Settings, update ready"', () => {
    ready('1.4.7');
    expect(dots()).toHaveLength(1);
    expect(dots()[0]!.getAttribute('aria-hidden')).toBe('true');
    expect(gear().getAttribute('aria-label')).toBe('Settings, update ready');
    expect(GEAR_LABEL_READY).toBe('Settings, update ready');
    expect(gear().querySelector('svg')).not.toBeNull(); // the icon stays
  });

  it('shows the note: "New update available" with the version, then a smaller "Update now in Settings"', () => {
    ready('1.4.7');
    expect(note().hidden).toBe(false);
    expect(note().querySelector('.update-note-title')!.textContent).toBe('New update available: version 1.4.7');
    expect(note().querySelector('.update-note-detail')!.textContent).toBe('Update now in Settings');
    expect(updateMessage('1.4.7')).toBe('New update available: version 1.4.7');
    expect(UPDATE_NOTE_DETAIL).toBe('Update now in Settings');
  });

  it('the Updates section gets "Version X is ready" with an "Update now" button', () => {
    ready('1.4.7');
    expect(label()).toBe('Version 1.4.7 is ready');
    const button = updatesSection().querySelector<HTMLButtonElement>('#update-now')!;
    expect(button.textContent).toBe('Update now');
    expect(button.type).toBe('button');
    // Named by its own text, described by the version line and the installed version (a <label for> would rename it).
    expect(updatesSection().querySelector('label')!.htmlFor).toBe('');
    const described = button
      .getAttribute('aria-describedby')!
      .split(' ')
      .map((id) => document.getElementById(id)!.textContent);
    expect(described).toEqual(['Version 1.4.7 is ready', `Installed version ${INSTALLED}`]);
  });

  it('dismissing the note leaves the dot and the button', () => {
    ready('1.4.7');
    note().querySelector<HTMLButtonElement>('.update-note-close')!.click();
    expect(note().hidden).toBe(true);
    expect(dots()).toHaveLength(1);
    expect(document.getElementById('update-now')).not.toBeNull();
  });

  it('shows the note once per version; a newer version replaces the row, never adds a second', () => {
    ready('1.4.7');
    note().querySelector<HTMLButtonElement>('.update-note-close')!.click();
    ready('1.4.7');
    expect(note().hidden).toBe(true);
    ready('1.4.8');
    expect(note().hidden).toBe(false);
    expect(note().textContent).toContain('1.4.8');
    expect(document.querySelectorAll('#settings-updates')).toHaveLength(1);
    expect(document.querySelectorAll('#update-now')).toHaveLength(1);
    expect(label()).toBe('Version 1.4.8 is ready');
    expect(dots()).toHaveLength(1);
  });

  it('escapes the version text in the note', () => {
    fire('<b>9</b>');
    expect(note().querySelector('b')).toBeNull();
  });

  it('the dot and note message alone do not make the button appear: it follows the state it is sent', () => {
    fire('1.4.7');
    expect(document.getElementById('update-now')).toBeNull();
    expect(label()).toBe(`Version ${INSTALLED}`);
  });
});

describe('Update now asks to confirm first', () => {
  const open = () => {
    ready('1.4.7');
    const button = document.getElementById('update-now') as HTMLButtonElement;
    button.focus();
    button.click();
    return button;
  };
  const action = (name: string) => confirmLayer()!.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)!;

  it('opens "Restart now?" inside the Settings panel, with focus on Later and the rest of the panel inert', () => {
    open();
    const layer = confirmLayer()!;
    expect(document.getElementById('settings-sheet')!.contains(layer)).toBe(true);
    const box = layer.querySelector('[role="alertdialog"]')!;
    expect(box.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(box.getAttribute('aria-labelledby')!)!.textContent).toBe('Restart now?');
    expect(document.getElementById(box.getAttribute('aria-describedby')!)!.textContent).toBe('The app will close, update and reopen.');
    expect([...layer.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Restart', 'Later']);
    expect(document.activeElement).toBe(action('later'));
    expect(document.querySelector<HTMLElement>('.settings-header')!.inert).toBe(true);
    expect(sections().inert).toBe(true);
    expect(restart).not.toHaveBeenCalled();
  });

  it('keeps focus inside with Tab and Shift+Tab', () => {
    open();
    key('Tab');
    expect(document.activeElement).toBe(action('restart'));
    key('Tab');
    expect(document.activeElement).toBe(action('later'));
    key('Tab', true);
    expect(document.activeElement).toBe(action('restart'));
  });

  it('Later closes it, changes nothing and returns focus to Update now', () => {
    const button = open();
    action('later').click();
    expect(confirmLayer()).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(sections().inert).toBe(false);
    expect(restart).not.toHaveBeenCalled();
    expect(document.getElementById('update-now')).toBe(button);
  });

  it('Escape closes only the confirmation (not the Settings panel) and returns focus', () => {
    const button = open();
    const panelKeys = vi.fn();
    document.getElementById('settings-sheet')!.addEventListener('keydown', panelKeys);
    key('Escape');
    expect(confirmLayer()).toBeNull();
    expect(panelKeys).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
    expect(restart).not.toHaveBeenCalled();
  });

  it('Restart sends the one message, with no arguments', () => {
    open();
    action('restart').click();
    expect(restart).toHaveBeenCalledTimes(1);
    expect(restart).toHaveBeenCalledWith();
    expect(confirmLayer()).toBeNull();
  });

  it('opens only one confirmation at a time', () => {
    const button = open();
    button.click();
    expect(document.querySelectorAll('#update-confirm')).toHaveLength(1);
  });

  it('the same state sent again while the confirmation is open changes nothing', () => {
    const button = open();
    state({ status: 'ready', next: '1.4.7' });
    syncSettingsControls();
    expect(document.getElementById('update-now')).toBe(button);
    expect(confirmLayer()).not.toBeNull();
    action('later').click();
    expect(document.activeElement).toBe(button);
  });
});

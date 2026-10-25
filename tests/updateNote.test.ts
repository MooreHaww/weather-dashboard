// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GEAR_LABEL_READY,
  readyLabel,
  setupUpdateReady,
  UPDATE_NOTE_DETAIL,
  updateMessage,
} from '../src/renderer/components/updateNote';

let fire: (version: string) => void;
let restart: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  document.body.innerHTML =
    '<button id="settings-button" aria-label="Settings" title="Settings"><svg class="glyph"></svg></button>' +
    '<div id="update-note" role="status" hidden></div>' +
    '<div id="settings"><section id="settings-sheet"><header class="settings-header"><button class="settings-close"></button></header>' +
    '<div id="settings-sections"><section id="settings-units"></section><p id="settings-version">Version 1.4.6</p></div></section></div>';
  restart = vi.fn<() => void>();
  window.updates = { onReady: (cb) => (fire = cb), restart };
  setupUpdateReady();
});

const note = () => document.getElementById('update-note')!;
const gear = () => document.getElementById('settings-button')!;
const sections = () => document.getElementById('settings-sections')!;
const updateSection = () => document.getElementById('settings-update');
const dots = () => gear().querySelectorAll('.update-dot');
const confirmLayer = () => document.getElementById('update-confirm');
const key = (k: string, shift = false) =>
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true }));

describe('before an update is ready', () => {
  it('shows no note, no dot and no Settings row', () => {
    expect(note().hidden).toBe(true);
    expect(dots()).toHaveLength(0);
    expect(gear().getAttribute('aria-label')).toBe('Settings');
    expect(updateSection()).toBeNull();
    expect(sections().firstElementChild!.id).toBe('settings-units');
  });
});

describe('when an update is ready', () => {
  it('puts a red dot on the gear and names it "Settings, update ready"', () => {
    fire('1.4.7');
    expect(dots()).toHaveLength(1);
    expect(dots()[0]!.getAttribute('aria-hidden')).toBe('true');
    expect(gear().getAttribute('aria-label')).toBe('Settings, update ready');
    expect(GEAR_LABEL_READY).toBe('Settings, update ready');
    expect(gear().querySelector('svg')).not.toBeNull(); // the icon stays
  });

  it('shows the note: "New update available" with the version, then a smaller "Update now in Settings"', () => {
    fire('1.4.7');
    expect(note().hidden).toBe(false);
    expect(note().querySelector('.update-note-title')!.textContent).toBe('New update available: version 1.4.7');
    expect(note().querySelector('.update-note-detail')!.textContent).toBe('Update now in Settings');
    expect(updateMessage('1.4.7')).toBe('New update available: version 1.4.7');
    expect(UPDATE_NOTE_DETAIL).toBe('Update now in Settings');
  });

  it('adds "Version X is ready" with an "Update now" button at the top of Settings; the version line stays last', () => {
    fire('1.4.7');
    const section = updateSection()!;
    expect(sections().firstElementChild).toBe(section);
    expect(sections().lastElementChild!.id).toBe('settings-version');
    expect(section.querySelector('h3')!.textContent).toBe('Update');
    expect(section.querySelector('.settings-row-label')!.textContent).toBe(readyLabel('1.4.7'));
    expect(readyLabel('1.4.7')).toBe('Version 1.4.7 is ready');
    const button = section.querySelector<HTMLButtonElement>('#update-now')!;
    expect(button.textContent).toBe('Update now');
    expect(button.type).toBe('button');
    // Named by its own text, described by the version line (a <label for> would rename it).
    expect(section.querySelector('label')!.htmlFor).toBe('');
    expect(document.getElementById(button.getAttribute('aria-describedby')!)!.textContent).toBe('Version 1.4.7 is ready');
  });

  it('dismissing the note leaves the dot and the Settings row', () => {
    fire('1.4.7');
    note().querySelector<HTMLButtonElement>('.update-note-close')!.click();
    expect(note().hidden).toBe(true);
    expect(dots()).toHaveLength(1);
    expect(updateSection()).not.toBeNull();
  });

  it('shows the note once per version; a newer version replaces the row, never adds a second', () => {
    fire('1.4.7');
    note().querySelector<HTMLButtonElement>('.update-note-close')!.click();
    fire('1.4.7');
    expect(note().hidden).toBe(true);
    fire('1.4.8');
    expect(note().hidden).toBe(false);
    expect(note().textContent).toContain('1.4.8');
    expect(document.querySelectorAll('#settings-update')).toHaveLength(1);
    expect(updateSection()!.querySelector('.settings-row-label')!.textContent).toBe('Version 1.4.8 is ready');
    expect(dots()).toHaveLength(1);
  });

  it('escapes the version text', () => {
    fire('<b>9</b>');
    expect(note().querySelector('b')).toBeNull();
    expect(updateSection()!.querySelector('b')).toBeNull();
  });
});

describe('Update now asks to confirm first', () => {
  const open = () => {
    fire('1.4.7');
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
    expect(updateSection()).not.toBeNull();
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
});

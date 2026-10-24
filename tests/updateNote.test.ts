// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { setupUpdateNote, updateMessage } from '../src/renderer/components/updateNote';

let fire: (version: string) => void;

beforeEach(() => {
  document.body.innerHTML = '<div id="update-note" role="status" hidden></div>';
  window.updates = { onReady: (cb) => (fire = cb) };
  setupUpdateNote();
});

const note = () => document.getElementById('update-note')!;

describe('update note', () => {
  it('stays hidden until an update is ready', () => {
    expect(note().hidden).toBe(true);
  });

  it('shows the version and that it installs on close', () => {
    fire('1.4.1');
    expect(note().hidden).toBe(false);
    expect(note().textContent).toBe(updateMessage('1.4.1'));
    expect(updateMessage('1.4.1')).toBe('Version 1.4.1 is ready. It installs when you close the app.');
  });

  it('can be dismissed and does not come back for the same version', () => {
    fire('1.4.1');
    (note().querySelector('.update-note-close') as HTMLButtonElement).click();
    expect(note().hidden).toBe(true);
    fire('1.4.1');
    expect(note().hidden).toBe(true);
    fire('1.4.2');
    expect(note().hidden).toBe(false);
    expect(note().textContent).toContain('1.4.2');
  });

  it('escapes the version text', () => {
    fire('<b>9</b>');
    expect(note().querySelector('b')).toBeNull();
  });
});

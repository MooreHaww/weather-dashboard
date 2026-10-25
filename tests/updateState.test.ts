import { describe, expect, it } from 'vitest';
import { checkedText, describeUpdate, parseUpdateState, sameUpdateState, type UpdateState } from '../src/shared/updateState';

const at = (h: number, m: number) => new Date(2026, 9, 25, h, m, 5).getTime(); // the PC's own clock

describe('describeUpdate', () => {
  it('no state yet (plain browser, or before the main process answers): only the version', () => {
    expect(describeUpdate(null, '1.4.7')).toEqual({ label: 'Version 1.4.7', detail: null, ready: false });
  });

  it('no check finished yet and dev builds: only the version, nothing extra', () => {
    for (const status of ['idle', 'unavailable'] as const) {
      expect(describeUpdate({ status, version: '1.4.7' }, 'x')).toEqual({ label: 'Version 1.4.7', detail: null, ready: false });
    }
  });

  it('up to date: "Version 1.4.7 · Up to date", with when it was checked in the chosen format', () => {
    const state: UpdateState = { status: 'up-to-date', version: '1.4.7', checkedAt: at(10, 42) };
    expect(describeUpdate(state, 'x', '24h').label).toBe('Version 1.4.7 · Up to date · checked 10:42');
    expect(describeUpdate(state, 'x', '12h').label).toBe('Version 1.4.7 · Up to date · checked 10:42 AM');
    expect(describeUpdate({ status: 'up-to-date', version: '1.4.7' }, 'x').label).toBe('Version 1.4.7 · Up to date');
  });

  it('checked time: afternoon, midnight and noon follow the 12/24-hour setting', () => {
    expect(checkedText(at(15, 5), '24h')).toBe('checked 15:05');
    expect(checkedText(at(15, 5), '12h')).toBe('checked 3:05 PM');
    expect(checkedText(at(0, 7), '12h')).toBe('checked 12:07 AM');
    expect(checkedText(at(12, 0), '12h')).toBe('checked 12:00 PM');
  });

  it('downloading and ready name the new version and still show the installed one', () => {
    expect(describeUpdate({ status: 'downloading', version: '1.4.7', next: '1.4.8' }, 'x')).toEqual({
      label: 'Version 1.4.8 is downloading…',
      detail: 'Installed version 1.4.7',
      ready: false,
    });
    expect(describeUpdate({ status: 'ready', version: '1.4.7', next: '1.4.8' }, 'x')).toEqual({
      label: 'Version 1.4.8 is ready',
      detail: 'Installed version 1.4.7',
      ready: true,
    });
  });

  it('a failed check: the version and a small neutral line', () => {
    expect(describeUpdate({ status: 'failed', version: '1.4.7' }, 'x')).toEqual({
      label: 'Version 1.4.7',
      detail: "Couldn't check for updates",
      ready: false,
    });
  });

  it('only the ready state shows the button', () => {
    const states: UpdateState[] = [
      { status: 'unavailable', version: '1' },
      { status: 'idle', version: '1' },
      { status: 'up-to-date', version: '1', checkedAt: 1 },
      { status: 'downloading', version: '1', next: '2' },
      { status: 'failed', version: '1' },
    ];
    expect(states.map((s) => describeUpdate(s, 'x').ready)).toEqual([false, false, false, false, false]);
  });
});

describe('parseUpdateState (the page does not trust what it is sent)', () => {
  it('accepts well-formed states and keeps only the fields that belong to each', () => {
    expect(parseUpdateState({ status: 'idle', version: '1.4.7', next: '9', checkedAt: 5, extra: true })).toEqual({ status: 'idle', version: '1.4.7' });
    expect(parseUpdateState({ status: 'up-to-date', version: '1.4.7', checkedAt: 5 })).toEqual({ status: 'up-to-date', version: '1.4.7', checkedAt: 5 });
    expect(parseUpdateState({ status: 'ready', version: '1.4.7', next: '1.4.8' })).toEqual({ status: 'ready', version: '1.4.7', next: '1.4.8' });
  });

  it('rejects anything else', () => {
    for (const bad of [
      null,
      'ready',
      42,
      {},
      { status: 'nope', version: '1' },
      { status: 'idle' },
      { status: 'idle', version: '' },
      { status: 'idle', version: 1 },
      { status: 'ready', version: '1' }, // no new version to name
      { status: 'downloading', version: '1', next: 2 },
      { status: 'idle', version: 'x'.repeat(100) },
    ]) {
      expect(parseUpdateState(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('ignores a bad checkedAt', () => {
    expect(parseUpdateState({ status: 'up-to-date', version: '1', checkedAt: 'soon' })).toEqual({ status: 'up-to-date', version: '1' });
    expect(parseUpdateState({ status: 'up-to-date', version: '1', checkedAt: Infinity })).toEqual({ status: 'up-to-date', version: '1' });
  });

  it('compares states', () => {
    const a: UpdateState = { status: 'ready', version: '1', next: '2' };
    expect(sameUpdateState(a, { ...a })).toBe(true);
    expect(sameUpdateState(a, { ...a, next: '3' })).toBe(false);
    expect(sameUpdateState(null, null)).toBe(true);
    expect(sameUpdateState(a, null)).toBe(false);
  });
});

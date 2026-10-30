import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { startAutoUpdate, type Updater } from '../src/main/autoUpdate';
import { createUpdateTracker } from '../src/main/updateTracker';
import { LOCATION_PRIVACY_LINE, locationStatus, placeLabel } from '../src/shared/locationText';
import { LOCATION_PLACE_ID, type Place } from '../src/shared/types';
import { describeUpdate, parseUpdateState, sameUpdateState, type UpdateState } from '../src/shared/updateState';

describe('the tracker while "Check for updates" runs', () => {
  const make = (enabled = true) => {
    const onChange = vi.fn();
    const tracker = createUpdateTracker({ version: '1.5.0', enabled, now: () => 5_000, onChange });
    return { tracker, onChange };
  };

  it('shows "checking" from idle, up to date and failed, and nowhere else', () => {
    for (const prepare of [() => {}, (t: ReturnType<typeof make>['tracker']) => t.notAvailable(), (t: ReturnType<typeof make>['tracker']) => t.failed()]) {
      const { tracker } = make();
      prepare(tracker);
      expect(tracker.checking()).toBe(true);
      expect(tracker.state()).toEqual({ status: 'checking', version: '1.5.0' });
    }
    const downloading = make();
    downloading.tracker.available('1.5.1');
    expect(downloading.tracker.checking()).toBe(false);
    expect(downloading.tracker.state().status).toBe('downloading');
    const ready = make();
    ready.tracker.downloaded('1.5.1');
    expect(ready.tracker.checking()).toBe(false);
    expect(ready.tracker.state().status).toBe('ready');
  });

  it('is refused while another check runs, and in a dev build', () => {
    const { tracker } = make();
    expect(tracker.checking()).toBe(true);
    expect(tracker.checking()).toBe(false);
    const dev = make(false);
    expect(dev.tracker.checking()).toBe(false);
    expect(dev.tracker.state().status).toBe('unavailable');
    expect(dev.onChange).not.toHaveBeenCalled();
  });

  it('the outcome replaces "checking": up to date, downloading, or failed', () => {
    const a = make();
    a.tracker.checking();
    a.tracker.notAvailable();
    expect(a.tracker.state()).toEqual({ status: 'up-to-date', version: '1.5.0', checkedAt: 5_000 });
    const b = make();
    b.tracker.checking();
    b.tracker.available('1.5.1');
    expect(b.tracker.state()).toEqual({ status: 'downloading', version: '1.5.0', next: '1.5.1' });
    const c = make();
    c.tracker.checking();
    c.tracker.failed();
    expect(c.tracker.state()).toEqual({ status: 'failed', version: '1.5.0' });
  });

  it('a failed check after an earlier failure still ends in "failed" (not stuck on "checking")', () => {
    const { tracker, onChange } = make();
    tracker.failed();
    tracker.checking();
    tracker.failed();
    expect(tracker.state().status).toBe('failed');
    expect(onChange.mock.calls.map((c) => (c[0] as UpdateState).status)).toEqual(['failed', 'checking', 'failed']);
  });

  it('settle goes back to what it was when no event moved the state on, and never undoes a result', () => {
    const { tracker } = make();
    tracker.notAvailable();
    tracker.checking();
    tracker.settle();
    expect(tracker.state()).toEqual({ status: 'up-to-date', version: '1.5.0', checkedAt: 5_000 });
    tracker.checking();
    tracker.available('1.5.1');
    tracker.settle();
    expect(tracker.state().status).toBe('downloading');
    tracker.settle(); // a second call changes nothing
    expect(tracker.state().status).toBe('downloading');
  });
});

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  logger: unknown = console;
  checkForUpdates = vi.fn<() => Promise<unknown> | unknown>(async () => null);
  quitAndInstall = vi.fn();
}

function updates(enabled = true) {
  const updater = new FakeUpdater();
  const tracker = createUpdateTracker({ version: '1.5.0', enabled, now: () => 7_000 });
  const log = vi.fn();
  const handle = startAutoUpdate({
    enabled,
    loadUpdater: async () => updater as unknown as Updater,
    tracker,
    onReady: vi.fn(),
    log,
    setTimeout: () => 0, // no scheduled checks: only the ones asked for
    setInterval: () => 0,
  });
  return { updater, tracker, handle, log };
}

describe('checkNow (the Settings button)', () => {
  it('shows "checking" during the check and "up to date" after update-not-available', async () => {
    const { updater, tracker, handle } = updates();
    const seen: string[] = [];
    updater.checkForUpdates.mockImplementation(async () => {
      seen.push(tracker.state().status);
      updater.emit('update-not-available', {});
    });
    await handle.checkNow();
    expect(seen).toEqual(['checking']);
    expect(tracker.state()).toEqual({ status: 'up-to-date', version: '1.5.0', checkedAt: 7_000 });
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('a check that finds a newer version moves on to downloading', async () => {
    const { updater, tracker, handle } = updates();
    updater.checkForUpdates.mockImplementation(async () => void updater.emit('update-available', { version: '1.5.1' }));
    await handle.checkNow();
    expect(tracker.state()).toEqual({ status: 'downloading', version: '1.5.0', next: '1.5.1' });
  });

  it('a rejected check ends as "failed" and is only logged', async () => {
    const { updater, tracker, handle, log } = updates();
    updater.checkForUpdates.mockRejectedValue(new Error('net::ERR_INTERNET_DISCONNECTED'));
    await handle.checkNow();
    expect(tracker.state().status).toBe('failed');
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('ERR_INTERNET_DISCONNECTED'));
  });

  it('a check that returns without any event goes back to what it was (never a made-up "up to date")', async () => {
    const { tracker, handle } = updates();
    await handle.checkNow();
    expect(tracker.state()).toEqual({ status: 'idle', version: '1.5.0' });
  });

  it('does nothing while an update is downloading or ready', async () => {
    const { updater, tracker, handle } = updates();
    tracker.available('1.5.1');
    await handle.checkNow();
    tracker.downloaded('1.5.1');
    await handle.checkNow();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(tracker.state().status).toBe('ready');
  });

  it('does nothing when updates are disabled (dev or unpackaged), and never loads the updater', async () => {
    const { updater, tracker, handle } = updates(false);
    await handle.checkNow();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(tracker.state().status).toBe('unavailable');
  });

  it('two presses at once run one check', async () => {
    const { updater, handle } = updates();
    let finish!: () => void;
    updater.checkForUpdates.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const first = handle.checkNow();
    await vi.waitFor(() => expect(updater.checkForUpdates).toHaveBeenCalledTimes(1));
    await handle.checkNow();
    finish();
    await first;
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });
});

describe('the words and the button in the Updates row', () => {
  it('"checking" keeps the version line and asks for the button to say "Checking…"', () => {
    expect(describeUpdate({ status: 'checking', version: '1.5.0' }, 'x')).toEqual({ label: 'Version 1.5.0', detail: null, ready: false, check: 'checking' });
  });

  it('the button belongs to idle, up to date and failed only; not to downloading, ready, dev or a plain browser', () => {
    const shown = (s: UpdateState | null) => describeUpdate(s, '1.5.0').check;
    expect(shown({ status: 'idle', version: '1' })).toBe('idle');
    expect(shown({ status: 'up-to-date', version: '1' })).toBe('idle');
    expect(shown({ status: 'failed', version: '1' })).toBe('idle');
    expect(shown({ status: 'checking', version: '1' })).toBe('checking');
    expect(shown({ status: 'downloading', version: '1', next: '2' })).toBe('none');
    expect(shown({ status: 'ready', version: '1', next: '2' })).toBe('none');
    expect(shown({ status: 'unavailable', version: '1' })).toBe('none');
    expect(shown(null)).toBe('none');
  });

  it('the page accepts "checking" from the main process and tells it apart from idle', () => {
    expect(parseUpdateState({ status: 'checking', version: '1.5.0' })).toEqual({ status: 'checking', version: '1.5.0' });
    expect(sameUpdateState({ status: 'checking', version: '1' }, { status: 'idle', version: '1' })).toBe(false);
  });
});

describe('locationText', () => {
  const paris: Place = { id: LOCATION_PLACE_ID, name: 'Paris', latitude: 48.86, longitude: 2.35, country: 'France', countryCode: 'FR', timezone: 'Europe/Paris' };

  it('names the place with its country, or just the name', () => {
    expect(placeLabel(paris)).toBe('Paris, France');
    expect(placeLabel({ ...paris, country: undefined })).toBe('Paris');
    expect(placeLabel({ ...paris, name: 'Singapore', country: 'Singapore' })).toBe('Singapore');
  });

  it('says plainly what is stored and what will happen, never alarming', () => {
    expect(LOCATION_PRIVACY_LINE).toBe('Uses your IP address to guess your city. The IP address is sent to GeoJS.');
    expect(locationStatus('off', null, 'idle')).toBe('Off. No location lookup is made.');
    expect(locationStatus('ask', null, 'idle')).toBe('Off. No location lookup is made.');
    expect(locationStatus('on', null, 'looking')).toBe('Looking for your location…');
    expect(locationStatus('on', paris, 'idle')).toBe('Near Paris, France. This is approximate.');
    expect(locationStatus('on', null, 'failed')).toBe("Couldn't find your location. It tries again the next time the app starts.");
    expect(locationStatus('on', paris, 'failed')).toBe('Near Paris, France. This is approximate.'); // a saved place stays
    expect(locationStatus('off', paris, 'idle')).toBe('Off. No location lookup is made.'); // off wins
  });
});

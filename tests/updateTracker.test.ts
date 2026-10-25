import { describe, expect, it, vi } from 'vitest';
import { createUpdateTracker } from '../src/main/updateTracker';

function setup(opts: { enabled?: boolean } = {}) {
  const onChange = vi.fn();
  let time = 1_000;
  const tracker = createUpdateTracker({ version: '1.4.7', enabled: opts.enabled ?? true, now: () => time, onChange });
  return { tracker, onChange, tick: (ms: number) => (time += ms) };
}

describe('update state', () => {
  it('starts with no check done: only the version, never "up to date"', () => {
    const { tracker, onChange } = setup();
    expect(tracker.state()).toEqual({ status: 'idle', version: '1.4.7' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is "up to date" only after a check that succeeded and found nothing newer, with when it happened', () => {
    const { tracker, onChange } = setup();
    tracker.notAvailable();
    expect(tracker.state()).toEqual({ status: 'up-to-date', version: '1.4.7', checkedAt: 1_000 });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('a failed check is "failed", never "up to date", even if an earlier check succeeded', () => {
    const { tracker, tick } = setup();
    tracker.failed();
    expect(tracker.state().status).toBe('failed');
    tick(60_000);
    tracker.notAvailable();
    expect(tracker.state()).toMatchObject({ status: 'up-to-date', checkedAt: 61_000 });
    tracker.failed();
    expect(tracker.state()).toEqual({ status: 'failed', version: '1.4.7' }); // no stale checkedAt
  });

  it('a repeated failure does not announce itself again', () => {
    const { tracker, onChange } = setup();
    tracker.failed();
    tracker.failed();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('goes up to date -> downloading -> ready', () => {
    const { tracker } = setup();
    tracker.notAvailable();
    tracker.available('1.4.8');
    expect(tracker.state()).toEqual({ status: 'downloading', version: '1.4.7', next: '1.4.8' });
    tracker.downloaded('1.4.8');
    expect(tracker.state()).toEqual({ status: 'ready', version: '1.4.7', next: '1.4.8' });
  });

  it('a download that fails is "failed" (the next check starts it again)', () => {
    const { tracker } = setup();
    tracker.available('1.4.8');
    tracker.failed();
    expect(tracker.state().status).toBe('failed');
    tracker.available('1.4.8');
    expect(tracker.state().status).toBe('downloading');
  });

  it('a downloaded update stays ready whatever a later check says', () => {
    const { tracker } = setup();
    tracker.downloaded('1.4.8');
    tracker.notAvailable();
    tracker.failed();
    tracker.available('1.4.8');
    expect(tracker.state()).toEqual({ status: 'ready', version: '1.4.7', next: '1.4.8' });
  });

  it('a newer download replaces a ready one', () => {
    const { tracker } = setup();
    tracker.downloaded('1.4.8');
    tracker.downloaded('1.4.9');
    expect(tracker.state()).toMatchObject({ status: 'ready', next: '1.4.9' });
  });

  it('in a dev or unpackaged build nothing changes it: only the version', () => {
    const { tracker, onChange } = setup({ enabled: false });
    expect(tracker.state()).toEqual({ status: 'unavailable', version: '1.4.7' });
    tracker.notAvailable();
    tracker.available('9.9.9');
    tracker.downloaded('9.9.9');
    tracker.failed();
    expect(tracker.state()).toEqual({ status: 'unavailable', version: '1.4.7' });
    expect(onChange).not.toHaveBeenCalled();
  });
});

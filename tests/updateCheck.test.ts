import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CHECK_CHANNEL, CHECK_COOLDOWN_MS, CHECKABLE, createCheckHandler } from '../src/main/updateCheck';
import type { Frame, RestartEvent } from '../src/main/updateRestart';
import type { UpdateStatus } from '../src/shared/updateState';

const ORIGIN = 'http://127.0.0.1:51234';

function setup(opts: { active?: boolean; status?: UpdateStatus; windowGone?: boolean } = {}) {
  const top: Frame = { url: `${ORIGIN}/`, parent: null, processId: 4, routingId: 1 };
  const webContents = { mainFrame: top };
  let time = 1_000_000;
  let status: UpdateStatus = opts.status ?? 'up-to-date';
  const check = vi.fn(async () => {});
  const log = vi.fn();
  const handler = createCheckHandler({
    window: () => (opts.windowGone ? null : { webContents }),
    origin: ORIGIN,
    active: () => opts.active ?? true,
    status: () => status,
    check,
    now: () => time,
    log,
  });
  const event: RestartEvent = { sender: webContents, senderFrame: top };
  return {
    handler,
    event,
    top,
    check,
    log,
    advance: (ms: number) => void (time += ms),
    setStatus: (s: UpdateStatus) => void (status = s),
  };
}

describe('the "Check for updates" message in the main process', () => {
  it('starts one check from the app window, top frame and local origin', () => {
    const { handler, event, check } = setup();
    expect(handler(event)).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('works from every state where the button is shown (up to date, no check yet, last check failed)', () => {
    expect([...CHECKABLE].sort()).toEqual(['failed', 'idle', 'up-to-date']);
    for (const status of CHECKABLE) {
      const s = setup({ status });
      expect(s.handler(s.event), status).toBe(true);
    }
  });

  it('is ignored in a dev or unpackaged build, where the updater is not active', () => {
    const { handler, event, check, log } = setup({ active: false, status: 'unavailable' });
    expect(handler(event)).toBe(false);
    expect(check).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('not active'));
  });

  it('is ignored while downloading, when an update is ready, and while a check is already running', () => {
    for (const status of ['downloading', 'ready', 'checking', 'unavailable'] as const) {
      const s = setup({ status });
      expect(s.handler(s.event), status).toBe(false);
      expect(s.check).not.toHaveBeenCalled();
    }
  });

  it('is ignored from another window or web contents', () => {
    const { handler, event, check } = setup();
    expect(handler({ ...event, sender: { mainFrame: event.senderFrame } })).toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it('is ignored from a frame inside the page, a gone frame, or a different process', () => {
    const { handler, event, top, check } = setup();
    expect(handler({ ...event, senderFrame: { ...top, parent: top, routingId: 9 } })).toBe(false);
    expect(handler({ ...event, senderFrame: { ...top, routingId: 9 } })).toBe(false);
    expect(handler({ ...event, senderFrame: { ...top, processId: 5 } })).toBe(false);
    expect(handler({ ...event, senderFrame: null })).toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it('is ignored when the page is not from the local server', () => {
    const { handler, event, top, check } = setup();
    for (const url of ['http://127.0.0.1:51235/', 'http://localhost:51234/', 'https://example.com/', 'file:///C:/x.html', 'about:blank', 'not a url']) {
      expect(handler({ ...event, senderFrame: { ...top, url } }), url).toBe(false);
    }
    expect(check).not.toHaveBeenCalled();
  });

  it('is ignored when it carries anything (the preload never sends arguments)', () => {
    const { handler, event, check } = setup();
    expect(handler(event, 'https://example.com/latest.yml')).toBe(false);
    expect(handler(event, { feed: 'x' })).toBe(false);
    expect(handler(event, undefined)).toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it('is ignored when the window is gone', () => {
    const { handler, event, check } = setup({ windowGone: true });
    expect(handler(event)).toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it('ignores presses within 30 seconds of the last accepted one, then accepts again', () => {
    expect(CHECK_COOLDOWN_MS).toBe(30_000);
    const { handler, event, check, advance, log } = setup();
    expect(handler(event)).toBe(true);
    advance(1);
    expect(handler(event)).toBe(false);
    advance(CHECK_COOLDOWN_MS - 2);
    expect(handler(event)).toBe(false); // 29.999 s after the first
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('30 seconds'));
    advance(1);
    expect(handler(event)).toBe(true); // exactly 30 s
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('a rejected press does not restart the 30 seconds', () => {
    const { handler, event, top, check, advance } = setup();
    expect(handler(event)).toBe(true);
    advance(20_000);
    expect(handler({ ...event, senderFrame: { ...top, url: 'https://example.com/' } })).toBe(false);
    advance(10_000);
    expect(handler(event)).toBe(true);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('a press ignored because of the state does not use up the 30 seconds', () => {
    const { handler, event, check, setStatus } = setup({ status: 'ready' });
    expect(handler(event)).toBe(false);
    setStatus('up-to-date');
    expect(handler(event)).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('a check that throws or rejects is logged and does not break the handler', async () => {
    const s = setup();
    s.check.mockRejectedValueOnce(new Error('offline'));
    expect(s.handler(s.event)).toBe(true);
    await vi.waitFor(() => expect(s.log).toHaveBeenCalledWith('warn', expect.stringContaining('offline')));
    s.advance(CHECK_COOLDOWN_MS);
    s.check.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(s.handler(s.event)).toBe(true);
    await vi.waitFor(() => expect(s.log).toHaveBeenCalledWith('warn', expect.stringContaining('boom')));
  });

  it('the preload sends exactly the two messages, each with no arguments', () => {
    const preload = readFileSync(path.join(__dirname, '..', 'src', 'main', 'preload.ts'), 'utf8');
    const sends = [...preload.matchAll(/ipcRenderer\.(send|sendSync|invoke|postMessage)\(([^)]*)\)/g)].map((m) => m[0]);
    expect(sends).toEqual([`ipcRenderer.send('update-restart')`, `ipcRenderer.send('${CHECK_CHANNEL}')`]);
  });
});

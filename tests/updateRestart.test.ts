import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createRestartHandler, RESTART_CHANNEL, type Frame, type RestartEvent } from '../src/main/updateRestart';
import { CHECK_CHANNEL } from '../src/main/updateCheck';

const ORIGIN = 'http://127.0.0.1:51234';

function setup(opts: { ready?: string | null; loaded?: boolean; windowGone?: boolean } = {}) {
  const top: Frame = { url: `${ORIGIN}/`, parent: null, processId: 4, routingId: 1 };
  const webContents = { mainFrame: top };
  const calls: string[] = [];
  const quitAndInstall = vi.fn((silent?: boolean, runAfter?: boolean) => void calls.push(`quitAndInstall(${silent}, ${runAfter})`));
  const saveWindowState = vi.fn(() => void calls.push('saveWindowState'));
  const log = vi.fn();
  const handler = createRestartHandler({
    window: () => (opts.windowGone ? null : { webContents }),
    origin: ORIGIN,
    updateReady: () => (opts.ready === undefined ? '1.4.7' : opts.ready),
    updater: () => (opts.loaded === false ? null : { quitAndInstall }),
    saveWindowState,
    log,
  });
  const event: RestartEvent = { sender: webContents, senderFrame: top };
  return { handler, event, top, webContents, calls, quitAndInstall, saveWindowState, log };
}

describe('the "Update now" message in the main process', () => {
  it('saves the window state first, then quits and installs silently and reopens the app', () => {
    const { handler, event, calls } = setup();
    expect(handler(event)).toBe(true);
    expect(calls).toEqual(['saveWindowState', 'quitAndInstall(true, true)']);
  });

  it('is ignored when no update has been downloaded', () => {
    for (const s of [setup({ ready: null }), setup({ loaded: false })]) {
      expect(s.handler(s.event)).toBe(false);
      expect(s.saveWindowState).not.toHaveBeenCalled();
      expect(s.quitAndInstall).not.toHaveBeenCalled();
      expect(s.log).toHaveBeenCalledWith('warn', expect.stringContaining('no update downloaded'));
    }
  });

  it('is ignored from another window or web contents', () => {
    const { handler, event, quitAndInstall, saveWindowState } = setup();
    expect(handler({ ...event, sender: { mainFrame: event.senderFrame } })).toBe(false);
    expect(quitAndInstall).not.toHaveBeenCalled();
    expect(saveWindowState).not.toHaveBeenCalled();
  });

  it('is ignored from a frame inside the page (not the top frame)', () => {
    const { handler, event, top, quitAndInstall } = setup();
    expect(handler({ ...event, senderFrame: { ...top, parent: top, routingId: 9 } })).toBe(false);
    expect(handler({ ...event, senderFrame: { ...top, routingId: 9 } })).toBe(false);
    expect(handler({ ...event, senderFrame: { ...top, processId: 5 } })).toBe(false);
    expect(handler({ ...event, senderFrame: null })).toBe(false); // frame already gone
    expect(quitAndInstall).not.toHaveBeenCalled();
  });

  it('is ignored when the page is not from the local server', () => {
    const { handler, event, top, quitAndInstall } = setup();
    for (const url of ['http://127.0.0.1:51235/', 'http://localhost:51234/', 'https://example.com/', 'file:///C:/x.html', 'about:blank', 'not a url']) {
      expect(handler({ ...event, senderFrame: { ...top, url } }), url).toBe(false);
    }
    expect(quitAndInstall).not.toHaveBeenCalled();
  });

  it('is ignored when it carries anything (the preload never sends arguments)', () => {
    const { handler, event, quitAndInstall } = setup();
    expect(handler(event, 'C:\\evil.exe')).toBe(false);
    expect(handler(event, { url: 'https://example.com' })).toBe(false);
    expect(handler(event, undefined)).toBe(false);
    expect(quitAndInstall).not.toHaveBeenCalled();
  });

  it('is ignored when the window is gone', () => {
    const { handler, event, quitAndInstall } = setup({ windowGone: true });
    expect(handler(event)).toBe(false);
    expect(quitAndInstall).not.toHaveBeenCalled();
  });

  it('runs only once (a second quitAndInstall would make the installer run twice)', () => {
    const { handler, event, quitAndInstall, saveWindowState } = setup();
    expect(handler(event)).toBe(true);
    expect(handler(event)).toBe(false);
    expect(quitAndInstall).toHaveBeenCalledTimes(1);
    expect(saveWindowState).toHaveBeenCalledTimes(1);
  });

  it('the preload sends the restart message with no arguments (v1.5 added one more message, "update-check", which has its own test)', () => {
    const preload = readFileSync(path.join(__dirname, '..', 'src', 'main', 'preload.ts'), 'utf8');
    const sends = [...preload.matchAll(/ipcRenderer\.(send|sendSync|invoke|postMessage)\(([^)]*)\)/g)].map((m) => m[0]);
    expect(sends).toEqual([`ipcRenderer.send('${RESTART_CHANNEL}')`, `ipcRenderer.send('${CHECK_CHANNEL}')`]);
  });
});

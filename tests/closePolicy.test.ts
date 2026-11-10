// v1.9: what the close button does, and the page's answer to "Close Weather Dashboard?".
// main.ts sets `quitting` on before-quit (tray Quit, Exit, quitAndInstall's app.quit()), on the window's
// query-session-end / session-end (Windows shutdown, restart, sign-out) and before "Update now" runs quitAndInstall.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CLOSE_CHOICE_CHANNEL, CLOSE_REQUEST_CHANNEL, createCloseChoiceHandler } from '../src/main/closeChoice';
import { decideClose } from '../src/main/closePolicy';
import type { Frame, RestartEvent } from '../src/main/updateRestart';
import { CLOSE_BEHAVIORS } from '../src/shared/types';

describe('decideClose', () => {
  it('exit closes, background hides, ask asks', () => {
    expect(decideClose({ behavior: 'exit', quitting: false, pageReady: true })).toBe('close');
    expect(decideClose({ behavior: 'background', quitting: false, pageReady: true })).toBe('hide');
    expect(decideClose({ behavior: 'ask', quitting: false, pageReady: true })).toBe('ask');
  });

  it('never stops a quit: shutdown, sign-out, restart, the update restart, tray Quit and Exit all close, whatever the setting', () => {
    for (const behavior of CLOSE_BEHAVIORS) {
      for (const pageReady of [true, false]) expect(decideClose({ behavior, quitting: true, pageReady })).toBe('close');
    }
  });

  it('ask with a page that cannot show the dialog (loading or crashed) closes normally instead of leaving a window that will not close', () => {
    expect(decideClose({ behavior: 'ask', quitting: false, pageReady: false })).toBe('close');
  });

  it('background hides even while the page is not ready (the tray can bring it back)', () => {
    expect(decideClose({ behavior: 'background', quitting: false, pageReady: false })).toBe('hide');
  });
});

const ORIGIN = 'http://127.0.0.1:51234';

function setup(opts: { pending?: boolean; windowGone?: boolean } = {}) {
  const top: Frame = { url: `${ORIGIN}/`, parent: null, processId: 4, routingId: 1 };
  const webContents = { mainFrame: top };
  let pending = opts.pending ?? true;
  const exit = vi.fn();
  const hide = vi.fn();
  const log = vi.fn();
  const handler = createCloseChoiceHandler({
    window: () => (opts.windowGone ? null : { webContents }),
    origin: ORIGIN,
    pending: () => pending,
    clearPending: () => (pending = false),
    exit,
    hide,
    log,
  });
  const event: RestartEvent = { sender: webContents, senderFrame: top };
  return { handler, event, top, exit, hide, log, pending: () => pending, ask: () => (pending = true) };
}

describe('the close choice message', () => {
  it('exit quits, hide hides, and each clears the request', () => {
    const a = setup();
    expect(a.handler(a.event, 'exit')).toBe('exit');
    expect(a.exit).toHaveBeenCalledTimes(1);
    expect(a.pending()).toBe(false);
    const b = setup();
    expect(b.handler(b.event, 'hide')).toBe('hide');
    expect(b.hide).toHaveBeenCalledTimes(1);
    expect(b.exit).not.toHaveBeenCalled();
  });

  it('one close request allows one action', () => {
    const s = setup();
    expect(s.handler(s.event, 'hide')).toBe('hide');
    expect(s.handler(s.event, 'exit')).toBeNull();
    expect(s.exit).not.toHaveBeenCalled();
    s.ask(); // the next close asks again
    expect(s.handler(s.event, 'exit')).toBe('exit');
  });

  it('is ignored while no close request is pending', () => {
    const s = setup({ pending: false });
    expect(s.handler(s.event, 'exit')).toBeNull();
    expect(s.exit).not.toHaveBeenCalled();
    expect(s.log).toHaveBeenCalledWith('warn', expect.stringContaining('no close request pending'));
  });

  it('takes exactly one argument, "exit" or "hide"', () => {
    const s = setup();
    for (const args of [[], ['quit'], ['EXIT'], [{ toString: () => 'exit' }], ['exit', 'now'], ['hide', 1], [null]]) {
      expect(s.handler(s.event, ...args)).toBeNull();
    }
    expect(s.exit).not.toHaveBeenCalled();
    expect(s.hide).not.toHaveBeenCalled();
    expect(s.pending()).toBe(true);
  });

  it('is ignored from another web contents, a subframe, another origin, or with the window gone', () => {
    const s = setup();
    expect(s.handler({ ...s.event, sender: {} }, 'exit')).toBeNull();
    expect(s.handler({ ...s.event, senderFrame: { ...s.top, parent: s.top, routingId: 9 } }, 'exit')).toBeNull();
    expect(s.handler({ ...s.event, senderFrame: { ...s.top, processId: 5 } }, 'exit')).toBeNull();
    expect(s.handler({ ...s.event, senderFrame: null }, 'exit')).toBeNull();
    expect(s.handler({ ...s.event, senderFrame: { ...s.top, url: 'https://example.com/' } }, 'exit')).toBeNull();
    expect(s.handler({ ...s.event, senderFrame: { ...s.top, url: 'not a url' } }, 'exit')).toBeNull();
    const gone = setup({ windowGone: true });
    expect(gone.handler(gone.event, 'exit')).toBeNull();
    expect(s.exit).not.toHaveBeenCalled();
  });
});

describe('the preload (it cannot import closeChoice.ts)', () => {
  const preload = readFileSync(path.join(__dirname, '..', 'src', 'main', 'preload.ts'), 'utf8');

  it('uses the same channel strings, listens for the request and sends only the guarded choice', () => {
    expect(preload).toContain(`ipcRenderer.on('${CLOSE_REQUEST_CHANNEL}', () => callback())`);
    expect(preload).toContain(`if (choice === 'exit' || choice === 'hide') ipcRenderer.send('${CLOSE_CHOICE_CHANNEL}', choice);`);
  });
});

// Shared helper for the end-to-end tests and the README screenshot: launch the
// built Electron app with a throwaway data folder (your real favorites are never
// touched) and drive it over the Chrome DevTools Protocol (CDP).
//
// - The window's page is driven through the renderer's DevTools endpoint.
// - The Electron main process is driven through its Node inspector, so tests
//   can really resize/maximize the window. No test-only code ships in the app.
//
// Animations stay ON: an earlier version forced reduced motion here, which hid a
// chart bug that only happens when animations run.

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AppState } from '../src/shared/types';

const root = path.join(__dirname, '..');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type CdpEvent = { method: string; params: Record<string, unknown> };

class Cdp {
  private id = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private listeners: ((e: CdpEvent) => void)[] = [];

  private constructor(private ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(String(e.data)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
        method?: string;
        params?: Record<string, unknown>;
      };
      if (msg.id === undefined) {
        if (msg.method) this.listeners.forEach((l) => l({ method: msg.method!, params: msg.params ?? {} }));
        return;
      }
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    });
  }

  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new Cdp(ws)), { once: true });
      ws.addEventListener('error', () => reject(new Error(`CDP connection failed: ${url}`)), { once: true });
    });
  }

  on(listener: (e: CdpEvent) => void) {
    this.listeners.push(listener);
  }

  send<T = unknown>(method: string, params: object = {}): Promise<T> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise<T>((resolve, reject) => this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject }));
  }

  /** Evaluate an expression; returns its JSON value or throws the page's error. */
  async evaluate<T>(expression: string): Promise<T> {
    const res = await this.send<{ result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
    );
    if (res.exceptionDetails) {
      throw new Error(`Evaluation failed: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`);
    }
    return res.result.value;
  }

  close() {
    this.ws.close();
  }
}

export interface AppPage {
  /** Evaluate a JS expression in the dashboard window and return its value. */
  evaluate<T>(expression: string): Promise<T>;
  /** Poll until the expression is truthy. */
  waitFor(expression: string, timeoutMs?: number): Promise<void>;
  /** Send a real key press to the focused element (optionally with Shift held). */
  press(key: keyof typeof KEYS, opts?: { shift?: boolean }): Promise<void>;
  /** A real left mouse click at a viewport position (goes through hit-testing like a user's click). */
  click(x: number, y: number): Promise<void>;
  /** Emulate Windows' "Animation effects: off" (prefers-reduced-motion: reduce). */
  emulateReducedMotion(on: boolean): Promise<void>;
  screenshot(): Promise<Buffer>;
}

export interface LaunchedApp {
  page: AppPage;
  dataDir: string;
  /** Uncaught exceptions thrown in the window since launch. */
  errors: string[];
  /** Resize the window's content area (like the user dragging its edges). */
  resize: (width: number, height: number) => Promise<void>;
  maximize: () => Promise<void>;
  restore: () => Promise<void>;
  close: () => Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

const KEYS = {
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  Home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
  End: { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  ' ': { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
};
const SHIFT = 8; // CDP modifier bit

export async function launchApp(seed?: Partial<AppState>): Promise<LaunchedApp> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'wd-e2e-'));
  if (seed) {
    await writeFile(path.join(dataDir, 'weather-dashboard.json'), JSON.stringify({ version: 1, ...seed }), 'utf8');
  }

  const port = await freePort();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electronPath = require('electron') as unknown as string;
  const child = spawn(
    electronPath,
    [
      '--inspect=0',
      `--remote-debugging-port=${port}`,
      // Own profile folder, so a running installed copy's single-instance lock doesn't apply.
      `--user-data-dir=${path.join(dataDir, 'profile')}`,
      root,
    ],
    {
      cwd: root,
      env: { ...process.env, WD_DATA_DIR: dataDir, VITE_DEV_URL: '' },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  let exited = false;
  child.once('exit', () => (exited = true));

  const inspectorUrl = new Promise<string>((resolve, reject) => {
    let output = '';
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const m = output.match(/Debugger listening on (ws:\/\/\S+)/);
      if (m) resolve(m[1]!);
    });
    child.once('exit', (code) => reject(new Error(`Electron exited early (code ${code})`)));
  });

  // Wait for the dashboard window to appear in the DevTools target list.
  let target: { id: string; webSocketDebuggerUrl: string } | undefined;
  for (const deadline = Date.now() + 30_000; !target; await sleep(250)) {
    if (exited) throw new Error('Electron exited before the window opened');
    if (Date.now() > deadline) throw new Error('Dashboard window did not open within 30s');
    try {
      const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
        id: string;
        type: string;
        url: string;
        webSocketDebuggerUrl: string;
      }[];
      target = list.find((t) => t.type === 'page' && t.url.startsWith('http://127.0.0.1'));
    } catch {
      // DevTools endpoint not up yet
    }
  }

  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  const errors: string[] = [];
  cdp.on((e) => {
    if (e.method !== 'Runtime.exceptionThrown') return;
    const d = e.params.exceptionDetails as { text: string; exception?: { description?: string } };
    errors.push(d.exception?.description ?? d.text);
  });
  await cdp.send('Runtime.enable');

  const main = await Cdp.connect(await inspectorUrl);
  const inMain = <T>(body: string) =>
    main.evaluate<T>(
      `(async () => { const { BrowserWindow } = process.mainModule.require('electron'); const win = BrowserWindow.getAllWindows()[0]; ${body} })()`,
    );
  // Keep animations running even if the test window is behind other windows.
  await inMain(`win.webContents.setBackgroundThrottling(false);`);

  const page: AppPage = {
    evaluate: (expression) => cdp.evaluate(expression),
    async waitFor(expression, timeoutMs = 30_000) {
      for (const deadline = Date.now() + timeoutMs; ; await sleep(150)) {
        if (await cdp.evaluate<boolean>(`Boolean(${expression})`)) return;
        if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${expression}`);
      }
    },
    async press(key, opts) {
      const k = KEYS[key];
      const modifiers = opts?.shift ? SHIFT : 0;
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers, ...k });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, ...k, text: undefined });
    },
    async click(x, y) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: 1, clickCount: 1 });
      }
    },
    async emulateReducedMotion(on) {
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }],
      });
    },
    async screenshot() {
      const { data } = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      return Buffer.from(data, 'base64');
    },
  };

  const settle = () => sleep(500);

  return {
    page,
    dataDir,
    errors,
    async resize(width, height) {
      await inMain(`if (win.isMaximized()) win.unmaximize(); win.setContentSize(${width}, ${height});`);
      await settle();
    },
    async maximize() {
      await inMain(`win.maximize();`);
      await settle();
    },
    async restore() {
      await inMain(`win.unmaximize();`);
      await settle();
    },
    async close() {
      cdp.close();
      main.close();
      child.kill();
      if (!exited) await new Promise((r) => child.once('exit', r));
      await rm(dataDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/** Wait until the dashboard has rendered real data. */
export async function waitForDashboard(page: AppPage): Promise<void> {
  await page.waitFor(`document.querySelectorAll('.forecast .day').length === 7`);
  await page.waitFor(`(document.getElementById('clock-time')?.textContent ?? '').length > 0`);
  await page.waitFor(`!document.getElementById('main').classList.contains('is-loading')`);
}

/**
 * Count the pixels a chart actually painted in a given color family.
 * `match` is the body of a function (r, g, b, a) => boolean.
 */
export function countPixels(canvasId: string, match: string): string {
  return `(() => {
    const c = document.getElementById(${JSON.stringify(canvasId)});
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const m = (r, g, b, a) => ${match};
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (m(d[i], d[i + 1], d[i + 2], d[i + 3])) n++;
    return n;
  })()`;
}

/** Color families used by the charts (see src/renderer/charts.ts). */
export const COLORS = {
  temperature: 'a > 150 && r > 220 && g > 140 && g < 210 && b < 120', // #FFB547
  feelsLike: 'a > 120 && r > 160 && r < 225 && g > 150 && g < 205 && b > 225', // #C4B5FD
  rainBars: 'a > 40 && r < 160 && g > 150 && b > 220', // #5AB0FF / #7CC4FF
};

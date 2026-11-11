// What the glass window really looks like on screen (v1.6), for tests and the README screenshots.
// A page screenshot (CDP) cannot show it: the system acrylic is drawn by Windows, behind the page. So this
// puts a plain, controlled backdrop window behind the app (a flat colour, or the test pattern), keeps the app
// in front and focused (an inactive acrylic window shows a flat grey instead), and captures that part of the
// real screen with Electron's desktopCapturer from the app's main process. Test and script use only.

import type { LaunchedApp } from './launch';

/** Backdrops behind the window. `pattern`: white, black and the six saturated colours in bands, plus big text. */
export type Backdrop = 'white' | 'black' | 'grey' | 'pattern' | { css: string };

function backdropUrl(kind: Backdrop): string {
  const bg =
    typeof kind === 'object'
      ? kind.css
      : kind === 'white'
        ? '#ffffff'
        : kind === 'black'
          ? '#000000'
          : kind === 'grey'
            ? '#808080'
            : 'linear-gradient(90deg,#fff 0 20%,#000 20% 40%,#f00 40% 50%,#0f0 50% 60%,#00f 60% 70%,#ff0 70% 80%,#0ff 80% 90%,#f0f 90%)';
  const text =
    kind === 'pattern'
      ? '<div style="position:absolute;top:30%;left:0;right:0;text-align:center;font:900 220px Segoe UI,sans-serif;color:#000;mix-blend-mode:difference">BACKDROP</div>'
      : '';
  return `data:text/html,${encodeURIComponent(`<html><body style="margin:0;height:100vh;overflow:hidden;background:${bg}">${text}</body></html>`)}`;
}

// Main-process code: the app's window is the one not marked as a backdrop (and not the v2.0 desktop widget).
const MAIN = `const { BrowserWindow, desktopCapturer, screen } = process.mainModule.require('electron');
  const wins = BrowserWindow.getAllWindows(); const win = wins.find((w) => !w.__backdrop && !w.webContents.getURL().includes('/widget.html'));`;

/** Show (or change) the backdrop window over the app's whole screen, behind the app, and bring the app to the front. */
export async function showBackdrop(app: LaunchedApp, kind: Backdrop): Promise<void> {
  await app.evaluateMain(`${MAIN}
    for (const old of wins) if (old.__backdrop) old.destroy(); // a fresh one each time (reusing one lost its z-order)
    const d = screen.getDisplayMatching(win.getBounds()).bounds;
    const b = new BrowserWindow({ ...d, frame: false, focusable: false, skipTaskbar: true, show: false, resizable: false, backgroundColor: '#808080' });
    b.__backdrop = true;
    await b.loadURL(${JSON.stringify(backdropUrl(kind))});
    // Pinned above every other app's windows, the app pinned one level higher, so nothing else can come between
    // them (other windows on the desktop, or a window the user brings forward). removeBackdrop() undoes both.
    b.setAlwaysOnTop(true, 'floating');
    b.showInactive();
    win.setAlwaysOnTop(true, 'pop-up-menu');
    win.moveTop(); win.focus();`);
  await new Promise((r) => setTimeout(r, 1000)); // Windows fades the material in
}

export async function removeBackdrop(app: LaunchedApp): Promise<void> {
  await app.evaluateMain(`${MAIN} for (const w of wins) if (w.__backdrop) w.destroy(); win?.setAlwaysOnTop(false);`);
}

/** PNG of the app window as it is on screen (window bounds, plus `pad` px of what is around it). */
export async function captureWindow(app: LaunchedApp, pad = 0): Promise<Buffer> {
  const b64 = await app.evaluateMain<string>(`${MAIN}
    const r = win.getContentBounds(); const d = screen.getDisplayMatching(r); const k = d.scaleFactor;
    const [source] = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: d.bounds.width * k, height: d.bounds.height * k } });
    const x = Math.max(0, r.x - d.bounds.x - ${pad}), y = Math.max(0, r.y - d.bounds.y - ${pad});
    const w = Math.min(d.bounds.width - x, r.width + 2 * ${pad}), h = Math.min(d.bounds.height - y, r.height + 2 * ${pad});
    return source.thumbnail.crop({ x: Math.round(x * k), y: Math.round(y * k), width: Math.round(w * k), height: Math.round(h * k) }).toPNG().toString('base64');`);
  return Buffer.from(b64, 'base64');
}

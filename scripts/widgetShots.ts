// README shots of the desktop widget (v2.0): docs/widget-small.png and docs/widget-medium.png, plus a contact sheet of
// the weather effects (docs/widget-2.0/effects.png, not used by the README).
//
// Wallpaper mode with the made-up fixture picture as the wallpaper (tests/e2e/support/fakeDesktop.cjs): this PC's real
// wallpaper is never read. The weather is staged (the main process sends the widget a fixed payload), so the shots show
// the look, not live weather. Live mode can't be captured this way: the widget hides itself from captures while Live is on.
// The widget page is captured with webContents.capturePage (its own pixels: the card is drawn by the page, no acrylic).
// Run with: npm run build && npx tsx scripts/widgetShots.ts

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchApp, waitForDashboard } from './launch';
import { blendedLook, type Sky } from '../src/shared/sky';
import type { Phase } from '../src/shared/phase';
import { widgetTint } from '../src/shared/widgetLook';
import type { WidgetData } from '../src/shared/widget';
import type { IconId } from '../src/shared/weatherCodes';

const root = path.join(__dirname, '..');
const support = (f: string) => path.join(root, 'tests', 'e2e', 'support', f).replace(/\\/g, '/');
const london = { id: 2643743, name: 'London', latitude: 51.50853, longitude: -0.12574, admin1: 'England', country: 'United Kingdom', countryCode: 'GB', timezone: 'Europe/London' };

const MAIN = `const { BrowserWindow, nativeImage } = process.mainModule.require('electron');
  const W = () => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('/widget.html'));`;

interface Scene {
  sky: Sky;
  phase: Phase;
  isDay: boolean;
  icon: IconId;
  condition: string;
  temp: number;
  label: string;
}

const SCENES: Scene[] = [
  { sky: 'clear', phase: 'noon', isDay: true, icon: 'clear', condition: 'Clear sky', temp: 24, label: 'clear, day' },
  { sky: 'partly', phase: 'afternoon', isDay: true, icon: 'partly-cloudy', condition: 'Partly cloudy', temp: 19, label: 'partly cloudy, day' },
  { sky: 'overcast', phase: 'noon', isDay: true, icon: 'overcast', condition: 'Overcast', temp: 14, label: 'overcast' },
  { sky: 'fog', phase: 'morning', isDay: true, icon: 'fog', condition: 'Fog', temp: 9, label: 'fog' },
  { sky: 'drizzle', phase: 'noon', isDay: true, icon: 'drizzle', condition: 'Light drizzle', temp: 12, label: 'drizzle' },
  { sky: 'rain', phase: 'afternoon', isDay: true, icon: 'rain', condition: 'Rain', temp: 11, label: 'rain' },
  { sky: 'heavy-rain', phase: 'noon', isDay: true, icon: 'heavy-rain', condition: 'Heavy rain', temp: 10, label: 'heavy rain' },
  { sky: 'storm', phase: 'dusk', isDay: false, icon: 'thunder', condition: 'Thunderstorm', temp: 16, label: 'storm' },
  { sky: 'snow', phase: 'noon', isDay: true, icon: 'snow', condition: 'Snow', temp: -2, label: 'snow (no effect)' },
  { sky: 'clear', phase: 'night', isDay: false, icon: 'clear', condition: 'Clear sky', temp: 8, label: 'clear, night (no effect)' },
];

function payload(s: Scene, size: 'small' | 'medium'): WidgetData {
  const hours = ['3 PM', '4 PM', '5 PM', '6 PM'].map((label, i) => ({ time: `2026-11-10T${15 + i}:00`, label, icon: s.icon, isDay: s.isDay, temp: s.temp - i }));
  return {
    size,
    effects: true,
    place: 'London',
    temp: s.temp,
    unit: '°C',
    condition: s.condition,
    icon: s.icon,
    isDay: s.isDay,
    rainChance: s.sky.includes('rain') || s.sky === 'drizzle' || s.sky === 'storm' ? 80 : 10,
    hours: size === 'medium' ? hours : [],
    sky: s.sky,
    phase: s.phase,
    tint: widgetTint(blendedLook(s.sky, s.phase, s.phase, 0)),
  };
}

async function main() {
  const app = await launchApp(
    { lastPlace: london, settings: { widget: true, widgetSize: 'small', appearance: 'classic' } },
    { env: { NODE_OPTIONS: `--require ${support('fakeOs.cjs')} --require ${support('fakeDesktop.cjs')}` } },
  );
  try {
    await waitForDashboard(app.page);
    const ready = async () => app.evaluateMain<boolean>(`${MAIN} const w = W(); return Boolean(w && !w.webContents.isLoading() && await w.webContents.executeJavaScript("document.getElementById('backdrop').classList.contains('is-shown')"));`);
    for (const deadline = Date.now() + 20_000; !(await ready()); await new Promise((r) => setTimeout(r, 200))) {
      if (Date.now() > deadline) throw new Error('The widget did not show the wallpaper');
    }
    // A fixed seed and a fixed number of steps: the same picture every run.
    await app.evaluateMain(`${MAIN} await W().webContents.executeJavaScript('window.__widgetTest = { seed: 7, freezeAt: 45 }; true'); return true;`);

    const shot = async (p: WidgetData) => {
      // The main process re-sends the real weather each minute; send the staged payload right before each capture.
      return app.evaluateMain<string>(`${MAIN} const w = W();
        w.webContents.send('widget-data', ${JSON.stringify(p)});
        await new Promise((r) => setTimeout(r, 700)); // tint transition settles and the frozen effect frame draws
        await w.webContents.executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
        return (await w.webContents.capturePage()).toDataURL();`);
    };
    const save = async (file: string, dataUrl: string) => {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
      console.log(`${path.relative(root, file)}: ${Math.round(Buffer.from(dataUrl.split(',')[1]!, 'base64').length / 1024)} KB`);
    };

    // README: Small (partly cloudy) and Medium (rain).
    await save(path.join(root, 'docs', 'widget-small.png'), await shot(payload(SCENES[1]!, 'small')));
    await app.evaluateMain(`${MAIN} W().setSize(360, 170); return true;`);
    await new Promise((r) => setTimeout(r, 1500)); // the wallpaper is cut again for the new size
    await save(path.join(root, 'docs', 'widget-medium.png'), await shot(payload(SCENES[5]!, 'medium')));

    // Contact sheet: every scene, Medium.
    const cells: { label: string; src: string }[] = [];
    for (const s of SCENES) cells.push({ label: s.label, src: await shot(payload(s, 'medium')) });
    const html = `<html><body style="margin:0;background:#808080;font:13px Segoe UI,sans-serif;color:#111">
      <div style="display:grid;grid-template-columns:repeat(2,380px);gap:8px;padding:10px">
      ${cells.map((c) => `<figure style="margin:0"><img src="${c.src}" width="360" height="170"><figcaption>${c.label}</figcaption></figure>`).join('')}
      </div></body></html>`;
    const sheet = await app.evaluateMain<string>(`const { BrowserWindow } = process.mainModule.require('electron');
      const b = new BrowserWindow({ width: 790, height: 1080, show: false, webPreferences: { offscreen: true } });
      b.__backdrop = true;
      await b.loadURL('data:text/html,' + encodeURIComponent(${JSON.stringify(html)}));
      await new Promise((r) => setTimeout(r, 500));
      const img = await b.webContents.capturePage(); b.destroy(); return img.toDataURL();`);
    await save(path.join(root, 'docs', 'widget-2.0', 'effects.png'), sheet);
  } finally {
    await app.close();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});

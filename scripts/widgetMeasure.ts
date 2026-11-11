// v2.0: CPU and GPU cost of the desktop widget, 30 s per case (dev build, the made-up fixture wallpaper; Live captures
// the real screen). Cases: widget off, Wallpaper, Wallpaper + effects (staged heavy rain), Live, Live + effects.
// CPU: the sum of app.getAppMetrics() percentCPUUsage over every process of the app (one reading at the end of each
// 30 s, which covers the whole period). GPU: nvidia-smi utilization.gpu and power.draw, once a second.
// Run with: npm run build && npx tsx scripts/widgetMeasure.ts

import { execFile } from 'node:child_process';
import path from 'node:path';
import { launchApp, waitForDashboard } from './launch';
import { blendedLook } from '../src/shared/sky';
import { widgetTint } from '../src/shared/widgetLook';

const root = path.join(__dirname, '..');
const support = (f: string) => path.join(root, 'tests', 'e2e', 'support', f).replace(/\\/g, '/');
const london = { id: 2643743, name: 'London', latitude: 51.50853, longitude: -0.12574, admin1: 'England', country: 'United Kingdom', countryCode: 'GB', timezone: 'Europe/London' };
const SECONDS = 30;

const gpu = () =>
  new Promise<{ util: number; watts: number } | null>((resolve) =>
    execFile('nvidia-smi', ['--query-gpu=utilization.gpu,power.draw', '--format=csv,noheader,nounits'], { timeout: 3000, windowsHide: true }, (err, out) => {
      if (err) return resolve(null);
      const [u, w] = String(out).trim().split(',').map((v) => Number(v.trim()));
      resolve({ util: u!, watts: w! });
    }),
  );

const STAGED = {
  size: 'medium',
  effects: true,
  place: 'London',
  temp: 10,
  unit: '°C',
  condition: 'Heavy rain',
  icon: 'heavy-rain',
  isDay: true,
  rainChance: 90,
  hours: [15, 16, 17, 18].map((h, i) => ({ time: `2026-11-10T${h}:00`, label: `${h - 12} PM`, icon: 'heavy-rain', isDay: true, temp: 10 - i })),
  sky: 'heavy-rain',
  phase: 'noon',
  tint: widgetTint(blendedLook('heavy-rain', 'noon', 'noon', 0)),
};

async function main() {
  const app = await launchApp(
    { lastPlace: london, settings: { widget: false, widgetSize: 'medium', widgetOnTop: true, appearance: 'classic' } },
    { env: { NODE_OPTIONS: `--require ${support('fakeOs.cjs')} --require ${support('fakeDesktop.cjs')}` } },
  );
  const patch = (body: object) =>
    app.page.evaluate(`fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.status)`);
  const W = `const { BrowserWindow } = process.mainModule.require('electron'); const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('/widget.html'));`;
  try {
    await waitForDashboard(app.page);
    // The dashboard is minimized during the runs (the user does not look at it), as with the widget alone on the desktop.
    await app.evaluateMain(`${W} globalThis.__desk.capture.mode = 'real';
      for (const x of BrowserWindow.getAllWindows()) if (x !== w) { x.webContents.setBackgroundThrottling(true); x.minimize(); } return true;`);

    const cases: { name: string; settings: object; staged: boolean }[] = [
      { name: 'widget off', settings: { widget: false }, staged: false },
      { name: 'Wallpaper', settings: { widget: true, widgetBackground: 'wallpaper', widgetEffects: false }, staged: true },
      { name: 'Wallpaper + effects (heavy rain)', settings: { widget: true, widgetBackground: 'wallpaper', widgetEffects: true }, staged: true },
      { name: 'Live', settings: { widget: true, widgetBackground: 'live', widgetEffects: false }, staged: true },
      { name: 'Live + effects (heavy rain)', settings: { widget: true, widgetBackground: 'live', widgetEffects: true }, staged: true },
    ];
    for (const c of cases) {
      await patch(c.settings);
      await new Promise((r) => setTimeout(r, 4000)); // settle: page load, first frames
      await app.evaluateMain(`const { app: a } = process.mainModule.require('electron'); a.getAppMetrics(); return true;`); // start the CPU window
      const samples: { util: number; watts: number }[] = [];
      for (let i = 0; i < SECONDS; i++) {
        if (c.staged) {
          const effects = (c.settings as { widgetEffects?: boolean }).widgetEffects !== false;
          await app.evaluateMain(`${W} if (w) w.webContents.send('widget-data', ${JSON.stringify({ ...STAGED, effects })}); return true;`);
        }
        const g = await gpu();
        if (g) samples.push(g);
        await new Promise((r) => setTimeout(r, 1000));
      }
      const cpu = await app.evaluateMain<number>(`const { app: a } = process.mainModule.require('electron'); return a.getAppMetrics().reduce((s, m) => s + m.cpu.percentCPUUsage, 0);`);
      const mode = c.staged ? await app.evaluateMain<string>(`${W} return w ? await w.webContents.executeJavaScript("document.getElementById('effects').dataset.mode || 'off'") : '-';`) : '-';
      const avg = (k: 'util' | 'watts') => (samples.length ? samples.reduce((s, x) => s + x[k], 0) / samples.length : NaN);
      console.log(`${c.name.padEnd(34)} CPU ${cpu.toFixed(2)} %   GPU ${avg('util').toFixed(1)} %   ${avg('watts').toFixed(1)} W   effects: ${mode}`);
    }
  } finally {
    await app.close();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// v1.6 in the real window: glass (Windows' acrylic) where the PC allows it, otherwise the solid 1.5.1 look.
// - The material is checked from outside the page: the window's DWM backdrop type (38) via its handle.
// - Solid is forced for a test by NODE_OPTIONS=--require tests/e2e/support/fakeWindows10.cjs (os.release()
//   says Windows 10); the packaged exe ignores NODE_OPTIONS, so nothing that ships can be switched this way.
// - Contrast is computed from the real computed styles, every layer from the desktop up, under CLEAR_RULE
//   (src/shared/contrast.ts; no credit for Windows' own tint), like tests/glassContrast.test.ts does from the CSS.
// - The look on screen is captured with desktopCapturer over a controlled backdrop window (scripts/screen.ts).
// Run with: npm run test:e2e

import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchApp, waitForDashboard, type AppPage, type LaunchedApp } from '../../scripts/launch';
import { captureWindow, removeBackdrop, showBackdrop } from '../../scripts/screen';
import { parseColor, ROW_RULE, ROW_RULE_WASHED, ruleCheck, type ItemKind, type Layer, type Rgba } from '../../src/shared/contrast';
import { SKIES } from '../../src/shared/sky';
import { glassModel, WASH_MAX } from '../support/glassModel';
import { BACKDROP, systemBackdropType, transparencyEffectsOn } from './support/dwm';
import { decodePng, edgeShare } from './support/pixels';

const tokyo = { id: 1850147, name: 'Tokyo', latitude: 35.6895, longitude: 139.69171, admin1: 'Tokyo', country: 'Japan', countryCode: 'JP', timezone: 'Asia/Tokyo' };
const oslo = { id: 3143244, name: 'Oslo', latitude: 59.91273, longitude: 10.74609, admin1: 'Oslo', country: 'Norway', countryCode: 'NO', timezone: 'Europe/Oslo' };
const SEED = { lastPlace: tokyo, favorites: [tokyo], recent: [tokyo, oslo], settings: { units: 'metric' as const } };
const FAKE_WINDOWS_10 = path.join(__dirname, 'support', 'fakeWindows10.cjs').split(path.sep).join('/');
const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const SOLID_BODY = 'rgb(11, 18, 32)'; // --bg, 1.5.1
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// What the app should choose on this PC (the same rules as src/main/appearance.ts, read independently).
const build = Number(os.release().split('.')[2]);
const GLASS_HERE = process.platform === 'win32' && build >= 22621 && transparencyEffectsOn();

const MAIN_WIN = `const { BrowserWindow, nativeTheme } = process.mainModule.require('electron'); const win = BrowserWindow.getAllWindows().find((w) => !w.__backdrop);`;
const hwndOf = (app: LaunchedApp) => app.evaluateMain<string>(`${MAIN_WIN} return win.getNativeWindowHandle().readBigUInt64LE(0).toString();`);

/**
 * Computed layers behind an element, from the outer glass up, at each layer's least helpful point: a gradient that
 * fades to transparent counts as its faintest colour, so only solid fills and the dense part of a band get credit.
 * Ancestors' ::before backings (the sidebar sections' and the footer's panels) count. .layout's top fade is left
 * out (it only covers the top 20 px).
 */
const STACK = `(selector) => {
  const el = document.querySelector(selector);
  if (!el) return null;
  const colours = (s) => [...s.matchAll(/rgba?\\([^)]*\\)|#[0-9a-f]{3,8}\\b/gi)].map((m) => m[0]);
  const alpha = (c) => { const m = /rgba\\([^,]+,[^,]+,[^,]+,\\s*([\\d.]+)\\)/.exec(c); return m ? Number(m[1]) : (c === 'transparent' ? 0 : 1); };
  const own = (s) => {
    const out = [];
    const images = s.backgroundImage === 'none' ? [] : s.backgroundImage.split(/,(?![^(]*\\))(?=\\s*(?:radial|linear|conic|url))/);
    if (alpha(s.backgroundColor) > 0) out.push(s.backgroundColor);
    // background-image layers are drawn over background-color; the last image is the lowest. A light layer (a sheen)
    // counts at its peak, because it lowers the contrast of light text; a dark one at its faintest point, so a fade
    // gives no credit, except the title bar's band, whose contents sit in its dense part.
    const light = (c) => { const m = /rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)/.exec(c); return m && Number(m[1]) + Number(m[2]) + Number(m[3]) > 382; };
    for (const img of images.reverse()) {
      const cs = colours(img).filter((c) => alpha(c) > 0 || !light(c));
      if (!cs.length) continue;
      if (cs.some(light)) out.push(cs.filter(light).sort((a, b) => alpha(b) - alpha(a))[0]);
      else if (s === band) out.push(cs.sort((a, b) => alpha(b) - alpha(a))[0]);
      else if (cs.every((c) => alpha(c) > 0)) out.push(cs.sort((a, b) => alpha(a) - alpha(b))[0]);
    }
    return out;
  };
  const band = getComputedStyle(document.querySelector('.titlebar'));
  const layers = [];
  for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
    if (n.classList.contains('layout')) continue;
    const s = n.matches('.titlebar') ? band : getComputedStyle(n);
    const f = /saturate\\(([\\d.]+)\\)/.exec(s.backdropFilter);
    layers.unshift({ saturate: f ? Number(f[1]) : null, own: own(s) });
    const before = getComputedStyle(n, '::before');
    // Only a ::before that covers the whole element is a backing (not, say, an active card's 3 px accent bar).
    const covers = ['top', 'right', 'bottom', 'left'].every((k) => parseFloat(before[k]) <= 0);
    if (before.content !== 'none' && before.position === 'absolute' && covers) {
      const bf = /saturate\\(([\\d.]+)\\)/.exec(before.backdropFilter);
      layers.unshift({ saturate: bf ? Number(bf[1]) : null, own: own(before) });
    }
  }
  const b = getComputedStyle(document.body);
  return {
    color: getComputedStyle(el).color,
    tint: b.getPropertyValue('--sky-tint').trim(), alpha: Number(b.getPropertyValue('--sky-alpha')), glow: b.getPropertyValue('--sky-glow').trim(),
    strength: Number(b.getPropertyValue('--wash-strength')),
    layers,
  };
}`;
type Stack = { color: string; tint: string; alpha: number; glow: string; strength: number; layers: { saturate: number | null; own: string[] }[] };

function layersOf(s: Stack, withTint: boolean): Layer[] {
  // As drawn by the .backdrop rule: the state's alphas times --wash-strength, at most WASH_MAX.
  const glow = parseColor(s.glow);
  const drawnGlow: Rgba = { ...glow, a: Math.min(WASH_MAX, glow.a * s.strength) };
  const layers: Layer[] = withTint ? [{ ...parseColor(s.tint), a: Math.min(WASH_MAX, s.alpha * s.strength) } as Rgba, drawnGlow, drawnGlow] : [];
  for (const l of s.layers) {
    if (l.saturate) layers.push({ saturate: l.saturate });
    layers.push(...l.own);
  }
  return layers;
}

/** The tightest CLEAR_RULE check of an element's own colour: with no outer wash and under the shown state's wash. */
async function ruleOf(page: AppPage, selector: string, kind: ItemKind, rule?: typeof ROW_RULE, ruleWashed = rule): Promise<{ ratio: number; need: number; backdrop: string; color: string } | null> {
  const s = await page.evaluate<Stack | null>(`(${STACK})(${JSON.stringify(selector)})`);
  if (!s) return null;
  let worst = { ratio: Infinity, need: 0, margin: Infinity, backdrop: '', color: s.color };
  for (const withTint of [false, true]) {
    const w = ruleCheck(s.color, layersOf(s, withTint), kind, withTint ? ruleWashed : rule);
    if (w.margin < worst.margin) worst = { ...w, backdrop: `${w.backdrop} (${withTint ? 'wash' : 'no wash'})`, color: s.color };
  }
  return worst;
}

const STATES = SKIES.flatMap((s) => [`${s}-day`, `${s}-night`]);
const MODEL = glassModel(
  readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'styles.css'), 'utf8'),
  readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'charts.ts'), 'utf8'),
);
/** Show a state at once (no 600 ms fade), as render() would for that weather. */
const showState = (page: AppPage, state: string) =>
  page.evaluate(`(() => { const b = document.querySelector('.backdrop'); b.style.transition = 'none'; document.body.dataset.sky = '${state}'; void getComputedStyle(b).backgroundColor; b.style.transition = ''; })()`);

/** Mean colour of a region of a capture. */
function mean(png: Buffer, x0: number, y0: number, w: number, h: number): [number, number, number] {
  const img = decodePng(png);
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = y0; y < y0 + h; y += 2) {
    for (let x = x0; x < x0 + w; x += 2) {
      const p = img.at(x, y);
      sum[0] += p[0];
      sum[1] += p[1];
      sum[2] += p[2];
      n++;
    }
  }
  return sum.map((v) => v / n) as [number, number, number];
}
/** sRGB -> CIE Lab (D65). */
function lab(c: number[]): [number, number, number] {
  const [r, g, bl] = c.map((v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
/** CIE76 colour difference. */
function deltaE(a: number[], b: number[]): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

describe.runIf(GLASS_HERE)('glass on this PC (Windows 11 22H2+, "Transparency effects" on)', () => {
  let app: LaunchedApp;
  let page: AppPage;

  beforeAll(async () => {
    app = await launchApp(SEED);
    page = app.page;
    await waitForDashboard(page);
    await app.resize(1360, 900);
  });
  afterAll(async () => {
    await removeBackdrop(app).catch(() => {});
    await app?.close();
  });

  it('the window is created with the acrylic material (checked from outside the page) and a see-through window colour', async () => {
    expect(systemBackdropType(await hwndOf(app))).toBe(BACKDROP.acrylic);
    expect(await app.evaluateMain<string>(`${MAIN_WIN} return win.getBackgroundColor();`)).toBe('#000000'); // #00000000: Electron drops the alpha here
    expect(await page.evaluate<string>(`document.documentElement.dataset.material`)).toBe('glass');
  });

  it('the page only receives glass or solid: window.appearance is receive-only, window.updates is unchanged', async () => {
    expect(await page.evaluate<string[]>(`Object.keys(window.appearance).sort()`)).toEqual(['current', 'onChange']);
    expect(await page.evaluate<string>(`window.appearance.current()`)).toBe('glass');
    expect(await page.evaluate<string[]>(`Object.keys(window.updates).sort()`)).toEqual(['checkNow', 'onReady', 'onState', 'restart']);
  });

  it('the page background is transparent where the glass shows; the weather sets the outer tint (colour and alpha per state)', async () => {
    const bg = await page.evaluate<{ html: string; body: string; rect: number[]; sky: string }>(`(() => {
      const b = document.querySelector('.backdrop'); const r = b.getBoundingClientRect();
      return { html: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor,
        rect: [r.x, r.y, r.width, r.height], sky: document.body.dataset.sky };
    })()`);
    expect(bg.html).toBe(TRANSPARENT);
    expect(bg.body).toBe(TRANSPARENT);
    expect(bg.rect).toEqual([0, 0, 1360, 900]);
    expect(STATES).toContain(bg.sky); // render() set it from the shown city's weather
    for (const state of STATES) {
      await showState(page, state);
      const got = parseColor(await page.evaluate<string>(`getComputedStyle(document.querySelector('.backdrop')).backgroundColor`));
      const want = MODEL.states[state]!;
      expect([got.r, got.g, got.b].map(Math.round), state).toEqual([want.tint.r, want.tint.g, want.tint.b]);
      expect(got.a, state).toBeCloseTo(want.alpha, 3);
    }
    expect(app.errors).toEqual([]);
  });

  it('boxes are translucent dark glass, the same in every weather: fill, blur and saturation, light edge, inner glow; no backing panels', async () => {
    await app.evaluateMain(`${MAIN_WIN} win.webContents.send('update-ready', '9.9.9');`);
    await page.waitFor(`!document.getElementById('update-note').hidden`, 5000);
    type Look = { filter: string; bg: string; image: string; border: string; shadow: string; inset?: string };
    const read = () =>
      page.evaluate<Record<string, Look | null>>(`(() => {
        const out = {};
        const boxes = { hero: ['#hero'], rain: ['#rain-chart', '.card'], temperature: ['#temp-chart', '.card'], forecast: ['#forecast', '.card'],
          consent: ['#location-consent'], note: ['#update-note'], settings: ['.settings-sheet'] };
        for (const [name, [q, how]] of Object.entries(boxes)) {
          let el = document.querySelector(q);
          if (el && how === '.card') el = el.closest('.card');
          if (!el) { out[name] = null; continue; }
          const c = how === '::before' ? getComputedStyle(el, '::before') : getComputedStyle(el);
          out[name] = { filter: c.backdropFilter, bg: c.backgroundColor, image: c.backgroundImage, border: c.borderTopColor, shadow: c.boxShadow, inset: c.inset };
        }
        return out;
      })()`);
    const first = await read();
    for (const [name, l] of Object.entries(first)) {
      expect(l, name).not.toBeNull();
      // The Settings sheet is a dark scrim; the dashboard behind it is blurred by a filter on the dashboard (see the Settings tests).
      expect(l!.filter, name).toBe(name === 'settings' ? 'none' : 'blur(30px) saturate(1.7)');
      expect(l!.bg, name).toBe(name === 'settings' ? 'rgba(13, 17, 27, 0.55)' : 'rgba(13, 17, 27, 0.65)'); // translucent smoke: the desktop shows through
      expect(l!.image, name).toBe('none'); // a flat fill: no gradient (a gradient is dithered on screen: the grain 1.6.1 removed)
      expect(l!.shadow, name).toMatch(/inset/); // edge highlight and glow
      if (name !== 'settings') expect(l!.border, name).toBe('rgba(255, 255, 255, 0.16)');
    }
    // No backing panels: the title bar, the sidebar sections and the footer show the bare glass; their text has a shadow.
    const bare = await page.evaluate<Record<string, { bg: string; image: string; before: string }>>(`(() => {
      const out = {};
      for (const q of ['.titlebar', '.sidebar section:has(#favorites)', '.footer']) {
        const el = document.querySelector(q); const c = getComputedStyle(el);
        out[q] = { bg: c.backgroundColor, image: c.backgroundImage, before: getComputedStyle(el, '::before').content };
      }
      return out;
    })()`);
    for (const [q, v] of Object.entries(bare)) {
      expect(v.bg, q).toBe(TRANSPARENT);
      expect(v.image, q).toBe('none');
      expect(v.before, q).toBe('none');
    }
    const shadows = await page.evaluate<string[]>(
      `['.brand', '.sidebar .section-title', '#recent-empty', '.footer'].map((q) => getComputedStyle(document.querySelector(q)).textShadow)`,
    );
    for (const sh of shadows) expect(sh).toContain('rgba(0, 0, 0, 0.65)');
    // The same boxes in every weather state: only the outer tint changes.
    for (const state of STATES) {
      await showState(page, state);
      expect(await read(), state).toEqual(first);
    }
    await page.evaluate(`document.querySelector('#update-note .icon-button').click()`);
    expect(app.errors).toEqual([]);
  });

  it('the sidebar lists are plain rows, as in the classic look: no box, border, shadow or blur at rest; a tint on hover, a tint and the accent bar when selected', async () => {
    const look = (q: string) =>
      page.evaluate<{ bg: string; image: string; border: string; shadow: string; filter: string; shadowText: string; bar: string }>(`(() => {
        const el = document.querySelector(${JSON.stringify(q)}); const c = getComputedStyle(el);
        return { bg: c.backgroundColor, image: c.backgroundImage, border: c.borderTopWidth, shadow: c.boxShadow, filter: c.backdropFilter,
          shadowText: getComputedStyle(el.querySelector('.fav-name')).textShadow, bar: getComputedStyle(el, '::before').content };
      })()`);
    const rest = await look('#recent .place-card:not(.is-active)');
    expect(rest).toMatchObject({ bg: TRANSPARENT, image: 'none', border: '0px', shadow: 'none', filter: 'none', bar: 'none' });
    expect(rest.shadowText).toContain('rgba(0, 0, 0, 0.65)');
    const active = await look('.place-card.is-active');
    expect(active.bar).not.toBe('none');
    expect(active.image).toBe('none');
    expect(active.shadow).toBe('none');
    expect(active.filter).toBe('none');
    expect(active.bg).not.toBe(TRANSPARENT); // the clearer tint
    // Hover: the same faint tint as the classic look.
    const [hx, hy] = await page.evaluate<[number, number]>(`(() => { const r = document.querySelector('#recent .place-card:not(.is-active)').getBoundingClientRect(); return [r.x + 40, r.y + r.height / 2]; })()`);
    await page.move(hx, hy);
    await new Promise((r) => setTimeout(r, 300));
    const hover = await look('#recent .place-card:not(.is-active)');
    expect(hover.bg).toMatch(/^rgba\(255, 255, 255, 0\.08[56]\)$/); // --card-hover (0.085, as 8-bit alpha)
    expect(hover).toMatchObject({ image: 'none', shadow: 'none', filter: 'none' });
    await page.move(5, 700);
    expect(app.errors).toEqual([]);
  });

  it('text and graphics on the boxes in the real window meet CLEAR_RULE (primary 4.5 over grey and dark, 3 over white; secondary and graphics 3 over grey and dark), with and without the wash', async () => {
    const checks: [string, ItemKind][] = [
      ['#search-input', 'primary'],
      ['.place-name', 'primary'],
      ['.clock-tz', 'secondary'],
      ['.stat-label', 'secondary'],
      ['.stat-sub', 'secondary'],
      ['.legend', 'secondary'],
      ['.hour-time', 'secondary'],
      ['.day:not(.is-today) .day-date', 'secondary'],
      ['.day[aria-checked="true"] .day-name', 'primary'],
      ['.day-rain', 'secondary'],
      ['.location-consent-text', 'primary'],
      ['.star', 'graphic'],
      ['.wind-arrow', 'graphic'],
    ];
    const states = ['clear-day', 'clear-night', 'fog-day', 'rain-day', 'storm-night', 'snow-day', 'heavy-rain-night'];
    for (const state of states) {
      await showState(page, state);
      for (const [sel, kind] of checks) {
        const w = await ruleOf(page, sel, kind);
        expect(w, sel).not.toBeNull();
        expect(w!.ratio, `${state}: ${sel} (${kind}, ${w!.color}) over ${w!.backdrop}`).toBeGreaterThanOrEqual(w!.need);
      }
    }
    // The sidebar's rows sit on the bare glass: ROW_RULE (names and numbers 4.5 over dark, 3 over grey at rest with no wash; secondary 3 over dark).
    for (const state of states) {
      await showState(page, state);
      for (const [sel, kind] of [['#favorites .fav-name', 'primary'], ['#favorites .fav-sub', 'secondary'], ['#recent .place-card:not(.is-active) .fav-sub', 'secondary'], ['.place-card.is-active .fav-name', 'primary']] as [string, ItemKind][]) {
        const w = await ruleOf(page, sel, kind, ROW_RULE, ROW_RULE_WASHED);
        expect(w, sel).not.toBeNull();
        expect(w!.ratio, `${state}: ${sel} (${kind}, ${w!.color}) over ${w!.backdrop}`).toBeGreaterThanOrEqual(w!.need);
      }
    }
    // The chart's own colours on its card (canvas pixels are not elements): the temperature card's layers.
    for (const state of states) {
      await showState(page, state);
      const s = await page.evaluate<Stack>(`(${STACK})('#temp-chart')`);
      const items: [string, string, ItemKind][] = [
        ['temperature line', '#FFB547', 'graphic'],
        ['feels-like line', '#C4B5FD', 'graphic'],
        ['rain bar', '#5AB0FF', 'graphic'],
        ['dot', '#ffb547', 'graphic'],
        ['purple', '#a78bfa', 'graphic'],
        ['axis labels', 'rgba(226, 232, 240, 0.65)', 'secondary'],
      ];
      for (const [name, color, kind] of items) {
        for (const withTint of [false, true]) {
          const w = ruleCheck(color, layersOf(s, withTint), kind);
          expect(w.ratio, `${state} ${name} over ${w.backdrop}`).toBeGreaterThanOrEqual(w.need);
        }
      }
    }
    expect(app.errors).toEqual([]);
  });

  it('on screen the outer glass shows the weather wash without covering what is behind, and the boxes keep their lightness (over a neutral grey backdrop)', async () => {
    await showBackdrop(app, 'grey');
    const outer = (shot: Buffer) => mean(shot, 255, 150, 12, 550); // between the sidebar (right edge 252 px) and the cards (270 px)
    const boxAt = (shot: Buffer) => mean(shot, 330, 455, 430, 20); // an empty strip inside the rain card
    // No wash at all: the bare acrylic over grey.
    await sleep(1500); // let the backdrop window settle and the app come to the front
    await page.evaluate(`document.querySelector('.backdrop').style.visibility = 'hidden'`);
    await sleep(600);
    const bare = outer(await captureWindow(app));
    await page.evaluate(`document.querySelector('.backdrop').style.visibility = ''`);
    const wash: Record<string, number> = {};
    const box: Record<string, [number, number, number]> = {};
    for (const state of STATES) {
      await showState(page, state);
      await sleep(400);
      const shot = await captureWindow(app);
      wash[state] = deltaE(outer(shot), bare);
      box[state] = boxAt(shot);
    }
    await removeBackdrop(app);
    // A visible wash (--wash-strength 3), but still a shift of what is behind the window, not a cover. Measured up to
    // 28.4 at strength 2 and 39.9 at 3 (heavy-rain-day) with this PC's HDR on, which lifts mid-greys in captures.
    for (const [state, d] of Object.entries(wash)) expect(d, `${state} ${JSON.stringify(wash)}`).toBeLessThanOrEqual(45);
    expect(wash['clear-day']!).toBeLessThan(wash['storm-night']!);
    // The boxes have the same fill in every weather, but they are see-through: about a third of what is behind them shows,
    // the wash included (and their backdrop blur draws it once more). Measured 10.9 L at --wash-strength 1, 18.6 L at 2, 19.2 L at 3
    // (fog-day vs heavy-rain-night; HDR on). Their computed styles are identical in every state (the boxes test above).
    const L = Object.values(box).map((c) => lab(c)[0]);
    expect(Math.max(...L) - Math.min(...L), JSON.stringify(box)).toBeLessThanOrEqual(22);
    expect(app.errors).toEqual([]);
  });

  /** Open or close Settings with the gear / its close button, and wait for the panel's transitions to end. */
  const settingsOpen = async (open: boolean) => {
    await page.evaluate(`document.querySelector(${JSON.stringify(open ? '#settings-button' : '.settings-close')}).click()`);
    await page.waitFor(open ? `document.getElementById('settings').classList.contains('is-open')` : `document.getElementById('settings').hidden`, 5000);
    await sleep(700); // slide 320 ms, the dashboard's blur 220 ms
  };

  it('Settings open: the dashboard behind it gets a 40 px blur with saturation, the sheet is a dark scrim, the app name, search box and gear are hidden (not removed); all back on close', async () => {
    await app.resize(1360, 900);
    type Look = { layout: string; note: string; sheet: string; sheetFilter: string; brand: string; search: string; gear: string; rects: number[][]; regions: string[] };
    const look = () =>
      page.evaluate<Look>(`(() => {
        const c = (q) => getComputedStyle(document.querySelector(q));
        const rect = (q) => { const r = document.querySelector(q).getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
        return {
          layout: c('.layout').filter, note: c('#update-note').filter, sheet: c('.settings-sheet').backgroundColor, sheetFilter: c('.settings-sheet').backdropFilter,
          brand: c('.titlebar .brand').visibility, search: c('.titlebar .search').visibility, gear: c('#settings-button').visibility,
          rects: ['.titlebar .brand', '.titlebar .search', '#settings-button'].map(rect),
          regions: ['.titlebar', '#settings-button', '.settings-header'].map((q) => c(q).getPropertyValue('-webkit-app-region')),
        };
      })()`);
    const closed = await look();
    expect(closed).toMatchObject({ layout: 'none', note: 'none', brand: 'visible', search: 'visible', gear: 'visible' });
    await settingsOpen(true);
    const open = await look();
    expect(open.layout).toBe('blur(40px) saturate(1.8)');
    expect(open.note).toBe('blur(40px) saturate(1.8)');
    expect(open.sheetFilter).toBe('none'); // a backdrop-filter over the transparent page left the dashboard sharp
    const scrim = parseColor(open.sheet);
    expect([scrim.r, scrim.g, scrim.b]).toEqual([13, 17, 27]);
    expect(scrim.a).toBeGreaterThanOrEqual(0.4);
    expect(scrim.a).toBeLessThanOrEqual(0.55);
    expect(open.brand).toBe('hidden');
    expect(open.search).toBe('hidden');
    expect(open.gear).toBe('hidden'); // it sits under the panel's close button
    // Hidden, not removed: same places, gear and drag areas unchanged; the elements are still in the page.
    expect(open.rects).toEqual(closed.rects);
    expect(open.regions).toEqual(['drag', 'no-drag', 'drag']);
    expect(await page.evaluate<boolean>(`!!document.querySelector('.titlebar .brand') && !!document.getElementById('search-input')`)).toBe(true);
    await settingsOpen(false);
    expect(await look()).toEqual(closed);
    expect(await page.evaluate<string>(`document.activeElement.id`)).toBe('settings-button'); // focus back on the gear
    expect(app.errors).toEqual([]);
  });

  it('on screen, no dashboard text is sharp behind the open Settings panel (edge share over a grey backdrop, closed vs open)', async () => {
    await app.resize(1360, 900);
    await showBackdrop(app, 'grey');
    await sleep(1500);
    // Behind the panel but beside its rows (720 px wide, centred): the sidebar, and the temperature card's right part.
    const regions = [
      [16, 280, 280, 360],
      [1060, 300, 270, 340],
    ];
    const edges = (png: Buffer) => {
      const img = decodePng(png);
      const k = img.width / 1360;
      return regions.map(([x, y, w, h]) => edgeShare(img, Math.round(x! * k), Math.round(y! * k), Math.round(w! * k), Math.round(h! * k)));
    };
    const closed = edges(await captureWindow(app));
    await settingsOpen(true);
    const open = edges(await captureWindow(app));
    await settingsOpen(false);
    await removeBackdrop(app);
    for (const [i, c] of closed.entries()) {
      expect(c, `region ${i} closed: text there`).toBeGreaterThan(0.01);
      expect(open[i]!, `region ${i} open (closed ${c.toFixed(4)})`).toBeLessThan(0.001);
    }
    expect(app.errors).toEqual([]);
  });

  it('resize 480 to 1400, maximize and restore keep the material; the drag regions are unchanged', async () => {
    const hwnd = await hwndOf(app);
    for (const w of [480, 600, 960, 1240, 1400]) {
      await app.resize(w, 800);
      expect(await page.evaluate<number>(`innerWidth`)).toBe(w);
      const overlap = await page.evaluate<number>(`(() => {
        const r = [...document.querySelectorAll('.card, .sidebar > section')].map((e) => e.getBoundingClientRect()).filter((b) => b.width && b.height);
        let n = 0; for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++)
          if (Math.min(r[i].bottom, r[j].bottom) - Math.max(r[i].top, r[j].top) > 1 && Math.min(r[i].right, r[j].right) - Math.max(r[i].left, r[j].left) > 1) n++;
        return n + (document.querySelector('.layout').scrollWidth > document.querySelector('.layout').clientWidth ? 100 : 0);
      })()`);
      expect(overlap, `${w}px`).toBe(0);
    }
    await app.resize(1100, 760);
    const before = await app.evaluateMain<object>(`${MAIN_WIN} return win.getBounds();`);
    await app.evaluateMain(`${MAIN_WIN} win.maximize();`);
    await sleep(600);
    expect(await app.evaluateMain<boolean>(`${MAIN_WIN} return win.isMaximized();`)).toBe(true);
    expect(systemBackdropType(hwnd)).toBe(BACKDROP.acrylic);
    await app.evaluateMain(`${MAIN_WIN} win.unmaximize();`);
    await sleep(600);
    expect(await app.evaluateMain<object>(`${MAIN_WIN} return win.getBounds();`)).toEqual(before);
    expect(systemBackdropType(hwnd)).toBe(BACKDROP.acrylic);
    const regions = await page.evaluate<Record<string, string>>(`(() => {
      const r = (s) => getComputedStyle(document.querySelector(s)).getPropertyValue('-webkit-app-region');
      return { titlebar: r('.titlebar'), search: r('.search'), gear: r('#settings-button'), settingsHeader: r('.settings-header') };
    })()`);
    expect(regions).toEqual({ titlebar: 'drag', search: 'no-drag', gear: 'no-drag', settingsHeader: 'drag' });
    expect(app.errors).toEqual([]);
  });

  it('a change from the main process switches the page live; anything but "glass" or "solid" is ignored', async () => {
    const mode = () => page.evaluate<string>(`document.documentElement.dataset.material`);
    const body = () => page.evaluate<string>(`getComputedStyle(document.body).backgroundColor`);
    await app.evaluateMain(`${MAIN_WIN} win.webContents.send('appearance', 'solid');`);
    await page.waitFor(`document.documentElement.dataset.material === 'solid'`, 3000);
    expect(await body()).toBe(SOLID_BODY);
    for (const bad of ["'mica'", '42', '{}', "'glass '"]) await app.evaluateMain(`${MAIN_WIN} win.webContents.send('appearance', ${bad});`);
    await sleep(300);
    expect(await mode()).toBe('solid');
    await app.evaluateMain(`${MAIN_WIN} win.webContents.send('appearance', 'glass');`);
    await page.waitFor(`document.documentElement.dataset.material === 'glass'`, 3000);
    expect(await body()).toBe(TRANSPARENT);
    expect(app.errors).toEqual([]);
  });

  it('forced colours and reduced transparency (emulated) switch the page to the solid look', async () => {
    const look = () =>
      page.evaluate<{ body: string; card: string; filter: string }>(`(() => {
        const c = getComputedStyle(document.querySelector('#hero'));
        return { body: getComputedStyle(document.body).backgroundColor, card: c.backgroundColor, filter: c.backdropFilter };
      })()`);
    const emulations: Record<string, string>[] = [{ 'prefers-reduced-transparency': 'reduce' }, { 'forced-colors': 'active' }];
    for (const features of emulations) {
      await page.emulateMedia(features);
      await sleep(200);
      const l = await look();
      if ('forced-colors' in features) {
        expect(l.body, JSON.stringify(features)).not.toBe(TRANSPARENT); // the system's colours, opaque
      } else {
        expect(l).toEqual({ body: SOLID_BODY, card: 'rgba(255, 255, 255, 0.055)', filter: 'blur(30px) saturate(1.4)' });
      }
      await page.emulateMedia({});
      await sleep(200);
      expect((await look()).body).toBe(TRANSPARENT);
    }
    expect(app.errors).toEqual([]);
  });
});

describe('solid fallback (Windows 10, faked for the test)', () => {
  let app: LaunchedApp;
  let page: AppPage;

  beforeAll(async () => {
    app = await launchApp(SEED, { env: { NODE_OPTIONS: `--require ${FAKE_WINDOWS_10}` } });
    page = app.page;
    await waitForDashboard(page);
  });
  afterAll(async () => {
    await app?.close();
  });

  it('the window gets no material and the 1.5.1 window colour; the page is solid', async () => {
    expect(await app.evaluateMain<string>(`return process.mainModule.require('node:os').release();`)).toBe('10.0.19045');
    if (process.platform === 'win32') expect(systemBackdropType(await hwndOf(app))).not.toBe(BACKDROP.acrylic);
    expect(await app.evaluateMain<string>(`${MAIN_WIN} return win.getBackgroundColor();`)).toBe('#0E1729');
    expect(await page.evaluate<string>(`document.documentElement.dataset.material`)).toBe('solid');
    expect(await page.evaluate<string>(`window.appearance.current()`)).toBe('solid');
  });

  it("looks exactly like 1.5.1: today's background, cards, text colours and tokens", async () => {
    const look = await page.evaluate<Record<string, string>>(`(() => {
      const c = getComputedStyle(document.querySelector('#hero'));
      const r = getComputedStyle(document.documentElement);
      return { html: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor,
        backdrop: getComputedStyle(document.querySelector('.backdrop')).backgroundImage.includes('linear-gradient(160deg') + '',
        card: c.backgroundColor, filter: c.backdropFilter, border: c.borderTopColor,
        muted: getComputedStyle(document.getElementById('recent-empty')).color, link: getComputedStyle(document.querySelector('.footer a')).color,
        tint: r.getPropertyValue('--glass-tint-alpha').trim() };
    })()`);
    expect(look).toEqual({
      html: TRANSPARENT,
      body: SOLID_BODY,
      backdrop: 'true',
      card: 'rgba(255, 255, 255, 0.055)',
      filter: 'blur(30px) saturate(1.4)',
      border: 'rgba(255, 255, 255, 0.09)',
      muted: 'rgba(226, 232, 240, 0.62)',
      link: 'rgb(96, 165, 250)',
      tint: '',
    });
    expect(app.errors).toEqual([]);
  });
});

describe('nothing on the command line changes the decision', () => {
  it('a --wd-appearance switch given to the app does not reach the page', async () => {
    const app = await launchApp(SEED, { args: [`--wd-appearance=${GLASS_HERE ? 'solid' : 'glass'}`] });
    try {
      await waitForDashboard(app.page);
      expect(await app.page.evaluate<string>(`document.documentElement.dataset.material`)).toBe(GLASS_HERE ? 'glass' : 'solid');
    } finally {
      await app.close();
    }
  });
});

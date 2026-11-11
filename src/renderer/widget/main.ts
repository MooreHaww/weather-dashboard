// The desktop widget's page (v2.0). It only displays what the main process pushes through the receive-only preload
// (window.widget): the weather, the blurred background's pixels and whether the window is shown. It sends nothing.

import { weatherIcon } from '../icons';
import type { WidgetData, WidgetPayload } from '../../shared/widget';
import { createScene, effectsFor, frameDue, hasEffect, loopMode, type Box } from './effects';

interface WidgetBridge {
  onData(cb: (data: unknown) => void): void;
  onBackdrop(cb: (frame: unknown) => void): void;
  onVisible(cb: (visible: boolean) => void): void;
}

declare global {
  interface Window {
    widget?: WidgetBridge;
    /** Tests: the effects' seed and a frozen clock for the contact sheet. */
    __widgetTest?: { seed?: number; freezeAt?: number };
  }
}

const card = document.getElementById('card') as HTMLElement;
const content = document.getElementById('content') as HTMLElement;
const tint = document.getElementById('tint') as HTMLElement;
const backdrop = document.getElementById('backdrop') as HTMLCanvasElement;
const effects = document.getElementById('effects') as HTMLCanvasElement;

let data: WidgetPayload | null = null;
let windowVisible = true;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

const el = (tag: string, cls: string, text?: string) => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function isPayload(v: unknown): v is WidgetPayload {
  const o = v as Record<string, unknown>;
  return (o.size === 'small' || o.size === 'medium') && typeof o.tint === 'string' && typeof o.effects === 'boolean' && (o.place === null || typeof o.place === 'string');
}

function renderData(d: WidgetPayload): void {
  card.dataset.size = d.size;
  tint.style.backgroundColor = d.tint;
  content.replaceChildren();
  if (d.place === null) {
    content.append(el('p', 'empty', 'Weather Dashboard'));
    return;
  }
  const w = d as WidgetData;
  const now = el('section', 'now');
  const top = el('div', 'now-top');
  top.insertAdjacentHTML('beforeend', weatherIcon(w.icon, w.isDay));
  const temp = el('div', 'temp', String(w.temp));
  temp.append(el('span', 'unit', w.unit));
  temp.setAttribute('aria-label', `${w.temp}${w.unit}`);
  top.append(temp);
  const box = el('div', 'place-box');
  box.append(el('div', 'place', w.place), el('div', 'condition', w.condition));
  now.append(top, box);
  content.append(now);
  if (d.size === 'medium') {
    const later = el('section', 'later');
    const hours = el('div', 'hours');
    for (const h of w.hours) {
      const item = el('div', 'hour');
      item.append(el('span', 'hour-time', h.label));
      item.insertAdjacentHTML('beforeend', weatherIcon(h.icon, h.isDay));
      item.append(el('span', 'hour-temp', `${h.temp}°`));
      hours.append(item);
    }
    later.append(hours);
    if (w.rainChance !== null) later.append(el('div', 'rain', `Rain chance ${w.rainChance}%`));
    content.append(later);
  }
}

// ---- the blurred background ----
function showBackdrop(frame: unknown): void {
  const f = frame as { width?: unknown; height?: unknown; data?: unknown } | null;
  const ok =
    f !== null &&
    typeof f === 'object' &&
    typeof f.width === 'number' &&
    typeof f.height === 'number' &&
    f.width > 0 &&
    f.height > 0 &&
    (f.data instanceof Uint8ClampedArray || f.data instanceof Uint8Array) &&
    f.data.length === f.width * f.height * 4;
  if (!ok) {
    backdrop.classList.remove('is-shown'); // the plain tinted card
    return;
  }
  try {
    backdrop.width = f.width as number;
    backdrop.height = f.height as number;
    const ctx = backdrop.getContext('2d');
    if (!ctx) throw new Error('no context');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(f.data as Uint8Array), f.width as number, f.height as number), 0, 0);
    backdrop.classList.add('is-shown');
  } catch {
    backdrop.classList.remove('is-shown');
  }
}

// ---- weather effects ----
let scene: ReturnType<typeof createScene> | null = null;
let raf = 0;
let last = 0;
let sceneKey = '';

function boxes(): Box[] {
  const base = card.getBoundingClientRect();
  return [...card.querySelectorAll<HTMLElement>('.place-box, .hour')].map((b) => {
    const r = b.getBoundingClientRect();
    return { x: r.left - base.left, y: r.top - base.top, width: r.width, height: r.height };
  });
}

function stopLoop(): void {
  cancelAnimationFrame(raf);
  raf = 0;
}

function frame(t: number): void {
  raf = 0;
  if (!scene) return;
  if (frameDue(last, t)) {
    scene.step(last ? t - last : 0);
    last = t;
    const ctx = effects.getContext('2d');
    if (ctx) scene.draw(ctx);
  }
  raf = requestAnimationFrame(frame);
}

function updateEffects(): void {
  const d = data;
  const plan = d && d.place !== null ? effectsFor((d as WidgetData).sky, (d as WidgetData).isDay, d.size) : null;
  const mode = loopMode({
    enabled: Boolean(d?.effects && plan && hasEffect(plan)),
    pageVisible: document.visibilityState === 'visible',
    windowVisible,
    reducedMotion: reduced.matches,
  });
  stopLoop();
  const ctx = effects.getContext('2d');
  if (mode === 'off' || !plan || !d) {
    scene = null;
    sceneKey = '';
    ctx?.clearRect(0, 0, effects.width, effects.height);
    effects.dataset.mode = 'off';
    return;
  }
  const w = card.clientWidth;
  const h = card.clientHeight;
  const key = JSON.stringify([plan, d.size, w, h, content.childElementCount]);
  if (!scene || key !== sceneKey) {
    effects.width = w;
    effects.height = h;
    scene = createScene({ width: w, height: h, size: d.size, plan, boxes: boxes(), seed: window.__widgetTest?.seed ?? 20_026 });
    sceneKey = key;
    // Start a little way in, so a still frame shows drops already falling and resting.
    for (let i = 0; i < 60; i++) scene.step(1000 / 30);
  }
  effects.dataset.mode = mode;
  if (mode === 'still' || window.__widgetTest?.freezeAt !== undefined) {
    for (let i = 0; i < (window.__widgetTest?.freezeAt ?? 0); i++) scene.step(1000 / 30);
    if (ctx) scene.draw(ctx);
    return;
  }
  last = 0;
  raf = requestAnimationFrame(frame);
}

document.addEventListener('visibilitychange', updateEffects);
reduced.addEventListener('change', updateEffects);

window.widget?.onData((value) => {
  if (!isPayload(value)) return;
  data = value;
  renderData(value);
  updateEffects();
});
window.widget?.onBackdrop(showBackdrop);
window.widget?.onVisible((v) => {
  windowVisible = v;
  updateEffects();
});

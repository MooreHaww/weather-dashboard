// Weather effects behind the widget's text (v2.0): soft clouds, falling rain that splashes at the bottom and gathers in
// drops on the boxes' top edges, and a sun glow. Decorative only. Pure and seeded (no DOM, no Math.random), so tests and
// the README contact sheet are reproducible; the page draws it under the card's tint, so text contrast never depends on it.

import type { Sky } from '../../shared/sky';
import type { WidgetSize } from '../../shared/types';

export type RainLevel = 'none' | 'light' | 'normal' | 'dense';

export interface EffectPlan {
  glow: boolean;
  clouds: number;
  rain: RainLevel;
}

export const CAPS: Readonly<Record<WidgetSize, { drops: number; clouds: number; beads: number; splashes: number }>> = {
  small: { drops: 40, clouds: 3, beads: 12, splashes: 24 },
  medium: { drops: 80, clouds: 5, beads: 20, splashes: 40 },
};

const RAIN_SHARE: Record<RainLevel, number> = { none: 0, light: 0.35, normal: 0.65, dense: 1 };

/** Which effect a weather group gets (the nine groups of sky.ts). Snow and clear nights get none. */
export function effectsFor(sky: Sky, isDay: boolean, size: WidgetSize): EffectPlan {
  const cap = CAPS[size].clouds;
  switch (sky) {
    case 'clear':
      return { glow: isDay, clouds: 0, rain: 'none' };
    case 'partly':
      return { glow: isDay, clouds: 2, rain: 'none' };
    case 'overcast':
    case 'fog':
      return { glow: false, clouds: cap, rain: 'none' };
    case 'drizzle':
      return { glow: false, clouds: cap - 1, rain: 'light' };
    case 'rain':
      return { glow: false, clouds: cap - 1, rain: 'normal' };
    case 'heavy-rain':
    case 'storm':
      return { glow: false, clouds: cap, rain: 'dense' };
    case 'snow':
      return { glow: false, clouds: 0, rain: 'none' };
  }
}

export const hasEffect = (p: EffectPlan): boolean => p.glow || p.clouds > 0 || p.rain !== 'none';

/** mulberry32: a small seeded PRNG. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Drop {
  x: number;
  y: number;
  vy: number;
  len: number;
}
interface Splash {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}
interface Bead {
  x: number;
  y: number;
  r: number;
  dir: -1 | 1;
  box: Box;
}
interface Cloud {
  x: number;
  y: number;
  r: number;
  speed: number;
}

const GRAVITY = 900; // px/s²
const TERMINAL = 420; // px/s
const WIND = 0.12; // horizontal share of the fall
const BEAD_MAX = 3.2; // px radius at which a bead runs off
const BEAD_SLIDE = 9; // px/s along the edge

export interface SceneOptions {
  width: number;
  height: number;
  size: WidgetSize;
  plan: EffectPlan;
  boxes: Box[];
  seed: number;
}

export function createScene(o: SceneOptions) {
  const rnd = seeded(o.seed);
  const caps = CAPS[o.size];
  const targetDrops = Math.round(caps.drops * RAIN_SHARE[o.plan.rain]);
  const drops: Drop[] = [];
  const splashes: Splash[] = [];
  const beads: Bead[] = [];
  const clouds: Cloud[] = [];
  let time = 0;

  const newDrop = (anywhere: boolean): Drop => ({
    x: rnd() * (o.width + 20) - 10,
    y: anywhere ? rnd() * o.height : -10 - rnd() * 40,
    vy: TERMINAL * (0.6 + rnd() * 0.4),
    len: 6 + rnd() * 6,
  });
  for (let i = 0; i < targetDrops; i++) drops.push(newDrop(true));
  for (let i = 0; i < Math.min(o.plan.clouds, caps.clouds); i++) {
    clouds.push({ x: rnd() * o.width, y: o.height * (0.08 + rnd() * 0.5), r: 26 + rnd() * 26, speed: 3 + rnd() * 4 });
  }

  function splash(x: number, y: number): void {
    const n = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < n && splashes.length < caps.splashes; i++) {
      splashes.push({ x, y, vx: (rnd() - 0.5) * 90, vy: -(50 + rnd() * 70), life: 0.25 + rnd() * 0.15 });
    }
  }

  function landOnBox(d: Drop, prevY: number): boolean {
    for (const b of o.boxes) {
      if (d.x >= b.x && d.x <= b.x + b.width && prevY < b.y && d.y >= b.y) {
        const near = beads.find((k) => k.box === b && Math.abs(k.x - d.x) < 4);
        if (near) near.r = Math.min(BEAD_MAX + 0.5, near.r + 0.35);
        else if (beads.length < caps.beads) beads.push({ x: d.x, y: b.y, r: 1.2, dir: d.x < b.x + b.width / 2 ? -1 : 1, box: b });
        else splash(d.x, b.y);
        return true;
      }
    }
    return false;
  }

  /** Advance by `dtMs` (capped at 100 ms so a late frame never jumps). */
  function step(dtMs: number): void {
    const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
    time += dt;
    for (const c of clouds) {
      c.x += c.speed * dt;
      if (c.x - c.r > o.width) c.x = -c.r;
    }
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i]!;
      const prevY = d.y;
      d.vy = Math.min(TERMINAL, d.vy + GRAVITY * dt);
      d.y += d.vy * dt;
      d.x += d.vy * WIND * dt;
      if (landOnBox(d, prevY)) {
        drops[i] = newDrop(false);
      } else if (d.y >= o.height) {
        splash(d.x, o.height - 1);
        drops[i] = newDrop(false);
      }
    }
    for (let i = beads.length - 1; i >= 0; i--) {
      const b = beads[i]!;
      if (b.r >= BEAD_MAX) {
        b.x += b.dir * BEAD_SLIDE * 3 * dt;
        const off = b.x < b.box.x || b.x > b.box.x + b.box.width;
        if (off) {
          beads.splice(i, 1);
          if (drops.length > 0) drops[Math.floor(rnd() * drops.length)] = { x: b.x, y: b.y, vy: 60, len: 5 };
        }
      } else {
        b.x += b.dir * BEAD_SLIDE * 0.15 * dt;
        b.r = Math.min(BEAD_MAX, b.r + 0.08 * dt);
      }
    }
    for (let i = splashes.length - 1; i >= 0; i--) {
      const s = splashes[i]!;
      s.life -= dt;
      if (s.life <= 0) {
        splashes.splice(i, 1);
        continue;
      }
      s.vy += GRAVITY * 0.6 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
  }

  return {
    step,
    counts: () => ({ drops: drops.length, splashes: splashes.length, beads: beads.length, clouds: clouds.length }),
    /** A copy of the state, for tests. */
    snapshot: () => JSON.stringify({ time, drops, splashes, beads: beads.map(({ box: _b, ...rest }) => rest), clouds }),
    draw(ctx: CanvasRenderingContext2D): void {
      ctx.clearRect(0, 0, o.width, o.height);
      if (o.plan.glow) {
        const pulse = 0.9 + 0.1 * Math.sin(time * 0.6);
        const g = ctx.createRadialGradient(o.width * 0.82, o.height * 0.12, 0, o.width * 0.82, o.height * 0.12, o.height * 0.9);
        g.addColorStop(0, `rgba(255, 214, 120, ${0.55 * pulse})`);
        g.addColorStop(1, 'rgba(255, 214, 120, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, o.width, o.height);
      }
      for (const c of clouds) {
        const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
        g.addColorStop(0, 'rgba(230, 236, 245, 0.42)');
        g.addColorStop(1, 'rgba(230, 236, 245, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, c.r * 1.6, c.r, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (drops.length) {
        ctx.strokeStyle = 'rgba(190, 220, 255, 0.7)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (const d of drops) {
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x - d.len * WIND, d.y - d.len);
        }
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(200, 228, 255, 0.8)';
      for (const s of splashes) ctx.fillRect(s.x, s.y, 1.5, 1.5);
      for (const b of beads) {
        ctx.beginPath();
        ctx.arc(b.x, b.y + b.r * 0.6, b.r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  };
}

export const MAX_FPS = 30;

export interface LoopState {
  /** The setting is on and the weather has an effect. */
  enabled: boolean;
  /** The page is visible (not hidden, minimized or covered). */
  pageVisible: boolean;
  /** The main process says the window is shown. */
  windowVisible: boolean;
  reducedMotion: boolean;
}

/** 'run' = animate, 'still' = one frame and stop (reduced motion), 'off' = clear and stop. */
export function loopMode(s: LoopState): 'run' | 'still' | 'off' {
  if (!s.enabled) return 'off';
  if (!s.pageVisible || !s.windowVisible) return 'off';
  return s.reducedMotion ? 'still' : 'run';
}

/** True if a frame at `now` should draw (at most MAX_FPS; a small allowance keeps 60 Hz screens at 30 fps). */
export function frameDue(last: number, now: number): boolean {
  return now - last >= 1000 / MAX_FPS - 2;
}

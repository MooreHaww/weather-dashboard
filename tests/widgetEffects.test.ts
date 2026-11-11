// v2.0 Weather effects on the widget: which effect each weather group gets, the particle caps, the pause rules and
// seeded determinism (the page and the README contact sheet rely on it).

import { describe, expect, it } from 'vitest';
import { CAPS, createScene, effectsFor, frameDue, hasEffect, loopMode, MAX_FPS, seeded } from '../src/renderer/widget/effects';
import { SKIES } from '../src/shared/sky';

describe('effect mapping', () => {
  it('maps the nine groups', () => {
    const table = Object.fromEntries(SKIES.flatMap((s) => [[`${s} day`, effectsFor(s, true, 'medium')], [`${s} night`, effectsFor(s, false, 'medium')]]));
    expect(table).toEqual({
      'clear day': { glow: true, clouds: 0, rain: 'none' },
      'clear night': { glow: false, clouds: 0, rain: 'none' },
      'partly day': { glow: true, clouds: 2, rain: 'none' },
      'partly night': { glow: false, clouds: 2, rain: 'none' },
      'overcast day': { glow: false, clouds: 5, rain: 'none' },
      'overcast night': { glow: false, clouds: 5, rain: 'none' },
      'fog day': { glow: false, clouds: 5, rain: 'none' },
      'fog night': { glow: false, clouds: 5, rain: 'none' },
      'drizzle day': { glow: false, clouds: 4, rain: 'light' },
      'drizzle night': { glow: false, clouds: 4, rain: 'light' },
      'rain day': { glow: false, clouds: 4, rain: 'normal' },
      'rain night': { glow: false, clouds: 4, rain: 'normal' },
      'heavy-rain day': { glow: false, clouds: 5, rain: 'dense' },
      'heavy-rain night': { glow: false, clouds: 5, rain: 'dense' },
      'storm day': { glow: false, clouds: 5, rain: 'dense' },
      'storm night': { glow: false, clouds: 5, rain: 'dense' },
      'snow day': { glow: false, clouds: 0, rain: 'none' },
      'snow night': { glow: false, clouds: 0, rain: 'none' },
    });
    expect(hasEffect(effectsFor('snow', true, 'small'))).toBe(false);
    expect(hasEffect(effectsFor('clear', false, 'small'))).toBe(false);
    expect(effectsFor('overcast', true, 'small').clouds).toBe(CAPS.small.clouds);
  });
});

describe('the rain scene', () => {
  const boxes = [
    { x: 14, y: 110, width: 142, height: 46 },
    { x: 170, y: 12, width: 40, height: 120 },
  ];
  const scene = (size: 'small' | 'medium', seed = 1) =>
    createScene({ width: size === 'small' ? 170 : 360, height: 170, size, plan: effectsFor('storm', true, size), boxes, seed });

  it('never goes over the caps, also after a long run with drops gathering on the boxes', () => {
    for (const size of ['small', 'medium'] as const) {
      const s = scene(size);
      let beadsSeen = 0;
      let splashesSeen = 0;
      for (let i = 0; i < 30 * 60; i++) {
        s.step(1000 / 30);
        const c = s.counts();
        expect(c.drops).toBeLessThanOrEqual(CAPS[size].drops);
        expect(c.splashes).toBeLessThanOrEqual(CAPS[size].splashes);
        expect(c.beads).toBeLessThanOrEqual(CAPS[size].beads);
        expect(c.clouds).toBeLessThanOrEqual(CAPS[size].clouds);
        beadsSeen = Math.max(beadsSeen, c.beads);
        splashesSeen = Math.max(splashesSeen, c.splashes);
      }
      expect(beadsSeen).toBeGreaterThan(0); // drops gather on the boxes
      expect(splashesSeen).toBeGreaterThan(0); // and splash at the bottom
    }
    expect(CAPS.small.drops).toBeLessThan(CAPS.medium.drops);
  });

  it('density follows the group: drizzle < rain < heavy rain', () => {
    const drops = (sky: 'drizzle' | 'rain' | 'heavy-rain') => createScene({ width: 360, height: 170, size: 'medium', plan: effectsFor(sky, true, 'medium'), boxes, seed: 3 }).counts().drops;
    expect(drops('drizzle')).toBeLessThan(drops('rain'));
    expect(drops('rain')).toBeLessThan(drops('heavy-rain'));
    expect(drops('heavy-rain')).toBe(CAPS.medium.drops);
  });

  it('the same seed gives the same frames; another seed does not', () => {
    const a = scene('medium', 7);
    const b = scene('medium', 7);
    const c = scene('medium', 8);
    for (let i = 0; i < 90; i++) [a, b, c].forEach((s) => s.step(33));
    expect(a.snapshot()).toBe(b.snapshot());
    expect(a.snapshot()).not.toBe(c.snapshot());
    expect(seeded(1)()).toBe(seeded(1)());
  });

  it('a late frame never jumps more than 100 ms', () => {
    const a = scene('small', 5);
    const b = scene('small', 5);
    a.step(5000);
    b.step(100);
    expect(a.snapshot()).toBe(b.snapshot());
  });
});

describe('when the effects run', () => {
  const s = { enabled: true, pageVisible: true, windowVisible: true, reducedMotion: false };

  it('animates only while on and visible; a still frame under reduced motion', () => {
    expect(loopMode(s)).toBe('run');
    expect(loopMode({ ...s, enabled: false })).toBe('off');
    expect(loopMode({ ...s, pageVisible: false })).toBe('off'); // hidden or covered
    expect(loopMode({ ...s, windowVisible: false })).toBe('off');
    expect(loopMode({ ...s, reducedMotion: true })).toBe('still');
  });

  it('draws at most 30 frames a second', () => {
    expect(MAX_FPS).toBe(30);
    expect(frameDue(1000, 1000 + 1000 / 60)).toBe(false);
    expect(frameDue(1000, 1000 + 1000 / 30)).toBe(true);
    let drawn = 0;
    let last = 0;
    for (let t = 1; t <= 1000; t += 1000 / 144) {
      if (frameDue(last, t)) {
        drawn++;
        last = t;
      }
    }
    expect(drawn).toBeLessThanOrEqual(31);
  });
});

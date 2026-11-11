// v2.0: the widget's one look, under the main app's rule (CLEAR_RULE, src/shared/contrast.ts): primary text and numbers
// 4.5:1 over mid-grey (#808080) and a dark backdrop (#202020, and black) and 3:1 over white; secondary text and graphics
// 3:1 over grey and dark. Pure white is not guaranteed for 4.5:1. Checked with the tint on top, for every weather group,
// time of day and midpoint, on the card and on its boxes.
import { describe, expect, it } from 'vitest';
import { CLEAR_RULE, parseColor, ruleCheck, type ItemKind, type Layer } from '../src/shared/contrast';
import { RAIN_BLUES } from '../src/shared/rain';
import { skyLook } from '../src/shared/sky';
import { WIDGET_BOX, WIDGET_SECONDARY, WIDGET_TEXT, WIDGET_TINT_ALPHA, widgetTint, widgetTintColor } from '../src/shared/widgetLook';
import { allLooks } from './support/glassModel';

// What the widget draws: primary = temperature, city, hour temperatures; secondary = condition, hour labels, rain
// chance; graphics = the icons' defining colours (sun, cloud, drop, snow, moon; their darker shading parts are not counted).
const ITEMS: { fg: string; kind: ItemKind; name: string }[] = [
  { fg: WIDGET_TEXT, kind: 'primary', name: 'text' },
  { fg: WIDGET_SECONDARY, kind: 'secondary', name: 'secondary' },
  { fg: RAIN_BLUES.light, kind: 'secondary', name: 'rain chance' },
  { fg: '#FFC83D', kind: 'graphic', name: 'sun' },
  { fg: '#E4EAF3', kind: 'graphic', name: 'cloud' },
  { fg: '#5AB0FF', kind: 'graphic', name: 'drop' },
  { fg: '#DCEBFF', kind: 'graphic', name: 'snow' },
  { fg: '#E8ECF8', kind: 'graphic', name: 'moon' },
];
const ABOVE: readonly (readonly Layer[])[] = [[], [WIDGET_BOX]]; // on the card, and on a box

/** The lowest alpha (to 0.001) at which `fg` meets CLEAR_RULE for its kind with this tint colour. */
function neededAlpha(tint: [number, number, number], fg: string, kind: ItemKind, above: readonly Layer[]): number {
  const ok = (a: number) => ruleCheck(fg, [{ r: tint[0], g: tint[1], b: tint[2], a }, ...above], kind, CLEAR_RULE).margin >= 1;
  if (!ok(1)) return Infinity;
  let lo = 0;
  let hi = 1;
  while (hi - lo > 0.0005) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi * 1000) / 1000;
}

describe('the widget look', () => {
  const looks = allLooks();

  it('covers every look and midpoint (54 + 54)', () => {
    expect(Object.keys(looks)).toHaveLength(108);
  });

  it('WIDGET_TINT_ALPHA is the lowest alpha (to 0.01) that meets the rule everywhere', () => {
    let needed = 0;
    let where = '';
    for (const [name, look] of Object.entries(looks)) {
      const tint = widgetTintColor(look) as unknown as [number, number, number];
      for (const item of ITEMS) {
        for (const above of ABOVE) {
          const a = neededAlpha(tint, item.fg, item.kind, above);
          expect(a, `${item.name} on ${name}`).toBeLessThanOrEqual(1);
          if (a > needed) {
            needed = a;
            where = `${item.name} on ${name}${above.length ? ' (box)' : ''}`;
          }
        }
      }
    }
    console.log(`widget tint: needs ${needed} (${where}); uses ${WIDGET_TINT_ALPHA}`);
    expect(WIDGET_TINT_ALPHA).toBeGreaterThanOrEqual(needed);
    expect(WIDGET_TINT_ALPHA - needed).toBeLessThan(0.01);
  });

  it('every item meets the rule at WIDGET_TINT_ALPHA', () => {
    const lowest: Record<string, { ratio: number; where: string }> = {};
    for (const [name, look] of Object.entries(looks)) {
      const tint = widgetTint(look);
      for (const item of ITEMS) {
        for (const above of ABOVE) {
          for (const [backdrop, need] of Object.entries(CLEAR_RULE[item.kind])) {
            const r = ruleCheck(item.fg, [tint, ...above], item.kind, { ...CLEAR_RULE, [item.kind]: { [backdrop]: need } });
            expect(r.ratio, `${item.name} on ${name} over ${backdrop}`).toBeGreaterThanOrEqual(need);
            const key = `${item.kind} over ${backdrop}`;
            if (!lowest[key] || r.ratio < lowest[key].ratio) lowest[key] = { ratio: r.ratio, where: `${item.name} on ${name}${above.length ? ' (box)' : ''}` };
          }
        }
      }
    }
    for (const [key, v] of Object.entries(lowest)) console.log(`lowest ${key}: ${v.ratio.toFixed(2)} (${v.where})`);
  });

  it('the tint keeps the dark base: it is darker than mid-grey in every look', () => {
    for (const look of Object.values(looks)) {
      const c = parseColor(widgetTint(look));
      expect(Math.max(c.r, c.g, c.b)).toBeLessThan(0x80);
    }
  });

  it('the hue follows the weather: clear noon and heavy rain noon differ, the alpha does not', () => {
    const a = widgetTint(skyLook('clear', 'noon'));
    const b = widgetTint(skyLook('heavy-rain', 'noon'));
    expect(a).not.toBe(b);
    expect(a.endsWith(`, ${WIDGET_TINT_ALPHA})`)).toBe(true);
    expect(b.endsWith(`, ${WIDGET_TINT_ALPHA})`)).toBe(true);
  });
});

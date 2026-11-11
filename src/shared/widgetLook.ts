// The widget's one look (v2.0): a dark frosted card over its own blurred backdrop, whatever the Classic/Glass setting.
// The hue follows the weather and the time of day (skyLook, sky.ts); the alpha is fixed and is the lowest that keeps
// the text readable over the worst backdrops (tests/widgetLook.test.ts finds it again and fails if it is not).
//
// The rule is the main app's (CLEAR_RULE in contrast.ts): primary text and numbers 4.5:1 over mid-grey (#808080) and a
// dark backdrop (#202020, and black) and 3:1 over white; secondary text and graphics 3:1 over grey and dark. Pure white
// is not guaranteed for 4.5:1, so shapes of the blurred backdrop stay visible; the widget text has a soft shadow for
// bright areas (widget.css). Weather effects are drawn under the tint, so they count as part of the backdrop.

import type { Rgb, SkyLook } from './sky';

/** The card's dark base colour. */
export const WIDGET_BASE: Rgb = [13, 17, 27];
/**
 * How much of the sky tint's colour (its channels' spread around their mean: hue and saturation, not lightness) the card
 * takes on. Lightness is left out on purpose: fog's pale tint would otherwise lighten the card and need a much higher alpha.
 */
export const WIDGET_HUE_SHARE = 0.5;
/**
 * The tint's alpha over the blurred backdrop: the lowest that meets the rule, rounded up to 0.01 (needs 0.482: white text
 * on a box at clear noon, 3:1 over white). 0.76 until the rule changed to CLEAR_RULE (pure white was a 4.5:1 case then).
 */
export const WIDGET_TINT_ALPHA = 0.49;
/** Medium's hour boxes and both sizes' lower box: a faint white lift on the tint. */
export const WIDGET_BOX = 'rgba(255, 255, 255, 0.06)';
export const WIDGET_TEXT = '#ffffff';
export const WIDGET_SECONDARY = '#cbd5e1';

/** The tint's colour (opaque) for a sky look. */
export function widgetTintColor(look: Pick<SkyLook, 'tint'>): Rgb {
  const mean = (look.tint[0] + look.tint[1] + look.tint[2]) / 3;
  return WIDGET_BASE.map((b, i) => Math.min(255, Math.max(0, Math.round(b + (look.tint[i]! - mean) * WIDGET_HUE_SHARE)))) as unknown as Rgb;
}

/** The tint as a CSS colour, at WIDGET_TINT_ALPHA. */
export function widgetTint(look: Pick<SkyLook, 'tint'>, alpha: number = WIDGET_TINT_ALPHA): string {
  const [r, g, b] = widgetTintColor(look);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

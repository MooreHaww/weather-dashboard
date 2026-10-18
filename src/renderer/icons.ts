// Weather icons as inline SVG, bundled with the app (no icon CDN needed).
import type { IconId } from '../shared/weatherCodes';

const SUN = '#FFC83D';
const CLOUD = '#E4EAF3';
const CLOUD_BACK = '#9AA8BD';
const DARK_CLOUD = '#8E9AAF';
const DROP = '#5AB0FF';
const SNOW = '#DCEBFF';

function sun(transform = ''): string {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const p = (r: number) => `${(32 + r * Math.cos(a)).toFixed(1)} ${(32 + r * Math.sin(a)).toFixed(1)}`;
    return `M${p(17)}L${p(23)}`;
  }).join('');
  return `<g transform="${transform}"><path d="${rays}" stroke="${SUN}" stroke-width="3.5" stroke-linecap="round"/><circle cx="32" cy="32" r="11" fill="${SUN}"/></g>`;
}

function moon(transform = ''): string {
  return `<g transform="${transform}"><mask id="wx-moon-cut"><rect width="64" height="64" fill="#fff"/><circle cx="41" cy="23" r="13" fill="#000"/></mask><circle cx="31" cy="33" r="17" fill="#E8ECF8" mask="url(#wx-moon-cut)"/></g>`;
}

function cloud(transform = '', fill = CLOUD): string {
  return `<g transform="${transform}" fill="${fill}"><circle cx="22" cy="38" r="9"/><circle cx="33" cy="30" r="12"/><circle cx="44" cy="36" r="9"/><rect x="13" y="33" width="40" height="14" rx="7"/></g>`;
}

function drops(xs: number[], color = DROP, len = 9): string {
  return xs
    .map((x) => `<path d="M${x + 2} 46 L${x - 1.5} ${46 + len}" stroke="${color}" stroke-width="3.5" stroke-linecap="round"/>`)
    .join('');
}

function flakes(points: [number, number][]): string {
  return points.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.8" fill="${SNOW}"/>`).join('');
}

const UP = 'translate(0 -8)';

function body(id: IconId, isDay: boolean): string {
  const orb = isDay ? sun : moon;
  switch (id) {
    case 'clear':
      return orb();
    case 'mostly-clear':
      return orb() + cloud('translate(27 29) scale(0.55)');
    case 'partly-cloudy':
      return orb('translate(-4 -7) scale(0.8)') + cloud('translate(4 6)');
    case 'overcast':
      return cloud('translate(10 -5) scale(0.82)', CLOUD_BACK) + cloud('translate(-2 4)');
    case 'fog':
      return (
        cloud(UP) +
        [46, 52, 58]
          .map((y, i) => `<path d="M${14 + i * 4} ${y}H${50 - i * 2}" stroke="${CLOUD}" stroke-opacity="0.7" stroke-width="3" stroke-linecap="round"/>`)
          .join('')
      );
    case 'drizzle':
      return cloud(UP) + drops([24, 34, 44], DROP, 4);
    case 'rain':
      return cloud(UP) + drops([24, 34, 44]);
    case 'heavy-rain':
      return cloud(UP, DARK_CLOUD) + drops([18, 26, 34, 42, 50]);
    case 'sleet':
      return cloud(UP) + drops([24, 44], DROP, 7) + flakes([[34, 52]]);
    case 'snow':
      return cloud(UP) + flakes([[22, 49], [32, 54], [42, 49], [27, 59], [37, 60]]);
    case 'thunder':
      return cloud(UP, DARK_CLOUD) + `<path d="M35 36 L26 50 H33 L29 61 L42 45 H35 L39 36 Z" fill="${SUN}"/>`;
  }
}

export function weatherIcon(id: IconId, isDay = true, className = 'wx-icon'): string {
  return `<svg class="${className}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${body(id, isDay)}</svg>`;
}

// Small UI glyphs (stroke icons, inherit currentColor).
const glyph = (d: string) =>
  `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const glyphs = {
  search: glyph('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  star: glyph('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/>'),
  wind: glyph('<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/>'),
  humidity: glyph('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>'),
  thermo: glyph('<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0Z"/>'),
  sunrise: glyph('<path d="M4 18h16M7 14a5 5 0 0 1 10 0M12 3v5m-3-2 3-3 3 3M4.5 10.5l1.4 1.4M19.5 10.5l-1.4 1.4"/>'),
  sunset: glyph('<path d="M4 18h16M7 14a5 5 0 0 1 10 0M12 8V3m-3 2 3 3 3-3M4.5 10.5l1.4 1.4M19.5 10.5l-1.4 1.4"/>'),
  umbrella: glyph('<path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9Zm0 9v7a2 2 0 0 0 4 0"/>'),
  close: glyph('<path d="M6 6l12 12M18 6 6 18"/>'),
  refresh: glyph('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>'),
  gear: glyph(
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  ),
  pin: glyph('<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/>'),
};

/** Arrow pointing where the wind blows *to* (meteorological direction is where it comes *from*). */
export function windArrow(deg: number): string {
  return `<svg class="wind-arrow" viewBox="0 0 24 24" style="transform: rotate(${deg + 180}deg)" aria-hidden="true"><path d="M12 3 L18 19 L12 15 L6 19 Z" fill="currentColor"/></svg>`;
}

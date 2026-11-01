// The words for the Location section in Settings, in one place (used by the page and the tests).

import type { LocationSetting, Place } from './types';

/** What the page knows about the lookup besides the setting: not asked yet, running, or failed. */
export type LookupState = 'idle' | 'looking' | 'failed';

export const LOCATION_PRIVACY_LINE = 'Uses your IP address to guess your city. The IP address is sent to GeoJS.';

/** The one line under Settings > Location (the switch is the consent, so it says what it sends). */
export const LOCATION_SETTINGS_LINE = 'Uses your IP address, sent to GeoJS.';

/**
 * The info popover next to "Use my location", and the README's Privacy section (between the
 * location-facts markers). Static text only. tests/locationFacts.test.ts checks every claim against the
 * code (URL, headers, rounding, when it looks up) and that the README has exactly these lines.
 */
export const LOCATION_FACTS = {
  title: 'How your IP address is used',
  lines: [
    'Only after you turn this on. Nothing is looked up before that.',
    'The app asks GeoJS (geojs.io), over HTTPS, which city your IP address belongs to. GeoJS sees your IP address, like any website you connect to.',
    'The request carries no cookies, no account and no app identifier, only the generic name "Weather-Dashboard".',
    'The app saves only the city, country, an approximate position (about 1 km) and the time zone, on this PC. It never saves or logs your IP address.',
    'It looks up once each time the app starts, and when you turn it on. Turning the switch off deletes the saved place.',
    'The result is approximate and can be wrong, for example behind a VPN.',
  ],
} as const;

/** "Paris, France": the detected place, as shown on the card and in Settings. */
export function placeLabel(place: Place): string {
  return place.country && place.country !== place.name ? `${place.name}, ${place.country}` : place.name;
}

/** The neutral status line under the switch. Never alarming: a failure only says it will try again. */
export function locationStatus(setting: LocationSetting, place: Place | null, lookup: LookupState): string {
  if (setting !== 'on') return 'Off. No location lookup is made.';
  if (place) return `Near ${placeLabel(place)}. This is approximate.`;
  if (lookup === 'failed') return "Couldn't find your location. It tries again the next time the app starts.";
  return 'Looking for your location…';
}

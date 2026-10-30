// The words for the Location section in Settings, in one place (used by the page and the tests).

import type { LocationSetting, Place } from './types';

/** What the page knows about the lookup besides the setting: not asked yet, running, or failed. */
export type LookupState = 'idle' | 'looking' | 'failed';

export const LOCATION_PRIVACY_LINE = 'Uses your IP address to guess your city. The IP address is sent to GeoJS.';

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

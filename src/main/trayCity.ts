// Which city the tray icon and rain alerts follow (v1.9), and the tray's text. Pure, unit-tested.

import { describeWeather } from '../shared/weatherCodes';
import type { AppState, Place, WeatherData } from '../shared/types';

/** Your location if it is on (and found), else the first favorite, else the last shown city; null if there is none. */
export function trayCity(state: Pick<AppState, 'settings' | 'myLocation' | 'favorites' | 'lastPlace'>): Place | null {
  if (state.settings.location === 'on' && state.myLocation) return state.myLocation;
  return state.favorites[0] ?? state.lastPlace ?? null;
}

/** "Istanbul 12°C, Mainly clear": the tooltip and the menu's first line. */
export function trayText(place: Place, weather: Pick<WeatherData, 'current' | 'unitLabels'>): string {
  const t = Math.round(weather.current.temperature);
  return `${place.name} ${t === 0 ? 0 : t}${weather.unitLabels.temperature}, ${describeWeather(weather.current.weatherCode).label}`;
}

export const TRAY_PLAIN_TEXT = 'Weather Dashboard';

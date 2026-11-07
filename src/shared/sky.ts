// The glass look's outer tint (v1.6): which "sky" a weather code gives, day or night. Only the glass page uses it
// (body[data-sky], styles.css); the solid look keeps body[data-theme] from weatherCodes.ts, unchanged.
// Open-Meteo's code list (https://open-meteo.com/en/docs, "WMO Weather interpretation codes") also has 97 "Heavy
// thunderstorm", which describeWeather() does not know (it shows "Unknown"); here it is a thunderstorm.
// Open-Meteo has no tornado code: the most severe state is a thunderstorm with hail (96, 99).

export type Sky = 'clear' | 'partly' | 'overcast' | 'fog' | 'drizzle' | 'rain' | 'heavy-rain' | 'storm' | 'snow';
export type SkyState = `${Sky}-${'day' | 'night'}`;

export const SKIES: readonly Sky[] = ['clear', 'partly', 'overcast', 'fog', 'drizzle', 'rain', 'heavy-rain', 'storm', 'snow'];

const BY_CODE: Record<number, Sky> = {
  0: 'clear',
  1: 'partly', // mainly clear
  2: 'partly',
  3: 'overcast',
  45: 'fog',
  48: 'fog',
  51: 'drizzle',
  53: 'drizzle',
  55: 'drizzle',
  56: 'drizzle', // freezing drizzle
  57: 'drizzle',
  61: 'drizzle', // slight rain: "drizzle and light rain"
  63: 'rain',
  65: 'heavy-rain',
  66: 'drizzle', // light freezing rain
  67: 'heavy-rain', // heavy freezing rain
  71: 'snow',
  73: 'snow',
  75: 'snow',
  77: 'snow',
  80: 'rain', // rain showers
  81: 'rain',
  82: 'heavy-rain', // violent showers
  85: 'snow',
  86: 'snow',
  95: 'storm',
  96: 'storm',
  97: 'storm', // heavy thunderstorm (not in describeWeather)
  99: 'storm',
};

/** The sky for a code; a code Open-Meteo does not list is overcast (like describeWeather's "Unknown"). */
export function skyOf(code: number): Sky {
  return BY_CODE[code] ?? 'overcast';
}

export function skyState(code: number, isDay: boolean): SkyState {
  return `${skyOf(code)}-${isDay ? 'day' : 'night'}`;
}

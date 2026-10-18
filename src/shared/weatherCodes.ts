// WMO weather interpretation codes, as used by Open-Meteo.
// https://open-meteo.com/en/docs (see "WMO Weather interpretation codes")

export type IconId =
  | 'clear'
  | 'mostly-clear'
  | 'partly-cloudy'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'heavy-rain'
  | 'sleet'
  | 'snow'
  | 'thunder';

/** Broad condition used to tint the app background. */
export type Theme = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm';

interface CodeInfo {
  label: string;
  icon: IconId;
  theme: Theme;
}

const CODES: Record<number, CodeInfo> = {
  0: { label: 'Clear sky', icon: 'clear', theme: 'clear' },
  1: { label: 'Mainly clear', icon: 'mostly-clear', theme: 'clear' },
  2: { label: 'Partly cloudy', icon: 'partly-cloudy', theme: 'cloudy' },
  3: { label: 'Overcast', icon: 'overcast', theme: 'cloudy' },
  45: { label: 'Fog', icon: 'fog', theme: 'fog' },
  48: { label: 'Freezing fog', icon: 'fog', theme: 'fog' },
  51: { label: 'Light drizzle', icon: 'drizzle', theme: 'rain' },
  53: { label: 'Drizzle', icon: 'drizzle', theme: 'rain' },
  55: { label: 'Heavy drizzle', icon: 'drizzle', theme: 'rain' },
  56: { label: 'Freezing drizzle', icon: 'sleet', theme: 'rain' },
  57: { label: 'Heavy freezing drizzle', icon: 'sleet', theme: 'rain' },
  61: { label: 'Light rain', icon: 'rain', theme: 'rain' },
  63: { label: 'Rain', icon: 'rain', theme: 'rain' },
  65: { label: 'Heavy rain', icon: 'heavy-rain', theme: 'rain' },
  66: { label: 'Freezing rain', icon: 'sleet', theme: 'rain' },
  67: { label: 'Heavy freezing rain', icon: 'sleet', theme: 'rain' },
  71: { label: 'Light snow', icon: 'snow', theme: 'snow' },
  73: { label: 'Snow', icon: 'snow', theme: 'snow' },
  75: { label: 'Heavy snow', icon: 'snow', theme: 'snow' },
  77: { label: 'Snow grains', icon: 'snow', theme: 'snow' },
  80: { label: 'Light showers', icon: 'rain', theme: 'rain' },
  81: { label: 'Showers', icon: 'rain', theme: 'rain' },
  82: { label: 'Violent showers', icon: 'heavy-rain', theme: 'rain' },
  85: { label: 'Snow showers', icon: 'snow', theme: 'snow' },
  86: { label: 'Heavy snow showers', icon: 'snow', theme: 'snow' },
  95: { label: 'Thunderstorm', icon: 'thunder', theme: 'storm' },
  96: { label: 'Thunderstorm with hail', icon: 'thunder', theme: 'storm' },
  99: { label: 'Severe thunderstorm with hail', icon: 'thunder', theme: 'storm' },
};

const UNKNOWN: CodeInfo = { label: 'Unknown', icon: 'overcast', theme: 'cloudy' };

export function describeWeather(code: number): CodeInfo {
  return CODES[code] ?? UNKNOWN;
}

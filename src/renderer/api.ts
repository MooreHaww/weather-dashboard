import type { AppState, GeocodeResponse, Place, Settings, Units, WeatherResponse, WindUnit } from '../shared/types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError('The app could not reach its local server.', 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((body as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

export const api = {
  state: () => call<AppState>('/api/state'),

  geocode: (q: string, signal?: AbortSignal) =>
    call<GeocodeResponse>(`/api/geocode?q=${encodeURIComponent(q)}`, { signal }),

  /** `fresh` asks the server to skip its cached copy (auto-refresh and the refresh button). */
  weather: (p: Pick<Place, 'latitude' | 'longitude'>, units: Units, wind: WindUnit, fresh = false) =>
    call<WeatherResponse>(`/api/weather?lat=${p.latitude}&lon=${p.longitude}&units=${units}&wind=${wind}${fresh ? '&fresh=1' : ''}`),

  addFavorite: (p: Place) => call<Place[]>(`/api/favorites/${p.id}`, { method: 'PUT', body: JSON.stringify(p) }),
  removeFavorite: (id: number) => call<Place[]>(`/api/favorites/${id}`, { method: 'DELETE' }),

  addRecent: (p: Place) => call<Place[]>('/api/recent', { method: 'POST', body: JSON.stringify(p) }),
  clearRecent: () => call<Place[]>('/api/recent', { method: 'DELETE' }),
  removeRecent: (id: number) => call<Place[]>(`/api/recent/${id}`, { method: 'DELETE' }),

  /** Ask the local server to guess the city from the IP address. Only works while Settings > Location is on. */
  detectLocation: () => call<Place>('/api/location', { method: 'POST' }),

  saveSettings: (s: Partial<Settings>) => call<Settings>('/api/settings', { method: 'PATCH', body: JSON.stringify(s) }),

  /** v1.9: "Start with Windows" as the OS reports it (nothing is stored). */
  startup: () => call<StartupState>('/api/startup'),
  setStartup: (enabled: boolean) => call<StartupState>('/api/startup', { method: 'PUT', body: JSON.stringify({ enabled }) }),
  /** v1.9: one fixed test notification (at most one per 5 s). */
  testAlert: async (): Promise<void> => {
    const res = await fetch('/api/rain-alerts/test', { method: 'POST' }).catch(() => null);
    if (!res || !res.ok) throw new ApiError('No test notification', res?.status ?? 0);
  },
};

export interface StartupState {
  supported: boolean;
  enabled: boolean;
}

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

  weather: (p: Pick<Place, 'latitude' | 'longitude'>, units: Units, wind: WindUnit) =>
    call<WeatherResponse>(`/api/weather?lat=${p.latitude}&lon=${p.longitude}&units=${units}&wind=${wind}`),

  addFavorite: (p: Place) => call<Place[]>(`/api/favorites/${p.id}`, { method: 'PUT', body: JSON.stringify(p) }),
  removeFavorite: (id: number) => call<Place[]>(`/api/favorites/${id}`, { method: 'DELETE' }),

  addRecent: (p: Place) => call<Place[]>('/api/recent', { method: 'POST', body: JSON.stringify(p) }),
  clearRecent: () => call<Place[]>('/api/recent', { method: 'DELETE' }),

  saveSettings: (s: Partial<Settings>) => call<Settings>('/api/settings', { method: 'PATCH', body: JSON.stringify(s) }),
};

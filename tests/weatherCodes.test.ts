import { describe, expect, it } from 'vitest';
import { describeWeather } from '../src/shared/weatherCodes';

describe('describeWeather', () => {
  it.each([
    [0, 'Clear sky', 'clear', 'clear'],
    [2, 'Partly cloudy', 'partly-cloudy', 'cloudy'],
    [45, 'Fog', 'fog', 'fog'],
    [63, 'Rain', 'rain', 'rain'],
    [65, 'Heavy rain', 'heavy-rain', 'rain'],
    [75, 'Heavy snow', 'snow', 'snow'],
    [95, 'Thunderstorm', 'thunder', 'storm'],
  ])('code %i → %s', (code, label, icon, theme) => {
    expect(describeWeather(code)).toEqual({ label, icon, theme });
  });

  it('falls back for unknown codes', () => {
    expect(describeWeather(42).label).toBe('Unknown');
  });
});

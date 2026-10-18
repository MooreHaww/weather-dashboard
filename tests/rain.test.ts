import { describe, expect, it } from 'vitest';
import { rainHoursForDay, rainSummary } from '../src/shared/rain';
import type { HourlySeries } from '../src/shared/types';

/** 48 hours starting 2026-10-17T00:00, with given probabilities for today's and tomorrow's hours. */
function hourly(today: Record<number, number | null>, tomorrow: Record<number, number> = {}): HourlySeries {
  const time: string[] = [];
  const precipitationProbability: (number | null)[] = [];
  for (let d = 0; d < 2; d++) {
    for (let h = 0; h < 24; h++) {
      time.push(`2026-10-${17 + d}T${String(h).padStart(2, '0')}:00`);
      const p = d === 0 ? today[h] : tomorrow[h];
      precipitationProbability.push(p === undefined ? 0 : p);
    }
  }
  return {
    time,
    precipitationProbability,
    temperature: time.map(() => 20),
    apparentTemperature: time.map(() => 19),
    weatherCode: time.map(() => 0),
    isDay: time.map(() => true),
  };
}

describe('rainSummary (today)', () => {
  it('names the first upcoming hour that is likely to rain', () => {
    const s = rainSummary(hourly({ 14: 40, 16: 70, 18: 90 }), '2026-10-17T10:15');
    expect(s).toMatchObject({ level: 'likely', at: '2026-10-17T16:00', probability: 70 });
    expect(s.text).toBe('Rain likely at 4 PM (70%)');
  });

  it('ignores hours that have already passed', () => {
    const s = rainSummary(hourly({ 8: 95, 20: 10 }), '2026-10-17T12:00');
    expect(s.level).toBe('none');
    expect(s.text).toBe('No rain expected for the rest of today');
  });

  it('says "now" when the current hour is likely', () => {
    const s = rainSummary(hourly({ 12: 80 }), '2026-10-17T12:45:10');
    expect(s.text).toBe('Rain likely now (80%)');
  });

  it('reports a slight chance at the peak hour when nothing is likely', () => {
    const s = rainSummary(hourly({ 15: 30, 18: 45, 21: 35 }), '2026-10-17T09:00');
    expect(s).toMatchObject({ level: 'chance', at: '2026-10-17T18:00', probability: 45 });
    expect(s.text).toBe('Slight chance of rain around 6 PM (45%)');
  });

  it('does not look into tomorrow', () => {
    const s = rainSummary(hourly({}, { 3: 100 }), '2026-10-17T22:00');
    expect(s.level).toBe('none');
  });

  it('treats missing probabilities as 0', () => {
    const s = rainSummary(hourly({ 13: null, 14: null }), '2026-10-17T12:00');
    expect(s.level).toBe('none');
  });
});

describe('rainSummary (another day)', () => {
  it('counts the whole day, including early hours', () => {
    const s = rainSummary(hourly({}, { 3: 60, 16: 90 }), '2026-10-17T22:00', '2026-10-18');
    expect(s).toMatchObject({ level: 'likely', at: '2026-10-18T03:00' });
    expect(s.text).toBe('Rain likely at 3 AM (60%)');
  });

  it('never says "now" for a future day, even at the same clock hour', () => {
    const s = rainSummary(hourly({}, { 12: 80 }), '2026-10-17T12:30', '2026-10-18');
    expect(s.text).toBe('Rain likely at 12 PM (80%)');
  });

  it('uses plain "No rain expected" wording', () => {
    const s = rainSummary(hourly({ 20: 90 }, { 5: 10 }), '2026-10-17T08:00', '2026-10-18');
    expect(s.text).toBe('No rain expected');
  });
});

describe('rainHoursForDay', () => {
  it('returns today’s 24 hours and marks past ones', () => {
    const hours = rainHoursForDay(hourly({ 5: 20 }), '2026-10-17', '2026-10-17T06:30');
    expect(hours).toHaveLength(24);
    expect(hours[5]).toEqual({ time: '2026-10-17T05:00', probability: 20, isPast: true });
    expect(hours[6]!.isPast).toBe(false);
  });

  it('returns another day’s hours with none in the past', () => {
    const hours = rainHoursForDay(hourly({}, { 7: 40 }), '2026-10-18', '2026-10-17T23:00');
    expect(hours).toHaveLength(24);
    expect(hours.every((h) => h.time.startsWith('2026-10-18') && !h.isPast)).toBe(true);
    expect(hours[7]!.probability).toBe(40);
  });
});

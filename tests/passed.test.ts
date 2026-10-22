import { describe, expect, it } from 'vitest';
import { passedInfo } from '../src/shared/passed';
import { localIsoIn } from '../src/shared/time';

/** A city's hourly points for one local day, as Open-Meteo sends them. */
const dayHours = (date: string, hours = Array.from({ length: 24 }, (_, h) => h)) =>
  hours.map((h) => `${date}T${String(h).padStart(2, '0')}:00`);

describe('passedInfo (where "now" is on the chart)', () => {
  const today = dayHours('2026-10-17');

  it('is the hour index plus the minutes into the hour', () => {
    expect(passedInfo(today, '2026-10-17T00:00:00')).toEqual({ index: 0, pos: 0 });
    expect(passedInfo(today, '2026-10-17T13:45:30')).toEqual({ index: 13, pos: 13.75 });
    expect(passedInfo(today, '2026-10-17T23:59:59')?.index).toBe(23);
    expect(passedInfo(today, '2026-10-17T23:59:59')!.pos).toBeCloseTo(23.983, 3);
  });

  it('is null for any other day', () => {
    expect(passedInfo(dayHours('2026-10-18'), '2026-10-17T13:45:00')).toBeNull();
    expect(passedInfo(dayHours('2026-10-16'), '2026-10-17T00:10:00')).toBeNull();
  });

  // The PC's zone must not matter: "now" is converted to the city's own clock first.
  describe('in other timezones', () => {
    const instant = new Date(Date.UTC(2026, 9, 17, 9, 32, 5));

    it('Tokyo (UTC+9): 18:32', () => {
      expect(passedInfo(dayHours('2026-10-17'), localIsoIn('Asia/Tokyo', instant))).toMatchObject({ index: 18 });
    });

    it('Kathmandu (UTC+5:45): 15:17, a quarter-hour offset', () => {
      const info = passedInfo(dayHours('2026-10-17'), localIsoIn('Asia/Kathmandu', instant))!;
      expect(info.index).toBe(15);
      expect(info.pos).toBeCloseTo(15 + 17 / 60, 5);
    });

    it('Newfoundland (UTC-3:30 in winter): half-hour offset', () => {
      const winter = new Date(Date.UTC(2026, 11, 5, 12, 0, 0));
      expect(passedInfo(dayHours('2026-12-05'), localIsoIn('America/St_Johns', winter))).toEqual({ index: 8, pos: 8.5 });
    });

    it('a city already on the next date does not match the UTC date', () => {
      const late = new Date(Date.UTC(2026, 9, 17, 20, 10, 0)); // Kiritimati is UTC+14: 10:10 on the 18th
      const nowLocal = localIsoIn('Pacific/Kiritimati', late);
      expect(nowLocal.startsWith('2026-10-18T10:10')).toBe(true);
      expect(passedInfo(dayHours('2026-10-17'), nowLocal)).toBeNull();
      expect(passedInfo(dayHours('2026-10-18'), nowLocal)).toMatchObject({ index: 10 });
    });
  });

  describe('on daylight-saving days', () => {
    it('spring forward (New York 2026-03-08): the 02:00 hour does not exist', () => {
      const times = dayHours('2026-03-08', [0, 1, ...Array.from({ length: 21 }, (_, i) => i + 3)]);
      // 07:30 UTC is 03:30 EDT, just after the jump: the index counts the points that exist.
      const nowLocal = localIsoIn('America/New_York', new Date(Date.UTC(2026, 2, 8, 7, 30)));
      expect(nowLocal.slice(0, 16)).toBe('2026-03-08T03:30');
      expect(passedInfo(times, nowLocal)).toEqual({ index: 2, pos: 2.5 });
    });

    it('fall back (New York 2026-11-01): the repeated 01:00 hour matches its first point', () => {
      const times = dayHours('2026-11-01');
      const first = localIsoIn('America/New_York', new Date(Date.UTC(2026, 10, 1, 5, 30))); // 01:30 EDT
      const second = localIsoIn('America/New_York', new Date(Date.UTC(2026, 10, 1, 6, 30))); // 01:30 EST
      expect(first.slice(0, 16)).toBe('2026-11-01T01:30');
      expect(second.slice(0, 16)).toBe('2026-11-01T01:30');
      expect(passedInfo(times, first)).toEqual({ index: 1, pos: 1.5 });
      expect(passedInfo(times, second)).toEqual({ index: 1, pos: 1.5 });
    });

    it('later on a fall-back day the hours line up again', () => {
      const nowLocal = localIsoIn('America/New_York', new Date(Date.UTC(2026, 10, 1, 20, 15))); // 15:15 EST
      expect(passedInfo(dayHours('2026-11-01'), nowLocal)).toEqual({ index: 15, pos: 15.25 });
    });

    it('London spring forward (2026-03-29): the 01:00 hour does not exist', () => {
      const times = dayHours('2026-03-29', Array.from({ length: 24 }, (_, h) => h).filter((h) => h !== 1));
      const nowLocal = localIsoIn('Europe/London', new Date(Date.UTC(2026, 2, 29, 12, 0))); // 13:00 BST
      expect(nowLocal.slice(0, 16)).toBe('2026-03-29T13:00');
      expect(passedInfo(times, nowLocal)).toEqual({ index: 12, pos: 12 });
    });

    it('Lord Howe (30-minute DST shift) still lands in the right hour', () => {
      const nowLocal = localIsoIn('Australia/Lord_Howe', new Date(Date.UTC(2026, 9, 4, 10, 0))); // UTC+11 after the change
      expect(nowLocal.slice(0, 16)).toBe('2026-10-04T21:00');
      expect(passedInfo(dayHours('2026-10-04'), nowLocal)).toEqual({ index: 21, pos: 21 });
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  cityClock,
  compass,
  formatHour,
  formatTime,
  localDateIn,
  localIsoIn,
  shortDate,
  utcOffsetLabel,
  weekday,
} from '../src/shared/time';

// A fixed instant: 2026-10-17 09:32:05 UTC.
const INSTANT = new Date(Date.UTC(2026, 9, 17, 9, 32, 5));

describe('city-local time', () => {
  it('uses the city timezone, not the PC timezone', () => {
    expect(localIsoIn('Asia/Tokyo', INSTANT)).toBe('2026-10-17T18:32:05');
    expect(localIsoIn('America/Los_Angeles', INSTANT)).toBe('2026-10-17T02:32:05');
    expect(localIsoIn('UTC', INSTANT)).toBe('2026-10-17T09:32:05');
  });

  it('handles non-hour offsets (Kathmandu is UTC+5:45)', () => {
    expect(localIsoIn('Asia/Kathmandu', INSTANT)).toBe('2026-10-17T15:17:05');
    expect(utcOffsetLabel('Asia/Kathmandu', INSTANT)).toBe('UTC+5:45');
  });

  it('crosses the date line correctly', () => {
    expect(localDateIn('Pacific/Kiritimati', new Date(Date.UTC(2026, 9, 17, 12)))).toBe('2026-10-18');
    expect(localDateIn('Pacific/Pago_Pago', new Date(Date.UTC(2026, 9, 17, 5)))).toBe('2026-10-16');
  });

  it('follows daylight saving changes', () => {
    // New York switches from EDT (UTC-4) to EST (UTC-5) on 2026-11-01.
    expect(utcOffsetLabel('America/New_York', new Date(Date.UTC(2026, 9, 31, 12)))).toBe('UTC-4');
    expect(utcOffsetLabel('America/New_York', new Date(Date.UTC(2026, 10, 2, 12)))).toBe('UTC-5');
  });

  it('builds the live clock text', () => {
    expect(cityClock('Asia/Tokyo', INSTANT)).toEqual({
      date: 'Saturday, October 17, 2026',
      time: '6:32:05 PM',
      offset: 'UTC+9',
    });
  });
});

describe('time format (12-hour and 24-hour)', () => {
  it('formats hours in 24-hour style, including midnight and noon', () => {
    expect(formatHour('2026-10-17T00:00', false, '24h')).toBe('00:00');
    expect(formatHour('2026-10-17T09:00', false, '24h')).toBe('09:00');
    expect(formatHour('2026-10-17T12:00', false, '24h')).toBe('12:00');
    expect(formatHour('2026-10-17T16:00', false, '24h')).toBe('16:00');
    expect(formatHour('2026-10-17T23:00', false, '24h')).toBe('23:00');
    expect(formatHour('2026-10-17T06:07', true, '24h')).toBe('06:07');
  });

  it('keeps 12-hour midnight and noon right, with and without minutes', () => {
    expect(formatTime('00:00', '12h')).toBe('12 AM');
    expect(formatTime('00:30', '12h', { minutes: true })).toBe('12:30 AM');
    expect(formatTime('12:00', '12h')).toBe('12 PM');
    expect(formatTime('12:45', '12h', { minutes: true })).toBe('12:45 PM');
    expect(formatTime('23:59', '12h', { minutes: true })).toBe('11:59 PM');
  });

  it('formats seconds and defaults to 12-hour', () => {
    expect(formatTime('2026-10-17T14:32:05', '12h', { seconds: true })).toBe('2:32:05 PM');
    expect(formatTime('2026-10-17T14:32:05', '24h', { seconds: true })).toBe('14:32:05');
    expect(formatTime('2026-10-17T16:00')).toBe('4 PM');
  });

  it('builds the live clock in both formats, in the city timezone', () => {
    expect(cityClock('Asia/Tokyo', INSTANT, '24h').time).toBe('18:32:05');
    expect(cityClock('Asia/Tokyo', INSTANT, '12h').time).toBe('6:32:05 PM');
    expect(cityClock('America/Los_Angeles', INSTANT, '24h').time).toBe('02:32:05');
    expect(cityClock('America/Los_Angeles', INSTANT, '12h').time).toBe('2:32:05 AM');
  });

  it('handles +5:45 (Kathmandu) in both formats', () => {
    expect(cityClock('Asia/Kathmandu', INSTANT, '12h').time).toBe('3:17:05 PM');
    expect(cityClock('Asia/Kathmandu', INSTANT, '24h').time).toBe('15:17:05');
  });

  it('shows midnight and noon on the clock', () => {
    const midnight = new Date(Date.UTC(2026, 9, 17, 15, 0, 0)); // 00:00:00 in Tokyo
    const noon = new Date(Date.UTC(2026, 9, 17, 3, 0, 0)); // 12:00:00 in Tokyo
    expect(cityClock('Asia/Tokyo', midnight, '12h').time).toBe('12:00:00 AM');
    expect(cityClock('Asia/Tokyo', midnight, '24h').time).toBe('00:00:00');
    expect(cityClock('Asia/Tokyo', noon, '12h').time).toBe('12:00:00 PM');
    expect(cityClock('Asia/Tokyo', noon, '24h').time).toBe('12:00:00');
  });
});

describe('formatting', () => {
  it('formats hours in 12-hour style', () => {
    expect(formatHour('2026-10-17T00:00')).toBe('12 AM');
    expect(formatHour('2026-10-17T09:00')).toBe('9 AM');
    expect(formatHour('2026-10-17T12:00')).toBe('12 PM');
    expect(formatHour('2026-10-17T16:00')).toBe('4 PM');
    expect(formatHour('2026-10-17T06:07', true)).toBe('6:07 AM');
  });

  it('derives weekday and short date from a date string', () => {
    expect(weekday('2026-10-17')).toBe('Sat');
    expect(weekday('2026-10-18', true)).toBe('Sunday');
    expect(shortDate('2026-10-17')).toBe('Oct 17');
    expect(shortDate('2027-01-01')).toBe('Jan 1');
  });

  it('labels wind directions', () => {
    expect(compass(0)).toBe('N');
    expect(compass(359)).toBe('N');
    expect(compass(90)).toBe('E');
    expect(compass(225)).toBe('SW');
    expect(compass(-90)).toBe('W');
  });
});

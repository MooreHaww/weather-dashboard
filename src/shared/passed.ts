// Where "now" falls inside one day's hourly points, in the city's own time.

export interface NowMarker {
  /** Index of the current hour in `times`. */
  index: number;
  /** Fractional position: index plus the minutes into the hour (0 to just under index + 1). */
  pos: number;
}

/**
 * `times` are a day's city-local hour strings ("YYYY-MM-DDTHH:00") and `nowLocal`
 * is the city's current local time ("YYYY-MM-DDTHH:mm:ss"). Both carry no offset,
 * so only the strings are compared; the PC's timezone is never involved. Returns
 * null when the current hour isn't in `times` (any day other than today). On a DST
 * day the missing or repeated hour is handled by matching the string, so the first
 * matching hour wins.
 */
export function passedInfo(times: string[], nowLocal: string): NowMarker | null {
  const hour = nowLocal.slice(0, 13);
  const index = times.findIndex((t) => t.slice(0, 13) === hour);
  if (index < 0) return null;
  const minutes = Number(nowLocal.slice(14, 16)) || 0;
  return { index, pos: index + minutes / 60 };
}

// v1.5.1: the "How your IP address is used" text (LOCATION_FACTS) is shown in Settings and in the README's
// Privacy section. Every claim in it is checked here against the code, and the README must carry exactly these lines.

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  COORDINATE_DECIMALS,
  detectLocation,
  LOCATION_HEADERS,
  LOCATION_TIMEOUT_MS,
  LOCATION_URL,
  parseLocation,
} from '../src/server/location';
import type { FetchLike } from '../src/server/openMeteo';
import { Storage } from '../src/server/storage';
import { LOCATION_FACTS } from '../src/shared/locationText';

const root = path.join(__dirname, '..');
const text = LOCATION_FACTS.lines.join('\n');
const line = (start: string) => {
  const found = LOCATION_FACTS.lines.find((l) => l.startsWith(start));
  expect(found, start).toBeDefined();
  return found!;
};

/** How the README shows the facts, between its location-facts markers. */
const asMarkdown = () => [`**${LOCATION_FACTS.title}**`, '', ...LOCATION_FACTS.lines.map((l) => `- ${l}`)].join('\n');

describe('LOCATION_FACTS', () => {
  it('is the README Privacy text, word for word', async () => {
    const readme = (await readFile(path.join(root, 'README.md'), 'utf8')).replace(/\r\n/g, '\n');
    const block = /<!-- location-facts:start -->\n([\s\S]*?)\n<!-- location-facts:end -->/.exec(readme);
    expect(block, 'README has the location-facts markers').not.toBeNull();
    expect(block![1]).toBe(asMarkdown());
  });

  it('is plain static text: a title and six lines, no markup, no blanket "secure" claim', () => {
    expect(LOCATION_FACTS.title).toBe('How your IP address is used');
    expect(LOCATION_FACTS.lines).toHaveLength(6);
    expect(text).not.toMatch(/[<>]/);
    expect(text).not.toMatch(/secur/i);
  });

  it('"over HTTPS" to "GeoJS (geojs.io)": the one address the server asks', () => {
    const url = new URL(LOCATION_URL);
    expect(url.protocol).toBe('https:');
    expect(url.hostname.endsWith('geojs.io')).toBe(true);
    expect(line('The app asks GeoJS (geojs.io), over HTTPS,')).toContain('which city your IP address belongs to');
  });

  it('"no cookies, no account and no app identifier, only the generic name": exactly the headers and options the request has', async () => {
    expect(Object.keys(LOCATION_HEADERS).sort()).toEqual(['Accept', 'User-Agent']);
    expect(line('The request carries')).toContain(`"${LOCATION_HEADERS['User-Agent']}"`);
    expect(LOCATION_HEADERS['User-Agent']).toBe('Weather-Dashboard'); // no version, machine or user in it
    const fetchImpl = vi.fn<FetchLike>(async () => new Response(JSON.stringify({ city: 'Paris', latitude: '48.8566', longitude: '2.3522', timezone: 'Europe/Paris' })));
    await detectLocation(fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(LOCATION_URL);
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', headers: LOCATION_HEADERS });
    expect(Object.keys((init as { headers: object }).headers)).not.toContain('Cookie');
  });

  it('"an approximate position (about 1 km)": coordinates are rounded to COORDINATE_DECIMALS', () => {
    const km = Number(/about (\d+) km/.exec(line('The app saves only'))![1]);
    expect(Math.round(111.32 * 10 ** -COORDINATE_DECIMALS)).toBe(km); // one step of the rounding, in km at the equator
    const place = parseLocation({ city: 'Paris', country: 'France', country_code: 'FR', latitude: '48.856614', longitude: '2.3522219', timezone: 'Europe/Paris', ip: '203.0.113.7' })!;
    expect(place.latitude).toBe(48.86);
    expect(place.longitude).toBe(2.35);
    // "only the city, country, ... and the time zone": nothing else is kept (the id is the fixed "Your location" id).
    expect(Object.keys(place).sort()).toEqual(['country', 'countryCode', 'id', 'latitude', 'longitude', 'name', 'timezone']);
  });

  it('says nothing about a time limit unless it is the real one', () => {
    for (const m of text.matchAll(/(\d+)\s*(seconds?|s)\b/g)) expect(Number(m[1]) * 1000).toBe(LOCATION_TIMEOUT_MS);
  });

  it('"once each time the app starts, and when you turn it on": boot and the switch each call findMyLocation once', async () => {
    expect(line('It looks up')).toBe('It looks up once each time the app starts, and when you turn it on. Turning the switch off deletes the saved place.');
    const main = await readFile(path.join(root, 'src', 'renderer', 'main.ts'), 'utf8');
    const body = (name: string) => {
      const start = main.indexOf(`async function ${name}(`);
      const end = main.indexOf('\n}\n', start);
      expect(start, name).toBeGreaterThan(-1);
      return main.slice(start, end);
    };
    const calls = (src: string) => src.match(/(?<!function )findMyLocation\(\)/g)?.length ?? 0;
    expect(calls(body('boot'))).toBe(1);
    expect(calls(body('enableLocation'))).toBe(1);
    // Nowhere else: not on refresh, F5, the 5-minute timer or a city change.
    expect(calls(main)).toBe(2);
  });

  it('"Turning the switch off deletes the saved place", and nothing is looked up before it is on', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wd-facts-'));
    try {
      const s = new Storage(dir);
      await s.updateSettings({ location: 'on' });
      const place = parseLocation({ city: 'Paris', latitude: 48.85, longitude: 2.35, timezone: 'Europe/Paris' })!;
      expect((await s.setMyLocation(place))!.myLocation).toEqual(place);
      await s.updateSettings({ location: 'off' });
      expect((await s.get()).myLocation).toBeNull();
      const file = JSON.parse(await readFile(path.join(dir, 'weather-dashboard.json'), 'utf8')) as { myLocation: unknown };
      expect(file.myLocation).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    expect(line('Only after you turn this on.')).toBe('Only after you turn this on. Nothing is looked up before that.');
    // (The server refusing the lookup before "on" is tested in location.test.ts: "makes NO request to the provider before ...".)
  });
});

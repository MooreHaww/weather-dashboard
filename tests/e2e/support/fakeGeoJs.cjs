// Loaded into the app's main process by tests/e2e/location.e2e.ts (NODE_OPTIONS=--require), before the
// app's own code runs. It answers requests to GeoJS with a fixed place and records them, so the tests
// never send the PC's real IP address to the real service, not even at start-up. Every other request
// (Open-Meteo) goes through to the real fetch.
//
// The test controls it from the main-process inspector through `globalThis.__geo`:
//   mode: 'ok' (answer), 'fail' (HTTP 500), 'garbage' (not JSON)    delayMs: wait before answering
//   calls: every request seen, with what the app sent (url, header names and values, options)

const realFetch = globalThis.fetch;
const geo = (globalThis.__geo = { mode: 'ok', delayMs: 0, calls: [] });

const ANSWER = {
  ip: '203.0.113.77', // documentation address (RFC 5737); the app must never keep it
  organization_name: 'EXAMPLE-NET Example Telecom',
  asn: 64500,
  city: 'Paris',
  region: 'Île-de-France',
  country: 'France',
  country_code: 'FR',
  latitude: '48.8566',
  longitude: '2.3522',
  timezone: 'Europe/Paris',
};

globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://get.geojs.io/')) return realFetch(url, init);
  geo.calls.push({
    url: String(url),
    optionKeys: Object.keys(init ?? {}).sort(),
    headers: init?.headers ?? null,
    redirect: init?.redirect ?? null,
    credentials: init?.credentials ?? null,
  });
  if (geo.delayMs) await new Promise((resolve) => setTimeout(resolve, geo.delayMs));
  if (geo.mode === 'fail') return new Response('down', { status: 500 });
  if (geo.mode === 'garbage') return new Response('<html>blocked</html>', { status: 200 });
  return new Response(JSON.stringify(ANSWER), { status: 200, headers: { 'content-type': 'application/json' } });
};

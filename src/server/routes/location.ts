import { Router } from 'express';
import { HttpError } from '../errors';
import { detectLocation, LocationError } from '../location';
import type { FetchLike } from '../openMeteo';
import type { Storage } from '../storage';

interface Deps {
  storage: Storage;
  fetchImpl: FetchLike;
  log: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

/**
 * POST /api/location: guess the city from the IP address and store the place.
 * - Takes no parameters: no query string, no body, nothing the page sends reaches the provider.
 * - Refuses unless the stored setting says the user allowed it (checked here, not only in the page,
 *   and again when the place is stored, in case it was switched off while the lookup ran).
 * - One attempt. A failure answers 502 with a plain message; the page shows nothing alarming.
 * - The log line is a fixed reason word. The IP address is never stored or logged.
 */
export function locationRoutes({ storage, fetchImpl, log }: Deps): Router {
  const router = Router();

  router.post('/location', async (req, res) => {
    const body = req.body as unknown;
    const hasBody = body !== undefined && !(typeof body === 'object' && body !== null && Object.keys(body).length === 0);
    if (Object.keys(req.query).length > 0 || hasBody) throw new HttpError(400, 'This route takes no parameters');

    if ((await storage.get()).settings.location !== 'on') {
      throw new HttpError(403, 'Location is off. Turn on "Use my location" first.');
    }

    let place;
    try {
      place = await detectLocation(fetchImpl);
    } catch (err) {
      log('warn', `Location lookup failed: ${err instanceof LocationError ? err.reason : 'error'}`);
      throw new HttpError(502, 'Could not find your location right now.');
    }

    if (!(await storage.setMyLocation(place))) throw new HttpError(403, 'Location is off. Turn on "Use my location" first.');
    res.json(place);
  });

  return router;
}

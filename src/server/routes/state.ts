import { Router } from 'express';
import { HttpError } from '../errors';
import { TEMP_LABELS, TIME_FORMATS, WIND_UNITS } from '../../shared/types';
import { toPlace, type Storage } from '../storage';

function placeFromBody(body: unknown) {
  const place = toPlace(body);
  if (!place) throw new HttpError(400, 'Body must be a place with id, name, latitude and longitude');
  return place;
}

function idParam(raw: string | string[] | undefined): number {
  const id = Number(raw);
  if (!Number.isFinite(id)) throw new HttpError(400, 'Invalid id');
  return id;
}

/** Favorites, recent searches and settings, persisted in the local JSON file. */
export function stateRoutes(storage: Storage): Router {
  const router = Router();

  router.get('/state', async (_req, res) => {
    res.json(await storage.get());
  });

  router.get('/favorites', async (_req, res) => {
    res.json((await storage.get()).favorites);
  });

  router.put('/favorites/:id', async (req, res) => {
    const place = placeFromBody(req.body);
    if (place.id !== idParam(req.params.id)) throw new HttpError(400, 'Body id does not match URL');
    res.json((await storage.addFavorite(place)).favorites);
  });

  router.delete('/favorites/:id', async (req, res) => {
    res.json((await storage.removeFavorite(idParam(req.params.id))).favorites);
  });

  router.get('/recent', async (_req, res) => {
    res.json((await storage.get()).recent);
  });

  router.post('/recent', async (req, res) => {
    res.json((await storage.addRecent(placeFromBody(req.body))).recent);
  });

  router.delete('/recent', async (_req, res) => {
    res.json((await storage.clearRecent()).recent);
  });

  router.get('/settings', async (_req, res) => {
    res.json((await storage.get()).settings);
  });

  router.patch('/settings', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const oneOf = (name: string, allowed: readonly string[]) => {
      if (body[name] !== undefined && !allowed.includes(body[name] as string)) {
        throw new HttpError(400, `"${name}" must be ${allowed.map((a) => `"${a}"`).join(' or ')}`);
      }
    };
    oneOf('units', ['metric', 'imperial']);
    oneOf('timeFormat', TIME_FORMATS);
    oneOf('windUnit', WIND_UNITS);
    oneOf('tempLabels', TEMP_LABELS);
    res.json((await storage.updateSettings(body)).settings);
  });

  return router;
}

import { Router } from 'express';
import { HttpError } from '../errors';

/** "Start with Windows" as the OS reports it (v1.9). Nothing about it is stored: the OS is the truth. */
export interface StartupState {
  /** False in dev and unpackaged builds: only the installed app can start with Windows. */
  supported: boolean;
  enabled: boolean;
}

/** What the main process gives the server for the Background section. Absent in a plain browser (`dev:server`). */
export interface BackgroundHooks {
  startup?: {
    get(): StartupState;
    set(enabled: boolean): StartupState;
  };
  /** Shows one fixed test notification. */
  testNotification?: () => void;
  now?: () => number;
}

export const TEST_NOTIFICATION_GAP_MS = 5000;

const UNSUPPORTED: StartupState = { supported: false, enabled: false };

/**
 * GET/PUT /api/startup and POST /api/rain-alerts/test. The page can only read or flip the login item and ask for the
 * one fixed test notification (at most one per 5 s); it can pass no text, path or argument.
 */
export function backgroundRoutes(hooks: BackgroundHooks = {}): Router {
  const router = Router();
  const now = hooks.now ?? Date.now;
  let lastTest = -Infinity;

  router.get('/startup', (_req, res) => {
    res.json(hooks.startup?.get() ?? UNSUPPORTED);
  });

  router.put('/startup', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (Object.keys(body).length !== 1 || typeof body.enabled !== 'boolean') {
      throw new HttpError(400, 'Body must be { "enabled": true or false }');
    }
    const current = hooks.startup?.get() ?? UNSUPPORTED;
    if (!hooks.startup || !current.supported) throw new HttpError(409, 'Only the installed app can start with Windows');
    res.json(hooks.startup.set(body.enabled));
  });

  router.post('/rain-alerts/test', (req, res) => {
    if (req.body && typeof req.body === 'object' && Object.keys(req.body as object).length > 0) {
      throw new HttpError(400, 'No body expected');
    }
    if (!hooks.testNotification) throw new HttpError(409, 'Notifications are only available in the app');
    const t = now();
    if (t - lastTest < TEST_NOTIFICATION_GAP_MS) throw new HttpError(429, 'Please wait a moment');
    lastTest = t;
    hooks.testNotification();
    res.status(204).end();
  });

  return router;
}

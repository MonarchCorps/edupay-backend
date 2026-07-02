import { Router } from 'express';
import { requireApiKeyOrSession } from '../middleware/sessionAuth.js';
import { validateWebhook } from '../middleware/validateWebhook.js';
import { webhookRateLimiter } from '../middleware/rateLimiter.js';
import * as ctrl from '../controllers/webhooks.js';

const router = Router();

// Nomba webhook endpoint — HMAC verified, NOT behind API key auth
router.post('/nomba', webhookRateLimiter, validateWebhook, ctrl.receive);

// Management endpoints — API key OR dashboard session
router.get('/events', requireApiKeyOrSession, ctrl.listEvents);
router.get('/events/:id', requireApiKeyOrSession, ctrl.getEvent);
router.post('/events/:id/replay', requireApiKeyOrSession, ctrl.replay);

export default router;

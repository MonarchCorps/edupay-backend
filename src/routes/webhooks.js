import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { validateWebhook } from '../middleware/validateWebhook.js'
import { webhookRateLimiter } from '../middleware/rateLimiter.js'
import * as ctrl from '../controllers/webhooks.js'

const router = Router()

// Nomba webhook endpoint — HMAC verified, NOT behind API key auth
router.post('/nomba', webhookRateLimiter, validateWebhook, ctrl.receive)

// Management endpoints — API key auth required
router.get('/events',              requireAuth, ctrl.listEvents)
router.get('/events/:id',          requireAuth, ctrl.getEvent)
router.post('/events/:id/replay',  requireAuth, ctrl.replay)

export default router

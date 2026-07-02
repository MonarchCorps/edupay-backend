import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { authMeRateLimiter } from '../middleware/rateLimiter.js';
import * as ctrl from '../controllers/auth.js';

const router = Router();

const merchantSchema = z.object({
    name: z.string().min(2).max(255),
    email: z.string().email(),
});

const keySchema = z.object({
    label: z.string().max(100).optional(),
    mode: z.enum(['sandbox', 'live']).default('sandbox'),
});

router.get('/me', authMeRateLimiter, requireAuth, ctrl.getMe);
router.post('/merchants', validate(merchantSchema), ctrl.registerMerchant);
router.post(
    '/merchants/:merchantId/keys',
    validate(keySchema),
    ctrl.bootstrapKey,
);
router.post('/keys', requireAuth, validate(keySchema), ctrl.generateKey);
router.get('/keys', requireAuth, ctrl.listKeys);
router.delete('/keys/:id', requireAuth, ctrl.revokeKey);

export default router;

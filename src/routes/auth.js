import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireSession } from '../middleware/sessionAuth.js';
import { authRateLimiter } from '../middleware/rateLimiter.js';
import * as ctrl from '../controllers/auth.js';

const router = Router();

const merchantSchema = z.object({
    name: z.string().min(2).max(255),
    email: z.string().email(),
    password: z.string().min(8).max(255),
});

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
});

const keySchema = z.object({
    label: z.string().max(100).optional(),
    mode: z.enum(['sandbox', 'live']).default('sandbox'),
});

router.get('/me', authRateLimiter, requireSession, ctrl.getMe);
router.post('/login', authRateLimiter, validate(loginSchema), ctrl.login);
router.post('/merchants', validate(merchantSchema), ctrl.registerMerchant);
router.post(
    '/merchants/:merchantId/keys',
    validate(keySchema),
    ctrl.bootstrapKey,
);
router.post('/keys', requireSession, validate(keySchema), ctrl.generateKey);
router.get('/keys', requireSession, ctrl.listKeys);
router.delete('/keys/:id', requireSession, ctrl.revokeKey);

export default router;

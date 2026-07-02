import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireSession } from '../middleware/sessionAuth.js';
import * as ctrl from '../controllers/sandbox.js';

const router = Router();

router.use(requireSession);

const simulateSchema = z.object({
    accountId: z.string().uuid(),
    amount: z.coerce.number().positive(),
    senderName: z.string().min(1).max(255),
});

router.post('/simulate-webhook', validate(simulateSchema), ctrl.simulate);

export default router;

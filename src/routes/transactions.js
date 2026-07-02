import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import {
    requireApiKeyOrSession,
    requireMerchantMode,
} from '../middleware/sessionAuth.js';
import * as ctrl from '../controllers/transactions.js';

const router = Router();

router.use(requireApiKeyOrSession, requireMerchantMode);

const resolveSchema = z.object({
    action: z.enum(['allocate', 'return']),
});

router.get('/', ctrl.list);
router.get('/:id', ctrl.get);
router.post('/:id/resolve', validate(resolveSchema), ctrl.resolve);

export default router;

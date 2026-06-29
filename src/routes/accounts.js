import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate.js'
import { requireAuth } from '../middleware/auth.js'
import { idempotency } from '../utils/idempotency.js'
import * as ctrl from '../controllers/accounts.js'

const router = Router()

router.use(requireAuth)

const provisionSchema = z.object({
  customerName: z.string().min(2).max(255),
  customerId:   z.string().min(1).max(255),
  kycTier:      z.enum(['tier1', 'tier2', 'tier3']).default('tier1'),
})

const renameSchema = z.object({
  customerName: z.string().min(2).max(255),
})

const listSchema = z.object({
  status:   z.enum(['pending','active','frozen','closed','flagged','resolved']).optional(),
  kycTier:  z.enum(['tier1','tier2','tier3']).optional(),
  search:   z.string().optional(),
  page:     z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const freezeSchema = z.object({ reason: z.string().max(500).optional() })

router.post('/',                   idempotency(), validate(provisionSchema), ctrl.create)
router.get('/',                    validate(listSchema, 'query'),            ctrl.list)
router.get('/:id',                                                           ctrl.get)
router.patch('/:id',               validate(renameSchema),                   ctrl.update)
router.post('/:id/freeze',         validate(freezeSchema),                   ctrl.freeze)
router.post('/:id/unfreeze',                                                 ctrl.unfreeze)
router.post('/:id/close',          idempotency(),                            ctrl.close)
router.get('/:id/statement',                                                 ctrl.statement)
router.get('/:id/history',                                                   ctrl.history)

export default router

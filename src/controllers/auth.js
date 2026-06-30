import { generateApiKey } from '../utils/crypto.js'
import { createApiKey, findApiKeysByMerchant, revokeApiKey } from '../db/queries/apiKeys.js'
import { createMerchant, findMerchantByEmail, findMerchantById } from '../db/queries/merchants.js'
import { success } from '../utils/response.js'
import { serializeApiKey } from '../utils/serializers.js'
import { errors } from '../utils/errors.js'

export async function getMerchantByEmail(req, res, next) {
  try {
    const { email } = req.query
    if (!email) throw errors.badRequest('email query param is required')
    const merchant = await findMerchantByEmail(email)
    if (!merchant) throw errors.notFound('Merchant')
    return success(res, merchant)
  } catch (err) { next(err) }
}

export async function registerMerchant(req, res, next) {
  try {
    const { name, email } = req.body
    const existing = await findMerchantByEmail(email)
    if (existing) throw errors.duplicate('Email')

    const merchant = await createMerchant({ name, email })
    return success(res, merchant, 201)
  } catch (err) { next(err) }
}

// Bootstrap: generate the FIRST key for a merchant using only their ID.
// No prior API key needed. Safe because the caller must know the merchant UUID.
export async function bootstrapKey(req, res, next) {
  try {
    const merchant = await findMerchantById(req.params.merchantId)
    if (!merchant) throw errors.notFound('Merchant')

    const { key, prefix, hash } = generateApiKey()
    const { label } = req.body ?? {}

    const record = await createApiKey({
      merchantId: merchant.id,
      keyHash: hash,
      keyPrefix: prefix,
      label: label ?? 'Default key',
    })

    return success(res, serializeApiKey({ ...record, key }), 201)
  } catch (err) { next(err) }
}

export async function generateKey(req, res, next) {
  try {
    const { key, prefix, hash } = generateApiKey()
    const { label } = req.body

    const record = await createApiKey({
      merchantId: req.merchant.id,
      keyHash: hash,
      keyPrefix: prefix,
      label,
    })

    // Return raw key ONCE — never stored
    return success(res, serializeApiKey({ ...record, key }), 201)
  } catch (err) { next(err) }
}

export async function listKeys(req, res, next) {
  try {
    const keys = await findApiKeysByMerchant(req.merchant.id)
    return success(res, keys.map(serializeApiKey))
  } catch (err) { next(err) }
}

export async function revokeKey(req, res, next) {
  try {
    const revoked = await revokeApiKey(req.params.id, req.merchant.id)
    if (!revoked) throw errors.notFound('API key')
    return success(res, { id: req.params.id, revoked: true })
  } catch (err) { next(err) }
}

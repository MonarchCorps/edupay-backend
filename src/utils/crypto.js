import crypto from 'crypto'

export function generateApiKey() {
  const raw = crypto.randomBytes(32).toString('hex')
  const key = `ep_live_${raw}`
  const prefix = key.substring(0, 15) // "ep_live_" + first 7 chars
  const hash = crypto
    .createHmac('sha256', process.env.API_KEY_SALT)
    .update(key)
    .digest('hex')
  return { key, prefix, hash }
}

export function hashApiKey(key) {
  return crypto
    .createHmac('sha256', process.env.API_KEY_SALT)
    .update(key)
    .digest('hex')
}

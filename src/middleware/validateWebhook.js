import crypto from 'crypto'

export function validateWebhook(req, res, next) {
  const signature = req.headers['nomba-signature']
  const timestamp = req.headers['nomba-timestamp']
  const secret = process.env.NOMBA_WEBHOOK_SECRET

  if (!signature || !timestamp) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_WEBHOOK', message: 'Missing webhook headers' },
    })
  }

  const payload = req.body
  const { event_type, requestId, data } = payload
  const { merchant, transaction } = data ?? {}

  if (!event_type || !requestId || !merchant || !transaction) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_WEBHOOK', message: 'Malformed webhook payload' },
    })
  }

  const responseCode =
    transaction.responseCode === 'null' ? '' : (transaction.responseCode || '')

  const hashingPayload = [
    event_type,
    requestId,
    merchant.userId,
    merchant.walletId,
    transaction.transactionId,
    transaction.type,
    transaction.time,
    responseCode,
    timestamp,
  ].join(':')

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(hashingPayload)
    .digest('base64')

  const sigBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSig)

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_SIGNATURE', message: 'Webhook signature mismatch' },
    })
  }

  next()
}

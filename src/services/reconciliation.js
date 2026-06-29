import pool from '../config/db.js'
import {
  findAccountByRef, updateAccountBalance, addAuditLog,
} from '../db/queries/accounts.js'
import {
  createTransaction, findTransactionByNombaTxnId, updateTransactionStatus,
} from '../db/queries/transactions.js'
import { markWebhookProcessed, markWebhookFailed } from '../db/queries/webhookEvents.js'

export async function reconcileWebhook(webhookEvent) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { event_type } = webhookEvent.raw_payload

    if (event_type === 'payment_success') {
      await handlePaymentSuccess(webhookEvent, client)
    } else if (event_type === 'payment_reversal') {
      await handlePaymentReversal(webhookEvent, client)
    } else if (event_type === 'payment_failed') {
      await handlePaymentFailed(webhookEvent, client)
    } else {
      console.log(`Unhandled Nomba event type: ${event_type}`)
    }

    await markWebhookProcessed(webhookEvent.id, client)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    // markWebhookFailed uses pool — intentionally outside the rolled-back transaction
    try { await markWebhookFailed(webhookEvent.id, err.message) } catch (e) {
      console.error('Failed to mark webhook as failed:', e.message)
    }
    console.error(`Reconciliation failed for webhook ${webhookEvent.id}:`, err.message)
  } finally {
    client.release()
  }
}

async function handlePaymentSuccess(webhookEvent, client) {
  const txn = webhookEvent.raw_payload.data.transaction
  const aliasRef = txn.aliasAccountReference

  // Idempotency — skip if already processed
  if (txn.transactionId) {
    const existing = await findTransactionByNombaTxnId(txn.transactionId, client)
    if (existing) return
  }

  const account = await findAccountByRef(aliasRef, client)

  if (!account) {
    throw new Error(`Misdirected payment: accountRef ${aliasRef} not found — no virtual account matched`)
  }

  const amountKobo = toKobo(txn.amount)

  await createTransaction({
    virtualAccountId: account.id,
    merchantId: account.merchant_id,
    amount: amountKobo,
    direction: 'credit',
    status: 'success',
    matched: true,
    misdirected: false,
    senderName: txn.senderName ?? txn.sourceAccountName,
    senderBank: txn.senderBank ?? txn.sourceBankName,
    senderAccount: txn.senderAccount ?? txn.sourceAccountNumber,
    nombaSessionId: txn.sessionId,
    nambaTxnId: txn.transactionId,
    narration: txn.narration,
    nombaRawPayload: txn,
  }, client)

  await updateAccountBalance(account.id, amountKobo, client)

  await addAuditLog({
    virtualAccountId: account.id,
    action: 'credit_received',
    newValue: { amountKobo, transactionId: txn.transactionId, senderName: txn.senderName },
  }, client)
}

async function handlePaymentReversal(webhookEvent, client) {
  const txn = webhookEvent.raw_payload.data.transaction
  if (!txn.transactionId) return

  // Idempotency — skip if reversal already recorded
  const reversalId = `${txn.transactionId}_rev`
  const existingReversal = await findTransactionByNombaTxnId(reversalId, client)
  if (existingReversal) return

  const original = await findTransactionByNombaTxnId(txn.transactionId, client)
  if (!original) return // original never recorded — nothing to reverse

  await updateTransactionStatus(original.id, 'reversed', client)

  await createTransaction({
    virtualAccountId: original.virtual_account_id,
    merchantId: original.merchant_id,
    amount: original.amount,
    direction: 'debit',
    status: 'reversed',
    matched: true,
    misdirected: false,
    nambaTxnId: reversalId,
    narration: 'Payment reversal',
    nombaRawPayload: txn,
  }, client)

  await updateAccountBalance(original.virtual_account_id, -original.amount, client)

  await addAuditLog({
    virtualAccountId: original.virtual_account_id,
    action: 'payment_reversed',
    oldValue: { status: 'success' },
    newValue: { status: 'reversed', amountKobo: original.amount },
  }, client)
}

async function handlePaymentFailed(webhookEvent, client) {
  const txn = webhookEvent.raw_payload.data.transaction
  if (!txn.transactionId) return

  // Idempotency
  const existing = await findTransactionByNombaTxnId(txn.transactionId, client)
  if (existing) return

  const account = await findAccountByRef(txn.aliasAccountReference, client)
  if (!account) return

  await createTransaction({
    virtualAccountId: account.id,
    merchantId: account.merchant_id,
    amount: toKobo(txn.amount),
    direction: 'credit',
    status: 'failed',
    matched: false,
    misdirected: false,
    nambaTxnId: txn.transactionId,
    narration: txn.narration,
    nombaRawPayload: txn,
  }, client)
}

function toKobo(amount) {
  if (amount === null || amount === undefined) return 0
  // Handle both number and string, including comma-formatted strings
  const clean = String(amount).replace(/,/g, '')
  const num = parseFloat(clean)
  return Number.isFinite(num) ? Math.round(num * 100) : 0
}

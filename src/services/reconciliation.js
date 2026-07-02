import pool from '../config/db.js';
import {
    findAccountByRef,
    updateAccountBalance,
    updateAccountStatus,
    addAuditLog,
} from '../db/queries/accounts.js';
import {
    createTransaction,
    findTransactionByNombaTxnId,
    updateTransactionStatus,
} from '../db/queries/transactions.js';
import {
    markWebhookProcessed,
    markWebhookFailed,
    updateWebhookEventMerchant,
} from '../db/queries/webhookEvents.js';

export async function reconcileWebhook(webhookEvent) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { event_type } = webhookEvent.raw_payload;

        if (event_type === 'payment_success') {
            await handlePaymentSuccess(webhookEvent, client);
        } else if (event_type === 'payment_reversal') {
            await handlePaymentReversal(webhookEvent, client);
        } else if (event_type === 'payment_failed') {
            await handlePaymentFailed(webhookEvent, client);
        } else {
            console.log(`Unhandled Nomba event type: ${event_type}`);
        }

        await markWebhookProcessed(webhookEvent.id, client);
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        // markWebhookFailed uses pool — intentionally outside the rolled-back transaction
        try {
            await markWebhookFailed(webhookEvent.id, err.message);
        } catch (e) {
            console.error('Failed to mark webhook as failed:', e.message);
        }
        console.error(
            `Reconciliation failed for webhook ${webhookEvent.id}:`,
            err.message,
        );
    } finally {
        client.release();
    }
}

async function handlePaymentSuccess(webhookEvent, client) {
    const payload = webhookEvent.raw_payload;
    const txn = payload.data.transaction;
    const customer = payload.data.customer ?? {};
    const aliasRef = txn.aliasAccountReference;

    // Idempotency — skip if already processed
    if (txn.transactionId) {
        const existing = await findTransactionByNombaTxnId(
            txn.transactionId,
            client,
        );
        if (existing) return;
    }

    const account = await findAccountByRef(aliasRef, client);

    if (!account) {
        // No virtual account matches this reference at all — Nomba should only
        // send webhooks for accounts we provisioned, so this is a data/integration
        // problem rather than a normal "wrong recipient" case. There's no account
        // (and thus no merchant) to attach a transaction row to, so surface it as
        // a failed webhook for manual investigation instead of fabricating a row.
        throw new Error(
            `Unmatched account reference: accountRef ${aliasRef} not found — no virtual account matched`,
        );
    }

    // Now that we know which account this is, tag the webhook event with its
    // merchant so it only ever shows up in that merchant's own event log.
    await updateWebhookEventMerchant(webhookEvent.id, account.merchant_id, client);

    // Nomba sends transactionAmount (Naira), not amount
    const amountKobo = toKobo(txn.transactionAmount ?? txn.amount);
    // Sender info lives in payload.data.customer, not in transaction
    const senderName =
        customer.senderName ?? txn.senderName ?? txn.sourceAccountName ?? null;
    const senderBank =
        customer.bankName ?? txn.senderBank ?? txn.sourceBankName ?? null;
    const senderAccount =
        customer.accountNumber ??
        txn.senderAccount ??
        txn.sourceAccountNumber ??
        null;

    // Valid account, but does the sender's declared name plausibly belong to
    // this account's customer? A mismatch means the money landed on the right
    // virtual account number but likely for the wrong student/customer.
    const misdirected = !namesLikelyMatch(senderName, account.customer_name);

    await createTransaction(
        {
            virtualAccountId: account.id,
            merchantId: account.merchant_id,
            amount: amountKobo,
            direction: 'credit',
            status: 'success',
            matched: !misdirected,
            misdirected,
            senderName,
            senderBank,
            senderAccount,
            nombaSessionId: txn.sessionId,
            nambaTxnId: txn.transactionId,
            narration: txn.narration,
            nombaRawPayload: payload.data,
            environment: account.environment,
        },
        client,
    );

    if (misdirected) {
        // Hold the funds out of the account balance until the merchant reviews
        // and resolves it (allocate credits the balance, return does not).
        await updateAccountStatus(account.id, 'flagged', client);
        await addAuditLog(
            {
                virtualAccountId: account.id,
                action: 'misdirected_detected',
                newValue: {
                    amountKobo,
                    transactionId: txn.transactionId,
                    senderName,
                    expectedName: account.customer_name,
                },
                reason: 'Sender name does not match expected account holder',
            },
            client,
        );
        return;
    }

    await updateAccountBalance(account.id, amountKobo, client);

    // Track last credit timestamp
    await client.query(
        'UPDATE virtual_accounts SET last_credit_at=NOW() WHERE id=$1',
        [account.id],
    );

    await addAuditLog(
        {
            virtualAccountId: account.id,
            action: 'credit_received',
            newValue: {
                amountKobo,
                transactionId: txn.transactionId,
                senderName,
            },
        },
        client,
    );
}

async function handlePaymentReversal(webhookEvent, client) {
    const txn = webhookEvent.raw_payload.data.transaction;
    if (!txn.transactionId) return;

    // Idempotency — skip if reversal already recorded
    const reversalId = `${txn.transactionId}_rev`;
    const existingReversal = await findTransactionByNombaTxnId(
        reversalId,
        client,
    );
    if (existingReversal) return;

    const original = await findTransactionByNombaTxnId(
        txn.transactionId,
        client,
    );
    if (!original) return; // original never recorded — nothing to reverse

    await updateWebhookEventMerchant(webhookEvent.id, original.merchant_id, client);

    await updateTransactionStatus(original.id, 'reversed', client);

    await createTransaction(
        {
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
            environment: original.environment,
        },
        client,
    );

    await updateAccountBalance(
        original.virtual_account_id,
        -original.amount,
        client,
    );

    await addAuditLog(
        {
            virtualAccountId: original.virtual_account_id,
            action: 'payment_reversed',
            oldValue: { status: 'success' },
            newValue: { status: 'reversed', amountKobo: original.amount },
        },
        client,
    );
}

async function handlePaymentFailed(webhookEvent, client) {
    const txn = webhookEvent.raw_payload.data.transaction;
    if (!txn.transactionId) return;

    // Idempotency
    const existing = await findTransactionByNombaTxnId(
        txn.transactionId,
        client,
    );
    if (existing) return;

    const account = await findAccountByRef(txn.aliasAccountReference, client);
    if (!account) return;

    await updateWebhookEventMerchant(webhookEvent.id, account.merchant_id, client);

    await createTransaction(
        {
            virtualAccountId: account.id,
            merchantId: account.merchant_id,
            amount: toKobo(txn.transactionAmount ?? txn.amount),
            direction: 'credit',
            status: 'failed',
            matched: false,
            misdirected: false,
            nambaTxnId: txn.transactionId,
            narration: txn.narration,
            nombaRawPayload: txn,
            environment: account.environment,
        },
        client,
    );
}

// Normalize a free-text bank transfer name into comparable word tokens:
// lowercase, strip punctuation, collapse whitespace.
function normalizeNameTokens(name) {
    return String(name ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

// Loose match for sender-declared names vs. an account's customer name.
// Real bank transfer names vary in word order, middle names/initials, and
// titles (e.g. "MRS GRACE OKONKWO" vs "Grace Okonkwo"), so we compare token
// overlap rather than requiring an exact (or even case-insensitive) match.
// If either side has no usable tokens, we can't tell — don't flag.
function namesLikelyMatch(senderName, accountHolderName) {
    const senderTokens = normalizeNameTokens(senderName);
    const accountTokens = normalizeNameTokens(accountHolderName);
    if (!senderTokens.length || !accountTokens.length) return true;

    const accountSet = new Set(accountTokens);
    const shared = senderTokens.filter((t) => accountSet.has(t)).length;
    const required = Math.ceil(
        Math.min(senderTokens.length, accountTokens.length) / 2,
    );
    return shared >= required;
}

function toKobo(amount) {
    if (amount === null || amount === undefined) return 0;
    // Handle both number and string, including comma-formatted strings
    const clean = String(amount).replace(/,/g, '');
    const num = parseFloat(clean);
    return Number.isFinite(num) ? Math.round(num * 100) : 0;
}

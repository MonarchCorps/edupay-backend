import crypto from 'crypto';
import axios from 'axios';
import { findAccountById } from '../db/queries/accounts.js';
import { findWebhookEventById } from '../db/queries/webhookEvents.js';
import { findTransactionByNombaTxnId } from '../db/queries/transactions.js';
import { errors } from '../utils/errors.js';

const SANDBOX_BANK_NAME = 'Sandbox Test Bank';

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// The receiver acks Nomba immediately and reconciles via setImmediate
// (correct — Nomba needs a fast response). For the simulator, the caller
// wants to see the *result* of reconciliation (the transaction, the
// misdirected flag), so poll briefly for the event to finish processing
// rather than racing the frontend's refetch against an async job.
async function waitForReconciliation(eventId, { attempts = 8, delayMs = 150 } = {}) {
    for (let i = 0; i < attempts; i++) {
        const event = await findWebhookEventById(eventId);
        if (event?.processed || event?.error) return event;
        await sleep(delayMs);
    }
    return findWebhookEventById(eventId);
}

// Same field order/format validateWebhook.js expects for the real Nomba
// signature, so a simulated event is verified through the exact same code
// path a real webhook would be.
function signPayload({ eventType, requestId, merchant, transaction, timestamp }) {
    const responseCode =
        transaction.responseCode === 'null' ? '' : transaction.responseCode || '';

    const hashingPayload = [
        eventType,
        requestId,
        merchant.userId,
        merchant.walletId,
        transaction.transactionId,
        transaction.type,
        transaction.time,
        responseCode,
        timestamp,
    ].join(':');

    return crypto
        .createHmac('sha256', process.env.NOMBA_WEBHOOK_SECRET)
        .update(hashingPayload)
        .digest('base64');
}

export async function simulateWebhook({ merchantId, accountId, amount, senderName }) {
    const account = await findAccountById(accountId);
    if (!account || account.merchant_id !== merchantId) {
        throw errors.notFound('Account');
    }
    // Hard server-side gate — never simulate against a live account, no
    // matter what the UI does or doesn't show.
    if (account.environment !== 'sandbox') {
        throw errors.forbidden(
            'Cannot simulate a webhook against a live account',
        );
    }

    const timestamp = new Date().toISOString();
    const requestId = `sandbox_${crypto.randomUUID()}`;

    const merchant = { userId: 'sandbox-user', walletId: 'sandbox-wallet' };
    const transaction = {
        transactionId: `sandbox_txn_${crypto.randomUUID()}`,
        type: 'credit',
        time: timestamp,
        responseCode: '00',
        aliasAccountReference: account.account_ref,
        transactionAmount: amount, // Naira, matches the real Nomba field
        sessionId: `sandbox_session_${crypto.randomUUID()}`,
        narration: 'Sandbox simulated payment',
    };
    const customer = {
        senderName,
        bankName: SANDBOX_BANK_NAME,
        accountNumber: '0000000000',
    };

    const payload = {
        event_type: 'payment_success',
        requestId,
        data: { merchant, transaction, customer },
    };

    const signature = signPayload({
        eventType: payload.event_type,
        requestId,
        merchant,
        transaction,
        timestamp,
    });

    // POST to our own real webhook endpoint — loopback within the same
    // instance, so this exercises the actual rate limiter, HMAC
    // verification, and reconciliation logic, not a separate mock path.
    const baseUrl = `http://localhost:${process.env.PORT ?? 3001}`;
    const res = await axios.post(`${baseUrl}/webhooks/nomba`, payload, {
        headers: {
            'nomba-signature': signature,
            'nomba-timestamp': timestamp,
        },
    });

    const eventId = res.data?.data?.eventId;
    const finalEvent = eventId ? await waitForReconciliation(eventId) : null;
    const createdTxn = await findTransactionByNombaTxnId(
        transaction.transactionId,
    );

    return {
        requestId,
        transactionId: transaction.transactionId,
        accountRef: account.account_ref,
        webhookEventId: eventId ?? null,
        processed: finalEvent?.processed ?? false,
        error: finalEvent?.error ?? null,
        matched: createdTxn?.matched ?? null,
        misdirected: createdTxn?.misdirected ?? null,
    };
}

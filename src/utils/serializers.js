export function serializeAccount(row) {
    if (!row) return null;
    return {
        id: row.id,
        accountNumber: row.nomba_account_number ?? '',
        bankName: row.nomba_bank_name ?? '',
        bankCode: row.nomba_bank_code ?? '',
        customerName: row.customer_name,
        customerId: row.customer_id,
        status: row.status,
        kycTier: row.kyc_tier,
        balance: Number(row.balance ?? 0),
        lastCreditAt: row.last_credit_at ?? null,
        createdAt: row.created_at,
        nombaRef: row.account_ref ?? '',
        environment: row.environment,
    };
}

export function serializeTransaction(row) {
    if (!row) return null;
    return {
        id: row.id,
        virtualAccountId: row.virtual_account_id,
        amount: Number(row.amount ?? 0),
        direction: row.direction,
        status: row.status,
        matched: row.matched,
        misdirected: row.misdirected,
        senderName: row.sender_name ?? '',
        senderBank: row.sender_bank ?? '',
        narration: row.narration ?? '',
        nombaRef: row.nomba_session_id ?? row.nomba_txn_id ?? '',
        createdAt: row.created_at,
        runningBalance:
            row.running_balance != null
                ? Number(row.running_balance)
                : undefined,
        environment: row.environment,
    };
}

export function serializeWebhookEvent(row) {
    if (!row) return null;
    return {
        id: row.id,
        eventType: row.event_type,
        virtualAccountId: row.virtual_account_id ?? null,
        processed: row.processed,
        error: row.error ?? null,
        rawPayload: row.raw_payload,
        receivedAt: row.received_at ?? row.created_at,
        processedAt: row.processed_at ?? null,
    };
}

export function serializeMerchant(row) {
    if (!row) return null;
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        createdAt: row.created_at,
    };
}

export function serializeApiKey(row) {
    if (!row) return null;
    return {
        id: row.id,
        // key is present only on creation; key_prefix is the display token for list view
        key: row.key ?? row.key_prefix,
        label: row.label ?? null,
        environment: row.environment,
        createdAt: row.created_at,
        lastUsed: row.last_used_at ?? null,
    };
}

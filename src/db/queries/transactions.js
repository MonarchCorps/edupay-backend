import pool from '../../config/db.js';

export async function createTransaction(
    {
        virtualAccountId,
        merchantId,
        amount,
        direction,
        status = 'success',
        matched = true,
        misdirected = false,
        senderName,
        senderBank,
        senderAccount,
        nombaSessionId,
        nambaTxnId,
        narration,
        nombaRawPayload,
        environment = 'live',
    },
    client = pool,
) {
    const res = await client.query(
        `INSERT INTO transactions
       (virtual_account_id, merchant_id, amount, direction, status, matched, misdirected,
        sender_name, sender_bank, sender_account, nomba_session_id, nomba_txn_id, narration, nomba_raw_payload, environment)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
        [
            virtualAccountId,
            merchantId,
            amount,
            direction,
            status,
            matched,
            misdirected,
            senderName ?? null,
            senderBank ?? null,
            senderAccount ?? null,
            nombaSessionId ?? null,
            nambaTxnId ?? null,
            narration ?? null,
            nombaRawPayload ? JSON.stringify(nombaRawPayload) : null,
            environment,
        ],
    );
    return res.rows[0];
}

export async function findTransactionById(id, merchantId, environment) {
    const res = await pool.query(
        'SELECT * FROM transactions WHERE id=$1 AND merchant_id=$2 AND environment=$3',
        [id, merchantId, environment],
    );
    return res.rows[0] ?? null;
}

export async function findTransactionByNombaTxnId(nambaTxnId, client = pool) {
    const res = await client.query(
        'SELECT * FROM transactions WHERE nomba_txn_id=$1',
        [nambaTxnId],
    );
    return res.rows[0] ?? null;
}

export async function findTransactions({
    merchantId,
    environment,
    virtualAccountId,
    direction,
    status,
    matched,
    page = 1,
    pageSize = 20,
}) {
    const conds = ['t.merchant_id=$1', 't.environment=$2'];
    const params = [merchantId, environment];
    let i = 3;

    if (virtualAccountId) {
        conds.push(`t.virtual_account_id=$${i++}`);
        params.push(virtualAccountId);
    }
    if (direction) {
        conds.push(`t.direction=$${i++}`);
        params.push(direction);
    }
    if (status) {
        conds.push(`t.status=$${i++}`);
        params.push(status);
    }
    if (matched !== undefined) {
        conds.push(`t.matched=$${i++}`);
        params.push(matched);
    }

    const where = conds.join(' AND ');
    const offset = (page - 1) * pageSize;

    const [rows, count] = await Promise.all([
        pool.query(
            `SELECT t.*, va.account_ref, va.nomba_account_number
       FROM transactions t
       JOIN virtual_accounts va ON t.virtual_account_id=va.id
       WHERE ${where} ORDER BY t.created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
            [...params, pageSize, offset],
        ),
        pool.query(
            `SELECT COUNT(*) FROM transactions t WHERE ${where}`,
            params,
        ),
    ]);

    return { data: rows.rows, total: parseInt(count.rows[0].count, 10) };
}

export async function updateTransactionStatus(id, status, client = pool) {
    const res = await client.query(
        'UPDATE transactions SET status=$1 WHERE id=$2 RETURNING *',
        [status, id],
    );
    return res.rows[0];
}

export async function updateTransactionMisdirected(
    id,
    matched,
    misdirected,
    client = pool,
) {
    const res = await client.query(
        'UPDATE transactions SET matched=$1, misdirected=$2 WHERE id=$3 RETURNING *',
        [matched, misdirected, id],
    );
    return res.rows[0];
}

export async function findTransactionsByAccount(virtualAccountId) {
    const res = await pool.query(
        'SELECT * FROM transactions WHERE virtual_account_id=$1 ORDER BY created_at ASC',
        [virtualAccountId],
    );
    return res.rows;
}

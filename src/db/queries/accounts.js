import pool from '../../config/db.js';

export async function createAccount(
    {
        merchantId,
        customerId,
        customerName,
        kycTier,
        accountRef,
        nombaAccountNumber,
        nambaBankName,
        nambaBankCode,
        nombaRawResponse,
    },
    client = pool,
) {
    const res = await client.query(
        `INSERT INTO virtual_accounts
       (merchant_id, customer_id, customer_name, kyc_tier, account_ref,
        nomba_account_number, nomba_bank_name, nomba_bank_code, nomba_raw_response, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active')
     RETURNING *`,
        [
            merchantId,
            customerId,
            customerName,
            kycTier,
            accountRef,
            nombaAccountNumber ?? null,
            nambaBankName ?? null,
            nambaBankCode ?? null,
            nombaRawResponse ? JSON.stringify(nombaRawResponse) : null,
        ],
    );
    return res.rows[0];
}

export async function findAccountById(id, client = pool) {
    const res = await client.query(
        'SELECT * FROM virtual_accounts WHERE id = $1',
        [id],
    );
    return res.rows[0] ?? null;
}

export async function findAccountByRef(accountRef, client = pool) {
    const res = await client.query(
        'SELECT * FROM virtual_accounts WHERE account_ref = $1',
        [accountRef],
    );
    return res.rows[0] ?? null;
}

export async function findAccounts({
    merchantId,
    status,
    kycTier,
    search,
    page = 1,
    pageSize = 20,
}) {
    const conds = ['merchant_id = $1'];
    const params = [merchantId];
    let i = 2;

    if (status) {
        conds.push(`status = $${i++}`);
        params.push(status);
    }
    if (kycTier) {
        conds.push(`kyc_tier = $${i++}`);
        params.push(kycTier);
    }
    if (search) {
        conds.push(
            `(customer_name ILIKE $${i} OR nomba_account_number ILIKE $${i})`,
        );
        params.push(`%${search}%`);
        i++;
    }

    const where = conds.join(' AND ');
    const offset = (page - 1) * pageSize;

    const [rows, count] = await Promise.all([
        pool.query(
            `SELECT * FROM virtual_accounts WHERE ${where}
       ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
            [...params, pageSize, offset],
        ),
        pool.query(
            `SELECT COUNT(*) FROM virtual_accounts WHERE ${where}`,
            params,
        ),
    ]);

    return { data: rows.rows, total: parseInt(count.rows[0].count, 10) };
}

export async function updateAccountStatus(id, status, client = pool) {
    const res = await client.query(
        `UPDATE virtual_accounts SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
        [status, id],
    );
    return res.rows[0];
}

export async function updateAccountBalance(id, amountKobo, client = pool) {
    const res = await client.query(
        `UPDATE virtual_accounts SET balance=balance+$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
        [amountKobo, id],
    );
    return res.rows[0];
}

export async function updateAccountName(
    id,
    newName,
    renameHistory,
    client = pool,
) {
    const res = await client.query(
        `UPDATE virtual_accounts SET customer_name=$1, rename_history=$2::jsonb, updated_at=NOW()
     WHERE id=$3 RETURNING *`,
        [newName, JSON.stringify(renameHistory), id],
    );
    return res.rows[0];
}

export async function addAuditLog(
    { virtualAccountId, action, oldValue, newValue, reason },
    client = pool,
) {
    const res = await client.query(
        `INSERT INTO account_audit_log (virtual_account_id, action, old_value, new_value, reason)
     VALUES ($1,$2,$3::jsonb,$4::jsonb,$5) RETURNING *`,
        [
            virtualAccountId,
            action,
            oldValue ? JSON.stringify(oldValue) : null,
            newValue ? JSON.stringify(newValue) : null,
            reason ?? null,
        ],
    );
    return res.rows[0];
}

export async function findAuditLog(virtualAccountId) {
    const res = await pool.query(
        'SELECT * FROM account_audit_log WHERE virtual_account_id=$1 ORDER BY created_at DESC',
        [virtualAccountId],
    );
    return res.rows;
}

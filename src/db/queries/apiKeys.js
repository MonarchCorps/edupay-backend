import pool from '../../config/db.js';

export async function createApiKey({ merchantId, keyHash, keyPrefix, label }) {
    const res = await pool.query(
        `INSERT INTO api_keys (merchant_id, key_hash, key_prefix, label)
     VALUES ($1,$2,$3,$4)
     RETURNING id, merchant_id, key_prefix, label, created_at`,
        [merchantId, keyHash, keyPrefix, label ?? null],
    );
    return res.rows[0];
}

export async function findApiKeyByHash(keyHash) {
    const res = await pool.query(
        `SELECT k.*, m.name AS merchant_name, m.email AS merchant_email
     FROM api_keys k
     JOIN merchants m ON k.merchant_id=m.id
     WHERE k.key_hash=$1 AND k.revoked=false`,
        [keyHash],
    );
    return res.rows[0] ?? null;
}

export async function findApiKeysByMerchant(merchantId) {
    const res = await pool.query(
        `SELECT id, merchant_id, key_prefix, label, last_used_at, revoked, created_at
     FROM api_keys WHERE merchant_id=$1 AND revoked=false ORDER BY created_at DESC`,
        [merchantId],
    );
    return res.rows;
}

export async function revokeApiKey(id, merchantId) {
    const res = await pool.query(
        `UPDATE api_keys SET revoked=true WHERE id=$1 AND merchant_id=$2 RETURNING id`,
        [id, merchantId],
    );
    return res.rows[0] ?? null;
}

export async function updateApiKeyLastUsed(id) {
    await pool.query('UPDATE api_keys SET last_used_at=NOW() WHERE id=$1', [
        id,
    ]);
}

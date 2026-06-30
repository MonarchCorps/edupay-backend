import pool from '../../config/db.js';

export async function createWebhookEvent({
    nombaRequestId,
    eventType,
    rawPayload,
}) {
    const res = await pool.query(
        `INSERT INTO webhook_events (nomba_request_id, event_type, raw_payload)
     VALUES ($1,$2,$3::jsonb) RETURNING *`,
        [nombaRequestId ?? null, eventType, JSON.stringify(rawPayload)],
    );
    return res.rows[0];
}

export async function findWebhookEventById(id) {
    const res = await pool.query('SELECT * FROM webhook_events WHERE id=$1', [
        id,
    ]);
    return res.rows[0] ?? null;
}

export async function findWebhookEventByNombaRequestId(nombaRequestId) {
    const res = await pool.query(
        'SELECT * FROM webhook_events WHERE nomba_request_id=$1',
        [nombaRequestId],
    );
    return res.rows[0] ?? null;
}

export async function findWebhookEvents({
    processed,
    page = 1,
    pageSize = 20,
} = {}) {
    const conds = [];
    const params = [];
    let i = 1;

    if (processed !== undefined) {
        conds.push(`processed=$${i++}`);
        params.push(processed);
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const offset = (page - 1) * pageSize;

    const [rows, count] = await Promise.all([
        pool.query(
            `SELECT * FROM webhook_events ${where} ORDER BY received_at DESC LIMIT $${i} OFFSET $${i + 1}`,
            [...params, pageSize, offset],
        ),
        pool.query(`SELECT COUNT(*) FROM webhook_events ${where}`, params),
    ]);

    return { data: rows.rows, total: parseInt(count.rows[0].count, 10) };
}

export async function markWebhookProcessed(id, client = pool) {
    const res = await client.query(
        `UPDATE webhook_events SET processed=true, processed_at=NOW(), error=NULL WHERE id=$1 RETURNING *`,
        [id],
    );
    return res.rows[0];
}

export async function markWebhookFailed(id, errorMessage) {
    const res = await pool.query(
        `UPDATE webhook_events SET error=$1, retry_count=retry_count+1 WHERE id=$2 RETURNING *`,
        [errorMessage, id],
    );
    return res.rows[0];
}

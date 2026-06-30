import pool from '../../config/db.js';

export async function createMerchant({ name, email }) {
    const res = await pool.query(
        `INSERT INTO merchants (name, email) VALUES ($1, $2) RETURNING *`,
        [name, email],
    );
    return res.rows[0];
}

export async function findMerchantById(id) {
    const res = await pool.query('SELECT * FROM merchants WHERE id = $1', [id]);
    return res.rows[0] ?? null;
}

export async function findMerchantByEmail(email) {
    const res = await pool.query('SELECT * FROM merchants WHERE email = $1', [
        email,
    ]);
    return res.rows[0] ?? null;
}

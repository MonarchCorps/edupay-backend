import pool from '../../config/db.js';

export async function createMerchant({ name, email, passwordHash }) {
    const res = await pool.query(
        `INSERT INTO merchants (name, email, password_hash) VALUES ($1, $2, $3) RETURNING *`,
        [name, email, passwordHash],
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

import pg from 'pg'

const { Pool } = pg

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

pool.on('error', (err) => {
  console.error('Unexpected idle client error:', err)
})

export async function testConnection() {
  const client = await pool.connect()
  try {
    const result = await client.query('SELECT NOW()')
    console.log(`✓ Database connected (${result.rows[0].now})`)
  } finally {
    client.release()
  }
}

export default pool

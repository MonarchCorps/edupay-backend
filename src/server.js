import 'dotenv/config';
import app from './app.js';
import { testConnection } from './config/db.js';

const PORT = Number(process.env.PORT ?? 3001);

const REQUIRED_ENV = [
    'DATABASE_URL',
    'API_KEY_SALT',
    'NOMBA_WEBHOOK_SECRET',
    'NOMBA_CLIENT_ID',
    'NOMBA_CLIENT_SECRET',
    'NOMBA_ACCOUNT_ID',
    'NOMBA_BASE_URL',
];

function validateEnv() {
    const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
    if (missing.length) {
        console.error(`Missing required env vars: ${missing.join(', ')}`);
        process.exit(1);
    }
}

async function start() {
    validateEnv();
    await testConnection();
    app.listen(PORT, () => {
        console.log(`EduPay backend listening on http://localhost:${PORT}`);
        console.log(`  POST /auth/merchants   → register merchant`);
        console.log(`  POST /accounts         → provision DVA`);
        console.log(`  POST /webhooks/nomba   → Nomba webhook receiver`);
        console.log(`  GET  /healthz          → health check`);
    });
}

start().catch((err) => {
    console.error('Startup failed:', err);
    process.exit(1);
});

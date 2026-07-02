import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimiter } from './middleware/rateLimiter.js';
import { errorHandler } from './middleware/errorHandler.js';
import accountRoutes from './routes/accounts.js';
import transactionRoutes from './routes/transactions.js';
import webhookRoutes from './routes/webhooks.js';
import authRoutes from './routes/auth.js';
import sandboxRoutes from './routes/sandbox.js';

const app = express();

app.set('trust proxy', 1);

app.use(helmet());
app.use(
    cors({
        origin: [
            'https://edupay-frontend-s8w4.onrender.com',
            'http://localhost:5173', // Vite dev server
            'http://localhost:4173', // Vite preview
            'http://localhost:3000', // alternative dev port
        ],
        credentials: true,
    }),
);
app.use(express.json());
app.use(rateLimiter);

app.use('/accounts', accountRoutes);
app.use('/transactions', transactionRoutes);
app.use('/webhooks', webhookRoutes);
app.use('/auth', authRoutes);
app.use('/sandbox', sandboxRoutes);

app.get('/healthz', (req, res) =>
    res.json({ status: 'ok', timestamp: new Date().toISOString() }),
);

app.use((_req, res) =>
    res
        .status(404)
        .json({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Route not found' },
        }),
);

app.use(errorHandler);

export default app;

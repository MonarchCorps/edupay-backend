import { hashApiKey } from '../utils/crypto.js';
import {
    findApiKeyByHash,
    updateApiKeyLastUsed,
} from '../db/queries/apiKeys.js';
import { AppError } from '../utils/errors.js';

export async function requireAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            throw new AppError(
                'Invalid or missing API key',
                'UNAUTHORIZED',
                401,
            );
        }

        const key = authHeader.slice(7).trim();
        const hash = hashApiKey(key);
        const apiKey = await findApiKeyByHash(hash);

        if (!apiKey) {
            throw new AppError(
                'Invalid or missing API key',
                'UNAUTHORIZED',
                401,
            );
        }

        req.merchant = {
            id: apiKey.merchant_id,
            name: apiKey.merchant_name,
            email: apiKey.merchant_email,
        };
        // Which environment this key belongs to — downstream services use
        // this to keep sandbox data/calls fully isolated from live ones.
        req.merchantMode = apiKey.environment;

        // Fire-and-forget last_used update
        updateApiKeyLastUsed(apiKey.id).catch(console.error);

        next();
    } catch (err) {
        next(err);
    }
}

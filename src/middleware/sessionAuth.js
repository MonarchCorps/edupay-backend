import { hashApiKey } from '../utils/crypto.js';
import { verifySessionToken } from '../utils/jwt.js';
import {
    findApiKeyByHash,
    updateApiKeyLastUsed,
} from '../db/queries/apiKeys.js';
import { findMerchantById } from '../db/queries/merchants.js';
import { errors } from '../utils/errors.js';

function extractBearerToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        throw errors.invalidSession();
    }
    return authHeader.slice(7).trim();
}

// Pure session auth — dashboard-only routes (login-gated account/key
// management) that a raw API key should never be able to reach.
export async function requireSession(req, res, next) {
    try {
        const token = extractBearerToken(req);
        const payload = verifySessionToken(token);
        const merchant = await findMerchantById(payload.sub);
        if (!merchant) throw errors.invalidSession();

        req.merchant = {
            id: merchant.id,
            name: merchant.name,
            email: merchant.email,
        };
        req.authType = 'session';
        next();
    } catch (err) {
        next(err);
    }
}

// Dual auth for routes shared between third-party API consumers (API key)
// and the dashboard (session token) — /accounts, /transactions,
// /webhook-events. An API key is authoritative for its own environment; a
// session token carries no environment of its own, so merchantMode comes
// from the ?environment= query param instead (validated by
// requireMerchantMode, applied after this on routes that need it).
export async function requireApiKeyOrSession(req, res, next) {
    try {
        const token = extractBearerToken(req);

        const apiKey = await findApiKeyByHash(hashApiKey(token));
        if (apiKey) {
            req.merchant = {
                id: apiKey.merchant_id,
                name: apiKey.merchant_name,
                email: apiKey.merchant_email,
            };
            req.merchantMode = apiKey.environment;
            req.authType = 'api_key';
            updateApiKeyLastUsed(apiKey.id).catch(console.error);
            return next();
        }

        const payload = verifySessionToken(token);
        const merchant = await findMerchantById(payload.sub);
        if (!merchant) throw errors.invalidSession();

        req.merchant = {
            id: merchant.id,
            name: merchant.name,
            email: merchant.email,
        };
        req.merchantMode =
            req.query.environment === 'sandbox' ||
            req.query.environment === 'live'
                ? req.query.environment
                : undefined;
        req.authType = 'session';
        next();
    } catch (err) {
        next(err);
    }
}

// Environment is implicit for API-key auth (from the key itself) but must
// be explicit for session auth, since a dashboard session isn't tied to one
// mode. Apply after requireApiKeyOrSession on routes that filter by
// environment (accounts, transactions) — not needed for webhook events,
// which aren't environment-scoped.
export function requireMerchantMode(req, res, next) {
    if (!req.merchantMode) {
        return next(
            errors.badRequest(
                'environment query parameter (sandbox|live) is required',
            ),
        );
    }
    next();
}

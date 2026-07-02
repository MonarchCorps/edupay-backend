import { generateApiKey } from '../utils/crypto.js';
import {
    createApiKey,
    findApiKeysByMerchant,
    hasApiKeyForMerchant,
    revokeApiKey,
} from '../db/queries/apiKeys.js';
import {
    createMerchant,
    findMerchantByEmail,
    findMerchantById,
} from '../db/queries/merchants.js';
import { success } from '../utils/response.js';
import { serializeApiKey } from '../utils/serializers.js';
import { errors } from '../utils/errors.js';

// Sign-in check: the caller already proved possession of a valid API key via
// requireAuth, so this just confirms it and returns the merchant it belongs to.
export async function getMe(req, res, next) {
    try {
        const merchant = await findMerchantById(req.merchant.id);
        if (!merchant) throw errors.notFound('Merchant');
        return success(res, merchant);
    } catch (err) {
        next(err);
    }
}

export async function registerMerchant(req, res, next) {
    try {
        const { name, email } = req.body;
        const existing = await findMerchantByEmail(email);
        if (existing) throw errors.duplicate('Email');

        const merchant = await createMerchant({ name, email });
        return success(res, merchant, 201);
    } catch (err) {
        next(err);
    }
}

// Bootstrap: generate the FIRST key for a merchant using only their ID.
// No prior API key needed — only usable immediately after registration, once,
// before any key exists for the merchant. This is what closes the hole where
// knowing/guessing a merchant UUID let anyone mint themselves a fresh key.
export async function bootstrapKey(req, res, next) {
    try {
        const merchant = await findMerchantById(req.params.merchantId);
        if (!merchant) throw errors.notFound('Merchant');

        if (await hasApiKeyForMerchant(merchant.id)) {
            throw errors.conflict(
                'This merchant already has an API key — bootstrap can only run once',
            );
        }

        // Bootstrap always mints a sandbox key — merchants opt into a live
        // key later via Settings once they're ready to move off test data.
        const { key, prefix, hash, environment } = generateApiKey('sandbox');
        const { label } = req.body ?? {};

        const record = await createApiKey({
            merchantId: merchant.id,
            keyHash: hash,
            keyPrefix: prefix,
            label: label ?? 'Default key',
            environment,
        });

        return success(res, serializeApiKey({ ...record, key }), 201);
    } catch (err) {
        next(err);
    }
}

export async function generateKey(req, res, next) {
    try {
        const { label, mode } = req.body;
        const { key, prefix, hash, environment } = generateApiKey(mode);

        const record = await createApiKey({
            merchantId: req.merchant.id,
            keyHash: hash,
            keyPrefix: prefix,
            label,
            environment,
        });

        // Return raw key ONCE — never stored
        return success(res, serializeApiKey({ ...record, key }), 201);
    } catch (err) {
        next(err);
    }
}

export async function listKeys(req, res, next) {
    try {
        const keys = await findApiKeysByMerchant(req.merchant.id);
        return success(res, keys.map(serializeApiKey));
    } catch (err) {
        next(err);
    }
}

export async function revokeKey(req, res, next) {
    try {
        const revoked = await revokeApiKey(req.params.id, req.merchant.id);
        if (!revoked) throw errors.notFound('API key');
        return success(res, { id: req.params.id, revoked: true });
    } catch (err) {
        next(err);
    }
}

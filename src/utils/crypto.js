import crypto from 'crypto';

export function generateApiKey(mode = 'sandbox') {
    const environment = mode === 'live' ? 'live' : 'sandbox';
    const header = `ep_${environment}_`;
    const raw = crypto.randomBytes(32).toString('hex');
    const key = `${header}${raw}`;
    const prefix = key.substring(0, header.length + 7); // header + first 7 chars of raw
    const hash = crypto
        .createHmac('sha256', process.env.API_KEY_SALT)
        .update(key)
        .digest('hex');
    return { key, prefix, hash, environment };
}

export function hashApiKey(key) {
    return crypto
        .createHmac('sha256', process.env.API_KEY_SALT)
        .update(key)
        .digest('hex');
}

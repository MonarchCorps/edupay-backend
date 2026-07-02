import jwt from 'jsonwebtoken';
import { errors } from './errors.js';

const SESSION_TOKEN_TTL = '24h';

export function signSessionToken(merchant) {
    return jwt.sign(
        { sub: merchant.id },
        process.env.JWT_SECRET,
        { expiresIn: SESSION_TOKEN_TTL },
    );
}

export function verifySessionToken(token) {
    try {
        return jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        throw errors.invalidSession();
    }
}

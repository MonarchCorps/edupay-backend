export class AppError extends Error {
    constructor(message, code, status = 400) {
        super(message);
        this.name = 'AppError';
        this.code = code;
        this.status = status;
    }
}

export const errors = {
    notFound: (resource) =>
        new AppError(`${resource} not found`, 'NOT_FOUND', 404),
    unauthorized: () =>
        new AppError('Invalid or missing API key', 'UNAUTHORIZED', 401),
    invalidSession: () =>
        new AppError('Invalid or expired session', 'UNAUTHORIZED', 401),
    invalidCredentials: () =>
        new AppError('Invalid email or password', 'UNAUTHORIZED', 401),
    forbidden: (msg = 'Access denied') => new AppError(msg, 'FORBIDDEN', 403),
    duplicate: (field) =>
        new AppError(`${field} already exists`, 'DUPLICATE', 409),
    nombaError: (msg) =>
        new AppError(`Nomba API error: ${msg}`, 'NOMBA_ERROR', 502),
    webhookInvalid: () =>
        new AppError('Invalid webhook signature', 'INVALID_SIGNATURE', 401),
    conflict: (msg) => new AppError(msg, 'CONFLICT', 409),
    badRequest: (msg) => new AppError(msg, 'BAD_REQUEST', 400),
    unprocessable: (msg) => new AppError(msg, 'UNPROCESSABLE', 422),
};

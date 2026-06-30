const cache = new Map();
const TTL = 24 * 60 * 60 * 1000; // 24 hours

// Purge expired entries every hour
setInterval(
    () => {
        const now = Date.now();
        for (const [key, value] of cache.entries()) {
            if (now - value.createdAt > TTL) cache.delete(key);
        }
    },
    60 * 60 * 1000,
).unref();

export function idempotency() {
    return (req, res, next) => {
        const rawKey = req.headers['x-idempotency-key'];
        if (!rawKey) return next();

        // Scope key to the authenticated merchant to prevent cross-merchant collisions.
        // requireAuth runs before this middleware via router.use(), so req.merchant is set.
        const merchantId = req.merchant?.id ?? 'anon';
        const key = `${merchantId}:${rawKey}`;

        const cached = cache.get(key);
        if (cached) {
            if (cached.status === 'processing') {
                return res.status(409).json({
                    success: false,
                    error: {
                        code: 'DUPLICATE_REQUEST',
                        message:
                            'A request with this idempotency key is already in flight',
                    },
                });
            }
            if (cached.status === 'complete') {
                return res
                    .status(cached.response.status)
                    .json(cached.response.body);
            }
        }

        cache.set(key, { status: 'processing', createdAt: Date.now() });

        // Intercept response to cache it
        const originalJson = res.json.bind(res);
        res.json = (body) => {
            cache.set(key, {
                status: 'complete',
                response: { status: res.statusCode, body },
                createdAt: Date.now(),
            });
            return originalJson(body);
        };

        next();
    };
}

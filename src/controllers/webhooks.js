import {
    createWebhookEvent,
    findWebhookEventByNombaRequestId,
    findWebhookEvents,
    findWebhookEventById,
} from '../db/queries/webhookEvents.js';
import { reconcileWebhook } from '../services/reconciliation.js';
import { success, paginated } from '../utils/response.js';
import { serializeWebhookEvent } from '../utils/serializers.js';
import { errors } from '../utils/errors.js';

export async function receive(req, res, next) {
    try {
        const payload = req.body;
        const { requestId, event_type } = payload;

        // Idempotency — deduplicate by Nomba requestId
        if (requestId) {
            const existing = await findWebhookEventByNombaRequestId(requestId);
            if (existing) {
                return res
                    .status(200)
                    .json({
                        success: true,
                        data: { received: true, duplicate: true },
                    });
            }
        }

        // Store immediately BEFORE processing
        const event = await createWebhookEvent({
            nombaRequestId: requestId ?? null,
            eventType: event_type,
            rawPayload: payload,
        });

        // Acknowledge to Nomba immediately
        res.status(200).json({
            success: true,
            data: { received: true, eventId: event.id },
        });

        // Process asynchronously — errors are captured in webhook_events.error
        setImmediate(() => reconcileWebhook(event));
    } catch (err) {
        console.error('Webhook storage error:', err);
        next(err);
    }
}

export async function listEvents(req, res, next) {
    try {
        const { processed, page, pageSize } = req.query;
        const { data, total } = await findWebhookEvents({
            merchantId: req.merchant.id,
            processed:
                processed !== undefined ? processed === 'true' : undefined,
            page: Number(page) || 1,
            pageSize: Number(pageSize) || 20,
        });
        return paginated(
            res,
            data.map(serializeWebhookEvent),
            total,
            Number(page) || 1,
            Number(pageSize) || 20,
        );
    } catch (err) {
        next(err);
    }
}

export async function getEvent(req, res, next) {
    try {
        const event = await findWebhookEventById(req.params.id);
        if (!event || event.merchant_id !== req.merchant.id)
            throw errors.notFound('Webhook event');
        return success(res, serializeWebhookEvent(event));
    } catch (err) {
        next(err);
    }
}

export async function replay(req, res, next) {
    try {
        const event = await findWebhookEventById(req.params.id);
        if (!event || event.merchant_id !== req.merchant.id)
            throw errors.notFound('Webhook event');
        if (event.processed) {
            throw errors.conflict(
                'Event has already been processed successfully',
            );
        }

        await reconcileWebhook(event);

        const updated = await findWebhookEventById(req.params.id);
        return success(res, serializeWebhookEvent(updated));
    } catch (err) {
        next(err);
    }
}

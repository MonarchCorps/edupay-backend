import { simulateWebhook } from '../services/sandboxSimulator.js';
import { success } from '../utils/response.js';

export async function simulate(req, res, next) {
    try {
        const { accountId, amount, senderName } = req.body;
        const result = await simulateWebhook({
            merchantId: req.merchant.id,
            accountId,
            amount,
            senderName,
        });
        return success(res, result, 201);
    } catch (err) {
        next(err);
    }
}

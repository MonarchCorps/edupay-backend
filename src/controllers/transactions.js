import {
    findTransactions,
    findTransactionById,
} from '../db/queries/transactions.js';
import { resolveMisdirectedPayment } from '../services/edgeCases.js';
import { success, paginated } from '../utils/response.js';
import { serializeTransaction } from '../utils/serializers.js';
import { errors } from '../utils/errors.js';

export async function list(req, res, next) {
    try {
        const { virtualAccountId, direction, status, matched, page, pageSize } =
            req.query;
        const { data, total } = await findTransactions({
            merchantId: req.merchant.id,
            virtualAccountId,
            direction,
            status,
            matched: matched !== undefined ? matched === 'true' : undefined,
            page: Number(page) || 1,
            pageSize: Number(pageSize) || 20,
        });
        return paginated(
            res,
            data.map(serializeTransaction),
            total,
            Number(page) || 1,
            Number(pageSize) || 20,
        );
    } catch (err) {
        next(err);
    }
}

export async function get(req, res, next) {
    try {
        const txn = await findTransactionById(req.params.id, req.merchant.id);
        if (!txn) throw errors.notFound('Transaction');
        return success(res, serializeTransaction(txn));
    } catch (err) {
        next(err);
    }
}

export async function resolve(req, res, next) {
    try {
        const result = await resolveMisdirectedPayment({
            transactionId: req.params.id,
            merchantId: req.merchant.id,
            action: req.body.action,
        });
        return success(res, result);
    } catch (err) {
        next(err);
    }
}

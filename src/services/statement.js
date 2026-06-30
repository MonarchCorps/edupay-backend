import { findAccountById } from '../db/queries/accounts.js';
import { findTransactionsByAccount } from '../db/queries/transactions.js';
import { errors } from '../utils/errors.js';

export async function getStatement({
    accountId,
    merchantId,
    page = 1,
    pageSize = 50,
}) {
    const account = await findAccountById(accountId);
    if (!account || account.merchant_id !== merchantId) {
        throw errors.notFound('Account');
    }

    const allTxns = await findTransactionsByAccount(accountId);

    let runningBalance = 0;
    let totalCredits = 0;
    let totalDebits = 0;

    const withBalance = allTxns.map((txn) => {
        const signed = txn.direction === 'credit' ? txn.amount : -txn.amount;

        // 'failed' and 'pending' transactions never touched the real balance
        if (txn.status === 'success' || txn.status === 'reversed') {
            runningBalance += signed;
        }

        // Totals only reflect settled (non-reversed) movements
        if (txn.status === 'success') {
            if (txn.direction === 'credit') totalCredits += txn.amount;
            else totalDebits += txn.amount;
        }

        return { ...txn, running_balance: runningBalance };
    });

    const total = withBalance.length;
    const offset = (page - 1) * pageSize;
    const data = withBalance.slice(offset, offset + pageSize);

    return {
        data,
        total,
        summary: {
            opening_balance: 0,
            closing_balance: runningBalance,
            total_credits: totalCredits,
            total_debits: totalDebits,
        },
    };
}

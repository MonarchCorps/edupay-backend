import pool from '../config/db.js';
import * as nombaVA from '../nomba/virtualAccounts.js';
import {
    findAccountById,
    updateAccountStatus,
    updateAccountName,
    updateAccountBalance,
    addAuditLog,
} from '../db/queries/accounts.js';
import {
    findTransactionById,
    updateTransactionMisdirected,
} from '../db/queries/transactions.js';
import { errors } from '../utils/errors.js';

function assertOwner(account, merchantId, environment) {
    if (
        !account ||
        account.merchant_id !== merchantId ||
        account.environment !== environment
    ) {
        throw errors.notFound('Account');
    }
}

export async function renameAccount({
    accountId,
    merchantId,
    environment,
    newName,
}) {
    const account = await findAccountById(accountId);
    assertOwner(account, merchantId, environment);

    const renameHistory = Array.isArray(account.rename_history)
        ? account.rename_history
        : [];

    renameHistory.push({
        old_name: account.customer_name,
        new_name: newName,
        changed_at: new Date().toISOString(),
    });

    // Mirror to Nomba (best-effort — don't fail the DB update if Nomba errors).
    // Sandbox accounts have a fabricated account_ref that doesn't exist on
    // Nomba, so skip the call entirely rather than sending garbage requests.
    if (account.environment !== 'sandbox') {
        try {
            await nombaVA.updateVirtualAccount(account.account_ref, {
                accountName: newName,
            });
        } catch (err) {
            console.warn('Nomba name sync failed (non-fatal):', err.message);
        }
    }

    const updated = await updateAccountName(accountId, newName, renameHistory);

    await addAuditLog({
        virtualAccountId: accountId,
        action: 'rename',
        oldValue: { name: account.customer_name },
        newValue: { name: newName },
    });

    return updated;
}

export async function freezeAccount({
    accountId,
    merchantId,
    environment,
    reason,
}) {
    const account = await findAccountById(accountId);
    assertOwner(account, merchantId, environment);

    if (account.status !== 'active') {
        throw errors.badRequest(
            `Cannot freeze an account with status '${account.status}'`,
        );
    }

    if (account.environment !== 'sandbox') {
        try {
            await nombaVA.suspendVirtualAccount(account.nomba_account_number);
        } catch (err) {
            console.warn('Nomba suspend failed (non-fatal):', err.message);
        }
    }

    const updated = await updateAccountStatus(accountId, 'frozen');

    await addAuditLog({
        virtualAccountId: accountId,
        action: 'status_change',
        oldValue: { status: 'active' },
        newValue: { status: 'frozen' },
        reason: reason ?? 'Manual freeze',
    });

    return updated;
}

export async function unfreezeAccount({ accountId, merchantId, environment }) {
    const account = await findAccountById(accountId);
    assertOwner(account, merchantId, environment);

    if (account.status !== 'frozen') {
        throw errors.badRequest(
            `Cannot unfreeze an account with status '${account.status}'`,
        );
    }

    const updated = await updateAccountStatus(accountId, 'active');

    await addAuditLog({
        virtualAccountId: accountId,
        action: 'status_change',
        oldValue: { status: 'frozen' },
        newValue: { status: 'active' },
        reason: 'Manual unfreeze',
    });

    return updated;
}

export async function closeAccount({ accountId, merchantId, environment }) {
    const account = await findAccountById(accountId);
    assertOwner(account, merchantId, environment);

    if (account.status === 'closed') {
        throw errors.badRequest('Account is already closed');
    }

    // Expire DVA on Nomba before locking the DB (best-effort)
    if (account.environment !== 'sandbox') {
        try {
            await nombaVA.expireVirtualAccount(account.account_ref);
        } catch (err) {
            console.warn('Nomba expire failed (non-fatal):', err.message);
        }
    }

    // Atomic: sweep balance + update status in one transaction
    const client = await pool.connect();
    let updated;
    try {
        await client.query('BEGIN');

        if (account.balance > 0) {
            await updateAccountBalance(accountId, -account.balance, client);
        }
        updated = await updateAccountStatus(accountId, 'closed', client);
        await addAuditLog(
            {
                virtualAccountId: accountId,
                action: 'status_change',
                oldValue: { status: account.status, balance: account.balance },
                newValue: { status: 'closed', balance: 0 },
                reason: `Balance sweep of ${account.balance} kobo on closure`,
            },
            client,
        );

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    return updated;
}

export async function resolveMisdirectedPayment({
    transactionId,
    merchantId,
    environment,
    action,
}) {
    const txn = await findTransactionById(transactionId, merchantId, environment);
    if (!txn) throw errors.notFound('Transaction');
    if (!txn.misdirected) {
        throw errors.badRequest('Transaction is not flagged as misdirected');
    }

    if (action === 'allocate') {
        await updateTransactionMisdirected(transactionId, true, false);
        // Credit the account balance — the payment is now accepted
        await updateAccountBalance(txn.virtual_account_id, txn.amount);
        await updateAccountStatus(txn.virtual_account_id, 'active');
        await addAuditLog({
            virtualAccountId: txn.virtual_account_id,
            action: 'misdirected_resolved',
            newValue: {
                action: 'allocate',
                transactionId,
                amountKobo: txn.amount,
            },
        });
    } else if (action === 'return') {
        // TODO: actually send the money back — call Nomba's payout API with
        // txn.sender_account + txn.sender_bank. Out of scope for the hackathon
        // deadline; for now this only flips the DB state (unflags the
        // transaction/account) without moving funds. Balance was never
        // credited for a misdirected transaction, so nothing to reverse here.
        await updateTransactionMisdirected(transactionId, false, false);
        await updateAccountStatus(txn.virtual_account_id, 'active');
        await addAuditLog({
            virtualAccountId: txn.virtual_account_id,
            action: 'misdirected_returned',
            newValue: {
                action: 'return',
                transactionId,
                senderAccount: txn.sender_account,
            },
        });
    }

    return { success: true, action, transactionId };
}

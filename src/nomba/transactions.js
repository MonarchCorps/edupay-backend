import nombaClient from './client.js';

export async function fetchTransaction(transactionId) {
    const res = await nombaClient.get(
        `/v1/transactions/requery/${transactionId}`,
    );
    return res.data.data;
}

export async function fetchAccountTransactions(params = {}) {
    const res = await nombaClient.get('/v1/transactions', { params });
    return res.data.data;
}

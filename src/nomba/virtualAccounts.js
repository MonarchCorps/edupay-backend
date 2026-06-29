import nombaClient from './client.js'

export async function createVirtualAccount({ accountRef, accountName, currency = 'NGN', bvn }) {
  const res = await nombaClient.post('/v1/accounts/virtual', {
    accountRef,
    accountName,
    currency,
    ...(bvn && { bvn }),
  })
  return res.data.data
}

export async function fetchVirtualAccount(virtualAcctNumber) {
  const res = await nombaClient.get(`/v1/accounts/virtual/${virtualAcctNumber}`)
  return res.data.data
}

export async function suspendVirtualAccount(accountId) {
  const res = await nombaClient.put(`/v1/accounts/suspend/${accountId}`)
  return res.data.data
}

export async function filterVirtualAccounts(params = {}) {
  const res = await nombaClient.get('/v1/accounts/virtual', { params })
  return res.data.data
}

export async function updateVirtualAccount(accountRef, updates) {
  const res = await nombaClient.put(`/v1/accounts/virtual/${accountRef}`, updates)
  return res.data.data
}

export async function expireVirtualAccount(accountRef) {
  const res = await nombaClient.post(`/v1/accounts/virtual/expire/${accountRef}`)
  return res.data.data
}

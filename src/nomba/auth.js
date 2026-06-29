import axios from 'axios'

let _token = null
let _refreshToken = null
let _expiresAt = 0 // Unix ms
let _inflightPromise = null // serialises concurrent refresh/obtain calls

async function obtainToken() {
  const res = await axios.post(
    `${process.env.NOMBA_BASE_URL}/v1/auth/token/issue`,
    {
      grant_type: 'client_credentials',
      client_id: process.env.NOMBA_CLIENT_ID,
      client_secret: process.env.NOMBA_CLIENT_SECRET,
    },
    { headers: { accountId: process.env.NOMBA_ACCOUNT_ID } }
  )

  if (res.data.code !== '00') {
    throw new Error(`Nomba auth failed: ${res.data.message}`)
  }

  const { access_token, refresh_token, expiresAt } = res.data.data
  _token = access_token
  _refreshToken = refresh_token
  _expiresAt = new Date(expiresAt).getTime()
  return _token
}

async function doRefresh() {
  try {
    const res = await axios.post(
      `${process.env.NOMBA_BASE_URL}/v1/auth/token/refresh`,
      { grant_type: 'refresh_token', refresh_token: _refreshToken },
      {
        headers: {
          Authorization: `Bearer ${_token}`,
          accountId: process.env.NOMBA_ACCOUNT_ID,
        },
      }
    )

    if (res.data.code !== '00') throw new Error('Refresh failed')

    const { access_token, refresh_token, expiresAt } = res.data.data
    _token = access_token
    _refreshToken = refresh_token
    _expiresAt = new Date(expiresAt).getTime()
    return _token
  } catch {
    return obtainToken()
  }
}

export async function getAccessToken() {
  const now = Date.now()
  // Token still valid — return immediately
  if (_token && now < _expiresAt - 5 * 60 * 1000) return _token

  // Coalesce concurrent callers: only one refresh/obtain in flight at a time
  if (!_inflightPromise) {
    const action = _refreshToken && now < _expiresAt ? doRefresh : obtainToken
    _inflightPromise = action().finally(() => { _inflightPromise = null })
  }
  return _inflightPromise
}

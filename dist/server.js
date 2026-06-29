// src/server.js
import "dotenv/config";

// src/app.js
import express from "express";
import helmet from "helmet";
import cors from "cors";

// src/middleware/rateLimiter.js
import rateLimit from "express-rate-limit";
var rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests \u2014 please try again later"
      }
    });
  }
});
var webhookRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1e3,
  // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: { code: "RATE_LIMIT_EXCEEDED", message: "Webhook rate limit exceeded" }
    });
  }
});

// src/middleware/errorHandler.js
import { ZodError } from "zod";

// src/utils/errors.js
var AppError = class extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
};
var errors = {
  notFound: (resource) => new AppError(`${resource} not found`, "NOT_FOUND", 404),
  unauthorized: () => new AppError("Invalid or missing API key", "UNAUTHORIZED", 401),
  forbidden: (msg = "Access denied") => new AppError(msg, "FORBIDDEN", 403),
  duplicate: (field) => new AppError(`${field} already exists`, "DUPLICATE", 409),
  nombaError: (msg) => new AppError(`Nomba API error: ${msg}`, "NOMBA_ERROR", 502),
  webhookInvalid: () => new AppError("Invalid webhook signature", "INVALID_SIGNATURE", 401),
  conflict: (msg) => new AppError(msg, "CONFLICT", 409),
  badRequest: (msg) => new AppError(msg, "BAD_REQUEST", 400),
  unprocessable: (msg) => new AppError(msg, "UNPROCESSABLE", 422)
};

// src/middleware/errorHandler.js
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message }
    });
  }
  if (err instanceof ZodError) {
    return res.status(422).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request data",
        fields: err.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message
        }))
      }
    });
  }
  if (err.code === "23505") {
    return res.status(409).json({
      success: false,
      error: { code: "DUPLICATE", message: "A record with this value already exists" }
    });
  }
  console.error("Unhandled error:", err);
  return res.status(500).json({
    success: false,
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" }
  });
}

// src/routes/accounts.js
import { Router } from "express";
import { z } from "zod";

// src/middleware/validate.js
function validate(schema, source = "body") {
  return (req, res, next) => {
    try {
      req[source] = schema.parse(req[source]);
      next();
    } catch (err) {
      next(err);
    }
  };
}

// src/utils/crypto.js
import crypto from "crypto";
function generateApiKey() {
  const raw = crypto.randomBytes(32).toString("hex");
  const key = `ep_live_${raw}`;
  const prefix = key.substring(0, 15);
  const hash = crypto.createHmac("sha256", process.env.API_KEY_SALT).update(key).digest("hex");
  return { key, prefix, hash };
}
function hashApiKey(key) {
  return crypto.createHmac("sha256", process.env.API_KEY_SALT).update(key).digest("hex");
}

// src/config/db.js
import pg from "pg";
var { Pool } = pg;
var pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 3e4,
  connectionTimeoutMillis: 5e3
});
pool.on("error", (err) => {
  console.error("Unexpected idle client error:", err);
});
async function testConnection() {
  const client = await pool.connect();
  try {
    const result = await client.query("SELECT NOW()");
    console.log(`\u2713 Database connected (${result.rows[0].now})`);
  } finally {
    client.release();
  }
}
var db_default = pool;

// src/db/queries/apiKeys.js
async function createApiKey({ merchantId, keyHash, keyPrefix, label }) {
  const res = await db_default.query(
    `INSERT INTO api_keys (merchant_id, key_hash, key_prefix, label)
     VALUES ($1,$2,$3,$4)
     RETURNING id, merchant_id, key_prefix, label, created_at`,
    [merchantId, keyHash, keyPrefix, label ?? null]
  );
  return res.rows[0];
}
async function findApiKeyByHash(keyHash) {
  const res = await db_default.query(
    `SELECT k.*, m.name AS merchant_name, m.email AS merchant_email
     FROM api_keys k
     JOIN merchants m ON k.merchant_id=m.id
     WHERE k.key_hash=$1 AND k.revoked=false`,
    [keyHash]
  );
  return res.rows[0] ?? null;
}
async function findApiKeysByMerchant(merchantId) {
  const res = await db_default.query(
    `SELECT id, merchant_id, key_prefix, label, last_used_at, revoked, created_at
     FROM api_keys WHERE merchant_id=$1 AND revoked=false ORDER BY created_at DESC`,
    [merchantId]
  );
  return res.rows;
}
async function revokeApiKey(id, merchantId) {
  const res = await db_default.query(
    `UPDATE api_keys SET revoked=true WHERE id=$1 AND merchant_id=$2 RETURNING id`,
    [id, merchantId]
  );
  return res.rows[0] ?? null;
}
async function updateApiKeyLastUsed(id) {
  await db_default.query("UPDATE api_keys SET last_used_at=NOW() WHERE id=$1", [id]);
}

// src/middleware/auth.js
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw new AppError("Invalid or missing API key", "UNAUTHORIZED", 401);
    }
    const key = authHeader.slice(7).trim();
    const hash = hashApiKey(key);
    const apiKey = await findApiKeyByHash(hash);
    if (!apiKey) {
      throw new AppError("Invalid or missing API key", "UNAUTHORIZED", 401);
    }
    req.merchant = {
      id: apiKey.merchant_id,
      name: apiKey.merchant_name,
      email: apiKey.merchant_email
    };
    updateApiKeyLastUsed(apiKey.id).catch(console.error);
    next();
  } catch (err) {
    next(err);
  }
}

// src/utils/idempotency.js
var cache = /* @__PURE__ */ new Map();
var TTL = 24 * 60 * 60 * 1e3;
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.createdAt > TTL) cache.delete(key);
  }
}, 60 * 60 * 1e3).unref();
function idempotency() {
  return (req, res, next) => {
    const rawKey = req.headers["x-idempotency-key"];
    if (!rawKey) return next();
    const merchantId = req.merchant?.id ?? "anon";
    const key = `${merchantId}:${rawKey}`;
    const cached = cache.get(key);
    if (cached) {
      if (cached.status === "processing") {
        return res.status(409).json({
          success: false,
          error: { code: "DUPLICATE_REQUEST", message: "A request with this idempotency key is already in flight" }
        });
      }
      if (cached.status === "complete") {
        return res.status(cached.response.status).json(cached.response.body);
      }
    }
    cache.set(key, { status: "processing", createdAt: Date.now() });
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      cache.set(key, {
        status: "complete",
        response: { status: res.statusCode, body },
        createdAt: Date.now()
      });
      return originalJson(body);
    };
    next();
  };
}

// src/nomba/client.js
import axios2 from "axios";

// src/nomba/auth.js
import axios from "axios";
var _token = null;
var _refreshToken = null;
var _expiresAt = 0;
var _inflightPromise = null;
async function obtainToken() {
  const res = await axios.post(
    `${process.env.NOMBA_BASE_URL}/v1/auth/token/issue`,
    {
      grant_type: "client_credentials",
      client_id: process.env.NOMBA_CLIENT_ID,
      client_secret: process.env.NOMBA_CLIENT_SECRET
    },
    { headers: { accountId: process.env.NOMBA_ACCOUNT_ID } }
  );
  if (res.data.code !== "00") {
    throw new Error(`Nomba auth failed: ${res.data.message}`);
  }
  const { access_token, refresh_token, expiresAt } = res.data.data;
  _token = access_token;
  _refreshToken = refresh_token;
  _expiresAt = new Date(expiresAt).getTime();
  return _token;
}
async function doRefresh() {
  try {
    const res = await axios.post(
      `${process.env.NOMBA_BASE_URL}/v1/auth/token/refresh`,
      { grant_type: "refresh_token", refresh_token: _refreshToken },
      {
        headers: {
          Authorization: `Bearer ${_token}`,
          accountId: process.env.NOMBA_ACCOUNT_ID
        }
      }
    );
    if (res.data.code !== "00") throw new Error("Refresh failed");
    const { access_token, refresh_token, expiresAt } = res.data.data;
    _token = access_token;
    _refreshToken = refresh_token;
    _expiresAt = new Date(expiresAt).getTime();
    return _token;
  } catch {
    return obtainToken();
  }
}
async function getAccessToken() {
  const now = Date.now();
  if (_token && now < _expiresAt - 5 * 60 * 1e3) return _token;
  if (!_inflightPromise) {
    const action = _refreshToken && now < _expiresAt ? doRefresh : obtainToken;
    _inflightPromise = action().finally(() => {
      _inflightPromise = null;
    });
  }
  return _inflightPromise;
}

// src/nomba/client.js
var nombaClient = axios2.create({
  baseURL: process.env.NOMBA_BASE_URL || "https://api.nomba.com",
  timeout: 3e4
});
nombaClient.interceptors.request.use(async (config) => {
  const token = await getAccessToken();
  config.headers.Authorization = `Bearer ${token}`;
  config.headers.accountId = process.env.NOMBA_SUB_ACCOUNT_ID || process.env.NOMBA_ACCOUNT_ID;
  return config;
});
nombaClient.interceptors.response.use(
  (response) => {
    if (response.data?.code !== "00") {
      throw new AppError(
        `Nomba API error: ${response.data?.message || "Unknown error"}`,
        "NOMBA_ERROR",
        502
      );
    }
    return response;
  },
  (err) => {
    const msg = err.response?.data?.message || err.message || "Nomba unavailable";
    throw new AppError(`Nomba API error: ${msg}`, "NOMBA_ERROR", 502);
  }
);
var client_default = nombaClient;

// src/nomba/virtualAccounts.js
async function createVirtualAccount({ accountRef, accountName, currency = "NGN", bvn }) {
  const res = await client_default.post("/v1/accounts/virtual", {
    accountRef,
    accountName,
    currency,
    ...bvn && { bvn }
  });
  return res.data.data;
}
async function suspendVirtualAccount(accountId) {
  const res = await client_default.put(`/v1/accounts/suspend/${accountId}`);
  return res.data.data;
}
async function updateVirtualAccount(accountRef, updates) {
  const res = await client_default.put(`/v1/accounts/virtual/${accountRef}`, updates);
  return res.data.data;
}
async function expireVirtualAccount(accountRef) {
  const res = await client_default.post(`/v1/accounts/virtual/expire/${accountRef}`);
  return res.data.data;
}

// src/db/queries/accounts.js
async function createAccount({ merchantId, customerId, customerName, kycTier, accountRef, nombaAccountNumber, nambaBankName, nambaBankCode, nombaRawResponse }, client = db_default) {
  const res = await client.query(
    `INSERT INTO virtual_accounts
       (merchant_id, customer_id, customer_name, kyc_tier, account_ref,
        nomba_account_number, nomba_bank_name, nomba_bank_code, nomba_raw_response, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active')
     RETURNING *`,
    [
      merchantId,
      customerId,
      customerName,
      kycTier,
      accountRef,
      nombaAccountNumber ?? null,
      nambaBankName ?? null,
      nambaBankCode ?? null,
      nombaRawResponse ? JSON.stringify(nombaRawResponse) : null
    ]
  );
  return res.rows[0];
}
async function findAccountById(id, client = db_default) {
  const res = await client.query("SELECT * FROM virtual_accounts WHERE id = $1", [id]);
  return res.rows[0] ?? null;
}
async function findAccountByRef(accountRef, client = db_default) {
  const res = await client.query(
    "SELECT * FROM virtual_accounts WHERE account_ref = $1",
    [accountRef]
  );
  return res.rows[0] ?? null;
}
async function findAccounts({ merchantId, status, kycTier, search, page = 1, pageSize = 20 }) {
  const conds = ["merchant_id = $1"];
  const params = [merchantId];
  let i = 2;
  if (status) {
    conds.push(`status = $${i++}`);
    params.push(status);
  }
  if (kycTier) {
    conds.push(`kyc_tier = $${i++}`);
    params.push(kycTier);
  }
  if (search) {
    conds.push(`(customer_name ILIKE $${i} OR nomba_account_number ILIKE $${i})`);
    params.push(`%${search}%`);
    i++;
  }
  const where = conds.join(" AND ");
  const offset = (page - 1) * pageSize;
  const [rows, count] = await Promise.all([
    db_default.query(
      `SELECT * FROM virtual_accounts WHERE ${where}
       ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
      [...params, pageSize, offset]
    ),
    db_default.query(`SELECT COUNT(*) FROM virtual_accounts WHERE ${where}`, params)
  ]);
  return { data: rows.rows, total: parseInt(count.rows[0].count, 10) };
}
async function updateAccountStatus(id, status, client = db_default) {
  const res = await client.query(
    `UPDATE virtual_accounts SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
    [status, id]
  );
  return res.rows[0];
}
async function updateAccountBalance(id, amountKobo, client = db_default) {
  const res = await client.query(
    `UPDATE virtual_accounts SET balance=balance+$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
    [amountKobo, id]
  );
  return res.rows[0];
}
async function updateAccountName(id, newName, renameHistory, client = db_default) {
  const res = await client.query(
    `UPDATE virtual_accounts SET customer_name=$1, rename_history=$2::jsonb, updated_at=NOW()
     WHERE id=$3 RETURNING *`,
    [newName, JSON.stringify(renameHistory), id]
  );
  return res.rows[0];
}
async function addAuditLog({ virtualAccountId, action, oldValue, newValue, reason }, client = db_default) {
  const res = await client.query(
    `INSERT INTO account_audit_log (virtual_account_id, action, old_value, new_value, reason)
     VALUES ($1,$2,$3::jsonb,$4::jsonb,$5) RETURNING *`,
    [
      virtualAccountId,
      action,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null,
      reason ?? null
    ]
  );
  return res.rows[0];
}
async function findAuditLog(virtualAccountId) {
  const res = await db_default.query(
    "SELECT * FROM account_audit_log WHERE virtual_account_id=$1 ORDER BY created_at DESC",
    [virtualAccountId]
  );
  return res.rows;
}

// src/services/provisioning.js
async function provisionAccount({ merchantId, customerName, customerId, kycTier = "tier1" }) {
  const accountRef = `edupay_${customerId}_${Date.now()}`;
  const nombaResult = await createVirtualAccount({
    accountRef,
    accountName: customerName,
    currency: "NGN"
  });
  const account = await createAccount({
    merchantId,
    customerId,
    customerName,
    kycTier,
    accountRef,
    nombaAccountNumber: nombaResult?.bankAccountNumber ?? null,
    nambaBankName: nombaResult?.bankName ?? null,
    nambaBankCode: nombaResult?.bankCode ?? null,
    nombaRawResponse: nombaResult
  });
  await addAuditLog({
    virtualAccountId: account.id,
    action: "created",
    newValue: { customerName, customerId, kycTier, accountRef }
  });
  return account;
}

// src/db/queries/transactions.js
async function createTransaction({
  virtualAccountId,
  merchantId,
  amount,
  direction,
  status = "success",
  matched = true,
  misdirected = false,
  senderName,
  senderBank,
  senderAccount,
  nombaSessionId,
  nambaTxnId,
  narration,
  nombaRawPayload
}, client = db_default) {
  const res = await client.query(
    `INSERT INTO transactions
       (virtual_account_id, merchant_id, amount, direction, status, matched, misdirected,
        sender_name, sender_bank, sender_account, nomba_session_id, nomba_txn_id, narration, nomba_raw_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      virtualAccountId,
      merchantId,
      amount,
      direction,
      status,
      matched,
      misdirected,
      senderName ?? null,
      senderBank ?? null,
      senderAccount ?? null,
      nombaSessionId ?? null,
      nambaTxnId ?? null,
      narration ?? null,
      nombaRawPayload ? JSON.stringify(nombaRawPayload) : null
    ]
  );
  return res.rows[0];
}
async function findTransactionById(id, merchantId) {
  const res = await db_default.query(
    "SELECT * FROM transactions WHERE id=$1 AND merchant_id=$2",
    [id, merchantId]
  );
  return res.rows[0] ?? null;
}
async function findTransactionByNombaTxnId(nambaTxnId, client = db_default) {
  const res = await client.query(
    "SELECT * FROM transactions WHERE nomba_txn_id=$1",
    [nambaTxnId]
  );
  return res.rows[0] ?? null;
}
async function findTransactions({ merchantId, virtualAccountId, direction, status, matched, page = 1, pageSize = 20 }) {
  const conds = ["t.merchant_id=$1"];
  const params = [merchantId];
  let i = 2;
  if (virtualAccountId) {
    conds.push(`t.virtual_account_id=$${i++}`);
    params.push(virtualAccountId);
  }
  if (direction) {
    conds.push(`t.direction=$${i++}`);
    params.push(direction);
  }
  if (status) {
    conds.push(`t.status=$${i++}`);
    params.push(status);
  }
  if (matched !== void 0) {
    conds.push(`t.matched=$${i++}`);
    params.push(matched);
  }
  const where = conds.join(" AND ");
  const offset = (page - 1) * pageSize;
  const [rows, count] = await Promise.all([
    db_default.query(
      `SELECT t.*, va.account_ref, va.nomba_account_number
       FROM transactions t
       JOIN virtual_accounts va ON t.virtual_account_id=va.id
       WHERE ${where} ORDER BY t.created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
      [...params, pageSize, offset]
    ),
    db_default.query(`SELECT COUNT(*) FROM transactions t WHERE ${where}`, params)
  ]);
  return { data: rows.rows, total: parseInt(count.rows[0].count, 10) };
}
async function updateTransactionStatus(id, status, client = db_default) {
  const res = await client.query(
    "UPDATE transactions SET status=$1 WHERE id=$2 RETURNING *",
    [status, id]
  );
  return res.rows[0];
}
async function updateTransactionMisdirected(id, matched, misdirected, client = db_default) {
  const res = await client.query(
    "UPDATE transactions SET matched=$1, misdirected=$2 WHERE id=$3 RETURNING *",
    [matched, misdirected, id]
  );
  return res.rows[0];
}
async function findTransactionsByAccount(virtualAccountId) {
  const res = await db_default.query(
    "SELECT * FROM transactions WHERE virtual_account_id=$1 ORDER BY created_at ASC",
    [virtualAccountId]
  );
  return res.rows;
}

// src/services/edgeCases.js
function assertOwner(account, merchantId) {
  if (!account || account.merchant_id !== merchantId) {
    throw errors.notFound("Account");
  }
}
async function renameAccount({ accountId, merchantId, newName }) {
  const account = await findAccountById(accountId);
  assertOwner(account, merchantId);
  const renameHistory = Array.isArray(account.rename_history) ? account.rename_history : [];
  renameHistory.push({
    old_name: account.customer_name,
    new_name: newName,
    changed_at: (/* @__PURE__ */ new Date()).toISOString()
  });
  try {
    await updateVirtualAccount(account.account_ref, { accountName: newName });
  } catch (err) {
    console.warn("Nomba name sync failed (non-fatal):", err.message);
  }
  const updated = await updateAccountName(accountId, newName, renameHistory);
  await addAuditLog({
    virtualAccountId: accountId,
    action: "rename",
    oldValue: { name: account.customer_name },
    newValue: { name: newName }
  });
  return updated;
}
async function freezeAccount({ accountId, merchantId, reason }) {
  const account = await findAccountById(accountId);
  assertOwner(account, merchantId);
  if (account.status !== "active") {
    throw errors.badRequest(`Cannot freeze an account with status '${account.status}'`);
  }
  try {
    await suspendVirtualAccount(account.nomba_account_number);
  } catch (err) {
    console.warn("Nomba suspend failed (non-fatal):", err.message);
  }
  const updated = await updateAccountStatus(accountId, "frozen");
  await addAuditLog({
    virtualAccountId: accountId,
    action: "status_change",
    oldValue: { status: "active" },
    newValue: { status: "frozen" },
    reason: reason ?? "Manual freeze"
  });
  return updated;
}
async function unfreezeAccount({ accountId, merchantId }) {
  const account = await findAccountById(accountId);
  assertOwner(account, merchantId);
  if (account.status !== "frozen") {
    throw errors.badRequest(`Cannot unfreeze an account with status '${account.status}'`);
  }
  const updated = await updateAccountStatus(accountId, "active");
  await addAuditLog({
    virtualAccountId: accountId,
    action: "status_change",
    oldValue: { status: "frozen" },
    newValue: { status: "active" },
    reason: "Manual unfreeze"
  });
  return updated;
}
async function closeAccount({ accountId, merchantId }) {
  const account = await findAccountById(accountId);
  assertOwner(account, merchantId);
  if (account.status === "closed") {
    throw errors.badRequest("Account is already closed");
  }
  try {
    await expireVirtualAccount(account.account_ref);
  } catch (err) {
    console.warn("Nomba expire failed (non-fatal):", err.message);
  }
  const client = await db_default.connect();
  let updated;
  try {
    await client.query("BEGIN");
    if (account.balance > 0) {
      await updateAccountBalance(accountId, -account.balance, client);
    }
    updated = await updateAccountStatus(accountId, "closed", client);
    await addAuditLog({
      virtualAccountId: accountId,
      action: "status_change",
      oldValue: { status: account.status, balance: account.balance },
      newValue: { status: "closed", balance: 0 },
      reason: `Balance sweep of ${account.balance} kobo on closure`
    }, client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return updated;
}
async function resolveMisdirectedPayment({ transactionId, merchantId, action }) {
  const txn = await findTransactionById(transactionId, merchantId);
  if (!txn) throw errors.notFound("Transaction");
  if (!txn.misdirected) {
    throw errors.badRequest("Transaction is not flagged as misdirected");
  }
  if (action === "allocate") {
    await updateTransactionMisdirected(transactionId, true, false);
    await updateAccountBalance(txn.virtual_account_id, txn.amount);
    await updateAccountStatus(txn.virtual_account_id, "active");
    await addAuditLog({
      virtualAccountId: txn.virtual_account_id,
      action: "misdirected_resolved",
      newValue: { action: "allocate", transactionId, amountKobo: txn.amount }
    });
  } else if (action === "return") {
    await updateTransactionMisdirected(transactionId, false, false);
    await addAuditLog({
      virtualAccountId: txn.virtual_account_id,
      action: "misdirected_returned",
      newValue: { action: "return", transactionId, senderAccount: txn.sender_account }
    });
  }
  return { success: true, action, transactionId };
}

// src/services/statement.js
async function getStatement({ accountId, merchantId, page = 1, pageSize = 50 }) {
  const account = await findAccountById(accountId);
  if (!account || account.merchant_id !== merchantId) {
    throw errors.notFound("Account");
  }
  const allTxns = await findTransactionsByAccount(accountId);
  let runningBalance = 0;
  let totalCredits = 0;
  let totalDebits = 0;
  const withBalance = allTxns.map((txn) => {
    const signed = txn.direction === "credit" ? txn.amount : -txn.amount;
    if (txn.status === "success" || txn.status === "reversed") {
      runningBalance += signed;
    }
    if (txn.status === "success") {
      if (txn.direction === "credit") totalCredits += txn.amount;
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
      total_debits: totalDebits
    }
  };
}

// src/utils/response.js
function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}
function paginated(res, data, total, page, pageSize) {
  return res.status(200).json({
    success: true,
    data,
    pagination: {
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    }
  });
}

// src/utils/serializers.js
function serializeAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountNumber: row.nomba_account_number ?? "",
    customerName: row.customer_name,
    customerId: row.customer_id,
    status: row.status,
    kycTier: row.kyc_tier,
    balance: row.balance ?? 0,
    lastCreditAt: row.last_credit_at ?? null,
    createdAt: row.created_at,
    nombaRef: row.account_ref ?? ""
  };
}
function serializeTransaction(row) {
  if (!row) return null;
  return {
    id: row.id,
    virtualAccountId: row.virtual_account_id,
    amount: row.amount,
    direction: row.direction,
    status: row.status,
    matched: row.matched,
    misdirected: row.misdirected,
    senderName: row.sender_name ?? "",
    senderBank: row.sender_bank ?? "",
    narration: row.narration ?? "",
    nombaRef: row.nomba_session_id ?? row.nomba_txn_id ?? "",
    createdAt: row.created_at,
    runningBalance: row.running_balance ?? void 0
  };
}
function serializeWebhookEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventType: row.event_type,
    virtualAccountId: row.virtual_account_id ?? null,
    processed: row.processed,
    error: row.error ?? null,
    rawPayload: row.raw_payload,
    receivedAt: row.received_at ?? row.created_at,
    processedAt: row.processed_at ?? null
  };
}
function serializeApiKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    // key is present only on creation; key_prefix is the display token for list view
    key: row.key ?? row.key_prefix,
    label: row.label ?? null,
    createdAt: row.created_at,
    lastUsed: row.last_used_at ?? null
  };
}

// src/controllers/accounts.js
async function create(req, res, next) {
  try {
    const account = await provisionAccount({ merchantId: req.merchant.id, ...req.body });
    return success(res, serializeAccount(account), 201);
  } catch (err) {
    next(err);
  }
}
async function list(req, res, next) {
  try {
    const { status, kycTier, search, page, pageSize } = req.query;
    const { data, total } = await findAccounts({
      merchantId: req.merchant.id,
      status,
      kycTier,
      search,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20
    });
    return paginated(res, data.map(serializeAccount), total, Number(page) || 1, Number(pageSize) || 20);
  } catch (err) {
    next(err);
  }
}
async function get(req, res, next) {
  try {
    const account = await findAccountById(req.params.id);
    if (!account || account.merchant_id !== req.merchant.id) throw errors.notFound("Account");
    return success(res, serializeAccount(account));
  } catch (err) {
    next(err);
  }
}
async function update(req, res, next) {
  try {
    const account = await renameAccount({
      accountId: req.params.id,
      merchantId: req.merchant.id,
      newName: req.body.customerName
    });
    return success(res, serializeAccount(account));
  } catch (err) {
    next(err);
  }
}
async function freeze(req, res, next) {
  try {
    const account = await freezeAccount({
      accountId: req.params.id,
      merchantId: req.merchant.id,
      reason: req.body?.reason
    });
    return success(res, serializeAccount(account));
  } catch (err) {
    next(err);
  }
}
async function unfreeze(req, res, next) {
  try {
    const account = await unfreezeAccount({
      accountId: req.params.id,
      merchantId: req.merchant.id
    });
    return success(res, serializeAccount(account));
  } catch (err) {
    next(err);
  }
}
async function close(req, res, next) {
  try {
    const account = await closeAccount({
      accountId: req.params.id,
      merchantId: req.merchant.id
    });
    return success(res, serializeAccount(account));
  } catch (err) {
    next(err);
  }
}
async function statement(req, res, next) {
  try {
    const page = Number(req.query.page) || 1;
    const pageSize = Number(req.query.pageSize) || 50;
    const result = await getStatement({ accountId: req.params.id, merchantId: req.merchant.id, page, pageSize });
    return res.status(200).json({
      success: true,
      data: result.data.map(serializeTransaction),
      total: result.total,
      summary: result.summary
    });
  } catch (err) {
    next(err);
  }
}
async function history(req, res, next) {
  try {
    const account = await findAccountById(req.params.id);
    if (!account || account.merchant_id !== req.merchant.id) throw errors.notFound("Account");
    const log = await findAuditLog(req.params.id);
    return success(res, log);
  } catch (err) {
    next(err);
  }
}

// src/routes/accounts.js
var router = Router();
router.use(requireAuth);
var provisionSchema = z.object({
  customerName: z.string().min(2).max(255),
  customerId: z.string().min(1).max(255),
  kycTier: z.enum(["tier1", "tier2", "tier3"]).default("tier1")
});
var renameSchema = z.object({
  customerName: z.string().min(2).max(255)
});
var listSchema = z.object({
  status: z.enum(["pending", "active", "frozen", "closed", "flagged", "resolved"]).optional(),
  kycTier: z.enum(["tier1", "tier2", "tier3"]).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});
var freezeSchema = z.object({ reason: z.string().max(500).optional() });
router.post("/", idempotency(), validate(provisionSchema), create);
router.get("/", validate(listSchema, "query"), list);
router.get("/:id", get);
router.patch("/:id", validate(renameSchema), update);
router.post("/:id/freeze", validate(freezeSchema), freeze);
router.post("/:id/unfreeze", unfreeze);
router.post("/:id/close", idempotency(), close);
router.get("/:id/statement", statement);
router.get("/:id/history", history);
var accounts_default = router;

// src/routes/transactions.js
import { Router as Router2 } from "express";
import { z as z2 } from "zod";

// src/controllers/transactions.js
async function list2(req, res, next) {
  try {
    const { virtualAccountId, direction, status, matched, page, pageSize } = req.query;
    const { data, total } = await findTransactions({
      merchantId: req.merchant.id,
      virtualAccountId,
      direction,
      status,
      matched: matched !== void 0 ? matched === "true" : void 0,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20
    });
    return paginated(res, data.map(serializeTransaction), total, Number(page) || 1, Number(pageSize) || 20);
  } catch (err) {
    next(err);
  }
}
async function get2(req, res, next) {
  try {
    const txn = await findTransactionById(req.params.id, req.merchant.id);
    if (!txn) throw errors.notFound("Transaction");
    return success(res, serializeTransaction(txn));
  } catch (err) {
    next(err);
  }
}
async function resolve(req, res, next) {
  try {
    const result = await resolveMisdirectedPayment({
      transactionId: req.params.id,
      merchantId: req.merchant.id,
      action: req.body.action
    });
    return success(res, result);
  } catch (err) {
    next(err);
  }
}

// src/routes/transactions.js
var router2 = Router2();
router2.use(requireAuth);
var resolveSchema = z2.object({
  action: z2.enum(["allocate", "return"])
});
router2.get("/", list2);
router2.get("/:id", get2);
router2.post("/:id/resolve", validate(resolveSchema), resolve);
var transactions_default = router2;

// src/routes/webhooks.js
import { Router as Router3 } from "express";

// src/middleware/validateWebhook.js
import crypto2 from "crypto";
function validateWebhook(req, res, next) {
  const signature = req.headers["nomba-signature"];
  const timestamp = req.headers["nomba-timestamp"];
  const secret = process.env.NOMBA_WEBHOOK_SECRET;
  if (!signature || !timestamp) {
    return res.status(401).json({
      success: false,
      error: { code: "INVALID_WEBHOOK", message: "Missing webhook headers" }
    });
  }
  const payload = req.body;
  const { event_type, requestId, data } = payload;
  const { merchant, transaction } = data ?? {};
  if (!event_type || !requestId || !merchant || !transaction) {
    return res.status(400).json({
      success: false,
      error: { code: "INVALID_WEBHOOK", message: "Malformed webhook payload" }
    });
  }
  const responseCode = transaction.responseCode === "null" ? "" : transaction.responseCode || "";
  const hashingPayload = [
    event_type,
    requestId,
    merchant.userId,
    merchant.walletId,
    transaction.transactionId,
    transaction.type,
    transaction.time,
    responseCode,
    timestamp
  ].join(":");
  const expectedSig = crypto2.createHmac("sha256", secret).update(hashingPayload).digest("base64");
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSig);
  if (sigBuffer.length !== expectedBuffer.length || !crypto2.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return res.status(401).json({
      success: false,
      error: { code: "INVALID_SIGNATURE", message: "Webhook signature mismatch" }
    });
  }
  next();
}

// src/db/queries/webhookEvents.js
async function createWebhookEvent({ nombaRequestId, eventType, rawPayload }) {
  const res = await db_default.query(
    `INSERT INTO webhook_events (nomba_request_id, event_type, raw_payload)
     VALUES ($1,$2,$3::jsonb) RETURNING *`,
    [nombaRequestId ?? null, eventType, JSON.stringify(rawPayload)]
  );
  return res.rows[0];
}
async function findWebhookEventById(id) {
  const res = await db_default.query("SELECT * FROM webhook_events WHERE id=$1", [id]);
  return res.rows[0] ?? null;
}
async function findWebhookEventByNombaRequestId(nombaRequestId) {
  const res = await db_default.query(
    "SELECT * FROM webhook_events WHERE nomba_request_id=$1",
    [nombaRequestId]
  );
  return res.rows[0] ?? null;
}
async function findWebhookEvents({ processed, page = 1, pageSize = 20 } = {}) {
  const conds = [];
  const params = [];
  let i = 1;
  if (processed !== void 0) {
    conds.push(`processed=$${i++}`);
    params.push(processed);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const offset = (page - 1) * pageSize;
  const [rows, count] = await Promise.all([
    db_default.query(
      `SELECT * FROM webhook_events ${where} ORDER BY received_at DESC LIMIT $${i} OFFSET $${i + 1}`,
      [...params, pageSize, offset]
    ),
    db_default.query(`SELECT COUNT(*) FROM webhook_events ${where}`, params)
  ]);
  return { data: rows.rows, total: parseInt(count.rows[0].count, 10) };
}
async function markWebhookProcessed(id, client = db_default) {
  const res = await client.query(
    `UPDATE webhook_events SET processed=true, processed_at=NOW(), error=NULL WHERE id=$1 RETURNING *`,
    [id]
  );
  return res.rows[0];
}
async function markWebhookFailed(id, errorMessage) {
  const res = await db_default.query(
    `UPDATE webhook_events SET error=$1, retry_count=retry_count+1 WHERE id=$2 RETURNING *`,
    [errorMessage, id]
  );
  return res.rows[0];
}

// src/services/reconciliation.js
async function reconcileWebhook(webhookEvent) {
  const client = await db_default.connect();
  try {
    await client.query("BEGIN");
    const { event_type } = webhookEvent.raw_payload;
    if (event_type === "payment_success") {
      await handlePaymentSuccess(webhookEvent, client);
    } else if (event_type === "payment_reversal") {
      await handlePaymentReversal(webhookEvent, client);
    } else if (event_type === "payment_failed") {
      await handlePaymentFailed(webhookEvent, client);
    } else {
      console.log(`Unhandled Nomba event type: ${event_type}`);
    }
    await markWebhookProcessed(webhookEvent.id, client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    try {
      await markWebhookFailed(webhookEvent.id, err.message);
    } catch (e) {
      console.error("Failed to mark webhook as failed:", e.message);
    }
    console.error(`Reconciliation failed for webhook ${webhookEvent.id}:`, err.message);
  } finally {
    client.release();
  }
}
async function handlePaymentSuccess(webhookEvent, client) {
  const txn = webhookEvent.raw_payload.data.transaction;
  const aliasRef = txn.aliasAccountReference;
  if (txn.transactionId) {
    const existing = await findTransactionByNombaTxnId(txn.transactionId, client);
    if (existing) return;
  }
  const account = await findAccountByRef(aliasRef, client);
  if (!account) {
    throw new Error(`Misdirected payment: accountRef ${aliasRef} not found \u2014 no virtual account matched`);
  }
  const amountKobo = toKobo(txn.amount);
  await createTransaction({
    virtualAccountId: account.id,
    merchantId: account.merchant_id,
    amount: amountKobo,
    direction: "credit",
    status: "success",
    matched: true,
    misdirected: false,
    senderName: txn.senderName ?? txn.sourceAccountName,
    senderBank: txn.senderBank ?? txn.sourceBankName,
    senderAccount: txn.senderAccount ?? txn.sourceAccountNumber,
    nombaSessionId: txn.sessionId,
    nambaTxnId: txn.transactionId,
    narration: txn.narration,
    nombaRawPayload: txn
  }, client);
  await updateAccountBalance(account.id, amountKobo, client);
  await addAuditLog({
    virtualAccountId: account.id,
    action: "credit_received",
    newValue: { amountKobo, transactionId: txn.transactionId, senderName: txn.senderName }
  }, client);
}
async function handlePaymentReversal(webhookEvent, client) {
  const txn = webhookEvent.raw_payload.data.transaction;
  if (!txn.transactionId) return;
  const reversalId = `${txn.transactionId}_rev`;
  const existingReversal = await findTransactionByNombaTxnId(reversalId, client);
  if (existingReversal) return;
  const original = await findTransactionByNombaTxnId(txn.transactionId, client);
  if (!original) return;
  await updateTransactionStatus(original.id, "reversed", client);
  await createTransaction({
    virtualAccountId: original.virtual_account_id,
    merchantId: original.merchant_id,
    amount: original.amount,
    direction: "debit",
    status: "reversed",
    matched: true,
    misdirected: false,
    nambaTxnId: reversalId,
    narration: "Payment reversal",
    nombaRawPayload: txn
  }, client);
  await updateAccountBalance(original.virtual_account_id, -original.amount, client);
  await addAuditLog({
    virtualAccountId: original.virtual_account_id,
    action: "payment_reversed",
    oldValue: { status: "success" },
    newValue: { status: "reversed", amountKobo: original.amount }
  }, client);
}
async function handlePaymentFailed(webhookEvent, client) {
  const txn = webhookEvent.raw_payload.data.transaction;
  if (!txn.transactionId) return;
  const existing = await findTransactionByNombaTxnId(txn.transactionId, client);
  if (existing) return;
  const account = await findAccountByRef(txn.aliasAccountReference, client);
  if (!account) return;
  await createTransaction({
    virtualAccountId: account.id,
    merchantId: account.merchant_id,
    amount: toKobo(txn.amount),
    direction: "credit",
    status: "failed",
    matched: false,
    misdirected: false,
    nambaTxnId: txn.transactionId,
    narration: txn.narration,
    nombaRawPayload: txn
  }, client);
}
function toKobo(amount) {
  if (amount === null || amount === void 0) return 0;
  const clean = String(amount).replace(/,/g, "");
  const num = parseFloat(clean);
  return Number.isFinite(num) ? Math.round(num * 100) : 0;
}

// src/controllers/webhooks.js
async function receive(req, res, next) {
  try {
    const payload = req.body;
    const { requestId, event_type } = payload;
    if (requestId) {
      const existing = await findWebhookEventByNombaRequestId(requestId);
      if (existing) {
        return res.status(200).json({ success: true, data: { received: true, duplicate: true } });
      }
    }
    const event = await createWebhookEvent({
      nombaRequestId: requestId ?? null,
      eventType: event_type,
      rawPayload: payload
    });
    res.status(200).json({ success: true, data: { received: true, eventId: event.id } });
    setImmediate(() => reconcileWebhook(event));
  } catch (err) {
    console.error("Webhook storage error:", err);
    next(err);
  }
}
async function listEvents(req, res, next) {
  try {
    const { processed, page, pageSize } = req.query;
    const { data, total } = await findWebhookEvents({
      processed: processed !== void 0 ? processed === "true" : void 0,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20
    });
    return paginated(res, data.map(serializeWebhookEvent), total, Number(page) || 1, Number(pageSize) || 20);
  } catch (err) {
    next(err);
  }
}
async function getEvent(req, res, next) {
  try {
    const event = await findWebhookEventById(req.params.id);
    if (!event) throw errors.notFound("Webhook event");
    return success(res, serializeWebhookEvent(event));
  } catch (err) {
    next(err);
  }
}
async function replay(req, res, next) {
  try {
    const event = await findWebhookEventById(req.params.id);
    if (!event) throw errors.notFound("Webhook event");
    if (event.processed) {
      throw errors.conflict("Event has already been processed successfully");
    }
    await reconcileWebhook(event);
    const updated = await findWebhookEventById(req.params.id);
    return success(res, serializeWebhookEvent(updated));
  } catch (err) {
    next(err);
  }
}

// src/routes/webhooks.js
var router3 = Router3();
router3.post("/nomba", webhookRateLimiter, validateWebhook, receive);
router3.get("/events", requireAuth, listEvents);
router3.get("/events/:id", requireAuth, getEvent);
router3.post("/events/:id/replay", requireAuth, replay);
var webhooks_default = router3;

// src/routes/auth.js
import { Router as Router4 } from "express";
import { z as z3 } from "zod";

// src/db/queries/merchants.js
async function createMerchant({ name, email }) {
  const res = await db_default.query(
    `INSERT INTO merchants (name, email) VALUES ($1, $2) RETURNING *`,
    [name, email]
  );
  return res.rows[0];
}
async function findMerchantById(id) {
  const res = await db_default.query("SELECT * FROM merchants WHERE id = $1", [id]);
  return res.rows[0] ?? null;
}
async function findMerchantByEmail(email) {
  const res = await db_default.query("SELECT * FROM merchants WHERE email = $1", [email]);
  return res.rows[0] ?? null;
}

// src/controllers/auth.js
async function registerMerchant(req, res, next) {
  try {
    const { name, email } = req.body;
    const existing = await findMerchantByEmail(email);
    if (existing) throw errors.duplicate("Email");
    const merchant = await createMerchant({ name, email });
    return success(res, merchant, 201);
  } catch (err) {
    next(err);
  }
}
async function bootstrapKey(req, res, next) {
  try {
    const merchant = await findMerchantById(req.params.merchantId);
    if (!merchant) throw errors.notFound("Merchant");
    const { key, prefix, hash } = generateApiKey();
    const { label } = req.body ?? {};
    const record = await createApiKey({
      merchantId: merchant.id,
      keyHash: hash,
      keyPrefix: prefix,
      label: label ?? "Default key"
    });
    return success(res, serializeApiKey({ ...record, key }), 201);
  } catch (err) {
    next(err);
  }
}
async function generateKey(req, res, next) {
  try {
    const { key, prefix, hash } = generateApiKey();
    const { label } = req.body;
    const record = await createApiKey({
      merchantId: req.merchant.id,
      keyHash: hash,
      keyPrefix: prefix,
      label
    });
    return success(res, serializeApiKey({ ...record, key }), 201);
  } catch (err) {
    next(err);
  }
}
async function listKeys(req, res, next) {
  try {
    const keys = await findApiKeysByMerchant(req.merchant.id);
    return success(res, keys.map(serializeApiKey));
  } catch (err) {
    next(err);
  }
}
async function revokeKey(req, res, next) {
  try {
    const revoked = await revokeApiKey(req.params.id, req.merchant.id);
    if (!revoked) throw errors.notFound("API key");
    return success(res, { id: req.params.id, revoked: true });
  } catch (err) {
    next(err);
  }
}

// src/routes/auth.js
var router4 = Router4();
var merchantSchema = z3.object({
  name: z3.string().min(2).max(255),
  email: z3.string().email()
});
var keySchema = z3.object({
  label: z3.string().max(100).optional()
});
router4.post("/merchants", validate(merchantSchema), registerMerchant);
router4.post("/merchants/:merchantId/keys", validate(keySchema), bootstrapKey);
router4.post("/keys", requireAuth, validate(keySchema), generateKey);
router4.get("/keys", requireAuth, listKeys);
router4.delete("/keys/:id", requireAuth, revokeKey);
var auth_default = router4;

// src/app.js
var app = express();
app.use(helmet());
app.use(cors({
  origin: [
    "http://localhost:5173",
    // Vite dev server
    "http://localhost:4173",
    // Vite preview
    "http://localhost:3000"
    // alternative dev port
  ],
  credentials: true
}));
app.use(express.json());
app.use(rateLimiter);
app.use("/accounts", accounts_default);
app.use("/transactions", transactions_default);
app.use("/webhooks", webhooks_default);
app.use("/auth", auth_default);
app.get(
  "/healthz",
  (req, res) => res.json({ status: "ok", timestamp: (/* @__PURE__ */ new Date()).toISOString() })
);
app.use(
  (_req, res) => res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Route not found" } })
);
app.use(errorHandler);
var app_default = app;

// src/server.js
var PORT = Number(process.env.PORT ?? 3001);
var REQUIRED_ENV = [
  "DATABASE_URL",
  "API_KEY_SALT",
  "NOMBA_WEBHOOK_SECRET",
  "NOMBA_CLIENT_ID",
  "NOMBA_CLIENT_SECRET",
  "NOMBA_ACCOUNT_ID",
  "NOMBA_BASE_URL"
];
function validateEnv() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }
}
async function start() {
  validateEnv();
  await testConnection();
  app_default.listen(PORT, () => {
    console.log(`EduPay backend listening on http://localhost:${PORT}`);
    console.log(`  POST /auth/merchants   \u2192 register merchant`);
    console.log(`  POST /accounts         \u2192 provision DVA`);
    console.log(`  POST /webhooks/nomba   \u2192 Nomba webhook receiver`);
    console.log(`  GET  /healthz          \u2192 health check`);
  });
}
start().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});

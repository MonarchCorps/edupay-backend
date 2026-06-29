import { provisionAccount } from '../services/provisioning.js'
import { renameAccount, freezeAccount, unfreezeAccount, closeAccount } from '../services/edgeCases.js'
import { getStatement } from '../services/statement.js'
import { findAccountById, findAccounts, findAuditLog } from '../db/queries/accounts.js'
import { success, paginated } from '../utils/response.js'
import { serializeAccount, serializeTransaction } from '../utils/serializers.js'
import { errors } from '../utils/errors.js'

export async function create(req, res, next) {
  try {
    const account = await provisionAccount({ merchantId: req.merchant.id, ...req.body })
    return success(res, serializeAccount(account), 201)
  } catch (err) { next(err) }
}

export async function list(req, res, next) {
  try {
    const { status, kycTier, search, page, pageSize } = req.query
    const { data, total } = await findAccounts({
      merchantId: req.merchant.id, status, kycTier, search,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
    })
    return paginated(res, data.map(serializeAccount), total, Number(page) || 1, Number(pageSize) || 20)
  } catch (err) { next(err) }
}

export async function get(req, res, next) {
  try {
    const account = await findAccountById(req.params.id)
    if (!account || account.merchant_id !== req.merchant.id) throw errors.notFound('Account')
    return success(res, serializeAccount(account))
  } catch (err) { next(err) }
}

export async function update(req, res, next) {
  try {
    const account = await renameAccount({
      accountId: req.params.id,
      merchantId: req.merchant.id,
      newName: req.body.customerName,
    })
    return success(res, serializeAccount(account))
  } catch (err) { next(err) }
}

export async function freeze(req, res, next) {
  try {
    const account = await freezeAccount({
      accountId: req.params.id,
      merchantId: req.merchant.id,
      reason: req.body?.reason,
    })
    return success(res, serializeAccount(account))
  } catch (err) { next(err) }
}

export async function unfreeze(req, res, next) {
  try {
    const account = await unfreezeAccount({
      accountId: req.params.id,
      merchantId: req.merchant.id,
    })
    return success(res, serializeAccount(account))
  } catch (err) { next(err) }
}

export async function close(req, res, next) {
  try {
    const account = await closeAccount({
      accountId: req.params.id,
      merchantId: req.merchant.id,
    })
    return success(res, serializeAccount(account))
  } catch (err) { next(err) }
}

export async function statement(req, res, next) {
  try {
    const page = Number(req.query.page) || 1
    const pageSize = Number(req.query.pageSize) || 50
    const result = await getStatement({ accountId: req.params.id, merchantId: req.merchant.id, page, pageSize })
    return res.status(200).json({
      success: true,
      data: result.data.map(serializeTransaction),
      total: result.total,
      summary: result.summary,
    })
  } catch (err) { next(err) }
}

export async function history(req, res, next) {
  try {
    const account = await findAccountById(req.params.id)
    if (!account || account.merchant_id !== req.merchant.id) throw errors.notFound('Account')
    const log = await findAuditLog(req.params.id)
    return success(res, log)
  } catch (err) { next(err) }
}

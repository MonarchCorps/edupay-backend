import * as nombaVA from '../nomba/virtualAccounts.js'
import { createAccount, addAuditLog } from '../db/queries/accounts.js'

export async function provisionAccount({ merchantId, customerName, customerId, kycTier = 'tier1' }) {
  const accountRef = `edupay_${customerId}_${Date.now()}`

  // Create DVA via Nomba
  const nombaResult = await nombaVA.createVirtualAccount({
    accountRef,
    accountName: customerName,
    currency: 'NGN',
  })

  // Persist to DB
  const account = await createAccount({
    merchantId,
    customerId,
    customerName,
    kycTier,
    accountRef,
    nombaAccountNumber: nombaResult?.bankAccountNumber ?? null,
    nambaBankName: nombaResult?.bankName ?? null,
    nambaBankCode: null, // Nomba does not return a bank code on DVA creation
    nombaRawResponse: nombaResult,
  })

  await addAuditLog({
    virtualAccountId: account.id,
    action: 'created',
    newValue: { customerName, customerId, kycTier, accountRef },
  })

  return account
}

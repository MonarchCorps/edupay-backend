import * as nombaVA from '../nomba/virtualAccounts.js';
import { createAccount, addAuditLog } from '../db/queries/accounts.js';

// Nomba issues real DVAs on Wema Bank — mirror that for fabricated sandbox
// accounts so the account number/bank name look realistic in the dashboard.
const SANDBOX_BANK_NAME = 'Wema Bank';
const SANDBOX_BANK_CODE = '035';

function fabricateSandboxAccount(accountRef, customerName) {
    const bankAccountNumber = String(
        Math.floor(1_000_000_000 + Math.random() * 8_999_999_999),
    );
    return {
        accountRef,
        accountName: customerName,
        bankAccountNumber,
        bankName: SANDBOX_BANK_NAME,
        sandbox: true,
    };
}

export async function provisionAccount({
    merchantId,
    customerName,
    customerId,
    kycTier = 'tier1',
    environment = 'sandbox',
}) {
    const accountRef = `edupay_${customerId}_${Date.now()}`;

    // Sandbox never touches the real Nomba API — fabricate a realistic-looking
    // account instead so the rest of the dashboard works unchanged.
    const nombaResult =
        environment === 'sandbox'
            ? fabricateSandboxAccount(accountRef, customerName)
            : await nombaVA.createVirtualAccount({
                  accountRef,
                  accountName: customerName,
                  currency: 'NGN',
              });

    // Persist to DB
    const account = await createAccount({
        merchantId,
        customerId,
        customerName,
        kycTier,
        accountRef,
        nombaAccountNumber: nombaResult?.bankAccountNumber ?? null,
        nambaBankName: nombaResult?.bankName ?? null,
        nambaBankCode: environment === 'sandbox' ? SANDBOX_BANK_CODE : null, // Nomba does not return a bank code on real DVA creation
        nombaRawResponse: nombaResult,
        environment,
    });

    await addAuditLog({
        virtualAccountId: account.id,
        action: 'created',
        newValue: {
            customerName,
            customerId,
            kycTier,
            accountRef,
            environment,
        },
    });

    return account;
}

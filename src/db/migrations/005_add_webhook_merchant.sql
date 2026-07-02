-- webhook_events had no way to trace back to a merchant, so any authenticated
-- merchant could see every merchant's webhook events via GET /webhook-events.
-- Nullable because some events (unmatched account_ref, unhandled event
-- types) genuinely never touch an account and have no merchant to own them.
ALTER TABLE webhook_events
    ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE;

-- Backfill: same lookup reconciliation.js already does live (alias account
-- reference -> virtual_accounts.account_ref -> merchant_id). Payloads whose
-- reference doesn't resolve to a known account are correctly left NULL —
-- they aren't attributable to any merchant.
UPDATE webhook_events we
SET merchant_id = va.merchant_id
FROM virtual_accounts va
WHERE we.merchant_id IS NULL
  AND va.account_ref = (we.raw_payload -> 'data' -> 'transaction' ->> 'aliasAccountReference');

CREATE INDEX IF NOT EXISTS idx_webhook_events_merchant ON webhook_events(merchant_id);

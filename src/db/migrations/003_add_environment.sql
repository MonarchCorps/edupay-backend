-- Sandbox mode: tag keys/accounts/transactions so sandbox test data never
-- mixes with production data. Existing rows default to 'live' since they
-- were all created against real Nomba before this column existed.
ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS environment VARCHAR(10) NOT NULL DEFAULT 'live'
        CHECK (environment IN ('sandbox', 'live'));

ALTER TABLE virtual_accounts
    ADD COLUMN IF NOT EXISTS environment VARCHAR(10) NOT NULL DEFAULT 'live'
        CHECK (environment IN ('sandbox', 'live'));

ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS environment VARCHAR(10) NOT NULL DEFAULT 'live'
        CHECK (environment IN ('sandbox', 'live'));

CREATE INDEX IF NOT EXISTS idx_virtual_accounts_environment ON virtual_accounts(environment);
CREATE INDEX IF NOT EXISTS idx_transactions_environment ON transactions(environment);

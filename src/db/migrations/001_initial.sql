-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Merchants (the businesses using EduPay)
CREATE TABLE IF NOT EXISTS merchants (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            VARCHAR(255) NOT NULL,
  email           VARCHAR(255) UNIQUE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- API keys for merchant authentication
CREATE TABLE IF NOT EXISTS api_keys (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id     UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  key_hash        VARCHAR(255) NOT NULL UNIQUE,
  key_prefix      VARCHAR(20) NOT NULL,
  label           VARCHAR(100),
  last_used_at    TIMESTAMPTZ,
  revoked         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Virtual accounts provisioned via Nomba
CREATE TABLE IF NOT EXISTS virtual_accounts (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id          UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  customer_id          VARCHAR(255) NOT NULL,
  customer_name        VARCHAR(255) NOT NULL,
  account_ref          VARCHAR(255) NOT NULL UNIQUE,
  nomba_account_number VARCHAR(20),
  nomba_bank_name      VARCHAR(255),
  nomba_bank_code      VARCHAR(20),
  status               VARCHAR(20) NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','active','frozen','closed','flagged','resolved')),
  kyc_tier             VARCHAR(10) NOT NULL DEFAULT 'tier1'
                       CHECK (kyc_tier IN ('tier1','tier2','tier3')),
  balance              BIGINT NOT NULL DEFAULT 0,
  rename_history       JSONB NOT NULL DEFAULT '[]',
  nomba_raw_response   JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Inbound and outbound transactions
CREATE TABLE IF NOT EXISTS transactions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  virtual_account_id  UUID NOT NULL REFERENCES virtual_accounts(id) ON DELETE CASCADE,
  merchant_id         UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  amount              BIGINT NOT NULL,
  direction           VARCHAR(10) NOT NULL CHECK (direction IN ('credit','debit')),
  status              VARCHAR(20) NOT NULL DEFAULT 'success'
                      CHECK (status IN ('success','failed','pending','reversed')),
  matched             BOOLEAN NOT NULL DEFAULT TRUE,
  misdirected         BOOLEAN NOT NULL DEFAULT FALSE,
  sender_name         VARCHAR(255),
  sender_bank         VARCHAR(255),
  sender_account      VARCHAR(20),
  nomba_session_id    VARCHAR(255),
  nomba_txn_id        VARCHAR(255) UNIQUE,
  narration           TEXT,
  nomba_raw_payload   JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- All webhook events received from Nomba (stored BEFORE processing)
CREATE TABLE IF NOT EXISTS webhook_events (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nomba_request_id VARCHAR(255) UNIQUE,
  event_type       VARCHAR(50) NOT NULL,
  raw_payload      JSONB NOT NULL,
  processed        BOOLEAN NOT NULL DEFAULT FALSE,
  error            TEXT,
  retry_count      INTEGER NOT NULL DEFAULT 0,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at     TIMESTAMPTZ
);

-- Account state change audit log
CREATE TABLE IF NOT EXISTS account_audit_log (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  virtual_account_id  UUID NOT NULL REFERENCES virtual_accounts(id) ON DELETE CASCADE,
  action              VARCHAR(50) NOT NULL,
  old_value           JSONB,
  new_value           JSONB,
  reason              TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_virtual_accounts_merchant ON virtual_accounts(merchant_id);
CREATE INDEX IF NOT EXISTS idx_virtual_accounts_status ON virtual_accounts(status);
CREATE INDEX IF NOT EXISTS idx_transactions_virtual_account ON transactions(virtual_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_nomba_txn_id ON transactions(nomba_txn_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed ON webhook_events(processed);
CREATE INDEX IF NOT EXISTS idx_webhook_events_nomba_request_id ON webhook_events(nomba_request_id);

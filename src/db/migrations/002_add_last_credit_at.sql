-- Add last_credit_at to virtual_accounts (missed in initial schema)
ALTER TABLE virtual_accounts
    ADD COLUMN IF NOT EXISTS last_credit_at TIMESTAMPTZ;

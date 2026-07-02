-- Dashboard login now uses email+password instead of API keys.
-- Nullable so existing merchants (created before this migration) don't
-- break; the app-level registration flow requires it going forward.
ALTER TABLE merchants
    ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

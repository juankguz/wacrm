-- ============================================================
-- 037_contact_bsuid
--
-- Add support for Meta's Business-scoped User IDs (BSUID), the new
-- backend identifier WhatsApp assigns to a user and scopes to a
-- business portfolio (formerly Business Manager).
--
-- As usernames roll out, the webhook can omit the user's phone number
-- entirely (`message.from` and `contacts[].wa_id` both absent), so
-- `phone` is no longer a reliable identity. The stable identity for
-- those users is `user_id` (BSUID), e.g. `US.13491208655302741918`.
--
-- This migration adds two columns:
--   contacts.whatsapp_user_id    TEXT  — the BSUID (primary new identity)
--   contacts.whatsapp_username   TEXT  — optional display username
--
-- `phone` stays NOT NULL for backward compatibility. A BSUID-only
-- contact stores `phone = ''` — the value the app already writes when
-- `message.from` is missing. That empty string is NEVER used as an
-- identity:
--   * findExistingContact returns null for an empty phone;
--   * the unique index on (account_id, phone_normalized) excludes
--     `phone_normalized = ''` (migration 022).
--
-- The unique partial index below is the DB backstop that guarantees
-- one contact per (account, BSUID), mirroring 022's phone guarantee.
--
-- `contacts.user_id` is NOT reused: it remains the internal audit /
-- owner FK to auth.users (the WACRM user who created the row), not
-- the WhatsApp BSUID.
--
-- Idempotent.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS whatsapp_user_id TEXT;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS whatsapp_username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_bsuid
  ON contacts (account_id, whatsapp_user_id)
  WHERE whatsapp_user_id IS NOT NULL;

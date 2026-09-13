-- ============================================================
-- Migration 0048: Identity & Access Engine (Engine 1) Completion
-- ============================================================
--
-- Adds the three pieces of state Engine 1's gap-matrix audit found
-- genuinely missing from the schema (docs/NAIJADEALS-ENGINE-COMPLETION-
-- MASTER-AUDIT.md §5, and the follow-up Engine 1 gap matrix): password
-- reset tokens, email/phone verification tokens, and login-throttle
-- tracking. users.status (migration 0037) and is_email_verified/
-- is_phone_verified (migration 0001) already existed and are reused
-- as-is — this migration does NOT touch the users table at all.
--
-- DESIGN PRINCIPLES (matching every existing token/session pattern in
-- this codebase — sessions.token_hash, organization_invitations.token_hash):
--   - Raw tokens are NEVER stored. Only their SHA-256 hash is persisted,
--     identical to sessions.token_hash's established pattern. Even a full
--     DB read (backup leak, SQL injection, admin curiosity) cannot recover
--     a usable raw token.
--   - Every token is single-use: consumed_at is set the instant it is
--     successfully used, and every lookup query filters
--     `consumed_at IS NULL AND expires_at > datetime('now')`, closing
--     replay/reuse structurally rather than via an application-level flag
--     check that could be forgotten in a future call site.
--   - Every token is short-lived (expires_at set at creation time,
--     enforced identically to sessions.expires_at).
--   - No new "second" notification/email system — Engine 9's outbox
--     (notification_outbox / enqueueAndProcessNow) is the only dispatch
--     path; these tables hold nothing about HOW to deliver, only the
--     token's own lifecycle.

-- ============================================================
-- 1. PASSWORD RESET TOKENS (Priority 2)
-- ============================================================
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TEXT NOT NULL,
  consumed_at  TEXT,
  requested_ip TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires ON password_reset_tokens(expires_at);

-- ============================================================
-- 2. EMAIL / PHONE VERIFICATION TOKENS (Priority 3)
-- ============================================================
-- One shared table for both channels (channel column), rather than two
-- near-identical tables — the lifecycle (create/consume/expire/replay-
-- reject) is identical for both, only which users.is_*_verified column
-- gets flipped on success differs (application-layer, not schema).
CREATE TABLE IF NOT EXISTS identity_verification_tokens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL CHECK (channel IN ('email', 'phone')),
  -- The exact destination this token was issued for, snapshotted at
  -- creation time. Prevents a stale token from silently verifying a
  -- DIFFERENT email/phone the user may have since changed to.
  target_value TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TEXT NOT NULL,
  consumed_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_identity_verification_tokens_user ON identity_verification_tokens(user_id, channel);
CREATE INDEX IF NOT EXISTS idx_identity_verification_tokens_hash ON identity_verification_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_identity_verification_tokens_expires ON identity_verification_tokens(expires_at);

-- ============================================================
-- 3. LOGIN THROTTLING (Priority 4)
-- ============================================================
-- Append-only attempt ledger (mirrors inventory_adjustments'/wallet_ledger's
-- append-only pattern elsewhere in this codebase) rather than a single
-- mutable "failure count" column — an append-only ledger is trivially
-- correct under concurrency (no read-modify-write race on a counter) and
-- self-documents exactly when each attempt happened, which a bounded
-- time-window query (see src/lib/login-throttle.ts) reads directly.
-- Scoped by BOTH identifier (email/phone as submitted) and ip_address so
-- a single malicious IP can't lock out a legitimate account it doesn't
-- own by feeding it wrong passwords, and a distributed attacker can't
-- evade an account-level throttle merely by rotating IPs — either axis
-- alone crossing the threshold is enough to throttle (see
-- login-throttle.ts's checkLoginThrottle for the exact OR-of-two-windows
-- logic, deliberately bounded so legitimate users always recover once
-- the window rolls off — never a permanent lockout).
CREATE TABLE IF NOT EXISTS login_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier  TEXT NOT NULL,      -- the raw email/phone AS SUBMITTED (lowercased at write time) — not a user_id FK, since a failed attempt against an unknown identifier still needs to be throttled
  ip_address  TEXT,
  outcome     TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_identifier_time ON login_attempts(identifier, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts(ip_address, created_at DESC);

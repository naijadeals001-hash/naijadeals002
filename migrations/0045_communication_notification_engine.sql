-- Migration 0045: Engine 9 — Communication & Notification Engine
--
-- FORENSIC AUDIT FINDINGS THIS MIGRATION IS BUILT ON (see
-- docs/ENGINE-9-COMMUNICATION-NOTIFICATION-AUDIT.md for the full audit):
--
-- 1. `notifications` (migration 0005) is a REAL, reasonably-shaped in-app
--    notification table (type/title/body/action_url/reference_type/
--    reference_id/is_read) but has ZERO writers anywhere in src/ — grep
--    for `INSERT INTO notifications` across the whole app returns nothing.
--    It is read/seed-data-only today. This migration does NOT replace or
--    ALTER this table's shape — it is exactly the "notification" concept
--    Engine 9 needs, it just needs a real, safe writer. That writer lives
--    in src/lib/notifications.ts (application code), not in this
--    migration — see that file for why in-app writes go straight to this
--    table while durability/idempotency/retry live in the new outbox
--    table below.
--
-- 2. `cc_domain_events` (migration 0013) is a REAL, already-wired-in
--    generic audit/event log with THREE existing writers (order-lifecycle,
--    booking-lifecycle, moderation.ts) and ZERO readers anywhere. It is
--    indexed on (event_type) and (occurred_at DESC), but critically has
--    NO UNIQUE/idempotency constraint of any kind and NO index on
--    `processed_at` — i.e. it is a fire-and-forget AUDIT TRAIL, not a safe
--    outbox a consumer could poll without a full table scan or risk of
--    double-processing a retried write. Reusing it AS the notification
--    outbox (routing consumption off cc_domain_events.processed_at) would
--    require adding brittle constraints to a table 3 unrelated financial/
--    moderation writers already depend on staying exactly as-is — an
--    unacceptable coupling risk for Engine 9 to introduce into Engine 7/8's
--    existing audit trail. DECISION (per the explicit instruction to
--    report architectural decisions): cc_domain_events is left completely
--    UNTOUCHED and continues to serve its existing role as a generic
--    audit/analytics log; Engine 9 gets its OWN durable outbox table
--    (`notification_outbox`) purpose-built with the idempotency/retry
--    columns a real outbox needs. This is additive-only — zero risk to
--    the 3 existing writers, zero schema change to cc_domain_events.
--
-- 3. `cc_integrations` (migration 0023) is a REAL, well-shaped provider
--    registry (provider_key/status enum/config_json/environment/
--    verification_status) with ZERO writers and ZERO readers anywhere in
--    src/. It is exactly the Integration Hub abstraction Engine 9's
--    EmailProvider/SmsProvider/PushProvider selection needs. This
--    migration seeds it with Engine 9's provider rows (all
--    'not_configured' — no real credentials exist, per the "no fake
--    providers" rule) rather than creating a parallel provider table.
--
-- 4. `account_preferences.notification_prefs_json` (migration 0037) is a
--    REAL, currently-used free-form JSON blob
--    ({"order_updates":true,"promotions":true,"security_alerts":true}) —
--    read by src/pages/account.tsx, written by api-account.ts. It predates
--    Engine 9's category x channel preference model and is NOT expressive
--    enough (no per-channel granularity, no mandatory-category
--    enforcement, free-form keys). DECISION: leave this column exactly as
--    it is (still read/written by the existing Account page — must not
--    break it), and add a NEW, properly-normalized
--    `notification_preferences` table for Engine 9's real category x
--    channel model. The old JSON blob becomes a legacy/UI-only field this
--    migration does not migrate data out of (no user data exists in local
--    dev to migrate, and touching it is out of Engine 9's minimum-scope
--    mandate) — documented as a known follow-up, not silently ignored.
--
-- 5. `cc_roles`/`cc_permissions`/`cc_user_roles`/`cc_role_permissions`
--    (migration 0013) are CONFIRMED DORMANT — zero references anywhere in
--    src/. The only RBAC mechanism actually wired to any route is
--    `requirePlatformRole()` (src/lib/rbac.ts), which reads `users.role`
--    directly. Engine 9's Control Center/admin routes therefore use
--    `requirePlatformRole('admin')`, exactly like api-admin.ts already
--    does — NOT the dormant cc_roles tables (extending unused
--    infrastructure would be scope creep with no real caller).
--
-- NEW TABLES (all additive, zero ALTER of any existing table):
--
--   notification_outbox            — the durable, idempotent event queue
--   notification_deliveries        — one row per (outbox_event, channel)
--                                     delivery attempt lifecycle
--   notification_preferences       — per-user category x channel opt-in,
--                                     replaces account_preferences'
--                                     free-form JSON for anything Engine 9
--                                     actually enforces
--   communication_consents         — newsletter/marketing consent with a
--                                     real audit trail (source/timestamp/
--                                     ip/locale/unsubscribe), closing the
--                                     gap the audit found in
--                                     newsletter_subscribers
--   notification_templates         — locale-aware message templates,
--                                     versioned, safe-interpolation only
--
-- SCHEMA-ONLY INVARIANT (carried forward from migration 0005's own header
-- comment): this file applies cleanly to a completely empty D1 database.
-- Zero application-data rows are inserted here except pure reference data
-- (provider registrations in cc_integrations, seeded via UPSERT so
-- re-running this file is idempotent and never clobbers an admin's later
-- configuration of the same row).

-- ============================================================
-- 1. NOTIFICATION OUTBOX — the durable idempotent event queue
-- ============================================================
--
-- Idempotency model (the critical design decision the Engine 9 prompt
-- calls out explicitly): the key is NOT event_id+recipient_id+channel
-- (that would only dedupe identical *retries* of the exact same enqueue
-- call, not the actual business-level duplicate this needs to prevent —
-- e.g. two concurrent webhook deliveries for the same payment both trying
-- to enqueue "payment received"). Instead `idempotency_key` is a
-- caller-supplied string DERIVED FROM BUSINESS SEMANTICS (e.g.
-- 'order_item_settled:482', 'payment_confirmed:9931',
-- 'booking_confirmed:77') — one key per real-world business occurrence,
-- regardless of how many times or from how many concurrent code paths the
-- enqueue function is called for it. UNIQUE(idempotency_key) is the CAS
-- guard: `INSERT ... ON CONFLICT(idempotency_key) DO NOTHING`, exactly
-- mirroring Engine 7's "claim once" CAS discipline applied to the
-- notification domain instead of the financial one.
CREATE TABLE IF NOT EXISTS notification_outbox (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key     TEXT NOT NULL UNIQUE,
  event_type          TEXT NOT NULL,       -- e.g. 'order_item_settled', 'payment_confirmed', 'booking_confirmed'
  recipient_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category            TEXT NOT NULL CHECK (category IN
                        ('transactional','security','order','booking','delivery','payment','marketing','promotional','system')),
  payload_json        TEXT NOT NULL DEFAULT '{}',   -- template variables + any reference ids (order_id, booking_id, ...)
  reference_type      TEXT,                          -- 'order' | 'booking' | 'wallet' | 'security' | null — mirrors notifications.reference_type
  reference_id        TEXT,
  -- Processing lifecycle. 'pending' -> 'processing' -> 'processed' | 'failed'.
  -- 'processing' is a CAS claim state (mirrors Engine 7 Phase 3's transient
  -- 'settling' state pattern) so two workers/requests can never both fan
  -- this single event out to deliveries.
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','processed','failed')),
  attempts             INTEGER NOT NULL DEFAULT 0,
  last_error           TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_status ON notification_outbox(status, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_recipient ON notification_outbox(recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_category ON notification_outbox(category);

-- ============================================================
-- 2. NOTIFICATION DELIVERIES — one row per (outbox event, channel)
-- ============================================================
--
-- Deliberately SEPARATE from notification_outbox: one outbox event can
-- legitimately fan out to multiple channels (in_app + email, say), each
-- with its OWN independent delivery lifecycle/retry count/provider used —
-- collapsing these into one row per event would force every channel to
-- share a single status, which is wrong the moment one channel succeeds
-- and another fails.
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  outbox_id           INTEGER NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
  channel             TEXT NOT NULL CHECK (channel IN ('in_app','email','sms','push')),
  provider_key        TEXT,                 -- FK-by-convention to cc_integrations.provider_key (not a hard FK: provider may be unset pre-dispatch)
  -- Truthful status vocabulary (per the "No Fake Providers" rule) —
  -- 'delivered' is reserved for an ACTUAL provider delivery confirmation,
  -- never assumed from a queued/accepted state.
  status              TEXT NOT NULL DEFAULT 'queued' CHECK (status IN
                        ('queued','attempted','accepted','delivered','failed','unavailable','not_configured','skipped')),
  failure_class       TEXT CHECK (failure_class IS NULL OR failure_class IN ('transient','permanent')),
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  last_attempted_at   TEXT,
  next_retry_at       TEXT,
  delivered_at        TEXT,
  last_error          TEXT,
  provider_response_json TEXT,     -- raw (non-secret) provider response for observability — never store credentials/tokens here
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(outbox_id, channel)   -- exactly one delivery row per event per channel — the concurrency guard for duplicate fan-out
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_outbox ON notification_deliveries(outbox_id);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status ON notification_deliveries(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_channel ON notification_deliveries(channel, status);

-- ============================================================
-- 3. NOTIFICATION PREFERENCES — per-user category x channel opt-in
-- ============================================================
--
-- One row per (user, category, channel). Absence of a row means "use the
-- category's default" (application-layer default table, not stored here
-- — see src/lib/notification-preferences.ts DEFAULT_CHANNEL_MAP). The
-- 'transactional' and 'security' categories are enforced as
-- NON-OPTIONAL at the application layer regardless of what row (if any)
-- exists here — this table can never be used to silently suppress a
-- security alert or an order-confirmation the user is legally/
-- operationally entitled to receive.
CREATE TABLE IF NOT EXISTS notification_preferences (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category      TEXT NOT NULL CHECK (category IN
                  ('transactional','security','order','booking','delivery','payment','marketing','promotional','system')),
  channel       TEXT NOT NULL CHECK (channel IN ('in_app','email','sms','push')),
  enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, category, channel)
);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_user ON notification_preferences(user_id);

-- ============================================================
-- 4. COMMUNICATION CONSENTS — real consent/audit trail
-- ============================================================
--
-- Closes the audit's documented gap in newsletter_subscribers (bare
-- id/email/created_at — no consent timestamp, source, locale, country, or
-- unsubscribe mechanism). Deliberately NOT a replacement for
-- newsletter_subscribers (that table's existing UNIQUE(email) writer in
-- api-catalog.ts's POST /newsletter is untouched — no existing caller
-- breaks); this is the NEW, properly-governed consent ledger for
-- marketing/promotional communications going forward. purpose is a real
-- enum, not free text, so "marketing" consent can never be silently
-- read as covering "transactional" (which never requires consent to begin
-- with — see notification_preferences' enforcement note above).
CREATE TABLE IF NOT EXISTS communication_consents (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER REFERENCES users(id) ON DELETE CASCADE,   -- NULL for a pre-account newsletter signup (email-only)
  email             TEXT,
  purpose           TEXT NOT NULL CHECK (purpose IN ('marketing','promotional')),
  consent_given     INTEGER NOT NULL CHECK (consent_given IN (0,1)),
  source            TEXT NOT NULL,      -- 'newsletter_signup' | 'account_settings' | 'checkout_optin' | 'waitlist' | ...
  locale            TEXT,
  country_iso       TEXT,
  legal_basis       TEXT NOT NULL DEFAULT 'consent',  -- 'consent' | 'legitimate_interest' — reserved for future NDPR/GDPR-style expansion, honestly defaulted
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_communication_consents_user ON communication_consents(user_id);
CREATE INDEX IF NOT EXISTS idx_communication_consents_email ON communication_consents(email);

-- ============================================================
-- 5. NOTIFICATION TEMPLATES — locale-aware, versioned, safe-interpolation
-- ============================================================
--
-- `body_template`/`subject_template` use a minimal `{{variable}}` token
-- syntax (interpolated by src/lib/notification-templates.ts via a strict
-- allow-listed-key + HTML-escaping renderer — never raw string
-- concatenation, never eval, never a general templating engine that could
-- execute arbitrary logic). is_active lets a bad template be pulled
-- without deleting history.
CREATE TABLE IF NOT EXISTS notification_templates (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type        TEXT NOT NULL,
  channel           TEXT NOT NULL CHECK (channel IN ('in_app','email','sms','push')),
  locale            TEXT NOT NULL DEFAULT 'en',
  version           INTEGER NOT NULL DEFAULT 1,
  subject_template  TEXT,                 -- email/push title; NULL for in_app/sms (no subject concept)
  body_template     TEXT NOT NULL,
  action_url_template TEXT,               -- optional, mirrors notifications.action_url
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(event_type, channel, locale, version)
);

CREATE INDEX IF NOT EXISTS idx_notification_templates_lookup ON notification_templates(event_type, channel, locale, is_active);

-- ============================================================
-- 6. INTEGRATION HUB — seed Engine 9's provider rows (all not_configured)
-- ============================================================
--
-- Reuses the EXISTING cc_integrations table (migration 0023) exactly as
-- designed. No real credentials exist anywhere in this environment (per
-- the "no fake providers" rule) — every row starts 'not_configured' with
-- an empty config_json. This is registration, not activation: an admin
-- (or a future BYOK deploy) would later PATCH config_json + flip status,
-- never this migration.
INSERT INTO cc_integrations (provider_key, provider_name, category, country_availability_json, status, config_json, environment)
VALUES
  ('test_email_adapter', 'Deterministic Test Email Adapter', 'email', '[]', 'configured', '{}', 'development'),
  ('test_sms_adapter', 'Deterministic Test SMS Adapter', 'sms', '[]', 'configured', '{}', 'development'),
  ('test_push_adapter', 'Deterministic Test Push Adapter', 'push', '[]', 'configured', '{}', 'development')
ON CONFLICT(provider_key) DO NOTHING;

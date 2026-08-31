-- NaijaDeals — Ecosystem Waitlist v2 (Fix Task: "Join the waitlist" must actually work)
--
-- Problem being fixed:
--   Every Ecosystem Preview page (/fresh, /eats, /gigs, /stay, /drive, /send,
--   /stream, /aura) only offered a single-email "Notify me" inline form
--   (migration 0010's `ecosystem_waitlist` table + POST /api/ecosystem/:slug/waitlist).
--   Pat's directive requires a real, richer waitlist experience: full name,
--   email, phone, city, state, and a multi-service selection (NaijaEats /
--   NaijaGigs / NaijaStay / "all upcoming services") — collected through a
--   proper modal/bottom-sheet, not a bare email field, and reusable across
--   all 8 vertical routes plus the /ecosystem overview page.
--
-- Why a NEW table, not an ALTER of migration 0010's `ecosystem_waitlist`:
--   0010's `ecosystem_waitlist` is keyed by (vertical_id, email) — one row
--   PER VERTICAL a visitor asked about, with vertical_id as a required FK.
--   Pat's requested schema is fundamentally different in shape: ONE row per
--   PERSON with boolean flags for which services they want (naija_eats,
--   naija_gigs, naija_stay, all_services) plus contact/location fields that
--   0010's table has no room for (full_name, phone, city, state). Shoehorning
--   the new fields into 0010's table via ALTER would either (a) break its
--   existing UNIQUE(vertical_id, email) semantics and the already-deployed
--   /:slug/waitlist endpoint + inline "Notify me" forms still live on every
--   preview page, or (b) require destructively re-keying rows that may
--   already exist in production (real visitor emails — must not be touched
--   or risked). Additive-only, zero-risk path: leave 0010's table and
--   endpoint exactly as they are (dormant legacy, superseded but harmless —
--   see api-ecosystem.ts for the explicit note), and give the new richer
--   experience its own table with its own name: `ecosystem_waitlist_signups`.
--
-- Duplicate-email handling: UNIQUE(email) is the actual spam guard (not
-- app-level dedup). Resubmitting the same email is NOT rejected as an error
-- and does NOT create a second row — the API layer (lib/ecosystem-waitlist.ts)
-- performs an upsert: existing contact fields are refreshed and any newly
-- selected services are MERGED (OR'd) into the existing flags, so someone who
-- first joins for NaijaEats and later comes back from /gigs ends up on both
-- lists under one record, never duplicated.
--
-- Admin-readiness (Pat's requirement 9 — no admin UI built here, but the data
-- model must already support one): status lets a future admin mark a
-- subscriber as notified/contacted without deleting history; indexes below
-- support "subscribers by service" (boolean columns, standard indexes),
-- "by city/state", and "recent signups" (created_at) without a table scan.

CREATE TABLE IF NOT EXISTS ecosystem_waitlist_signups (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name    TEXT NOT NULL,
  email        TEXT NOT NULL,
  phone        TEXT NOT NULL,
  city         TEXT NOT NULL,
  state        TEXT NOT NULL,
  naija_eats   INTEGER NOT NULL DEFAULT 0 CHECK (naija_eats IN (0,1)),
  naija_gigs   INTEGER NOT NULL DEFAULT 0 CHECK (naija_gigs IN (0,1)),
  naija_stay   INTEGER NOT NULL DEFAULT 0 CHECK (naija_stay IN (0,1)),
  all_services INTEGER NOT NULL DEFAULT 0 CHECK (all_services IN (0,1)),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','notified','contacted','unsubscribed')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(email)
);

-- "subscribers by city/state" without a table scan
CREATE INDEX IF NOT EXISTS idx_ecosystem_waitlist_signups_city ON ecosystem_waitlist_signups(city);
CREATE INDEX IF NOT EXISTS idx_ecosystem_waitlist_signups_state ON ecosystem_waitlist_signups(state);
-- "recent signups" list, newest first
CREATE INDEX IF NOT EXISTS idx_ecosystem_waitlist_signups_created ON ecosystem_waitlist_signups(created_at);
-- "subscribers by service" counts/filters
CREATE INDEX IF NOT EXISTS idx_ecosystem_waitlist_signups_services ON ecosystem_waitlist_signups(naija_eats, naija_gigs, naija_stay, all_services);
CREATE INDEX IF NOT EXISTS idx_ecosystem_waitlist_signups_status ON ecosystem_waitlist_signups(status);

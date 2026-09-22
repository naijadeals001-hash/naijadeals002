-- Migration 0076: NaijaStay + Aura Live Status Correction
--
-- CONTEXT (Workstream C — "make NaijaGigs + NaijaStay + Aura live
-- everywhere"): NaijaGigs, NaijaStay and Aura AI all sit on top of real,
-- fully-functioning engines (Service Engine 2.0 for Gigs, Booking Engine
-- 2.0 for Stay, the real LLM-backed Aura chat endpoint at
-- /api/aura/chat) — verified via full authenticated E2E QA (hold ->
-- booking -> honest insufficient-funds payment rejection -> cancel with a
-- real computed refund quote for Stay; real service-request creation for
-- Gigs; live curl-verified non-fabricated LLM responses for Aura, on both
-- local and PRODUCTION). This migration performs the two remaining,
-- purely-cosmetic/status fixes needed before those verticals can honestly
-- be presented as LIVE — it does NOT touch schema, does NOT touch any
-- financial/settlement logic, and does NOT touch migration 0075 (reserved
-- on branch feature/naijashop-fund-settlement for Phase B — deliberately
-- absent from this branch).
--
-- PART 1 — DEMO LABEL CLEANUP (customer-facing columns only):
-- Migration 0072 (NaijaGigs demo seed) already stripped the "[DEMO] "
-- prefix from the one customer-facing column it populates
-- (provider_profiles.display_name) via REPLACE(name, '[DEMO] ', ''),
-- while leaving the prefix intact on the internal `users.name` column
-- (never rendered to customers) so admin/CC listings can still tell it's
-- seed data. Migration 0073 (NaijaStay demo seed) did NOT replicate this
-- pattern for its own customer-facing columns — stay_properties.name and
-- bookable_listings.title were seeded WITH the literal "[DEMO] " prefix,
-- and BOTH are rendered verbatim on /stay, /stay/property/:slug and
-- /stay/book/:listingId (confirmed via direct grep of src/pages/stay.tsx
-- and a live curl of https://naijadeals.com/stay showing 12 literal
-- "[DEMO]" occurrences in production right now). This is a genuine
-- data-cleanliness bug — the underlying properties/units/hosts are real,
-- functioning rows in the same production-grade Booking Engine NaijaGigs
-- already uses successfully; only the customer-facing label leaked demo
-- internals. Fix: strip "[DEMO] " from the customer-facing name/title
-- columns only. The internal users.name / users.email columns for the
-- demo host accounts (demo_stay_*@naijadeals.demo, "[DEMO] <Host Name>")
-- are DELIBERATELY left untouched — they are never rendered to customers,
-- and keeping the prefix there preserves admin/CC ability to identify
-- seed accounts, exactly mirroring migration 0072's own precedent.
-- booking_cancellation_policies.name is also cleaned for consistency,
-- even though it is not currently rendered on any customer page, purely
-- so no "[DEMO]" string can leak into any future policy-facing UI without
-- a second migration.
--
-- stay_properties.description also literally embeds the sentence "NOTE:
-- this is DEMO inventory for NaijaStay, not a real bookable commercial
-- property." — this IS rendered verbatim on /stay/property/:slug (src/
-- pages/stay.tsx renders {property.description} directly). That sentence
-- is stripped below too; the rest of each description (the genuine,
-- factual property description) is left completely untouched.
--
-- PART 2 — STATUS FLIP: ecosystem_verticals.status 'coming_soon' -> 'live'
-- for stay and aura (gigs is already 'live' in production per the audit).
-- Per migration 0073's own closing comment, this flip was deliberately
-- deferred "as a SEPARATE, LATER migration only after full local +
-- production authenticated E2E verification [hold -> confirm -> pay ->
-- cancel/refund]" — that verification has now been completed (see
-- context above). Every other customer-facing surface (homepage,
-- /ecosystem, header/mobile nav, footer, MerchandisingRail) reads this
-- single column via src/lib/ecosystem-verticals.ts / ecosystem-nav.ts, so
-- flipping it here is what actually makes those surfaces show Stay/Aura
-- as LIVE with zero further code changes to any of them.
--
-- NOTE ON PRODUCTION DRIFT: production's own ecosystem_verticals.stay is
-- ALREADY 'live' today (an earlier, unrelated deploy set it before this
-- data-cleanliness fix existed) — this migration's UPDATE is idempotent
-- (WHERE slug = 'stay' AND status != 'live' is unnecessary since setting
-- an already-'live' row to 'live' is a no-op) so applying it to
-- production is always safe regardless of that drift. Local dev DB still
-- shows stay/aura as 'coming_soon' before this migration runs.

-- ============================================================
-- 1. Strip "[DEMO] " prefix from customer-facing NaijaStay columns
-- ============================================================
UPDATE stay_properties
SET name = REPLACE(name, '[DEMO] ', '')
WHERE name LIKE '[DEMO] %';

UPDATE stay_properties
SET description = TRIM(REPLACE(description, ' NOTE: this is DEMO inventory for NaijaStay, not a real bookable commercial property.', ''))
WHERE description LIKE '%NOTE: this is DEMO%';

UPDATE bookable_listings
SET title = REPLACE(title, '[DEMO] ', '')
WHERE vertical = 'stay' AND title LIKE '%[DEMO] %';

UPDATE booking_cancellation_policies
SET name = REPLACE(name, '[DEMO] ', '')
WHERE name LIKE '[DEMO] %';

-- ============================================================
-- 2. Flip ecosystem_verticals.status to 'live' for stay + aura
--    (gigs already 'live'; every other vertical's status is
--    intentionally left untouched)
-- ============================================================
UPDATE ecosystem_verticals
SET status = 'live'
WHERE slug IN ('stay', 'aura') AND status != 'live';

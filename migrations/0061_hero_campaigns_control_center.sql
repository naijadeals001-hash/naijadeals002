-- Migration 0061: Hero Campaign Management — Enterprise Control Center Phase 1
--
-- Extends the existing hero_campaigns table (migration 0008, expanded 0055)
-- with the minimum real columns needed for:
--   (a) targeting beyond "vertical" (country, segment, auth-state, priority)
--   (b) admin provenance (who created/last edited a campaign)
--   (c) soft-delete/archive (never hard-DELETE a campaign that has run live —
--       preserves history for the audit trail and lets a campaign be restored)
--
-- NO existing column is modified or removed. getActiveHeroCampaigns() (the
-- read path HeroZone.tsx/home.tsx already depend on) continues to work
-- unmodified — every new column defaults to a value that preserves its
-- exact current behavior for the 10 existing rows (target_countries=NULL,
-- target_segment='all', target_auth_state='all', priority=display_order,
-- is_archived=0). This migration adds capability; it does not change what
-- is currently live on the homepage.
--
-- TARGETING DESIGN (Pat's Phase 4 preview, built now per his explicit
-- "clean extensible targeting model... without another major rewrite"
-- instruction — schema only, the FILTERING logic itself is Phase 4 scope
-- and is NOT wired into getActiveHeroCampaigns() by this migration):
--   target_countries   TEXT   JSON array of ISO codes, e.g. '["NG","GH"]'.
--                              NULL/'[]' = all countries (current behavior).
--   target_segment      TEXT   free-form segment key for now (e.g. 'all',
--                              'fashion_interest', 'high_value') — no
--                              customer-segment table exists yet (confirmed
--                              absent by the read-only audit), so this is
--                              intentionally a plain string, not a FK, until
--                              Phase 3's behavioral infrastructure exists.
--   target_auth_state   TEXT   CHECK ('all','authenticated','anonymous').
--   priority             INTEGER  For future multi-campaign-per-slot ranking
--                              once real targeting filters are wired in
--                              (Phase 4). Defaults to display_order so
--                              existing ordering is preserved if priority
--                              is read before Phase 4 wires it up.
--
-- PROVENANCE / SOFT-DELETE:
--   created_by_user_id  INTEGER  FK-less reference to users.id (matches this
--                              codebase's existing convention on collections
--                              .created_by_user_id — no FK constraint, since
--                              D1/SQLite FKs are not enforced by default here
--                              and other tables in this schema follow the
--                              same convention).
--   updated_by_user_id  INTEGER  Same convention, updated on every edit.
--   is_archived          INTEGER  0/1. Archived campaigns are excluded from
--                              both the admin's default list view AND
--                              getActiveHeroCampaigns() (belt-and-suspenders
--                              — an archived campaign must never appear live
--                              even if status is accidentally left 'active').
--                              This is the "Delete/Archive" capability from
--                              Pat's spec — never a hard DELETE, so campaign
--                              history/assets remain available for reuse.

ALTER TABLE hero_campaigns ADD COLUMN target_countries TEXT;
ALTER TABLE hero_campaigns ADD COLUMN target_segment TEXT NOT NULL DEFAULT 'all';
ALTER TABLE hero_campaigns ADD COLUMN target_auth_state TEXT NOT NULL DEFAULT 'all' CHECK (target_auth_state IN ('all','authenticated','anonymous'));
ALTER TABLE hero_campaigns ADD COLUMN priority INTEGER;
ALTER TABLE hero_campaigns ADD COLUMN created_by_user_id INTEGER;
ALTER TABLE hero_campaigns ADD COLUMN updated_by_user_id INTEGER;
ALTER TABLE hero_campaigns ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;

-- Backfill priority = display_order for the 10 existing rows so a future
-- Phase-4 "ORDER BY priority" never silently reorders anything that is
-- currently live and correct.
UPDATE hero_campaigns SET priority = display_order WHERE priority IS NULL;

CREATE INDEX IF NOT EXISTS idx_hero_campaigns_archived ON hero_campaigns(is_archived);

-- ============================================================
-- Homepage feed cache: allow targeted DELETE of a single section's cache
-- row so the Hero Campaign Manager can force-refresh the homepage the
-- moment an admin publishes/pauses/deletes a campaign, instead of the
-- visitor-facing site staying stale for up to the existing 120s TTL
-- (src/lib/homepage-feed.ts). No schema change needed here — the table's
-- existing (section_key, payload_json, generated_at) shape already
-- supports "DELETE WHERE section_key = 'hero_campaigns'"; this migration
-- adds no new cache table, only documents the reuse (see
-- src/lib/homepage-feed.ts's new invalidateSection() this checkpoint adds).

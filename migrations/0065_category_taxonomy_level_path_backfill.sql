-- NaijaDeals — Category + Footer Live Reconciliation: level/path backfill
-- for the REAL production taxonomy (Pat's directive, 2026-09-18).
--
-- ROOT CAUSE (discovered during this reconciliation, confirmed via direct
-- production D1 audit): migration 0053 added categories.level/path/
-- country_iso as genuinely new columns, but NO migration ever backfilled
-- level/path for the taxonomy actually running in production (79 rows,
-- ids 1-150, 16 roots). Migrations 0056/0057/0063 (homepage merchandising,
-- homepage images, pill navigation) were all written and tested against a
-- DIFFERENT, larger "Phase 1a" taxonomy (189 rows, ids 37-226,
-- scripts/seed/seed-phase1a-taxonomy-catalog.sql) that was NEVER applied
-- to production (confirmed: zero d1_migrations rows for it, explicitly
-- documented in commit aacf581 as "a one-time, manually-invoked dev/demo
-- catalog seeder ... never intended to run against production"). Because
-- SQL UPDATE...WHERE silently affects zero rows on a non-matching slug
-- (no error), those three migrations "applied cleanly" while doing almost
-- nothing on the REAL table — except for 5 slugs that happen to exist
-- verbatim in both schemes (electronics, fashion, automotive,
-- kitchen-appliances, furniture), which is exactly the partial,
-- inexplicable-looking state this reconciliation found and is now fixing.
--
-- IMPACT of the missing backfill (two confirmed, live, customer-facing
-- bugs, not just failing test data):
--   1. src/pages/shop.tsx's category filter matches descendants via
--      `cat.path LIKE '<path>/%'`. With path NULL everywhere, this
--      silently matched ZERO rows for any parent-only category — e.g.
--      GET /shop?category=electronics returned 0 products despite 14 real
--      products existing under its 4 children (confirmed reproduced
--      locally before this fix).
--   2. src/routes/control-center.tsx's /categories admin page builds its
--      "departments" rail via `categories.filter(cat => cat.level === 1)`.
--      With level NULL everywhere, the Enterprise Control Center's own
--      Category Manager screen has been rendering an EMPTY departments
--      list in production.
--
-- FIX: derive level/path from the EXISTING, correct parent_id
-- relationships already in the table — nothing invented, nothing
-- reshuffled. Confirmed via direct query that the real taxonomy is
-- exactly 2 levels deep (0 grandchildren exist across all 79 rows), so
-- two passes are sufficient today. If a 3rd taxonomy level is ever added,
-- the migration that adds those rows must set their own level/path (or a
-- follow-up migration must add a third pass) — this migration only
-- describes the taxonomy shape as it exists right now.
--
-- Path format matches the convention already used by the (unapplied)
-- Phase 1a seed and documented in migration 0053: '<parent_path>/<id>'.

-- Pass 1: roots (level 1) — path is just the row's own id.
UPDATE categories SET level = 1, path = CAST(id AS TEXT) WHERE parent_id IS NULL;

-- Pass 2: direct children of roots (level 2) — path is '<parent path>/<id>'.
UPDATE categories
SET level = 2,
    path = (SELECT p.path || '/' || CAST(categories.id AS TEXT) FROM categories p WHERE p.id = categories.parent_id)
WHERE parent_id IS NOT NULL;

-- NaijaDeals — Category + Footer Live Reconciliation: correct the header
-- pill curation to the REAL production taxonomy (Pat's directive,
-- 2026-09-18).
--
-- ROOT CAUSE: migration 0063 ("Checkpoint 3: Category Pill Navigation
-- Bar") was authored and its own automated tests were written against the
-- unapplied "Phase 1a" taxonomy (189 rows: electronics=id37,
-- phones-and-tablets=id38, smartphones=id39, toys-and-games=id154, ...).
-- Every `UPDATE categories SET nav_pill_visible = 1 ... WHERE slug = X`
-- statement in 0063 silently affected ZERO rows against the REAL
-- production taxonomy (79 rows, ids 1-150) for any slug that doesn't
-- exist there verbatim. Only 3 of the 13 intended slugs happen to be
-- spelled identically in both schemes (electronics, fashion, automotive),
-- which is exactly why production ended up with only those 3 flagged
-- nav_pill_visible=1 instead of the intended 13 — not a partial rollout,
-- a migration that was 77% silently inert on the table it actually ran
-- against.
--
-- FIX: re-curate the SAME 13-slot design (mixed level-1/level-2 depth,
-- same rough department coverage Pat approved for Checkpoint 3) using the
-- REAL slugs that actually exist in production, confirmed via direct D1
-- query immediately before writing this migration. Three of 0063's
-- original 13 targets have no equivalent in the real 2-level taxonomy
-- (african-fashion, art-and-crafts — no such categories exist under
-- Fashion or as a root; toys-and-games/books-and-education/
-- grocery-and-food/etc. are simply spelled differently) and are NOT
-- fabricated here — they are replaced with the closest genuine analogous
-- real category (documented per-line below) rather than invented rows,
-- per the explicit "do not fabricate categories merely to satisfy
-- curation" instruction. No new categories.* rows are created by this
-- migration — every UPDATE targets an id already returned by the
-- production audit run immediately before this file was written.
--
-- Idempotent / safe to re-run: first resets nav_pill_visible to 0 for
-- every row (undoing 0063's partial 3-slug state cleanly), then curates
-- the full real 13 from scratch, so this migration's end-state is fully
-- deterministic regardless of what nav_pill_visible/nav_pill_order held
-- before it ran.

-- Reset: clear ALL prior pill flags (0063 left exactly 3 rows flagged:
-- electronics, fashion, automotive — all 3 are re-flagged below anyway,
-- this reset just guarantees a clean, fully-deterministic end state).
UPDATE categories SET nav_pill_visible = 0, nav_pill_order = NULL WHERE nav_pill_visible = 1;

-- Real curated 13-pill set, mixed depth (level 1 departments alongside
-- level 2 subcategories), matching 0063's original department coverage:
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 1  WHERE slug = 'electronics';        -- level 1 (unchanged from 0063 — real slug matched)
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 2  WHERE slug = 'fashion';             -- level 1 (unchanged from 0063 — real slug matched)
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 3  WHERE slug = 'phones-tablets';      -- level 2, real equivalent of 0063's 'phones-and-tablets' (child of Electronics)
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 4  WHERE slug = 'laptops-computers';   -- level 2, real equivalent of 0063's 'computers-and-laptops' (child of Electronics)
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 5  WHERE slug = 'groceries';           -- level 1, real equivalent of 0063's 'grocery-and-food' — displays as "Supermarket" (A1 decision preserved)
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 6  WHERE slug = 'beauty-health';       -- level 1, real equivalent of 0063's 'beauty-and-personal-care'
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 7  WHERE slug = 'home-kitchen';        -- level 1, real equivalent of 0063's 'home-and-kitchen'
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 8  WHERE slug = 'automotive';          -- level 1 (unchanged from 0063 — real slug matched)
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 9  WHERE slug = 'sports-outdoors';     -- level 1, real equivalent of 0063's 'sports-and-fitness'
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 10 WHERE slug = 'shoes';               -- level 2, real Fashion subcategory with real products — SUBSTITUTE for 0063's 'african-fashion' (no African-identity subcategory exists under the real Fashion root; 'shoes' keeps the mixed-depth Fashion-subcategory pill slot honest, with genuine seeded products, rather than inventing a category or picking a currently-empty one like fashion-women)
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 11 WHERE slug = 'drinks';              -- level 1, real root category — SUBSTITUTE for 0063's 'art-and-crafts' (no Art & Crafts department exists in the real taxonomy; Drinks is a genuine, already-seeded root with real products, filling this slot honestly)
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 12 WHERE slug = 'baby-products';       -- level 1, real equivalent of 0063's 'baby-and-kids'
UPDATE categories SET nav_pill_visible = 1, nav_pill_order = 13 WHERE slug = 'books';               -- level 1, real equivalent of 0063's 'books-and-education' — displays as "Books & Learning" (A1 decision preserved)

-- A1 label overrides (navigation-display-only — real `name`/`slug`/SEO/
-- breadcrumbs/PDP references are completely untouched), reapplied against
-- the REAL slugs. Idempotent regardless of any prior override state.
UPDATE categories SET nav_label_override = 'Supermarket'      WHERE slug = 'groceries';
UPDATE categories SET nav_label_override = 'Books & Learning' WHERE slug = 'books';

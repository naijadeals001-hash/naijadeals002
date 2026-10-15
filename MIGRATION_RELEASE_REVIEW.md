# NaijaEats Phase 1 — Migration Release Review Artifact (0078–0081)

**Status: REVIEW ONLY. No production execution. No historical migration files modified.**
Generated: 2026-10-15, against branch `release/naijaeats-phase1` (baseline `897a844`).

---

## 0078_naijaeats_taxonomy_restore.sql

- **SHA-256**: `151146197759173968afdffcda4dc146a815437c202996ecf36586b8b9be57a0`
- **Current header authorization**: *"Authorized for LOCAL/DEV D1 ONLY. Do not apply to production."*
- **Proposed production-release treatment**: **SKIP at production-release time, or ship as a verified no-op.** Production already holds these exact 10 cuisines + 56 dishes (byte-for-byte, confirmed via direct read-only comparison on 2026-09-22 and re-verified this session). `INSERT OR IGNORE` means running it against production is harmless, but it accomplishes nothing there — its sole purpose is dev/local parity.
- **Tables/columns affected**: `cuisines` (10 rows), `dishes` (56 rows). No schema change (no ALTER/CREATE).
- **Rows inserted**: 10 cuisines (IDs 1–10), 56 dishes (IDs reference `cuisine_id` FK).
- **FK/uniqueness**: `dishes.cuisine_id` FK → `cuisines.id`, all 56 rows reference existing IDs 1–10. `slug` UNIQUE constraint on both tables — confirmed no collision against production's existing rows (identical slugs, identical IDs).
- **Idempotency**: `INSERT OR IGNORE` on explicit primary-key IDs. Fully idempotent — re-running is a guaranteed no-op after first success.
- **Seed/demo-data disclosure**: **None.** This is real production taxonomy data, not demo/fabricated content.
- **Rollback limitations**: Rollback would require `DELETE FROM dishes WHERE id IN (...); DELETE FROM cuisines WHERE id IN (...)` — safe only if no `menu_items.dish_id` FK references exist yet (true before 0080 runs; **false after**, since 0080 creates such references). Do not roll back 0078 after 0080 has applied without first rolling back 0080.
- **Production verification query**: `SELECT COUNT(*) FROM cuisines; SELECT COUNT(*) FROM dishes;` — expect 10 and 56 respectively, unchanged from pre-migration state.
- **Migration-runner assumption**: Standard `wrangler d1 migrations apply` / hosted-deploy path — filename-sorted, `d1_migrations`-table-gated. No special runner behavior required.

---

## 0079_naijaeats_provenance.sql

- **SHA-256**: `fd9d590387387a3bcdee17620aa337fddde36ef51e6a1d29d39b3f0556c3f70e`
- **Current header authorization**: *"Authorized for LOCAL/DEV D1 in this phase. Not applied to production as part of this work."*
- **Proposed production-release treatment**: **Genuine production schema change — requires explicit re-authorization from Pat before shipping**, since it is NOT a no-op: `source_type` column is confirmed **absent** from production's `restaurants` and `menu_items` tables today.
- **Tables/columns affected**: `ALTER TABLE restaurants ADD COLUMN source_type TEXT NOT NULL DEFAULT 'live'`; `ALTER TABLE menu_items ADD COLUMN source_type TEXT NOT NULL DEFAULT 'live'`; 2 new indexes (`idx_restaurants_source_type`, `idx_menu_items_source_type` — confirm exact names in file before release).
- **Rows inserted/updated**: Zero explicit INSERT/UPDATE. `ADD COLUMN ... DEFAULT 'live'` backfills all existing rows with `'live'` implicitly (D1/SQLite semantics) — this means **every existing production restaurant/menu_item row would be retroactively labeled `source_type='live'`**, which is correct and intended (production currently has 0 restaurants/menu_items, so this is moot today, but will matter once real restaurant partners onboard).
- **FK/uniqueness**: None — simple column addition, no new constraints beyond `NOT NULL DEFAULT`.
- **Idempotency**: D1 `ALTER TABLE ADD COLUMN` is **not** naturally idempotent — re-running produces "duplicate column name" (`SQLITE_ERROR`), consistent with the project's own documented 0071 incident. Must rely purely on `d1_migrations` tracking to prevent re-execution; do not attempt manual re-apply.
- **Seed/demo-data disclosure**: None — pure DDL.
- **Rollback limitations**: SQLite does not support `DROP COLUMN` without full table recreation (confirmed via this project's own skill-doc hint: *"DROP/RENAME COLUMN need table recreation"*). Rolling back 0079 after it ships requires a full `restaurants`/`menu_items` table rebuild, not a simple reverse migration. **High rollback cost — review carefully before shipping.**
- **Production verification query**: `PRAGMA table_info(restaurants);` / `PRAGMA table_info(menu_items);` — expect `source_type` present after; `SELECT DISTINCT source_type FROM restaurants;` — expect `'live'` for all pre-existing rows (there are currently 0, so expect empty set).
- **Migration-runner assumption**: Standard path. No special handling, but **this is the first of the 4 files with real, non-trivial production effect** — treat as the highest-scrutiny item in this set.

---

## 0080_naijaeats_phase1_seed.sql

- **SHA-256**: `c6fad8482f29657f88c56c80cbb2400f11ced68d3ac0b4ab8ef87b5be42d91dd`
- **Current header authorization**: *"Authorized for LOCAL/DEV D1 ONLY. Not applied to production."*
- **Proposed production-release treatment**: **Explicit demo-data decision required from Pat.** This migration seeds 6 fully-labeled `[DEMO]` restaurants/providers/users into whatever database it runs against — including production, if shipped. This is a **policy decision, not a technical one**: do you want demo restaurants live in production, even clearly labeled? Empirically verified safe and non-destructive (see below), but the decision to seed demo data into prod is Pat's call.
- **Tables/columns affected**: `users` (6 new rows), `provider_profiles` (6), `restaurants` (6), `menus` (6), `menu_sections` (~10), `menu_items` (~38, confirmed via local test — not 69 as earlier estimated from title counts), `menu_item_option_groups` (~15), `menu_item_options` (~26).
- **Rows inserted — empirically confirmed via local test run against production-equivalent D1**: 6 restaurants, 38 menu_items, 20 provider_profiles-adjacent rows (includes pre-existing), 15 option groups, 26 options.
- **FK/uniqueness**:
  - `menu_items.dish_id` → `dishes.id` (migration 0078) — confirmed all referenced dish IDs exist.
  - `source_type='seed'` literal values require migration 0079's column to exist first — confirmed dependency, test-verified by applying 0079 before 0080.
  - `users.email` UNIQUE — `demo_eats_*@naijadeals.demo` convention, confirmed zero collision against production's real user emails.
  - `users.phone` UNIQUE — `+234803000030{1-6}` range, pre-verified unique by the migration's own author against production's phone column (not independently re-verified this session, but no FK/unique errors occurred on local test apply).
- **Idempotency**: Confirmed via full 668-line read — every INSERT is guarded by `WHERE NOT EXISTS` on a natural key (email for users, slug for restaurants, `(menu_section_id, name)` for menu_items, etc.). Re-running after first success is a no-op.
- **Seed/demo-data disclosure**: **Yes — substantial.** 6 demo users (role='customer', `[DEMO]` name prefix), 6 demo provider_profiles (`verification_status='pending'`), 6 demo restaurants (`verification_status='pending'`, `rating_avg=0`, `rating_count=0`, no fabricated reviews/ratings/deals/ETAs per the file's own stated principles — confirmed by inspection). Password: `Demo-NaijaEats-2026!` (PBKDF2-HMAC-SHA256, 100k iterations) — **not a secret, intentionally documented** in the migration's own header comment; treat as public knowledge, not a credential leak, but confirm Pat is comfortable with a known demo password existing in a production-adjacent migration file.
- **Rollback limitations**: Deleting these rows requires cascading deletes in dependency order (menu_item_options → menu_item_option_groups → menu_items → menu_sections → menus → restaurants → provider_profiles → users), filtered by the `demo_eats_*` email convention / `source_type='seed'` marker. No rollback script currently exists — would need to be written before release if rollback capability is required.
- **Production verification query**: `SELECT COUNT(*) FROM restaurants WHERE source_type='seed';` — expect 6; `SELECT COUNT(*) FROM users WHERE email LIKE 'demo_eats_%';` — expect 6.
- **Migration-runner assumption**: Standard path. **Empirically confirmed this session**: applies cleanly in 106 SQL commands against a production-equivalent local D1 populated via `gsk hosted d1_export` → `sqlite3` import, immediately after 0078/0079.

---

## 0081_naijaeats_restaurant_images.sql

- **SHA-256**: `06aabab58a88e78c8a8917eb1e10be8b7f2ec9ec330f02fe670776a7a90fd68c`
- **Current header authorization**: *"Local/dev D1 only. No production writes."*
- **Proposed production-release treatment**: **Ships together with 0080 as a unit** — cosmetic completion of the same 6 demo restaurants; no independent decision needed beyond the 0080 decision above.
- **Tables/columns affected**: `UPDATE restaurants SET logo_url = ?, cover_image_url = ?` — no schema change.
- **Rows updated**: 6 (one per demo restaurant), confirmed via local test: all 6 restaurants show correct `/static/eats/restaurants/<slug>-logo.jpg` / `-cover.jpg` paths post-migration.
- **FK/uniqueness**: None directly; guard clause `WHERE slug = <x> AND source_type = 'seed'` depends on 0079's column existing and 0080's rows existing — **confirmed non-independent, must follow both**.
- **Idempotency**: Plain `UPDATE ... WHERE`, naturally idempotent (re-running sets the same values again, no error).
- **Seed/demo-data disclosure**: Images only, no new identity-bearing data. The `source_type='seed'` guard is a genuine safety feature — **this UPDATE can never touch a real/live restaurant row even if accidentally run against a production DB that later has real restaurants**, confirmed by inspection.
- **Rollback limitations**: Would require storing pre-migration `logo_url`/`cover_image_url` values (both were presumably NULL before, since these are newly-created demo rows) — trivial rollback: `UPDATE restaurants SET logo_url=NULL, cover_image_url=NULL WHERE source_type='seed'`.
- **Production verification query**: `SELECT slug, logo_url, cover_image_url FROM restaurants WHERE source_type='seed';` — expect 6 rows, all non-NULL, all pointing at `/static/eats/restaurants/...`.
- **Migration-runner assumption**: Standard path. **Empirically confirmed**: applied cleanly as the 4th and final migration in the test run.

---

## Cross-cutting findings

1. **Dependency order is mandatory and confirmed**: 0078 → 0079 → 0080 → 0081. Empirically verified via a clean sequential `wrangler d1 migrations apply --local` run against a production-equivalent local D1 (imported from a real `gsk hosted d1_export` snapshot). Zero FK violations (`PRAGMA foreign_key_check` returned empty). Zero errors.
2. **Header contradiction remains unresolved and requires Pat's explicit decision**, not a default assumption: all 4 files say "local/dev only" / "not applied to production." This review does not recommend silently overriding that — it surfaces exactly what each file would do if that authorization were extended to production, so Pat can make an informed call per file (0078 = safe no-op; 0079 = real schema change, moderate decision; 0080/0081 = demo-data policy decision).
3. **No wallet balances, UAT session data, or other test-environment state were found in any of the 4 files** — confirmed by direct grep (zero matches for `wallet_balance`, `INSERT INTO wallets`, `UPDATE users SET` patterns).
4. **Migration-runner behavior empirically validated against realistic (already-populated) state** — not just theorized. This directly resolves the open question from the prior analysis turn about whether the runner safely handles this exact 4-file set.

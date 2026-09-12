# NaijaDeals — Production Schema Map (Local ↔ Production, Migrations 0001–0036)

**Status:** Reconstruction Phase 1, Checkpoint 1 deliverable (mega-prompt Section 5).
**Branch:** `production-reconstruction`
**Date:** 2026-09-12
**Production schema capture method:** `gsk hosted d1_schema` (read-only), re-fetched fresh this session against `naijadeals.com`'s hosted D1 (project `393ef41c-f7b9-4ded-996a-2f5265e3280d`, database uuid `bbbd12bf-e8cd-4e14-8413-76ed8b96ed1e`). Result: **106 tables** (105 application tables + `d1_migrations`), **0 views**, **173 indexes**. Identical counts to an earlier cache from the same investigation — production has not moved since the prior audit turns.
**Production SHA (unrecovered source):** `99b1664df552ce1cd707330e17207d8869f12a4e` — see `docs/NAIJADEALS-PRODUCTION-RECOVERY-REPORT.md` for the exhaustive search that failed to locate this SHA anywhere in local git, GitHub, or 7 Genspark-hosted projects.
**GitHub baseline this map was built from:** commit `1cdfdcbc976d2dbb1f9885a4576ba8cfc5ed58e1` on `main`.

**Important limitation, stated up front (mega-prompt Section 38 compliance):** D1 does not retain per-migration column-level history — only the *current, final-state* `CREATE TABLE` for each table is inspectable via a schema dump. This means:
- Table **creation** can be attributed to a migration with reasonable confidence (a table either exists or it doesn't; if it's new relative to local's 12 migrations, it was created somewhere in 0013–0036).
- Table **name-to-migration-number** attribution beyond that is **inferred** by semantic/subject-area grouping and foreign-key dependency order, cross-checked against production's own migration *filenames* (which do carry semantic hints, e.g. `0032_naijaeats_foundation.sql`). This is not independently confirmed against original source.
- Migrations that were originally **ALTER-only** (adding columns to a table that already existed under an earlier migration) generally **cannot** be pinpointed to an exact migration number after the fact, because the final schema dump only shows the end state, not which migration added which column. Where this applies, the affected migration file is left as an **intentionally-empty placeholder** marked `UNKNOWN — SOURCE CODE REQUIRED` rather than guessed (5 such migrations: 0029, 0030, 0031, 0033, 0036 — see §4 below).
- Two exceptions to "placeholder" were found and handled: production ALTERed two tables that already existed in **local's own** migrations 0001–0012 (`reviews`, `vendors`). These ALTERs were column-diffed explicitly (see §3) and folded into the migration whose subject area they best serve, since a normal migration-runner will only apply a file once and an empty placeholder here would have hidden a real, verifiable structural fact.

---

## 1. Verification Method

This map is not merely descriptive — it was mechanically verified:

1. All 106 production `CREATE TABLE` statements and 173 `CREATE INDEX` statements were extracted verbatim from the `gsk hosted d1_schema` dump into standalone SQL files and loaded into a throwaway `sqlite3` database (`prod_schema_only.sqlite3`) exactly as production defines them.
2. All 36 local migration files (`0001`–`0036`, the 12 pre-existing + 24 reconstructed this phase) were applied **in order** to a second, independent throwaway `sqlite3` database (`test_reconstruction.sqlite3`).
3. Both databases were compared programmatically via `sqlite3` `PRAGMA table_info`, `PRAGMA foreign_key_list`, and `sqlite_master` index introspection — not by eyeballing SQL text.

**Result:**

| Check | Result |
|---|---|
| Table count | Production 105 application tables (106 incl. `d1_migrations`) vs. Local (reconstructed) 105 application tables — **0 set difference** |
| Column-level drift (all 105 tables) | **0 unresolved drift** after 2 real ALTERs were identified and folded in (see §3) |
| Index count | 173 / 173 — **exact match** |
| Index definitions (normalized SQL) | 172 / 173 byte-equivalent; 1 (`idx_vendors_user_id_unique`) differs only in `WHERE NOT user_id IS NULL` vs `WHERE user_id IS NOT NULL` — logically identical, cosmetic only |
| Foreign key relationships (all 105 tables via `PRAGMA foreign_key_list`) | **0 mismatches** |

This is the strongest evidence available, short of the original source, that the reconstructed migrations 0013–0036 (plus the two ALTER fixes to 0020/0027) reproduce production's actual database contract.

---

## 2. Local Tables (Migrations 0001–0012) — Unchanged Ownership

These 34 tables already existed in the repository before this reconstruction phase and needed **no new columns** except the two explicit ALTERs in §3. All are confirmed present, byte-equivalent in production (case-only `DATETIME`/`datetime` differences ignored as non-functional).

| Migration | Tables Created |
|---|---|
| `0001_initial_schema.sql` | `addresses, cart_items, carts, categories, newsletter_subscribers, order_items, orders, payment_transactions, products, reviews, sessions, users, vendors, wallet_accounts, wallet_ledger` |
| `0002_marketplace_depth.sql` | `brands, coupons, homepage_feed_cache, product_listings, product_questions, product_variants, saved_payment_methods, wishlists` |
| `0003_review_avatars.sql` | (ALTER only — adds `avatar_url` to `reviews`, confirmed present in both) |
| `0004_checkout_depth.sql` | (ALTER only, confirmed) |
| `0005_account_experience.sql` | `notifications` |
| `0006_brand_merchandising.sql` | (ALTER only, confirmed) |
| `0007_address_book_depth.sql` | `nigerian_states` |
| `0008_hero_campaigns.sql` | `hero_campaigns` |
| `0009_seller_portal.sql` | `nigerian_banks, seller_finance_accounts, seller_payout_account_audit, seller_payout_accounts` |
| `0010_ecosystem_verticals.sql` | `ecosystem_vertical_features, ecosystem_verticals, ecosystem_waitlist` |
| `0011_ecosystem_waitlist.sql` | `ecosystem_waitlist_signups` |
| `0012_locale_preference.sql` | (ALTER only, confirmed) |

Total: **34 tables**, all confirmed identical (name + column set + FKs) between local and production, subject to the two exceptions below.

---

## 3. Schema-Drift ALTERs Found (Production Changed Pre-Existing Local Tables)

Two tables that already existed under local's own migrations were found, by column-level diff (not just table-name diff), to have been ALTERed by production somewhere in the unrecovered 0013–0036 range. Both are now corrected in the reconstructed migration files.

### 3.1 `reviews` (originally created by `0001`/`0002`)

| Column | Production | Local (before fix) | Status |
|---|---|---|---|
| `product_id` | `INTEGER` (nullable) | `INTEGER NOT NULL` | **Changed**: production relaxed NOT NULL to support polymorphic reviews without a product |
| `reviewable_type` | `TEXT NOT NULL DEFAULT 'product' CHECK (IN ('product','provider_profile','restaurant','stay'))` | *missing* | **Added** |
| `reviewable_id` | `INTEGER NOT NULL` | *missing* | **Added** |
| `status` | `TEXT NOT NULL DEFAULT 'published' CHECK (IN ('published','hidden'))` | *missing* | **Added** |
| `updated_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | *missing* | **Added** |
| `moderated_by_user_id` | `INTEGER REFERENCES users(id)` | *missing* | **Added** |
| `moderated_at` | `TEXT` | *missing* | **Added** |

Plus 3 new indexes: `idx_reviews_reviewable`, `idx_reviews_status`, `idx_reviews_one_per_user_per_entity` (unique, partial `WHERE user_id IS NOT NULL`).

**Attribution:** Folded into `migrations/0027_polymorphic_reviews_foundation.sql` — the migration is literally named for this exact change (polymorphic reviews), and it is the same subject-area file that introduces `review_status_events`. Implemented as `ALTER TABLE ... ADD COLUMN` for the 6 new columns, plus a SQLite table-rebuild (SQLite cannot relax a `NOT NULL` constraint via ALTER) to make `product_id` nullable. **Exact original migration number for this ALTER is `UNKNOWN — SOURCE CODE REQUIRED`** — only the final-state columns are recoverable, not which of migrations 0013–0036 actually applied them; 0027 is the most defensible attribution given the filename evidence.

### 3.2 `vendors` (originally created by `0001`, extended by `0009`)

| Column | Production | Local (before fix) | Status |
|---|---|---|---|
| `pickup_address_line1` | `TEXT` (nullable) | *missing* | **Added** |

**Attribution:** Folded into `migrations/0020_naijasend_commerce_bridge.sql` — this is the first NaijaSend-subject migration whose tables (`pickup_jobs`) require a vendor pickup address to originate a shipment from a seller's store, making it the most defensible attribution among the reconstructed files. **Exact original migration number is `UNKNOWN — SOURCE CODE REQUIRED`.**

**Why these two were caught and others may not have been:** The initial mapping pass (Section 5/6 of the mega-prompt) only diffed *table names* between local and production to find the 71 net-new tables for 0013–0036. It did **not** initially diff *columns* on the 34 pre-existing shared tables. This gap was caught during Checkpoint 1 verification (§1 above) by re-running a full column-level `PRAGMA table_info` diff across all 105 tables — not just the 71 new ones — and finding these two real ALTERs. This is documented here transparently per mega-prompt Section 3's "document conflicts, don't silently resolve" rule. **This also means it remains possible that other local tables carry additional ALTERs that a schema-only dump cannot distinguish from a same-named, differently-typed column** (e.g., a `TEXT` column that production silently widened from `VARCHAR(50)` semantics — SQLite doesn't enforce length so this wouldn't show as a diff). No such case was found in this pass, but it cannot be ruled out with 100% certainty from a final-state dump alone.

---

## 4. Production-Only Tables (71 Tables, Migrations 0013–0036)

All 71 tables that exist in production but not in local's original 12 migrations, mapped to their reconstructed migration file. Validated via Python set-arithmetic: **71 tables mapped, 0 missing, 0 extra** (exhaustive, gap-free).

| # | Migration File | Tables Created | Confidence |
|---|---|---|---|
| 0013 | `control_center_foundation.sql` | `cc_countries, cc_country_settings, cc_permissions, cc_roles, cc_role_permissions, cc_user_roles, cc_system_health, cc_audit_logs, cc_alerts, cc_domain_events` (10) | High — exact CREATE TABLE recovered |
| 0014 | `seller_finance_ledger.sql` | `seller_ledger` (1) | High |
| 0015 | `naijasend_logistics_foundation.sql` | `logistics_providers, vehicle_types, vehicles` (3) | High |
| 0016 | `naijasend_driver_foundation.sql` | `driver_profiles, driver_documents, driver_vehicle_assignments` (3) | High |
| 0017 | `affiliate_foundation.sql` | `affiliate_profiles, affiliate_referral_codes, affiliate_campaigns, affiliate_clicks, affiliate_attributions` (5) | High |
| 0018 | `affiliate_account_state.sql` | `affiliate_accounts, affiliate_commissions, affiliate_ledger, affiliate_payouts, affiliate_fraud_events` (5) | High |
| 0019 | `naijasend_shipment_foundation.sql` | `shipment_rate_cards, shipments, shipment_addresses, shipment_items, shipment_status_events` (5) | High |
| 0020 | `naijasend_commerce_bridge.sql` | `delivery_jobs, pickup_jobs` (2) **+ ALTER `vendors.pickup_address_line1`** | High (tables) / Medium (ALTER attribution — see §3.2) |
| 0021 | `merchant_foundation.sql` | `product_import_batches, product_import_rows` (2) | High |
| 0022 | `capability_registry.sql` | `cc_capabilities, cc_capability_country_overrides` (2) | High |
| 0023 | `integration_hub.sql` | `cc_integrations, cc_integration_providers, cc_integration_country_overrides` (3) | High |
| 0024 | `booking_engine_foundation.sql` | `bookable_listings, booking_availability_blocks, bookings, booking_status_events` (4) | High |
| 0025 | `provider_identity_foundation.sql` | `provider_organizations, provider_profiles, provider_profile_status_events` (3) | High |
| 0026 | `maps_gps_foundation.sql` | `gps_events` (1) | High |
| 0027 | `polymorphic_reviews_foundation.sql` | `review_status_events` (1) **+ ALTER `reviews` (6 cols, product_id nullable)** | High (table) / Medium (ALTER attribution — see §3.1) |
| 0028 | `gigs_stay_customer_activation.sql` | `gig_service_details, stay_unit_details` (2) | High |
| 0029 | `provider_verification_rbac.sql` | *(none)* | **UNKNOWN — SOURCE CODE REQUIRED** — placeholder |
| 0030 | `gigs_marketplace_imagery.sql` | *(none)* | **UNKNOWN — SOURCE CODE REQUIRED** — placeholder |
| 0031 | `naijafresh_categories.sql` | *(none)* | **UNKNOWN — SOURCE CODE REQUIRED** — placeholder |
| 0032 | `naijaeats_foundation.sql` | `cuisines, dishes, restaurants, restaurant_status_events, menus, menu_sections, menu_items, menu_item_option_groups, menu_item_options, eats_carts, eats_cart_items, eats_orders, eats_order_items, eats_order_item_options, eats_order_status_events` (15) | High |
| 0033 | `naijaeats_imagery.sql` | *(none)* | **UNKNOWN — SOURCE CODE REQUIRED** — placeholder |
| 0034 | `naijastay_foundation.sql` | `stay_properties, stay_property_status_events` (2) | High |
| 0035 | `naijasend_vehicle_marketplace.sql` | `vehicle_documents, vehicle_photos` (2) | High |
| 0036 | `naijasend_vehicle_type_expansion.sql` | *(none)* | **UNKNOWN — SOURCE CODE REQUIRED** — placeholder |

**Total new tables: 71.** Sum check: 10+1+3+3+5+5+5+2+2+2+3+4+3+1+1+2+0+0+0+15+0+2+2+0 = **71.** ✓

---

## 5. The Five `UNKNOWN — SOURCE CODE REQUIRED` Placeholder Migrations

Per mega-prompt Section 38 ("if production behavior can't be determined, never guess"), these 5 migrations could not have any new `CREATE TABLE` honestly attributed to them from a final-state schema dump. Each is preserved as an empty, clearly-labeled, no-op (`SELECT 1;`) file so the 0001–0036 numbering sequence stays intact and matches production's own `expected_migrations` array exactly (required for the `/api/version` migration-count mechanism to ever report `36` again once this is deployed).

| Migration | Why no table could be attributed | Where the likely real column change lives instead |
|---|---|---|
| `0029_provider_verification_rbac.sql` | Name implies ALTER-only (verification-status column and/or RBAC role-assignment logic on `provider_profiles`/`cc_user_roles`) — indistinguishable from earlier migrations in a final-state dump | Final observed columns of `provider_profiles` are already captured verbatim in `0025` |
| `0030_gigs_marketplace_imagery.sql` | "Imagery" migrations most plausibly add `cover_image_url`/gallery columns to existing gig tables, not new tables | Final observed columns of `gig_service_details`/`bookable_listings` already captured in `0028`/`0024` |
| `0031_naijafresh_categories.sql` | No NaijaFresh-specific table exists in the final schema at all — NaijaFresh reuses the shared `categories`/`products` tables from `0001`/`0002`. This matches the prior Live Production Audit's finding that NaijaFresh is the thinnest vertical (page shell only, no dedicated product schema observed) | Final observed columns of `categories` already captured in `0001` |
| `0033_naijaeats_imagery.sql` | Same imagery pattern as 0030, for NaijaEats tables | Final observed columns of `restaurants`/`dishes`/`menu_items` already captured in `0032` |
| `0036_naijasend_vehicle_type_expansion.sql` | `vehicle_types`/`vehicles` were already created in `0015` with their final observed column set, which may include marketplace-listing columns (e.g. daily rate, listing status) actually added by this migration | Final observed columns of `vehicle_types`/`vehicles` already captured in `0015` |

**Design decision:** rather than fabricate a plausible-looking column split across these 5 files (which the mega-prompt explicitly forbids), every column any of these migrations might have added is already present in the earlier "foundation" migration's `CREATE TABLE` (since that's genuinely where the final-state dump shows the column existing). This is honest but has one side effect worth flagging: **if the original source code is ever recovered**, these 5 files will need their column additions retroactively split out of the foundation migrations they were folded into, to exactly reproduce the original 36-migration history. Until then, the end-state schema is correct even though the migration-by-migration history is compressed.

---

## 6. Foreign-Key Dependency Notes

Cross-checked all 71 new tables' `REFERENCES` targets to confirm migration ordering is FK-safe (a table is never created before a table it references):

- `0015` creates `logistics_providers`, `vehicle_types`, `vehicles` **before** `0016`'s `driver_vehicle_assignments` references `vehicles`.
- `0019` creates `shipments` **before** `0020`'s `delivery_jobs`/`pickup_jobs` reference `shipments`.
- `0024` creates `bookable_listings` **before** `0028`'s `gig_service_details`/`stay_unit_details` reference it (gigs/stay activation depends on the booking engine's listing concept).
- `0025` creates `provider_profiles` **before** `0032`'s `restaurants.owner_provider_profile_id` references it.
- `0032` (NaijaEats) is entirely self-contained plus references to `provider_profiles` (0025) and `categories`/`cuisines` (self).
- `0034` (`stay_properties`) references `provider_profiles` (0025) and `bookable_listings` (0024, via `stay_unit_details`).

**Verified programmatically:** `PRAGMA foreign_key_list` on all 105 tables in the applied local database returns **0 mismatches** against production's own FK graph (see §1). This confirms the migration ordering as written is not just plausible but structurally correct.

---

## 7. Business-Purpose Summary (Per Subject Area)

| Subject Area | Tables | Business Purpose |
|---|---|---|
| Control Center (`cc_*`) | `cc_countries, cc_country_settings, cc_permissions, cc_roles, cc_role_permissions, cc_user_roles, cc_system_health, cc_audit_logs, cc_alerts, cc_domain_events, cc_capabilities, cc_capability_country_overrides, cc_integrations, cc_integration_providers, cc_integration_country_overrides` (15 tables) | RBAC (roles/permissions/user-role assignment), country/region configuration, platform observability (system health, audit trail, alerts, domain events), feature-capability registry per country, third-party integration registry — this is the schema backbone for the confirmed-live `/control-center` route (auth-gated, observed in the Live Production Audit) |
| Seller Finance | `seller_ledger` (1 table) | Double-entry-style ledger of vendor balance movements (order payouts, fees, adjustments) — extends `seller_finance_accounts`/`seller_payout_accounts` from local `0009` |
| NaijaSend Logistics | `logistics_providers, vehicle_types, vehicles, driver_profiles, driver_documents, driver_vehicle_assignments, vehicle_documents, vehicle_photos` (8 tables) | Fleet/driver onboarding and identity for the confirmed-real `/gigs/provider`-adjacent logistics-partner side of NaijaSend |
| NaijaSend Shipments | `shipment_rate_cards, shipments, shipment_addresses, shipment_items, shipment_status_events, delivery_jobs, pickup_jobs, gps_events` (8 tables) | Shipment lifecycle (create → pickup → in-transit → delivered), address capture, line items, status-event audit trail, live GPS tracking events, and the pickup/delivery job assignment bridge to drivers. **Pricing formula is NOT recoverable from schema alone** — `shipment_rate_cards` stores rate-card *outputs*, not the calculation logic; this must be marked `UNKNOWN — SOURCE CODE REQUIRED` in application code per mega-prompt Section 25 |
| Affiliates | `affiliate_profiles, affiliate_referral_codes, affiliate_campaigns, affiliate_clicks, affiliate_attributions, affiliate_accounts, affiliate_commissions, affiliate_ledger, affiliate_payouts, affiliate_fraud_events` (10 tables) | Affiliate identity, referral-code/click tracking, attribution-to-order matching, commission calculation *records* (not formula), ledger, payouts, fraud detection events. Commission **formula is UNKNOWN — SOURCE CODE REQUIRED** per mega-prompt Section 23 |
| Merchant Import | `product_import_batches, product_import_rows` (2 tables) | Bulk product-catalog import tooling for sellers (CSV/bulk upload with row-level validation status) |
| Booking Engine | `bookable_listings, booking_availability_blocks, bookings, booking_status_events` (4 tables) | Generic polymorphic booking engine shared across NaijaGigs (services) and NaijaStay (property units) — `bookable_listings` is the polymorphic anchor, `booking_status_events` is the audit trail for state transitions |
| Provider Identity | `provider_organizations, provider_profiles, provider_profile_status_events` (3 tables) | Shared provider/vendor identity layer distinct from ordinary marketplace `vendors` — used by NaijaGigs providers, NaijaEats restaurant owners, and NaijaStay hosts alike (`restaurants.owner_provider_profile_id` and `stay_properties.owner_provider_profile_id` both reference `provider_profiles`) |
| Reviews (extension) | `review_status_events` (1 table) + ALTER on `reviews` | Polymorphic reviews (product / provider_profile / restaurant / stay) with a moderation workflow (`status`, `moderated_by_user_id`, `moderated_at`) and audit trail of status changes |
| Gigs/Stay Activation | `gig_service_details, stay_unit_details` (2 tables) | Vertical-specific detail tables attached 1:1 to a `bookable_listings` row — the polymorphic booking engine's "what kind of thing is being booked" extension tables |
| NaijaEats | `cuisines, dishes, restaurants, restaurant_status_events, menus, menu_sections, menu_items, menu_item_option_groups, menu_item_options, eats_carts, eats_cart_items, eats_orders, eats_order_items, eats_order_item_options, eats_order_status_events` (15 tables) | Full restaurant/food-delivery vertical: cuisine taxonomy, restaurant onboarding + status audit trail, menu hierarchy (menu → section → item → option group → option), a **separate** cart/order pipeline from the core NaijaShop `carts`/`orders` (mirrors the same shape but is functionally distinct — restaurant ordering has different state transitions and no shipping) |
| NaijaStay | `stay_properties, stay_property_status_events` (2 tables) | Property/host onboarding for the confirmed "YES backend" NaijaStay vertical, feeding into the shared booking engine via `bookable_listings`/`stay_unit_details` |

---

## 8. Explicit Non-Findings (What Was NOT Changed/Renamed)

- **Zero tables were renamed.** Every production table name that also exists locally is spelled identically.
- **Zero tables were dropped.** All 34 local tables persist unchanged (except the 2 ALTERs in §3) in production.
- **No parallel/competing systems exist in production's schema** — e.g. there is no `users2` or `vendors2`. NaijaEats' `eats_orders`/`eats_carts` are a deliberately **separate** pipeline from `orders`/`carts` (different subject area — restaurant orders vs. product orders — not a duplicate of the same concept), consistent with mega-prompt Section 9's guidance to only create a second system when the underlying concept is genuinely different.

---

## 9. Cross-Reference

- Full production route/API surface: `docs/NAIJADEALS-LIVE-PRODUCTION-AUDIT.md`
- Forensic source-recovery investigation (why the original 0013–0036 files can't be found): `docs/NAIJADEALS-PRODUCTION-RECOVERY-REPORT.md`
- Master index of all recovery/audit documents: `docs/NAIJADEALS-PRODUCTION-RECOVERY-INDEX.md`
- Reconstruction plan and phase roadmap: `docs/NAIJADEALS-PRODUCTION-RECONSTRUCTION-PLAN.md`
- The 24 reconstructed migration files themselves: `migrations/0013_*.sql` through `migrations/0036_*.sql` (each carries its own provenance header pointing back to this document)

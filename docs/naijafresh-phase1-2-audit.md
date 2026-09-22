# NaijaFresh Phase 1 + 2 — Pre-Build Audit

**Branch:** `feature/naijafresh-marketplace` (off `main` @ `566328b`, which now
includes the deployed Gigs/Stay/Aura live-fix — `main` was fast-forwarded to
this commit before branching so NaijaFresh builds on the exact baseline that
is actually running in production).

**Purpose:** document what already exists before writing any NaijaFresh code,
per the explicit "audit before coding" instruction. Every item below was read
directly from the codebase, not assumed.

## 1. Commerce engine already in place (NaijaShop's Marketplace Engine 2.0)

| Concept | Table(s) | Key columns relevant to Fresh |
|---|---|---|
| Canonical product | `products` (0001, rewritten 0002) | `category_id`, `title`, `description`, `image_url`, `gallery_json`, `specs_json`, `rating_avg/count`, `is_active`, `source_type` (`seed\|live\|imported`, added 0053) |
| Seller's offer on a product | `product_listings` (0002) | `vendor_id`, `price_kobo`, `compare_at_price_kobo`, `stock`, `delivery_days_min/max`, `is_primary` (buy-box winner), `is_active`, `source_type`, **`unit_of_measure`** (free-text: kg/bunch/basket/crate/bag/piece/..., added 0038), **`unit_quantity`**, **`is_variable_weight`** + **`variable_weight_tolerance_pct`** (added 0038) |
| Wholesale/bulk tiers | `product_pricing_tiers` (0038) | `listing_id`, `min_quantity`, `max_quantity`, `unit_price_kobo`, `tier_label` (e.g. "Wholesale (50+ bags)") — purely additive/optional, zero-row = today's flat-price behavior |
| Seller | `vendors` (0001) + `organization_id`/`store_type` (0038) | `name`, `city`, `is_verified`, `rating_avg/count`; `store_type` free-text incl. `farmer`/`wholesaler`/`retailer` |
| Categories | `categories` (0001) + `level/path/country_iso` (0053) + `category_type` (0039) | `category_type='product'` is what NaijaShop/Fresh both use; `path` enables "Fashion" filter to also match descendant "Ankara Fabric" — same mechanic Fresh categories get for free |
| Source/discovery tags | `collections` + `product_collections` (0038) | **`farm-direct`** and **`market-fresh`** collections already seeded (rows 8, 9) — directly satisfies the brief's "Farm Direct / Market Fresh" source concept with ZERO new schema |
| Cart | `carts`, `cart_items` + `src/lib/cart.ts` | `getCartItems()` already joins listing→product→vendor; **`groupByVendor()`** and **`groupByCurrency()`** already exist and are used by the cart page/API today |
| Checkout | `src/pages/checkout.tsx`, `src/lib/orders.ts` | Address selection, delivery method (standard/express) w/ `calculateDeliveryFeeKobo()`, wallet + Paystack payment, coupon support — all vertical-agnostic, works on any `product_listings` row |
| Search/filter/sort | `GET /api/catalog/products` (`src/routes/api-catalog.ts`) + `src/pages/shop.tsx` | Full query-param API: `category`, `q`, `sort`, `min/max_price`, `min_rating`, `brand`, `country`/`origin_country`, pagination — category-path aware, already excludes placeholder-image products |
| Product detail | `src/pages/product.tsx` | Buy-box join, seller comparison table, reviews, variants — generic across verticals |
| Layout/header | `src/components/Layout.tsx` | DB-driven mega-menu (categories/tree), ecosystem pill nav (`nav_visible` control-center toggle), **city selector** (`CITIES` array, `nd_city` cookie, `selectedCity` prop) — this is the "Delivering to {city}" mechanism the brief asks for; already exists |
| Product card | `src/components/ProductCard.tsx` | Image, discount badge, PLUS badge, rating, price, seller_count, stock/out-of-stock states, working `Add to Cart` button wired to `POST /api/cart/items` |

**Conclusion:** the entire Phase 2 customer flow (category listing, search,
product detail, cart, checkout) can be built by **adding NaijaFresh data**
into this existing engine and writing **NaijaFresh-specific page templates**
that call the *same* APIs — not by building new cart/checkout/search
infrastructure. This matches the brief's "reuse before creating" rule exactly.

## 2. What does NOT exist yet (the real Phase 1 gap)

- **No freshness classification anywhere.** No column, no table, nothing.
  `product_listings`/`products` have no `freshness_status`,
  `harvested_at`, or equivalent.
- **No route for `/fresh`.** `app.get('/fresh', ecosystemPreviewPage)` in
  `src/index.tsx` — a shared generic "coming soon" stub, zero Fresh-specific
  code.
- **No Fresh demo data of any kind** — zero rows on any category in the
  `fresh-food` tree (see correction below), zero Fresh-specific vendors,
  zero Fresh products.
- No customer-facing page anywhere renders `unit_of_measure` /
  `unit_quantity` / `is_variable_weight` / `variable_weight_tolerance_pct`,
  even though those columns exist and are populated by the seller-facing
  product form (`src/pages/seller-products.tsx`). `shop.tsx`, `product.tsx`,
  and `ProductCard.tsx` never read them. This is genuine, non-duplicated
  Phase 2 work — the data model exists, the customer-facing rendering does
  not.

### ⚠️ CORRECTION (superseding the original audit pass above)

The original version of this document stated "No NaijaFresh categories.
Migration 0031 is a documented no-op" and concluded a brand-new category
subtree was needed. **This was wrong.** A direct production D1 query
(`gsk hosted d1_query`) found a live, already-seeded `fresh-food` category
department:

| id | slug | name | level |
|---|---|---|---|
| 100 | fresh-food | Fresh Produce & Food | 1 (department) |
| 101 | fresh-fruits | Fruits | 2 |
| 102 | fresh-vegetables | Vegetables | 2 |
| 103 | fresh-meat-poultry | Meat & Poultry | 2 |
| 104 | fresh-fish-seafood | Fish & Seafood | 2 |
| 105 | fresh-tubers | Tubers | 2 |
| 106 | fresh-grains | Grains | 2 |
| 107 | fresh-beans-legumes | Beans & Legumes | 2 |
| 108 | fresh-spices-seasonings | Spices & Seasonings | 2 |
| 109 | fresh-cooking-essentials | Cooking Essentials | 2 |
| 110 | fresh-dairy-eggs | Dairy & Eggs | 2 |
| 111 | fresh-drinks | Drinks | 2 |
| 112 | fresh-pantry-staples | Pantry Staples | 2 |
| 113 | fresh-herbs | Fresh Herbs | 2 |
| 114 | fresh-ready-to-cook | Ready-to-Cook | 2 |

All rows: `is_visible=1`, `nav_pill_visible=0`, `is_featured_home=0`,
`product_count=0` (confirmed via `LEFT JOIN products`). **This entire tree
is absent from local dev D1** (confirmed: `SELECT COUNT(*) FROM categories
WHERE id BETWEEN 100 AND 114` returns 0 locally) — it exists ONLY in
production, with no reconstructable local migration source.

**Why migration `0031_naijafresh_categories.sql` didn't catch this:**
production's schema/data history for migrations 0013–0036 was recovered
after an earlier incident from a live final-state D1 dump, not from
original source (see `docs/NAIJADEALS-PRODUCTION-RECOVERY-REPORT.md`).
Whoever performed that reconstruction could not attribute this specific
`INSERT INTO categories` block to a migration number from a schema-only
diff (inserts leave no trace in `PRAGMA table_info`), so `0031` was left an
intentional, documented no-op rather than a guess. **Per Pat's explicit
instruction, `0031` is NOT being retroactively "fixed" or rewritten here.**
The gap is preserved as a second, smaller provenance defect — cousin to the
already-ticketed SHA provenance issue (`docs/tickets/deploy-identity-synthetic-sha.md`)
— and is recorded here, not silently patched into old migration history.

**Second finding, independent of NaijaFresh, left untouched as separate
technical debt per Pat's explicit instruction:** production (and local)
also contain two OTHER top-level "grocery" category departments —
`groceries` (id=30, children: Staples & Grains/Beverages/Household) and
`grocery-and-food` (id=217, children: African/Nigerian/Ghanaian/Kenyan
foods, snacks) — neither reconciled with `fresh-food` (100) nor with each
other. `groceries`(30) appears to carry real NaijaShop SKUs (e.g. `rice`
id=218 sits under it); `grocery-and-food`(217) has zero products, same as
`fresh-food`(100). **NaijaFresh's Phase 1 does not touch `30` or `217` —**
only extends `100`, per Pat's explicit "do not modify" instruction.

## 3. Design decision for Phase 1 (minimal, additive, no duplicate engine)

Rather than a parallel "fresh_products" table (which the brief explicitly
forbids — "do not create duplicate versions of products/vendors/orders"),
Phase 1 adds:

1. **`products.freshness_status`** (nullable TEXT, free-text like existing
   `store_type`/`unit_of_measure` conventions — not a CHECK constraint, so
   new statuses don't need a migration). Values used by seed data:
   `fresh_today`, `harvested_today`, `seasonal`, `frozen`, `pantry`. NULL for
   every existing non-Fresh product — zero behavior change elsewhere.
2. **`products.harvested_date`** (nullable TEXT, ISO date) — structured, not
   baked into `description` text, per the brief's explicit requirement
   ("must be structured data, not merely text").
3. **Reuse `vendors.store_type`** (already free-text, currently only
   `individual`/`business`/`organization` in use anywhere) for `farmer` /
   `wholesaler` / `retailer` / `market_vendor` classification — no new column.
4. **Reuse `collections`** `farm-direct` / `market-fresh` / `wholesale` /
   `bulk` / `imported` (ids 8/9/14/15/10, all already seeded in migration
   0038/0067-era work) for the "source"/wholesale/imported discovery
   requirement — attach Fresh demo products to these via
   `product_collections`, no new table, no category-shaped duplicates of a
   cross-cutting tag.
5. **Reuse `product_pricing_tiers`** as-is for wholesale — Phase 1 seeds one
   real tiered listing (rice by the bag) to prove the data model supports
   it, per the brief ("Phase 1 only needs to ensure the data model ... can
   support it").
6. **Reuse the existing `fresh-food`(100) category tree for 12 of the
   brief's 18 requested categories** (see mapping table below); add
   **6 new leaf categories** under `fresh-food`(100) for the genuinely
   missing ones: Bread & Bakery, Frozen Foods, Organic & Specialty Foods,
   African Traditional Foods, Imported Groceries, Wholesale & Bulk Food.

### Category reconciliation (brief's 18 vs. existing `fresh-food` tree)

| Brief's category | Resolution |
|---|---|
| Fruits & Vegetables | reuse 101 (Fruits) + 102 (Vegetables) — finer-grained than requested, kept as-is |
| Fresh Meat & Poultry | reuse 103 |
| Fish & Seafood | reuse 104 |
| Eggs & Dairy | reuse 110 |
| Grains & Cereals | reuse 106 |
| Beans/Rice & Staples | reuse 107 (Beans & Legumes) + 112 (Pantry Staples) |
| Tubers & Roots | reuse 105 |
| African Spices & Seasonings | reuse 108 |
| Fresh Herbs | reuse 113 |
| Cooking Ingredients | reuse 109 |
| Bread & Bakery | **new** leaf under 100 |
| Drinks & Beverages | reuse 111 |
| Frozen Foods | **new** leaf under 100 |
| Farm Produce | not a category — expressed via `farm-direct` collection tag on qualifying products, not a duplicate taxonomy node |
| Organic & Specialty Foods | **new** leaf under 100 |
| African Traditional Foods | **new** leaf under 100 (distinct purpose from `grocery-and-food/african-foods`, which is untouched) |
| Imported Groceries | **new** leaf under 100 + tag into existing `imported` collection |
| Wholesale & Bulk Food | **new** leaf under 100 + tag into existing `wholesale`/`bulk` collections; hosts the `product_pricing_tiers` proof-of-concept |

No new tables for products/vendors/orders/carts/payments — confirms
compliance with the brief's Section 2 requirement. No new grocery
taxonomy — confirms compliance with the correction's explicit instruction.

## 4. Phase 2 scope, mapped to existing infrastructure

| Screen (brief §9) | Route | Reuses |
|---|---|---|
| Homepage | `GET /fresh` | New `src/pages/fresh.tsx`; queries via existing `db` calls scoped to Fresh category tree + `freshness_status IS NOT NULL`; `Layout` component as-is |
| Category listing | `GET /fresh?category=:slug` | Same file, same query-param convention as `shop.tsx` (not a nested route — matches existing `/shop?category=` convention) |
| Search | `GET /fresh?q=:query` | Same file; calls the identical WHERE-clause pattern as `shop.tsx`/`api-catalog.ts`, scoped to Fresh's category subtree |
| Product detail | `GET /fresh/:slug` | New thin wrapper reusing `product.tsx`'s query shape (or extending `product.tsx` to render Fresh-specific fields — freshness badge, unit selector — when `freshness_status IS NOT NULL`) |
| Cart | `GET /cart` (existing) | Zero changes — Fresh listings are ordinary `product_listings` rows, already vendor-grouped |
| Checkout | `GET /checkout` (existing) | Zero changes |

## 5. Explicit non-goals for this phase (per brief §16)

Not building: seller dashboard extensions, admin module, farm profile pages,
seasonal recommendation engine, substitution engine, wholesale storefront UI,
delivery optimization, analytics, 33-screen expansion, large catalog. Schema
is designed so these can be added later without rebuilding the foundation
(e.g. `harvested_date`/`freshness_status` are exactly what a future seasonal
engine would read; `collections` is exactly what a future farm-profile page
would query).

## 6. Data integrity commitments for seed data (per brief §8, §15)

- Small catalog: ~18-22 products across ~5-6 demo vendors (not thousands).
- Every demo vendor name will be clearly generic/placeholder-style (matching
  the existing seed pattern used by `vendors` catalog seed data elsewhere in
  this codebase), not a real business name presented as authorized.
- No fake reviews, no fake order history, no fake ratings beyond a
  reasonable static seed value consistent with how the existing 20 pre-seeded
  catalog vendors already do it (this project's established convention).
- No fake delivery-time promises — `delivery_days_min/max` will be set from
  the same honest per-listing mechanism every other vertical uses, not a
  fabricated "27 minutes" style claim.
- Seed products get `rating_avg=0, rating_count=0` (no fabricated review
  aggregates) — `ProductCard.tsx`/`product.tsx` already conditionally hide
  the star display when `rating_count=0`, so this renders honestly with
  zero code changes.
- Product photography for all new demo products sourced via `image_search`
  (Creative-Commons/public-domain filtered) or `image_generation` where
  licensing search returned no usable results, per this project's
  established "zero commercially-licensed stock imagery" design principle
  (`docs/NAIJADEALS-BASELINE-AUDIT.md`) — never AI-fabricated claims of a
  real photo, and never a hotlinked stock-site URL.

## 7. ID collision audit (local dev D1 vs. production D1)

Local dev D1 (`.wrangler/state/v3/d1/...sqlite`) and production D1 have
DIVERGED id sequences for `categories` — a THIRD, smaller provenance gap
(noted, not fixed, per Pat's instruction not to silently repair historical
drift as part of this feature work):

- Local is missing all of production's `fresh-food` tree (ids 100-114) —
  confirmed above.
- Local has its OWN copy of the services taxonomy (Home Services, Plumbing,
  Electrical, ...) at ids **326-359**, while production stores the
  identical slugs at ids **115-150**. Two independent seeding events, two
  different numeric ID assignments, same concepts.
- Vendor/category/product/user max-id snapshots taken before writing
  migration `0077` (both environments, to guarantee zero collision):

  | Table | Local max id | Production max id | 0077 uses |
  |---|---|---|---|
  | `categories` | 359 | 325 | 100-114 (idempotent, matches prod exactly) + **400-405** (new leaves) |
  | `vendors` | 35 | 35 | **36-41** (6 demo vendors) |
  | `products` | 519 (noisy local test data) | 103 | **600-621** (22 demo products) |
  | `product_listings` | 520 | 140 | **600-621** (1:1 with products, single-vendor-per-product for Phase 1 simplicity) |
  | `product_pricing_tiers` | 0 rows | 0 rows | 1 new row, no hardcoded id (AUTOINCREMENT) |
  | `product_collections` | — | 0 rows | new rows, no hardcoded id (AUTOINCREMENT) |
  | `users` (demo vendor accounts, if any) | 2850 | 25 | referenced by `email` subquery only — never hardcoded, per migrations 0072/0073's own precedent |

This table exists so a future migration author doesn't repeat the
collision risk — it is NOT a claim that the drift itself is fixed.

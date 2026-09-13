# Engine 11 — Search & Discovery — Phase 0 Forensic Audit

**Status:** AUDIT ONLY. No migrations, no schema changes, no application code
changes were made in the production of this document. Every claim below was
verified directly against this repository's source code and/or a live query
against this project's local D1 database (`naijadeals-production`, `--local`
binding) on 2026-09-13, not assumed from prior conversation, diagrams, or
naming conventions.

**Branch:** `main`, HEAD `8eadb19eeccbe3740d65ae90f46f22fb816172db` (the
verified Engine 9 closure checkpoint) at the time this audit began.

**Classification legend used throughout:**
- **REAL** — schema exists, has live write paths, and (where checked) has
  actual rows in the local dev database seeded from production data.
- **PARTIAL** — schema exists and *some* of the required capability exists,
  but it is incomplete, degraded, or covers only part of the entity set.
- **DEAD** — schema exists but has zero write paths in `src/` and zero rows
  in the database. A shell, not a feature.
- **CONFIG** — a reference/lookup table, not a business entity (seed data,
  enumerations).
- **MOCK** — code exists that simulates a capability without doing the real
  thing (e.g. deterministic test adapters — not relevant to this audit,
  flagged only if found in production code paths).
- **TEST-ONLY** — exists only inside `tests/`, never reachable in production.
- **UNUSED** — exists, is wired, but has no callers / no consumers today.

---

## 1. Purpose and Method

This document answers one question honestly, before any Engine 11 migration
or code is written: **what does this repository actually contain today**,
as opposed to what its table names, migration comments, or prior
architecture diagrams imply it contains?

Method: for every candidate "searchable entity," this audit checked, in
order:
1. The `CREATE TABLE` DDL in `migrations/*.sql` (schema-level truth).
2. Every `src/routes/*.ts` and `src/lib/*.ts` file for INSERT/UPDATE/DELETE
   statements against that table (write-path truth).
3. A live `SELECT COUNT(*)` (and, where relevant, a `GROUP BY` breakdown)
   against `naijadeals-production --local` (data truth — the local D1 file
   is seeded from a real production schema/data recovery, per
   `docs/NAIJADEALS-PRODUCTION-RECOVERY-REPORT.md`).
4. Whether the entity's writes emit a `cc_domain_events` row today (event
   truth — this determines whether Engine 11's outbox-indexer pipeline has
   anything to consume for that entity on day one, or needs new
   instrumentation first).

No claim in this document is inferred from a table's name or a migration
file's comment alone.

---

## 2. Searchable Entity Inventory — REAL / PARTIAL / DEAD Classification

| # | Entity | Table(s) | Rows (local, seeded from prod) | Write path exists in `src/`? | Classification |
|---|---|---|---|---|---|
| 1 | Marketplace products | `products`, `product_listings` | 595 products / 630 listings | Yes — `src/routes/api-seller.ts` (`POST/PATCH /products`, `/listings`) → `src/lib/seller-products.ts` | **REAL** |
| 2 | Gig services (bookable) | `bookable_listings` (`listing_type='gig_service'`) | 1,474 | Yes — `src/routes/api-bookings.ts` → `src/lib/bookings.ts` | **REAL** |
| 3 | Stay units (bookable) | `bookable_listings` (`listing_type='stay_unit'`) | 27 | Yes — same path as #2 | **REAL** (small volume, but a genuine live write path) |
| 4 | Service listings (quote-based gigs) | `service_listings` | **1** | Yes — `src/routes/api-provider.ts` → `src/lib/services.ts` (`createServiceListing`) | **PARTIAL** — schema and write path are real and correct, but the entity is functionally unlaunched (1 row in a production-seeded dataset). Indexing this is cheap but will return almost nothing for V1 users. |
| 5 | Vendors (sellers) | `vendors` | 30 | Yes — `src/lib/stores.ts` | **REAL** — but see §5, no structured location, only free-text `city`. |
| 6 | Provider profiles (gig/host/driver/restaurant operators) | `provider_profiles` | 2 | Yes — `src/lib/providers.ts` | **PARTIAL** — real write path, but only 2 rows exist; both `verification_status='verified'`. Not enough volume to be a meaningful discovery target on its own, but it IS the visibility gate for #2/#3/#4 (see §4). |
| 7 | Stay properties | `stay_properties` | **0** | **NONE FOUND** — zero references to `stay_properties` anywhere in `src/` (`grep -rl "stay_properties" src/` returns empty) | **DEAD** — schema-only shell. `bookable_listings.stay_property_id` column exists (migration 0024) but nothing in `src/` ever inserts a `stay_properties` row to point it at. The 27 real "stay_unit" bookable_listings rows (#3) apparently do not use this table in the current codebase. |
| 8 | Restaurants | `restaurants`, `menus`, `menu_sections`, `menu_items`, `dishes`, `cuisines` | 0 (restaurants) | **NONE FOUND** — zero references to `restaurants` (the table) anywhere in `src/` beyond an unrelated string match in `src/pages/home.tsx` | **DEAD** — full NaijaEats schema (7+ tables from migrations 0032/0033) exists with zero write paths and zero rows. |
| 9 | Vehicles (fleet) | `vehicles`, `vehicle_types`, `vehicle_documents`, `vehicle_photos` | not queried (fleet-internal) | Yes — `src/routes/api-logistics.ts` (`/logistics-providers/me/vehicles`) | **REAL, but NOT a customer-facing marketplace entity.** This is internal fleet/driver-assignment management for NaijaSend logistics providers, not a "browse/rent a vehicle" listing. There is no vehicle *rental* or *sale* marketplace anywhere in this repo. **Do not include `vehicles` in Engine 11's searchable corpus as a customer discovery target** — it is operational data, analogous to a driver's license record, not a product. |
| 10 | Reviews (polymorphic) | `reviews` | 174, **100% `reviewable_type='product'`** | Yes — polymorphic schema (`reviewable_type` CHECK allows `product/provider_profile/restaurant/stay`) exists since migration 0027 | **PARTIAL** — the schema supports 4 reviewable types; only 1 (`product`) has ever been used. This mirrors the dead/thin state of #6–#8: reviews can't exist for entities that are never created. |
| 11 | Logistics providers / shipments | `logistics_providers`, `shipments`, `delivery_jobs`, `pickup_jobs` | not queried | Yes | **REAL, but not a discovery target.** Shipments are transactional records tied to an order, not something a user searches/browses. Out of scope for Engine 11's search corpus by nature of the entity, not by omission. |
| 12 | Categories, brands, collections | `categories`, `brands`, `collections` | seeded | Yes | **CONFIG** — these are facets/filters Engine 11 should index *against* (as structured fields), not documents to search *for*. |
| 13 | Country/region reference | `cc_countries` | 10 | Yes (Control Center admin) | **CONFIG** — see §6. |

### 2.1 Net V1-eligible searchable corpus (evidence-based, not aspirational)

Based strictly on the "has real write path AND has real rows" bar:

```
V1 searchable corpus =
    products (595)              — NaijaShop
  + bookable_listings (1,501)   — NaijaGigs (1,474) + NaijaStay (27)
  + service_listings (1)        — technically real, negligible volume
```

**stay_properties and restaurants are excluded from V1** — not because
Engine 11 chose to exclude them, but because there is nothing there to
index. Indexing a `DEAD` table produces an empty search corpus for that
vertical, which would either (a) silently return zero results forever, or
(b) tempt a future engineer to fabricate rows to make the demo look
populated. Per the explicit "no fake providers/results" invariant, Engine
11 must **not** synthesize rows for dead tables. If/when NaijaEats and a
real stay_properties write path ship (a **different, currently
unscheduled engine's job**, not Engine 11's), those verticals slot into the
same adapter contract Engine 11 builds — see §9.

---

## 3. Domain Event Writer Inventory — What Exists vs What's Missing

Confirmed via `grep -rl "cc_domain_events" src/lib/*.ts`:

| File | Entity it covers | Emits `cc_domain_events`? |
|---|---|---|
| `src/lib/booking-lifecycle.ts` | Booking state transitions | ✅ Yes (line 194) |
| `src/lib/order-lifecycle.ts` | Order state transitions | ✅ Yes (line 147) |
| `src/lib/moderation.ts` | Moderation decisions (approve/reject/suspend) on **listings** | ✅ Yes (line 125) |

**Every other write path in this repository — confirmed by exhaustive grep,
not sampling — emits ZERO domain events today:**

| Write path | File : line | Emits event? |
|---|---|---|
| `sellerApi.post('/products')` → `createProduct()` | `api-seller.ts:115` | ❌ No |
| `sellerApi.patch('/products/:id')` → `updateProduct()` | `api-seller.ts:135` | ❌ No |
| `sellerApi.post('/listings')` → create listing | `api-seller.ts:156` | ❌ No |
| `sellerApi.patch('/listings/:id')` → update listing | `api-seller.ts:204` | ❌ No |
| `providerApi.post('/providers/me/services')` → `createServiceListing()` | `api-provider.ts:103` | ❌ No |
| `providerApi.patch('/providers/me/services/:id')` → `updateServiceListing()` | `api-provider.ts:116` | ❌ No |
| `bookingsApi.post('.../bookable-listings')` → create bookable listing | `api-bookings.ts:181` | ❌ No |
| `bookingsApi.patch('.../bookable-listings/:id')` → update bookable listing | `api-bookings.ts:212` | ❌ No |
| Vendor create/update (`src/lib/stores.ts`) | — | ❌ No |
| Provider profile create/update (`src/lib/providers.ts`) | — | ❌ No |

**Conclusion, stated plainly:** the "Domain Events → Outbox → Indexer"
pipeline in the agreed architecture has **zero producers** for any of the
three real, populated searchable entities (products, bookable_listings,
service_listings) as of this audit. `booking-lifecycle.ts` only fires on
a *booking* (a transaction against a listing), never on the *listing
itself* being created/edited/deactivated. This is exactly the gap flagged
in the prior turn's pushback, now confirmed with file:line evidence rather
than asserted from a diagram.

This is **Phase 1's real, unavoidable first task**: add a
`cc_domain_events` write (or a purpose-built `search_index_events` outbox,
per §9's recommendation) to every one of the write paths listed above,
using the exact "never block/rollback the business mutation" pattern
`booking-lifecycle.ts`/`order-lifecycle.ts` already demonstrate correctly
(their event-write calls are explicitly documented as "Never throws — a
logging failure must not fail the transition itself").

---

## 4. Visibility / Verification / Moderation Field Inventory

Per-entity fields that Engine 11's indexer must respect before a row is
eligible to appear in search results at all:

| Entity | Visibility field(s) | Values found in live data | Moderation interaction |
|---|---|---|---|
| `products` | `is_active` | 595/595 = `is_active=1` (100%) | `src/lib/moderation.ts` moderates listings (approve/reject/suspend/request_changes) — `getPendingModerationQueue()`, `applyModerationDecision()`; a rejected/suspended listing should NOT be indexed |
| `product_listings` | `is_active`, `is_primary` | not separately queried; moderation applies at listing level | Same `moderation.ts` |
| `vendors` | `is_verified` | 30/30 = `is_verified=1` (100%) | No dedicated vendor-suspension write path found in `src/` beyond the base column |
| `bookable_listings` | `is_active` | not separately queried | No moderation.ts hook found for bookable_listings specifically — **gap**: booking listings appear to bypass the moderation queue that products go through. Worth flagging to you as a possible pre-existing product gap unrelated to Engine 11, not something Engine 11 should silently paper over. |
| `provider_profiles` | `verification_status` (`pending/verified/rejected`), `operational_status` (`active/paused/suspended`) | 2/2 = `verified`+`active` (100%) | This is the field Engine 11 MUST join against for any `bookable_listings`/`service_listings` result — a `provider_profiles.operational_status='suspended'` provider's listings must disappear from search even if the listing row itself is still `is_active=1`. **No current query path in `src/lib/bookings.ts`'s `searchPublicListings()` joins to `provider_profiles.operational_status` today** — confirmed by reading the function body (§7). This is a second, independent visibility gap Engine 11 must close, not just replicate. |
| `service_listings` | `status` (`draft/pending_review/active/paused/rejected/archived`), `is_active` | 1 row, unknown value (not queried — sample size too small to matter) | — |
| `stay_properties` / `restaurants` | `verification_status`, `is_active` | N/A — table is empty (DEAD, §2) | N/A |

**Hard requirement carried forward into Phase 1 design:** the eligibility
check for "should this row be indexed / stay indexed" is **two-level**:
(1) the entity's own `is_active`/`status` field, AND (2) its owning
provider/vendor's `verification_status`/`operational_status`. Both must be
`true`/`verified`/`active` for a row to be searchable. This is stricter
than what any existing query in the codebase currently enforces — see §7.

---

## 5. Location / Geo-Readiness Inventory

| Entity | Structured location fields | Lat/Lng? | Geo-ready? |
|---|---|---|---|
| `products` | **NONE** (product has no location at all) | ❌ | ❌ Not geo-ready. Location can only be inherited transitively via `vendors.city` (free text). |
| `vendors` | `city` (free TEXT, no `country_iso`/`region` column) | ❌ | ❌ Not geo-ready. |
| `bookable_listings` | `country_iso`, `city` (both TEXT) | ❌ | ❌ Not geo-ready at the listing level. |
| `service_areas` (NaijaGigs, feeds into `service_listings` via `provider_profile_id`) | `country_iso`, `city`, `neighborhood`, `radius_km` | ✅ `latitude`, `longitude` | ✅ **Geo-ready** |
| `service_requests` | `city`, `address_line1` | ✅ `latitude`, `longitude` | ✅ **Geo-ready** |
| `stay_properties` | `city`, `neighborhood`, `address_line1` | ✅ `latitude`, `longitude` | ✅ Geo-ready schema — but table is DEAD (§2), 0 rows |
| `restaurants` | `city`, `address_line1` | ❌ (no lat/lng column at all) | ❌ Not geo-ready even at schema level — and also DEAD (0 rows) |
| `provider_profiles` | `country_iso`, `service_area_json` (free-form JSON, not structured columns) | ❌ | ❌ Not geo-ready — `service_area_json` is an unstructured blob, not queryable coordinates |
| `gps_events` | — | ✅ `latitude`, `longitude` | **Not applicable to product/listing search at all.** This table logs a delivery *driver's* live position during an active shipment (`driver_id`, `shipment_id`, `accuracy_m`, `recorded_at`). It answers "where is my driver right now," never "where is this listing." Confirmed by reading the full schema (migration 0026) and its only consumers (`logistics-tracking.ts`, `logistics-dispatch.ts`). |

**Conclusion:** Real, usable lat/lng exists **only** for NaijaGigs
(`service_areas`, `service_requests`) — and that data path (`service_listings`,
§2 row #4) currently has exactly 1 row. `bookable_listings`, which holds
the actual 1,501-row live gig/stay inventory, has only `city` as TEXT, no
coordinates. **This means "near me" proximity search cannot be delivered
for the real, populated gig/stay corpus in V1 without first adding
lat/lng columns to `bookable_listings` (or joining through to a
`provider_profiles`/`service_areas`-style location that most rows won't
actually have populated).**

This is a materially different, and more constrained, situation than the
prior turn's finding "no lat/lng on products, but NaijaGigs/NaijaStay have
it" — the schema *supports* it for those verticals, but the actual
*populated* 1,501-row dataset does not carry usable coordinates. Geo
search in V1, as scoped, will work correctly only for whatever fraction of
that dataset happens to have `service_areas`/`service_requests` rows
wired to it — which needs to be measured in Phase 1, not assumed to be
"most of it."

### 5.1 Existing "fake geo" anti-patterns found (must be replaced, not extended)

Two existing functions were found masquerading as location-aware search
while actually doing exact-string matching:

1. **`getDealsNearYou(db, city, limit)`** — `src/lib/catalog.ts:198`.
   Filters `WHERE v.city = ?` (exact string match against `vendors.city`),
   and if zero rows match, **silently falls back to returning the
   highest-rated products platform-wide with no location filter at all**,
   while still being presented to the user under a "near you" label. This
   is precisely the "fake proximity" pattern the governing instructions
   explicitly forbid. **Engine 11 must replace this function's underlying
   behavior, not wrap or extend it.**

2. **`searchPublicListings(db, opts)`** — `src/lib/bookings.ts:149`.
   Same pattern: `city` is an exact-match `WHERE bl.city = ?` clause, no
   radius, no coordinates, no distance ranking. Also does **not** join to
   `provider_profiles.operational_status` (§4's second visibility gap).

### 5.2 Geocoding capability: confirmed absent

`grep -rn "geocod" src/ migrations/` returns 2 matches, both incidental
(comments unrelated to a geocoding *service*). There is no city-name → 
coordinate resolution, no reverse-geocoder, and no third-party geocoding
API integration anywhere in this codebase. Per your decision, this
audit does not evaluate the third-party option further — it should be
built as **a small internal Africa location-resolution table** (e.g. a
seeded `search_locations` reference table of known Nigerian cities/
neighborhoods with canonical coordinates and a bounding radius), consuming
`cc_countries` (§6) for country-level scaffolding. This is new Phase 1/4
work, not something to "wire up."

---

## 6. Country/Africa Engine — Actual Depth

`cc_countries` (migration 0013, Control Center foundation):

```sql
CREATE TABLE cc_countries (
  id, iso_code, name, region, currency_code, default_language,
  available_languages_json, status ('PLANNED'|'PRE-LAUNCH'|'BETA'|'LIVE'|'PAUSED'|'SUSPENDED'),
  display_order, created_at, updated_at
);
```

**10 rows** in local dev data. This is a **country-level launch-status
registry** (used by Control Center to gate features per country), not a
geocoding or locality system. It has no city/neighborhood granularity and
no coordinates. It is a legitimate, real, CONFIG-classified table Engine
11 should reference for country scoping (e.g. "only search within LIVE
countries"), but it does nothing to solve the geo problem in §5 — this
confirms the prior turn's finding, not a new one.

---

## 7. Existing Search Implementations — What Engine 11 Must Eventually Replace

| Implementation | Location | Technique | Verdict |
|---|---|---|---|
| NaijaShop product search | `catalogApi.get('/products')`, `api-catalog.ts:64` | `LIKE '%q%'` against `title`/`description`/vendor `name`, plus exact filters (category, price range, rating, brand, `nigerian` flag) | **REAL, functioning, but not full-text-ranked.** `LIKE` has no relevance ranking, no typo tolerance, and — because SQLite's `LIKE` is not indexed for substring matches — scales linearly with `products` table size. Correct target for FTS5 migration in Phase 6. |
| "Deals near you" | `getDealsNearYou()`, `catalog.ts:198` | Exact `city` string match + silent fallback | **Anti-pattern, must be replaced** (§5.1). |
| Bookable listings search | `searchPublicListings()`, `bookings.ts:149` | Exact filters only (`listing_type`, `vertical`, `country_iso`, `city`), no text search at all — there is no `q`/keyword parameter on this function | **REAL but text-search-free.** A user cannot currently type "yoga instructor" and find gig listings by keyword; only by exact category/location filters. This is actually a stronger case for Engine 11 than NaijaShop's search, which at least has `LIKE`. |
| Service listings search | none found | — | **DEAD** — no search/browse endpoint exists for `service_listings` at all; only `providerApi.get('/providers/me/services')` (a provider's own listings, not public discovery). |

**No competing FTS/Elasticsearch/Algolia/etc. integration exists anywhere
in this repo.** There is nothing to "migrate off of" except the two
in-house implementations above.

---

## 8. Engine 9 Outbox Pattern — Reusability Assessment

`notification_outbox` (migration 0045) schema:

```sql
CREATE TABLE notification_outbox (
  id, idempotency_key TEXT UNIQUE, event_type, recipient_user_id,
  category, payload_json, reference_type, reference_id,
  status ('pending'|'processing'|'processed'|'failed'),
  attempts, last_error, created_at, processed_at
);
```

**Directly reusable pattern elements** (confirmed via Engine 9's own
verified, 187/187-tested implementation in `src/lib/notifications.ts`):
- CAS-claim `status: pending → processing → processed|failed` transition,
  avoiding double-processing under concurrent HTTP-triggered runs.
- `idempotency_key UNIQUE` constraint — the exact mechanism needed for
  "the same product update event must not double-index."
- Bounded, HTTP-triggered batch processing (`processOutboxBatch()`-style)
  — the only viable trigger mechanism under this platform's no-cron
  constraint, already proven correct.
- Bounded retry with backoff (`MAX_DELIVERY_ATTEMPTS`, `RETRY_BACKOFF_MINUTES`)
  — directly applicable to "indexing this event failed transiently, retry
  it later" without inventing new retry semantics.

**What does NOT transfer directly:** `notification_outbox.recipient_user_id
NOT NULL` — indexing events have no recipient concept; a new table
(`search_index_events` or similar) is needed with the same *shape*
(idempotency key, status lifecycle, attempts/backoff) but different
domain columns (`entity_type`, `entity_id`, `operation`
`upsert|delete`, `payload_json` snapshot). This is a **new migration**,
not a reuse of the existing table — Engine 9's table is scoped to
notifications by its own CHECK constraint on `category` and does not
generalize.

**Verdict: pattern is REAL and reusable; the specific table is not.**
Phase 1/2 should create a parallel outbox table following the identical
proven shape, not attempt to overload `notification_outbox`.

---

## 9. D1 FTS5 — Verified, Not Assumed

Rather than trust documentation or web search claims, FTS5 was tested
directly against this project's actual local D1 database
(`naijadeals-production`, `--local` binding) during this audit:

```
npx wrangler d1 execute naijadeals-production --local \
  --command="CREATE VIRTUAL TABLE IF NOT EXISTS fts5_test USING fts5(title, body)"
→ success

INSERT INTO fts5_test (title, body) VALUES ('Samsung Galaxy Phone', 'Latest smartphone with great camera')
→ success

SELECT * FROM fts5_test WHERE fts5_test MATCH 'samsung'
→ returns the row correctly

DROP TABLE fts5_test  (cleanup — no residue left in the dev DB)
```

**Confirmed: `CREATE VIRTUAL TABLE ... USING fts5(...)`, `INSERT`, and
`MATCH` all work correctly in this project's D1 setup.** This de-risks the
core Option-B architectural bet. Cloudflare's own documentation
(`developers.cloudflare.com/d1/sql-api/sql-statements/`) confirms FTS5 is
a supported subset SQLite extension on hosted D1 as well, not just local
`wrangler dev`'s bundled SQLite — though this audit could only directly
verify the **local** engine; the **hosted** D1 FTS5 behavior should be
smoke-tested once Engine 11 reaches its own deploy/verification phase
(the same "don't assume, verify" discipline Engine 9 applied to
`meta.changes` vs `meta.rows_written` applies here too — local D1's
Miniflare/SQLite engine has already been shown once, in Engine 9, to
diverge from hosted D1's behavior in a load-bearing way).

**One real cost/limits caveat found during research (flag for later
planning, not a blocker now):** Cloudflare's D1 changelog documents a
daily row-read/row-write cap on the Workers Free plan taking effect
2026-09-01 (already in effect as of this audit's date). An FTS5 corpus
adds additional row reads/writes on every indexing operation. Not a
concern for a dev/test build, but worth remembering before assuming "add
generous reconciliation polling" is free at any scale.

---

## 10. Moderation Engine — Actual Scope

`src/lib/moderation.ts` (5 exported functions: `getPendingModerationQueue`,
`getListingForModeration`, `applyModerationDecision`,
`getModerationHistoryForVendor`, plus the type `ModerationDecision`)
operates **only on `product_listings`/`products`** — every reference to
an entity type in the file's queries targets the marketplace listing
tables. There is no evidence of a moderation queue for `bookable_listings`,
`service_listings`, or provider profiles. This is consistent with §4's
finding that `bookable_listings` has no moderation.ts hook. Engine 11's
indexer, when built, should NOT assume a uniform moderation-status
signal exists for every vertical — it must fall back to the entity's own
`is_active`/`status` column and the provider's `verification_status`/
`operational_status` for verticals moderation.ts doesn't reach yet.

---

## 11. Test Infrastructure Available for Reuse

Confirmed present and directly reusable for Engine 11's own eventual test
suite, following the exact dual-invocation-mode pattern Engine 9 proved
out and documented in `docs/ENGINE-9-COMMUNICATION-NOTIFICATION-AUDIT.md`:

- `tests/payment-engine/helpers/ts-extensionless-loader.mjs` — the
  `--experimental-loader` shim needed for direct-lib-mode `.ts` imports.
- `tests/notification-engine/helpers/direct-db.mjs` — direct
  `getPlatformProxy()` D1 connection pattern (server-stopped mode).
- `tests/payment-engine/helpers/client.mjs` — HTTP-mode `fetch()` client
  (server-running mode).

Engine 11's test suite should create its own `tests/search-engine/`
directory following this exact structure rather than inventing a third
pattern.

---

## 12. Summary Table — REAL / PARTIAL / DEAD / CONFIG Classification

| Classification | Entities |
|---|---|
| **REAL** | `products`/`product_listings` (NaijaShop), `bookable_listings` gig_service (1,474 rows), `bookable_listings` stay_unit (27 rows), `vendors`, existing NaijaShop `LIKE`-based search, Engine 9 outbox *pattern* (not the table itself), D1 FTS5 capability (local, tested) |
| **PARTIAL** | `service_listings` (real path, 1 row), `provider_profiles` (real path, 2 rows — but is the mandatory visibility gate for #2/#3), `reviews` (real, but 100% concentrated on `product` type only), moderation coverage (real for products, absent for bookable_listings/service_listings) |
| **DEAD** | `stay_properties` (0 rows, 0 write paths), `restaurants` + full NaijaEats schema (0 rows, 0 write paths) |
| **CONFIG** | `cc_countries`, `categories`, `brands`, `collections` |
| **NOT A DISCOVERY TARGET (by nature, not by gap)** | `vehicles` (internal fleet, not a rental marketplace), `gps_events` (driver tracking, not listing location), `shipments`/logistics job tables (transactional, not browsable) |
| **MISSING (must be built in Phase 1, not assumed to exist)** | Domain-event writers on every commerce write path (§3); a search-specific outbox table (§8); an internal Africa location-resolution table (§5.2); a two-level (entity + owning-provider) visibility join that no existing query currently performs correctly (§4, §7) |

---

## 13. What This Changes About the Agreed Phase Plan

Nothing about the four locked architectural decisions changes. This audit
confirms Option B (real FTS5 corpus), the outbox-pattern reuse, the
strict visibility invariant, and the "search failure never blocks the
transaction" rule are all still correct and buildable. What this audit
adds, with evidence, that the plan must explicitly account for:

1. **Phase 1 is bigger than "add event writers"** — it is "add event
   writers to 6+ confirmed-missing call sites, AND fix two confirmed
   visibility-join gaps that predate Engine 11 and were silently letting
   `searchPublicListings()` skip the `provider_profiles.operational_status`
   check." The second item is a pre-existing correctness gap, not new
   scope Engine 11 invented — but Engine 11's indexer cannot safely index
   "whatever the current query returns" without first closing it, or the
   search corpus will faithfully replicate a bug.
2. **stay_properties and restaurants are correctly excluded from V1**, not
   because of a scoping choice but because they contain no data and no
   write path exists to create any. Do not build indexing logic for empty
   tables.
3. **Geo delivery in V1 is narrower than "NaijaGigs/NaijaStay have
   coordinates" implied.** The *populated* `bookable_listings` corpus
   (1,501 rows) itself only has `city` TEXT, not lat/lng. Real proximity
   search depends on how many of those rows can actually be joined to a
   `service_areas`/`stay_properties`-style coordinate — a number Phase 1
   must measure, not assume is "most of them."
4. **`vehicles` should not appear in Engine 11's searchable corpus at all**
   — it was implicitly swept into the original architecture diagram's
   "vehicles" vertical box, but the actual table is fleet-operations data,
   not a customer discovery surface.
5. **A new outbox table is needed** (Engine 9's `notification_outbox`
   cannot be repurposed due to its `recipient_user_id NOT NULL` and
   `category` CHECK constraint) — same proven shape, different columns.

No migration, no code change, and no scope decision has been made in this
document beyond the classification and measurement above. Phase 1 planning
is the next authorized step, pending your review of these findings.

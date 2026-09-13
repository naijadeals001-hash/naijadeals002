# Engine 11 — Geo-Coverage Measurement (Phase 0 Addendum)

**Status:** AUDIT ONLY. No migrations, no event writers, no indexing code,
no schema changes. This document is a direct factual follow-up to
`docs/ENGINE-11-SEARCH-DISCOVERY-AUDIT.md` §5, measuring exactly what that
document flagged as unmeasured: *"how many of the 1,501 bookable_listings
rows can actually be joined to a coordinate."*

**Method:** every plausible join path from `bookable_listings` to a table
containing `latitude`/`longitude` was identified from the schema (via
`PRAGMA table_info`), then measured directly against
`naijadeals-production --local` (the same production-seeded local D1 used
throughout Phase 0). No path was assumed to work or assumed to fail without
running the actual query.

---

## 1. Baseline

```sql
SELECT listing_type, COUNT(*) FROM bookable_listings GROUP BY listing_type;
```

| listing_type | count |
|---|---|
| gig_service | 1,474 |
| stay_unit | 27 |
| **Total** | **1,501** |

---

## 2. Every Join Path Measured

`bookable_listings` has five columns that could plausibly lead to a
coordinate: `provider_user_id`, `stay_property_id`, `service_listing_id`,
`organization_id`, and its own `city` column. Each was tested.

### 2.1 Direct columns on `bookable_listings` itself

| Column | Result |
|---|---|
| `city` | **0 / 1,501 populated** (100% NULL) |
| `latitude` / `longitude` | Columns do not exist on this table at all |

### 2.2 Path via `provider_user_id → provider_profiles.user_id → service_areas.provider_profile_id`

This is the path the original architecture diagram and the prior turn's
finding ("NaijaGigs has real lat/lng via `service_areas`") assumed would
cover the gig_service rows.

```sql
SELECT COUNT(*) FROM bookable_listings bl
WHERE bl.listing_type = 'gig_service'
AND EXISTS (SELECT 1 FROM provider_profiles pp WHERE pp.user_id = bl.provider_user_id);
```

**Result: 0 / 1,474.**

Root cause, confirmed by direct inspection:
- `bookable_listings` has **1,405 distinct `provider_user_id` values**
  (17, 22, 23, 24, 32, 33, 35, 37, 38, 39, ... — all valid, real
  `users.id` values, confirmed via `SELECT COUNT(*) FROM users WHERE id IN
  (...)` returning 1,405).
- `provider_profiles` has **only 2 rows total**, with `user_id` values
  `{9, 10}` — neither of which appears anywhere in the 1,405 distinct
  provider IDs behind the real listing inventory.
- **This is not a data-quality bug in the sense of corrupted data — it is
  a confirmation that the `provider_profiles` extension table was never
  populated for the users who actually created these 1,501 real listings.**
  The users creating gig/stay listings today do so without ever gaining a
  `provider_profiles` row, so the entire `provider_profiles →
  service_areas` chain — which is otherwise schema-correct and even has
  real lat/lng columns — is structurally disconnected from 100% of the
  live inventory.
- Additionally, `service_areas` itself has **0 rows** (measured directly:
  `SELECT COUNT(*) FROM service_areas` → 0). Even if the `provider_profiles`
  link existed, there would be nothing on the other end of it.

### 2.3 Path via `stay_property_id → stay_properties`

```sql
SELECT stay_property_id, COUNT(*) FROM bookable_listings WHERE listing_type='stay_unit' GROUP BY stay_property_id;
```

**Result: `stay_property_id IS NULL` for all 27/27 stay_unit rows.**

And even if it were populated: `stay_properties` has 0 rows (confirmed in
the Phase 0 audit, §2, row #7 — DEAD). This path was dead on both ends
independently.

### 2.4 Path via `organization_id → organization_addresses`

Not identified in the original Phase 0 audit — found during this
measurement while exhaustively checking every FK-shaped column on
`bookable_listings`.

```sql
SELECT COUNT(*), COUNT(organization_id) FROM bookable_listings;
```

**221 / 1,501** rows have `organization_id` populated — the only non-trivial
population rate found among the candidate join columns.

`organization_addresses` does have real `latitude`/`longitude` columns
(confirmed via `PRAGMA table_info`). But:

```sql
SELECT COUNT(*), COUNT(latitude) FROM organization_addresses;
```

**Result: 0 rows total.** `organization_addresses` is itself an empty
shell — a third dead table discovered in this exercise, alongside
`stay_properties` and `restaurants` from the Phase 0 audit.

**Result: 0 / 221** organization-linked listings resolve to a coordinate.

### 2.5 Path via `service_listing_id → service_listings → service_areas`

```sql
SELECT COUNT(*), COUNT(service_listing_id) FROM bookable_listings;
```

**Result: 0 / 1,501 populated.** No `bookable_listings` row links to a
`service_listings` row at all (consistent with the Phase 0 audit's
finding that `service_listings` itself only has 1 row and no visible
integration back to `bookable_listings`).

### 2.6 User-level `addresses` table (checked for completeness)

`addresses` (the customer/user address book table) has `city`/`state`
columns but **no `latitude`/`longitude` columns at all** — ruled out
structurally, not just by row count.

---

## 3. Combined Definitive Result

A single query combining every viable coordinate-bearing path
(`service_areas` via `provider_profiles`, and `stay_properties` direct)
confirms the aggregate:

```sql
SELECT COUNT(*) FROM bookable_listings bl
WHERE EXISTS (
  SELECT 1 FROM service_areas sa
  JOIN provider_profiles pp ON pp.id = sa.provider_profile_id
  WHERE pp.user_id = bl.provider_user_id AND sa.latitude IS NOT NULL AND sa.longitude IS NOT NULL
)
OR (bl.stay_property_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM stay_properties sp WHERE sp.id = bl.stay_property_id AND sp.latitude IS NOT NULL AND sp.longitude IS NOT NULL
));
```

**Result: 0.**

### Final table

| Vertical | Rows | Rows with a resolvable coordinate | Coverage |
|---|---|---|---|
| gig_service | 1,474 | 0 | **0.0%** |
| stay_unit | 27 | 0 | **0.0%** |
| **Total** | **1,501** | **0** | **0.0%** |

**Of the 1,501 real, live `bookable_listings` rows, zero — not "a small
fraction," zero — can be associated with a real latitude/longitude through
any existing join path in this schema.** Every table that structurally
*could* supply a coordinate (`service_areas`, `stay_properties`,
`organization_addresses`) is itself empty (0 rows). The one table that
does have rows and a plausible link column (`provider_profiles`, linked
via `organization_id`/`provider_user_id`) is populated for only 2 users
total, neither of whom owns any of the 1,405 distinct real listing-owner
accounts.

---

## 4. What This Means for Phase 1/11a Scope

This is a stronger and more specific finding than the Phase 0 audit's
original caution ("real proximity search... depends on how many rows can
actually be joined to a coordinate — a number Phase 1 must measure, not
assume"). The measured answer is not a partial-coverage number requiring
a percentage-based scoping decision — **it is zero coverage**, full stop,
for the entire currently-live inventory.

**Implication, stated plainly:** "Geo for entities that already have
coordinates" (your locked V1 decision) is currently an **empty set** when
applied to the real, populated `bookable_listings` corpus. The schema
*capability* for geo exists (real `latitude`/`longitude` columns on
`service_areas` and `stay_properties`), but zero rows in the live
inventory are connected to it today.

This does not invalidate the architectural decision — Option B, FTS5,
outbox pattern, the two-level visibility invariant, and "geo for
entities that already have coordinates" all remain correct as *target*
architecture. It does mean:

1. **11a (geo infrastructure) can and should still be built** — the
   FTS5/outbox/eligibility machinery Phase 1/2 delivers is not wasted;
   it is the correct foundation regardless of today's coordinate coverage.
2. **11a (geo results) will return zero geo-filtered results for the
   live gig/stay inventory on launch day**, honestly, unless one of two
   things happens first: (a) a data-backfill effort links existing
   `bookable_listings` rows to `provider_profiles`/`service_areas` (a
   business/ops decision, not an Engine 11 coding task), or (b) a future,
   separately-authorized change adds `latitude`/`longitude` directly to
   `bookable_listings` (or a lightweight owning-provider location table)
   and populates it going forward for new listings.
3. **This must be stated exactly this way in any Phase 1 scope document
   or user-facing "what does Engine 11 do" claim** — not softened to
   "geo coverage is still being measured" or "partial coverage exists."
   Zero is zero, and claiming otherwise would repeat exactly the kind of
   overclaiming the governing instructions explicitly forbid (the same
   discipline applied to Engine 9's "retry is not an autonomous worker"
   and "browser verification not performed" honesty requirements).
4. **A new, small finding to fold into Phase 1's inventory**:
   `organization_addresses` is a third dead table (alongside
   `stay_properties` and `restaurants` from the Phase 0 audit) — 221
   `bookable_listings` rows point at an `organization_id`, but the address
   table on the other end of that relationship has never been populated.
   This should be added to the Phase 0 audit's DEAD-table list for
   completeness.

## 5. Recommendation

Ship Phase 1's eligibility/outbox/event-writer work exactly as scoped —
none of it depends on geo coverage. Explicitly **descope "near me" /
proximity search from the initial Engine 11 launch surface** (return it
to a clearly labeled future item, contingent on a data-linkage decision
outside Engine 11's remit), rather than either quietly building dead
geo-filter UI or writing geo-ranking code that will deterministically
never activate against real data. Text/keyword/category/price search and
the correct two-level visibility gate deliver real, immediate value
without geo; geo becomes an honest "Phase 11c, blocked on a data
question" item rather than a silently-broken V1 promise.

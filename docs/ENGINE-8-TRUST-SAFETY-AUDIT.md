# NaijaDeals — Engine 8: Trust, Safety & Review Engine
## Phase 1 Audit — Existing Architecture Inspection

**Status:** AUDIT ONLY. No schema changes, no code changes, no migrations made or
planned in this pass. This document exists to satisfy Engine 8's explicit
"FIRST RULE — DO NOT START BY CREATING NEW TABLES. FIRST AUDIT THE EXISTING
ARCHITECTURE" before any Phase 2+ implementation work begins.

**Date:** 2026-09-12
**Git SHA at time of audit:** `c963d276666ef149a8436179be133de724dae6fb` (clean, no changes made during this audit)
**Method:** Direct code/schema inspection (Read/Grep/Bash) of every file cited
below. No claim in this document is inferred — every line is backed by a
grep or file read performed during this session. Where something could not be
located after an exhaustive search, it is stated as **CONFIRMED ABSENT**, not
assumed absent.

---

## 1. Existing trust functionality

There is **no standalone Trust Engine** anywhere in the repository. Trust
functionality is scattered across four unrelated subsystems that never talk
to each other:

| Subsystem | Owner file(s) | Scope |
|---|---|---|
| Product reviews (read-only) | `migrations/0027`, `api-catalog.ts`, `api-services.ts`, `src/pages/product.tsx` | Display only |
| Vendor verification | `migrations/0009`, `src/lib/seller.ts` | Seller-only |
| Provider verification | `migrations/0025`, `src/lib/providers.ts` | Provider-only |
| Marketplace disputes/refunds | `migrations/0040`, `src/lib/refunds.ts`, `api-admin.ts` | Order-scoped only |

None of these four share a table, a status enum, an RBAC permission
namespace, or an audit-event schema with each other. This is the "trust
functionality is currently embedded inside the Marketplace Engine" gap the
spec describes, confirmed empirically.

**Classification: BUILD** (the unifying abstraction layer does not exist —
the four pieces below are each individually real and mostly reusable).

---

## 2. Existing review schema

`migrations/0027_polymorphic_reviews_foundation.sql` (RECONSTRUCTED migration,
production-schema-dump provenance per its own header — original source for
migrations 0013-0036 was lost, see `docs/NAIJADEALS-PRODUCTION-RECOVERY-REPORT.md`).

**This is the single biggest finding of this audit.** The `reviews` table is
**already polymorphic**, not product-only as the spec's "Current State"
section assumes:

```sql
CREATE TABLE reviews__rebuild_0027 (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id           INTEGER REFERENCES products(id) ON DELETE CASCADE,  -- nullable
  user_id              INTEGER REFERENCES users(id),
  author_name          TEXT,
  rating               INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title                TEXT,
  comment              TEXT,
  has_photo            INTEGER NOT NULL DEFAULT 0,
  photo_url            TEXT,
  helpful_count        INTEGER NOT NULL DEFAULT 0,
  is_verified_purchase INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  avatar_url           TEXT,
  reviewable_type      TEXT NOT NULL DEFAULT 'product'
                         CHECK (reviewable_type IN ('product','provider_profile','restaurant','stay')),
  reviewable_id        INTEGER,
  status               TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  updated_at           TEXT,
  moderated_by_user_id INTEGER REFERENCES users(id),
  moderated_at         TEXT
);

CREATE INDEX idx_reviews_reviewable ON reviews(reviewable_type, reviewable_id);
CREATE UNIQUE INDEX idx_reviews_one_per_user_per_entity
  ON reviews(user_id, reviewable_type, reviewable_id) WHERE user_id IS NOT NULL;

CREATE TABLE review_status_events (
  id, review_id FK reviews, status, actor_user_id FK users, note, created_at
);
```

Also present: `idx_reviews_product`, `idx_reviews_status`.

**Findings:**
- Duplicate-review prevention (Phase 5's requirement) **already exists** as a
  real unique partial index — not something Engine 8 needs to build.
- A moderation audit-trail table (`review_status_events`, Phase 6/32's
  requirement) **already exists** as a schema scaffold.
- `reviewable_type` enum is currently capped at `'product','provider_profile',
  'restaurant','stay'` — does **not** yet include `driver`, `trip`, `booking`,
  `delivery`, `event`, `property` etc. that Phase 3 requires. Widening this
  CHECK constraint (or replacing it with an application-layer allow-list plus
  a documented registry) is real Phase-3 work.
- `moderated_by_user_id`/`moderated_at`/`status IN ('published','hidden')`
  exist on the table, but **zero application code writes to them** (see
  §5/§14 below) — the moderation *schema* exists, the moderation *engine*
  does not.

**Classification: KEEP the schema as the storage layer / EXTEND the
`reviewable_type` enum and add the missing write-path + eligibility engine
around it.** This is explicitly NOT a "rebuild reviews" situation — Phase 33's
"DO NOT delete existing reviews" instruction is trivially satisfiable because
nothing here needs replacing.

---

## 3. Existing verification logic

Two **independent, non-shared** verification state machines exist:

**a) Vendor (seller) verification** — `migrations/0009_seller_portal.sql` +
`src/lib/seller.ts`:
```
vendors.verification_status: pending | verified | rejected | suspended
vendors.verification_note   (admin-entered reason)
vendors.store_status:        active | paused | suspended   (seller-controlled, distinct axis)
```
`resolveSellerStatus()` (src/lib/seller.ts:38) computes a derived
`SellerState` (`NO_SELLER | ONBOARDING | PENDING_VERIFICATION | REJECTED |
SUSPENDED | ACTIVE_SELLER`) by reading both columns together. `requireActiveSeller`
(page-route middleware, mounted on `/seller/dashboard` etc. in `src/index.tsx`)
is the enforcement point.

**b) Provider verification** — `migrations/0025_provider_identity_foundation.sql`
+ `src/lib/providers.ts`:
```
provider_profiles.verification_status: pending | verified | rejected
provider_profiles.operational_status:  active | paused | suspended
provider_organizations.verification_status: pending | verified | rejected  (org-level, separate row)
```
`resolveProviderStatus()` mirrors the seller pattern almost line-for-line
(confirmed via direct comparison — `providers.ts`'s own header comment says
"Mirrors src/lib/seller.ts's resolveSellerStatus/requireActiveProvider").
`provider_profile_status_events` table exists (verification/operational audit
trail) — same shape as `review_status_events`.

**Critical gap confirmed by exhaustive grep:** there is **no admin-facing
mutation path** for either verification_status enum anywhere in `src/routes/`
or `src/lib/`. `grep -rn "verification_status\s*=" src/lib src/routes` finds
only *read* comparisons (`if (vendor.verification_status === 'suspended')`
etc.) — **zero `UPDATE ... SET verification_status` statements exist in
application code.** The only place verification_status is ever written is the
one-time backfill `UPDATE` inside migration 0009 itself (setting the 20 seed
vendors to `'verified'`). In production, these fields can presumably only be
set directly via `wrangler d1 execute`, not through any API.

**Classification: EXTEND.** Two real, structurally-similar-but-disconnected
state machines exist. Engine 8's Phase 10 (Verification Engine) should
generalize the *shape* (`subject_type` + `subject_id` + status enum + status
event log — this is nearly identical to what `provider_profiles`/
`provider_profile_status_events` already do) rather than inventing something
new, and must **build the missing admin mutation API** (currently 100% absent)
with RBAC gating (Phase 11's explicit "Provider/seller users cannot
self-verify" requirement — trivially true today only because no endpoint
exists at all, not because it's enforced).

---

## 4. Existing suspension logic

Three **separate, non-unified** suspension concepts exist:

1. `vendors.store_status = 'suspended'` / `vendors.verification_status = 'suspended'` — seller.
2. `provider_profiles.operational_status = 'suspended'` — provider.
3. `organization_members.status = 'suspended'` (migration 0037) — org membership,
   enforced via `suspendMember()` (`src/lib/organizations.ts:232`), called from
   `api-organizations.ts:130`. This is the **only one of the three with a real,
   callable API endpoint today.**
4. `driver_profiles.status` enum includes `'suspended'` (migration 0016) but
   — confirmed via grep — `logistics-drivers.ts` only ever writes to the
   *separate* `operational_status` column (online/offline toggle), never to
   `status`. No code path sets a driver's `status` to `'suspended'` anywhere.

**Enforcement is inconsistent:** `requireActiveSeller`/`requireActiveProvider`
correctly gate seller/provider *page* routes, but grep confirms
**`requireActiveProvider` is never imported or called from any `src/routes/
api-*.ts` file** — only from `src/index.tsx` page routes and doc comments.
Booking/service API routes (`api-bookings.ts`, `api-services.ts`) resolve
organization membership directly via `resolveMembership()`/`requireOrganizationMember`
and never check `provider_profiles.operational_status` at all. **A suspended
provider's organization members could still hit provider-scoped booking APIs
today** — this is a real enforcement gap, not a hypothetical one, and is
exactly the kind of thing Phase 18 ("Do not rely on UI hiding buttons.
Enforcement must occur server-side") is warning about.

**Classification: EXTEND `organization_members` suspension pattern as the
template / BUILD a generalized `subject_type`+`subject_id` suspension table
+ a shared enforcement middleware that every vertical API route actually
calls** (today, only page routes get any enforcement at all).

---

## 5. Existing moderation logic

**Two entirely distinct "moderation" concepts exist in this codebase and must
not be conflated** (this was explicitly flagged as a risk in the spec's
framing, and is confirmed real):

**a) Product-listing moderation** (`src/lib/moderation.ts`, full file read) —
Marketplace 2.1's approval workflow for `product_listings.moderation_status`.
`ModerationDecision = 'approve'|'reject'|'suspend'|'request_changes'`.
`applyModerationDecision()` writes `cc_audit_logs` + `cc_domain_events` and
recomputes buy-box winner. Fully wired to a real admin endpoint:
`POST /api/admin/moderation/listings/:id/decision` in `api-admin.ts`, gated
by `requirePlatformRole('admin')`. **This has nothing to do with reviews.**

**b) Review moderation** — the `reviews.status`/`moderated_by_user_id`/
`moderated_at` columns and the `review_status_events` table exist in schema
(§2 above), but **confirmed via exhaustive `grep -rln "review" src/` sweep:
zero application code reads or writes these fields.** There is no
`getPendingReviewQueue()`, no `applyReviewModerationDecision()`, no
`/api/admin/reviews/*` route of any kind.

**Classification: KEEP `moderation.ts` unchanged (unrelated, working,
in-scope for Marketplace only) / BUILD review moderation from scratch**,
ideally reusing `applyModerationDecision()`'s audit-logging pattern
(`cc_audit_logs`/`cc_domain_events`) as the template rather than inventing a
new audit mechanism.

---

## 6. Existing provider trust

`provider_profiles.rating_avg REAL DEFAULT 0` / `rating_count INTEGER DEFAULT
0` (migration 0025) — cached aggregate columns. Confirmed consumer:
`api-services.ts:75` / `service-requests.ts:162`:
```sql
ORDER BY pp.verification_status = 'verified' DESC, pp.rating_avg DESC, pp.rating_count DESC
```
**No code path was found that recalculates `rating_avg`/`rating_count` from
the `reviews` table** (grep for `UPDATE provider_profiles SET rating_avg`
returns zero matches). Given §5's finding that no review-creation code exists
at all, these columns are presumably still at their seed/default values in
practice — i.e. **the ranking query above is silently ordering by data that
is never actually updated by real reviews.** This is a real, working
mechanism with no data flowing into it — a "trust signal pipe with the input
disconnected."

**Classification: KEEP the cache columns (Phase 21 explicitly allows cached
aggregates) / BUILD the recalculation trigger-path once review-write-path
exists (Phase 4/5).**

---

## 7. Existing seller trust

`vendors.positive_feedback_percent` (confirmed to exist per the spec's own
"Current State" section; column present in schema per migration 0001/0002
lineage). Same situation as §6: a display field with, per grep, **no
application code that writes to it** — confirmed absent from
`src/lib/*.ts` write statements. Likely a static/seed value today.

**Classification: EXTEND** once a real seller-trust signal pipeline
(completed orders, dispute outcomes, refund rates — Phase 8's "REAL events")
exists to feed it.

---

## 8 & 9. Existing order-based / booking-based review eligibility

**CONFIRMED ABSENT — the most important negative finding of this audit.**

`grep -rn "INSERT INTO reviews" src/` returns **zero results anywhere in the
entire application.** There is no `POST /api/reviews` route, no
`createReview()` function in any `src/lib/*.ts` file, no eligibility check of
any kind (delivered-order-item, completed-booking, or otherwise).

This means Phase 4 ("Review Eligibility") is not a hardening task on top of
an existing-but-insecure review-creation flow — **it is 100% greenfield
build work**, because the flow itself does not exist. This actually *reduces*
risk for Engine 8: there is no existing insecure eligibility logic to
reverse-engineer or accidentally regress; whatever is built will be the
first and only implementation.

Order/booking completion signals that a future eligibility check would read
from **do already exist and are real**:
- `order_items.status` (order-lifecycle, confirmed via `order-lifecycle.ts`) —
  a `'delivered'` state exists that could gate NaijaShop review eligibility.
- `bookings.status` (`booking-lifecycle.ts`'s `TRANSITIONS` table, confirmed
  in the prior Booking Engine harness work this session) — a `'completed'`
  state exists that could gate NaijaGigs/NaijaStay review eligibility.

**Classification: BUILD** (eligibility engine itself) — **KEEP** the
underlying order/booking status columns as the data source (do not duplicate
completion state into Engine 8).

---

## 10. Existing driver/trip relationships

`driver_profiles` (migration 0016) — `user_id`, `provider_id` (FK
`logistics_providers`), `license_number`, `status`, `is_online`. No `trips`
table was found under that name; logistics uses `shipments`
(`migrations/0019/0020/0042`) as its transaction unit, not a
"trip" concept — NaijaDrive-style ride trips do not appear to be
implemented yet in this codebase (the repo's logistics vertical is
delivery/shipment-oriented, not passenger-ride-oriented, as far as could be
confirmed by this audit). This means Phase 4's "NaijaDrive: completed ride →
eligible to review driver/trip" example is **aspirational for a vertical that
doesn't exist in this codebase yet**, not a gap in Engine 8 itself.

**Classification: BLOCKED (not applicable yet)** — document the intended
contract (driver review eligibility keys off `driver_profiles.id` +
whatever the eventual ride/trip completion event is) without building against
a transaction type that doesn't exist.

---

## 11. Existing authorization

The canonical RBAC/permission system is `migrations/0037
_identity_organization_engine.sql` + `src/lib/rbac.ts` + `src/lib/organizations.ts`:
- `organization_permissions` — global keyed catalog (`key`, `category`,
  `name`, `description`). Current seeded categories: `organization`,
  `commerce`, `money`, `logistics`. **`reviews.manage` already exists** as a
  seeded permission key (`commerce` category) — confirmed in the seed INSERT.
  This is presumably intended for a seller/provider replying-to-reviews use
  case, not admin-level review moderation, but it's a real precedent Engine 8
  can extend rather than replacing.
- `organization_roles` + `organization_role_permissions` — role→permission
  join, per-organization + 4 system roles (owner/admin/manager/staff).
- `requireOrganizationMember` / `requirePermission(key)` middleware
  (`src/lib/rbac.ts`) — the correct, singular authorization primitive every
  vertical route already uses (confirmed pattern in `api-bookings.ts`,
  `api-organizations.ts`).
- Separate: `requirePlatformRole('admin')` (imported in `api-admin.ts`) —
  a platform-level (non-organization-scoped) role check, distinct from the
  org RBAC system above. This is the gate Control Center admin routes use.

**Classification: KEEP outright.** Phase 27 explicitly says "Use existing
permission/RBAC architecture where available. Do NOT invent a second
authorization system" — this system is real, working, and has exactly the
right shape (keyed permission catalog) for Engine 8's proposed
`trust.reviews.moderate`, `trust.disputes.manage` etc. keys to slot into
directly as new rows in `organization_permissions`, plus reuse of
`requirePlatformRole('admin')` for platform-level trust operations (fraud,
cross-org moderation).

---

## 12. Existing audit trail

`cc_audit_logs` + `cc_domain_events` (migration 0013, Control Center
foundation) — confirmed real schema:
```sql
cc_audit_logs(id, actor_user_id, actor_name_snapshot, action, entity_type,
  entity_id, before_json, after_json, ip_address, context_json, success, created_at)
cc_domain_events(id, event_type, entity_type, entity_id, payload_json,
  actor_user_id, occurred_at, processed_at)
```
Confirmed live callers (grep): `booking-lifecycle.ts`, `moderation.ts`,
`order-lifecycle.ts`. Pattern is consistent and generic (`entity_type` +
`entity_id` string pair) — directly reusable for `entity_type='review'`,
`entity_type='dispute'`, `entity_type='trust_suspension'` etc. without any
schema change.

Also found: `cc_alerts` table (same migration) — **already has `FRAUD` and
`SECURITY` in its `category` CHECK constraint**, plus `severity`
(`INFO/LOW/MEDIUM/HIGH/CRITICAL`), `status`
(`open/acknowledged/resolved/snoozed/escalated`), `assigned_to_user_id`,
`snoozed_until`, `resolved_by_user_id`. **Confirmed via grep: zero
application code writes to `cc_alerts` today** — it is a fully-designed,
completely unused table. This is a significant pre-built asset for Phase 15
(Fraud Signal Engine) — its state machine already matches the spec's
"signal → review → confirmed/dismissed" requirement almost exactly.

**Classification: KEEP `cc_audit_logs`/`cc_domain_events` as Engine 8's audit
mechanism (do not build a parallel one) / EXTEND `cc_alerts` as the fraud
signal store** (rename/reinterpret is unnecessary — its `FRAUD`/`SECURITY`
categories and lifecycle already fit).

---

## 13. Existing security controls

Relevant patterns confirmed present and worth reusing directly:
- `resolveMembership()`'s explicit anti-enumeration doc comment ("Deliberately
  the SAME response whether the organization doesn't exist or the user simply
  isn't a member of it") — the correct pattern for Phase 36's IDOR concerns;
  Engine 8's dispute/report authorization should copy this 404-not-403 pattern
  for any cross-tenant lookup.
- The Booking Engine's `AND status = ?` compare-and-swap pattern fixed this
  session (`booking-lifecycle.ts`) is the correct template for any Engine 8
  status transition (moderation decision, verification transition, dispute
  resolution) that must resist concurrent double-application — Phase 14's
  "No client-controlled status transitions" + Phase 35's concurrency
  requirement both point at this exact class of bug.
- **No existing rate-limiting or anti-abuse mechanism was found anywhere in
  the repo** (no KV-based throttle, no per-IP/per-user submission cap). This
  matters directly for Phase 22 (review bombing / rapid suspicious review
  bursts) and Phase 15 (rapid account creation) — this infrastructure does
  not exist yet and would need to be built if those specific fraud signals
  are prioritized.

**Classification: KEEP the anti-enumeration and CAS patterns as engineering
templates / BUILD rate-limiting if fraud-signal phases are prioritized.**

---

## 14. Existing tests

Only one test harness exists in the entire repository:
`tests/booking-engine/{01-06}.test.mjs` + `tests/booking-engine/helpers/`
(Node `node:test`, black-box HTTP against a running dev server + local D1) —
built this session for the Booking Engine, **zero relation to reviews/trust**.

**Confirmed via `find tests -type f`: no review, dispute, verification,
moderation, or fraud test exists anywhere.**

**Classification: BUILD**, reusing the exact same harness pattern
(`node:test` + `fetch()` against `localhost:3000` + `helpers/d1.mjs`-style
ground-truth queries) — Phase 34 explicitly says "If a framework exists, USE
IT," and this one is directly reusable (same stack, same auth/session
helpers in `helpers/client.mjs` can very likely be extended rather than
duplicated).

---

## 15. Existing UI

Confirmed via direct read of `src/pages/product.tsx`: review display is
**100% read-only**. The rating breakdown, review list, and photo strip all
render from the `reviews` table, but there is no submission form, no "Write a
review" button, and the empty-state copy literally says *"No reviews yet —
be the first to review this product"* with **no interactive element behind
it** (confirmed via grep of `public/static/app.js` for any review-related
form-submit handler — none exists).

`src/routes/api-services.ts` similarly only *reads* provider reviews for
display; no submission UI exists for provider/service reviews either.

**No admin/Control Center UI exists at all** — confirmed via
`find src -iname "*admin*" -o -iname "*control*"`, which returns only
`api-admin.ts` (a JSON API, no `.tsx` page) and `collections-admin.ts` (a lib
file, not a page). The Marketplace 2.1 admin capabilities in `api-admin.ts`
(moderation queue, disputes, refunds) are **API-only today, with no rendered
admin dashboard page** — Postman/curl-only in practice.

**Classification: BUILD** (review submission UI is greenfield; admin trust UI
is greenfield; there is no existing admin UI of any kind to extend, for
reviews or otherwise).

---

## 16. Existing Control Center integration

`cc_audit_logs`/`cc_domain_events`/`cc_alerts` (§12) constitute the *data
layer* of a Control Center, and `api-admin.ts` is a real, working admin API
surface (moderation, collections, disputes/refunds, category attributes,
countries) gated correctly by `requirePlatformRole('admin')`. However — per
§15 — **there is no rendered Control Center UI page anywhere**; "Control
Center" today means "a JSON API namespace under `/api/admin/*` with correct
RBAC," not a dashboard a human admin opens in a browser.

**Classification: EXTEND the API pattern in `api-admin.ts`** (add
`trust`/`reviews`/`verification`/`disputes-general` route groups following its
exact existing conventions: `requirePlatformRole('admin')` at the top,
typed error handling per-route, `cc_audit_logs` writes on every mutation) —
**do not build a separate admin API module with different conventions.**
Building an actual browser-rendered Control Center UI page is out of scope
unless separately requested; it does not exist for Marketplace disputes
either, so Engine 8 would not be introducing an inconsistency by deferring it.

---

## Summary Classification Table

| # | Component | Classification | Why |
|---|---|---|---|
| 1 | Trust Engine (unifying layer) | **BUILD** | Does not exist; 4 disconnected subsystems today |
| 2 | Review schema (`reviews`) | **KEEP** storage / **EXTEND** `reviewable_type` enum | Already polymorphic, dup-prevention exists |
| 2b | `review_status_events` | **KEEP** | Schema exists, unused — ready to wire up |
| 3 | Vendor verification | **EXTEND** | Real state machine, no admin mutation API exists |
| 3b | Provider verification | **EXTEND** | Same shape as vendor; same missing-API gap |
| 4 | Suspension (org members) | **EXTEND** as template | Only one of 4 suspension surfaces has a real API |
| 4b | Suspension (seller/provider/driver) | **BUILD** enforcement | Enforcement gap: API routes don't check operational_status |
| 5 | Product-listing moderation | **KEEP unchanged** | Working, unrelated to reviews — do not touch |
| 5b | Review moderation | **BUILD** | Schema exists, zero application code |
| 6 | Provider trust (`rating_avg`) | **KEEP** cache column / **BUILD** recalculation | Currently a disconnected pipe |
| 7 | Seller trust (`positive_feedback_percent`) | **EXTEND** | Static value, no real pipeline |
| 8/9 | Review eligibility | **BUILD** | Confirmed zero existing eligibility logic (no review-creation code at all) |
| 10 | Driver/trip | **BLOCKED** (not applicable) | No ride/trip concept exists in this codebase yet |
| 11 | RBAC | **KEEP outright** | Correct existing system; add new permission keys only |
| 12 | Audit trail (`cc_audit_logs`/`cc_domain_events`) | **KEEP** | Reuse directly, no new audit mechanism |
| 12b | Fraud signals (`cc_alerts`) | **EXTEND** | Fully-designed, unused — matches Phase 15 exactly |
| 13 | Security patterns | **KEEP as template** | Anti-enumeration, CAS pattern reusable |
| 13b | Rate limiting / anti-abuse | **BUILD** | Confirmed absent entirely |
| 14 | Tests | **BUILD** (reuse harness pattern) | No review/trust tests exist |
| 15 | UI (review submission, admin dashboard) | **BUILD** | Confirmed 100% absent, read-only display only |
| 16 | Control Center API | **EXTEND** `api-admin.ts` conventions | Real API pattern exists; no rendered UI exists (consistent gap, not new) |
| — | Marketplace `disputes`/`refunds` (migration 0040, `refunds.ts`) | **EXTEND** (generalize beyond `orders`) | Full working CRUD/lifecycle, order-scoped only — major pre-existing asset for Phase 13 |

---

## Two Headline Findings (for sequencing decision)

1. **Reviews are already ~40% built at the schema layer** (polymorphic type,
   duplicate prevention, moderation columns, audit-event table) **but 0%
   built at the application layer** (no creation endpoint, no eligibility
   check, no moderation queue, no recalculation of cached ratings). Phase 3
   is mostly KEEP/EXTEND; Phases 4-6 are 100% BUILD.

2. **Marketplace Engine 2.1's `disputes` system (migration 0040,
   `src/lib/refunds.ts`) is a complete, working, tested-in-production-style
   CRUD+lifecycle** (`createDispute`, `getDisputesForOrder`,
   `getOpenDisputesForAdmin`, `resolveDispute`, wired to a real admin
   endpoint in `api-admin.ts`). It is hard-scoped to `orders`/`order_items`
   by foreign key. Engine 8's Phase 13 must **EXTEND/generalize** this
   (e.g. add a nullable polymorphic `context_type`/`context_id` alongside
   the existing `order_id` FK, migrating forward without breaking the
   existing order-dispute flow) rather than building a second, parallel
   dispute table — doing the latter would directly violate the spec's own
   "ONE DISPUTE SYSTEM" absolute rule.

---

## What This Audit Does NOT Do

Per Engine 8's own Phase 44 Budget Discipline and my explicit commitment to
the user: this document performs **audit only**. It does not:
- Create any migration.
- Write any Engine 8 application code.
- Modify `reviews`, `provider_profiles`, `vendors`, `disputes`, `cc_alerts`,
  or any other table.
- Begin Phase 2 (Canonical Trust Model) or any later phase.

The next action requires an explicit sequencing decision from Pat (see
accompanying chat message): finish Booking Engine invariants 7-8, run the
Engine 7 (Payment & Finance) audit, or proceed into Engine 8 Phase 2+
implementation on the strength of this audit.

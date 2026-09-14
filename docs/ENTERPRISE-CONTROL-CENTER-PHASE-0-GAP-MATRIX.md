# NaijaDeals — Enterprise Control Center — Phase 0 Forensic Gap Matrix

**Status:** AUDIT ONLY. No application code, migration, seed file, API route, UI
component, or production state was created or modified while producing this
document. Every claim below is backed by a `git`/`grep`/`cat`/`wrangler d1
execute --local` command actually run during this session against the real
repository and the real local D1 database — nothing is carried forward from
memory or from the attached reference image.

**Date:** 2026-09-13
**Git SHA at audit start (re-verified, not assumed):** `a9a987136d577de7c6fb83e023ea41724353c28c`
**Branch:** `main`
**Working tree at audit start:** CLEAN
**Trigger:** Pat's "NAIJADEALS — ENTERPRISE CONTROL CENTER — PHASE 0 — FORENSIC
ARCHITECTURE + GAP AUDIT" prompt, following the closure of the Engine 12 Legacy
Remediation pass (commit `a9a9871`).

**Visual reference note:** an Enterprise Control Center dashboard image was
supplied alongside the prompt. Per Pat's own explicit instruction, that image is
treated **exclusively as a visual/informational-architecture direction target**
for a *future* build phase. Nothing in this document treats any element shown
in that image (Africa live-operations map with per-country order/delivery/
revenue counts, Aura AI Operations Copilot chat panel, live system-health tiles,
per-vertical GMV cards, critical-alerts feed, etc.) as something that already
exists in this repository. Every capability below is independently verified
against actual code/schema/data, and every gap is stated as a gap even where it
matches something depicted in the image.

---

## 1. Executive Summary

**Bottom line: the Enterprise Control Center is not a green-field build.** A
real, non-trivial foundation already exists — a genuine dual-layer RBAC system
(platform roles + organization roles/permissions), a real audit-log table
already being written to by three engines, a real (if UI-less) admin API
surface with 27 routes across moderation/collections/disputes/refunds/
countries/notification-ops/user-lifecycle, a real multi-tenant `organizations`
system (135 rows), and a real, honest, config-driven Africa/Country engine.
**What does not exist is any of it exposed through a UI**, and several
schema-level Control Center primitives depicted conceptually in migration 0013
(`cc_roles`, `cc_permissions`, `cc_role_permissions`, `cc_user_roles`,
`cc_system_health`, `cc_alerts`) are **completely dormant** — defined,
zero rows, zero code references anywhere in `src/`.

The nine customer-facing verticals are asymmetric in a way the Control Center's
design must respect: **NaijaShop is real and deep** (marketplace, payments,
logistics, reviews — the only vertical with actual transactional data).
**NaijaGigs/NaijaStay have real backend engines** (Booking Engine: 120 bookings,
186 bookable listings, 32 provider profiles) even though their *customer-facing
vertical page* is still a shared "coming soon" placeholder — this is an
important, non-obvious finding: **the engine is ahead of the vertical UI**, and
the Control Center should be able to administer Booking Engine data today even
though `/gigs` and `/stay` themselves show a waitlist page. **NaijaFresh,
NaijaEats, NaijaSend, NaijaDrive, NaijaStream, Aura AI have zero backing
tables with any rows** — confirmed via direct query, not assumed — and must be
treated as genuinely not-yet-real for Control Center purposes, exactly as their
own preview pages honestly represent them.

Aura AI has **zero implementation** beyond a static preview page — no chat
endpoint, no tool-calling, no LLM integration of any kind exists anywhere in
this codebase. The image's "Aura AI — Operations Copilot" panel is 100%
aspirational relative to this repository today.

This audit's central recommendation (§30) is: **build the Control Center as a
thin, privileged UI + a small number of new aggregation/read endpoints over the
engines that are already real** (Identity, Marketplace, Payments, Booking,
Trust, Affiliates, Country), **while being explicit and honest in the UI itself
about which verticals/metrics are live vs. not-yet-real** — continuing this
project's own established "no fake availability" discipline (§0 of the Master
Architecture doc) rather than breaking it the moment a dashboard is involved.

---

## 2. Current Repository State (Ground Truth)

| Item | Value |
|---|---|
| Repository | `naijadeals001-hash/naijadeals002` |
| Branch | `main` |
| HEAD | `a9a987136d577de7c6fb83e023ea41724353c28c` (Engine 12 Legacy Remediation closure — verified, not assumed) |
| Working tree | CLEAN |
| Migrations | 49 files, `0001`–`0049`, monotonically additive |
| `src/lib/` files | 66 |
| `src/routes/` files | 22 (API sub-apps) |
| `src/pages/` files | 21 |
| `src/components/` files | 7 |
| Test suites | 6 directories (`identity-engine`, `booking-engine`, `payment-engine`, `notification-engine`, `search-engine`, `promotion-engine`) |
| `docs/*.md` | 25 files (audit/completion history) |
| Local D1 tables (spot-checked, not exhaustively counted this pass) | 100+ (see §20 for the ones relevant to this audit) |
| PM2 service | `naijadeals`, online, port 3000 |

No application code, migration, or seed file was touched to produce this
document.

---

## 3. Existing Control Center Audit

Direct grep for `admin|control.?center|Enterprise|dashboard` across
`src/**/*.{ts,tsx}` returns **zero matches** — there is no file literally named
or commented as "Control Center" in application code. However, real Control
Center *substance* exists under different names:

| Artifact | File | Classification |
|---|---|---|
| Admin API router | `src/routes/api-admin.ts` (283 lines, 27 routes) | **REAL / COMPLETE** for its 6 domains (moderation, collections, category attributes, disputes/refunds, countries, notification ops, user-status) |
| Platform-role gate | `src/lib/rbac.ts` → `requirePlatformRole('admin')` | **REAL** — confirmed the only two callers are `api-admin.ts`'s two `.use('*', ...)` mounts |
| Audit log | `cc_audit_logs` (migration 0013) | **REAL, ACTIVELY WRITTEN** — 50 rows in local dev DB; write call sites confirmed in `moderation.ts`, `user-lifecycle.ts` |
| Domain events | `cc_domain_events` (migration 0013) | **REAL, ACTIVELY WRITTEN** — 145 rows; write call sites in `moderation.ts`, `booking-lifecycle.ts`, `order-lifecycle.ts`, `search-index-events.ts` |
| Country registry | `cc_countries` / `cc_country_settings` | **REAL** (10 countries seeded, Nigeria only `LIVE`) / `cc_country_settings` is schema-only (0 rows) |
| Integration registry | `cc_integrations` | **REAL, PARTIAL** — 3 rows, only Engine 9 (notifications) is a live consumer |
| RBAC roles/permissions (`cc_roles`/`cc_permissions`/`cc_role_permissions`/`cc_user_roles`) | migration 0013 | **SCHEMA ONLY / DEAD** — 0 rows, 0 code references anywhere. This is a distinct, unused RBAC model sitting alongside the *actually used* platform-role (`users.role`) and organization-role (`organization_roles`/`organization_members`) models. |
| System health (`cc_system_health`) | migration 0013 | **SCHEMA ONLY / DEAD** — 0 rows, 0 code references |
| Alerts (`cc_alerts`) | migration 0013 | **SCHEMA ONLY / DEAD** — 0 rows, 0 code references |
| Capabilities registry (`cc_capabilities`, migration 0022) | — | **SCHEMA ONLY / DEAD** — 0 rows, 0 code references found |
| Admin UI (any `/admin` page) | — | **MISSING** — confirmed via grep of `src/index.tsx`: no `/admin` route of any kind exists. Only the JSON API exists. |

**Conclusion:** roughly 40% of migration 0013's own Control Center schema
(audit logs, domain events, countries, integrations) is real and load-bearing.
The other 60% (roles/permissions/user_roles/system_health/alerts) is inert
scaffolding from the reconstructed-schema recovery effort (see
`docs/NAIJADEALS-PRODUCTION-RECOVERY-REPORT.md`) that was never wired to
anything — it should be treated as a **candidate to reuse or a candidate to
retire**, not as existing functionality, when Phase 1 design begins.

---

## 4. RBAC / Security Audit

Two real, independently-working authorization systems coexist by design:

1. **Platform role** (`users.role`, values confirmed via code: `customer`,
   `vendor`, `admin`) — single flat column, gated by
   `requirePlatformRole(...roles)`. Used exclusively by `api-admin.ts`. This is
   the ONLY tier that could plausibly gate a future "SUPER ADMIN" or "Enterprise
   Control Center" surface today, because it is the only admin-tier check that
   is actually enforced anywhere.
2. **Organization RBAC** (migration 0037: `organizations`, `organization_members`,
   `organization_roles`, `organization_permissions`, `organization_invitations`)
   — a genuinely well-designed multi-tenant model: 135 organizations, 176
   members, 6 system roles seeded. Every membership/permission check is
   resolved **server-side** from `organization_members`/`resolveMembership()` —
   confirmed by `rbac.ts`'s own header comment and code: the client can never
   claim a role, only which organization it wants to act on. This is the
   correct pattern and should be the template for any future Control Center
   role that needs per-country or per-vertical scoping (e.g. "Country Admin for
   Nigeria" could be modeled as an organization-style membership rather than a
   new global enum).

**What does NOT exist**: any of the 13 roles suggested in the user's prompt
(SUPER ADMIN, EXECUTIVE, OPERATIONS ADMIN, FINANCE ADMIN, TRUST & SAFETY ADMIN,
MARKETING ADMIN, CONTENT ADMIN, VERTICAL ADMIN, COUNTRY ADMIN, SUPPORT ADMIN,
ANALYST, AUDITOR, READ-ONLY ADMIN). Today there is exactly one privileged role
(`users.role = 'admin'`) and it is all-or-nothing — an admin who can resolve
disputes can also change any user's account status and process the
notification outbox. **This is a real, confirmed gap**: there is no
granular/scoped admin permission model today, only a binary admin/non-admin
split. Building the 13-role hierarchy is real, non-trivial future work, not a
labeling exercise — it requires either (a) extending `cc_roles`/
`cc_permissions` (currently dead, but structurally the right shape for exactly
this) and wiring a new `requireControlCenterPermission(key)` middleware
following `rbac.ts`'s existing pattern, or (b) reusing the organization RBAC
model with a synthetic "platform organization." Recommendation: **(a)** —
`cc_roles`/`cc_permissions` already model roles as sets of keyed permissions,
which is the correct shape; it just needs seed data and a middleware, not a
redesign.

Session security (cookie flags, fixation, PBKDF2 params) was **not**
independently re-verified this pass — Engine 1's own completion doc already
covers this and re-auditing it is out of scope for a Control Center gap audit.

---

## 5. Information Architecture — What's Real vs. Proposed

Evaluating the user's proposed IA against actual repository capability:

| Proposed area | Backing exists today? | Detail |
|---|---|---|
| **Command Center** (exec/ops overview, alerts, incidents, pending actions) | Partial | `cc_domain_events` (145 rows) could feed an activity feed; `cc_alerts` exists but is empty/unwired — no incident ever gets INSERTed into it by any code path today. |
| **Africa Map** | Not backed | See §7 — no listing/order has resolvable coordinates. |
| **System Health** | Not backed | `cc_system_health` is schema-only, 0 rows, 0 writers. |
| **Users & Entities** | Real | `users`, `organizations`, `organization_members`, `provider_profiles` all real with substantial rows. |
| **Commerce** (Products/Orders/Inventory/Returns/Refunds) | Real | Deepest engine in the codebase (Marketplace, §4a-equivalent of prior audits). |
| **Bookings/Mobility/Logistics** | Partial | Booking Engine real (120 bookings); Logistics Engine has dispatch/pricing/tracking code but 0 shipment/vehicle/driver rows of consequence (5 shipments, 2 drivers, 0 vehicles) — schema and code real, operational volume near-zero. |
| **Finance** | Real | Wallet ledger, payment transactions, seller finance accounts — Engine 7 is the most hardened engine in the repo (114/114 tests per prior audits). |
| **Trust & Safety** | Partial | Reviews schema is real but `reviewable_type` has only ever been `'product'` (174/174 rows); disputes/refunds are real and CAS-hardened; verification state machines exist but have zero admin mutation route (confirmed — same finding as the Master Completion Audit, re-confirmed this session via grep). |
| **Marketing & Growth** (Promotions/Coupons/Advertising/Affiliates) | Partial | Coupons/hero campaigns/brand merchandising real (just closed under Engine 12 Legacy Remediation); Affiliates real (1 profile, real ledger); **Sponsored Advertising does not exist at all** — confirmed, zero tables, zero code. |
| **Content & Media** | Partial | Hero campaigns real and wired; `SELLER_UPLOADS` R2 bucket declared but zero upload route exists anywhere. |
| **Platform** (Verticals/Countries/Feature Flags/Config) | Partial | Countries real (10 rows); **no feature-flag system of any kind exists** (confirmed via grep — zero matches for `feature_flag` anywhere in `src/` or `migrations/`). |
| **Integrations** | Partial | `cc_integrations` real but only 3 rows, only Engine 9 is a consumer; Payments (Paystack) and Logistics providers are still hardcoded, not routed through the registry. |
| **Analytics** | Not backed | Confirmed zero analytics/events-aggregation tables exist beyond the raw `cc_domain_events`/`search_index_events` logs, which are instrumentation, not analytics. Engine 13 (Analytics) does not exist. Explicitly out of scope for this Phase 0 (per Pat's Part 10 instruction). |
| **Aura AI** | Not backed at all | Zero chat endpoint, zero LLM call anywhere in `src/`, confirmed via grep for `openai\|anthropic\|LLM\|completions` — no hits. `/aura` is a static preview page identical in mechanism to `/fresh`, `/eats`, etc. |

---

## 6. Entity 360 Analysis

A "Customer 360" timeline is **partially constructible today** from existing
joins, but not as a single query — it requires assembling from several tables
that already have the right foreign keys: `users` → `orders` (via
`orders.user_id`) → `wallet_ledger` (via `user_id`) → `bookings` (via
`bookings.customer_user_id`, confirmed present in Booking Engine schema) →
`reviews` (via `user_id`) → `organization_members` (via `user_id`). No code
path assembles this today — it would be new aggregation-query work, not schema
work. This is **low-risk, additive work**: every join key already exists;
nothing needs to be added to the schema to support a first-cut Customer 360
read view.

A generalized "Entity 360" for Seller/Provider/Booking/Payment/Campaign is
**more work** because Reviews (`reviewable_type`) has never actually been
exercised for anything but products — building a Provider 360 that includes
"reviews about this provider" would be the FIRST real use of the polymorphic
reviews design, not a reuse of a proven path.

---

## 7. Command Palette Analysis

No global search/command infrastructure exists. Confirmed: no `/api/search`
mount exists anywhere (`src/index.tsx` has no such route); Engine 11 (Search &
Discovery) Phase 1 is instrumentation-only — it writes `search_index_events`
(341 rows) but has zero query/lookup API. A Control Center command palette
("find customer", "find order") would need to hit each engine's own existing
lookup functions directly (e.g. `getOrderByNumber`, a new `getUserByEmail`) —
there is no shared, cross-entity search index to build the palette on top of
today. This is consistent with, and should not duplicate, Engine 11's own
Phase 2/3 scope (FTS5/ranking) — a Control Center palette in Phase 1 should be
a handful of direct, entity-specific lookups, not a preview of Engine 11's
future work.

---

## 8. Operations Control Tower

Real-time-ish data that could genuinely be surfaced without new schema:
`orders` (with `created_at`, `status`), `bookings` (with `status`,
`booking_status_events` for a timeline), `cc_domain_events` (145 rows — a
genuine cross-engine event stream already capturing booking/order/search
lifecycle events with `payload_json`), `payment_transactions`. **None of this
is "live" in a push/websocket sense** — Cloudflare Pages/Workers cannot run a
persistent server process (explicitly out of scope per this environment's own
constraints), so any "live feed" must be implemented as **polling** (the client
re-fetches an aggregation endpoint every N seconds), not a websocket/SSE push.
This is an important constraint the image's "Live Operational Feed" panel
implies but cannot literally deliver in this hosting model without an
additional service — flag this explicitly for Phase 1 design rather than
silently building a fake "live" indicator.

---

## 9. Africa Operations Map / Geographic Architecture

Re-confirms the existing, already-documented finding
(`docs/ENGINE-11-GEO-COVERAGE-MEASUREMENT.md`): `gps_events` table exists
(migration 0026) but has **0 rows** (confirmed this session). No
`bookable_listing`, vendor, or order carries a resolvable lat/lng coordinate.
`vendors.state`/`organizations` carry state/country **strings**, not
coordinates. **A literal "Africa live-operations map with pins" as shown in the
reference image cannot be built honestly today** — it would require either (a)
a real geocoding pass over existing state/city strings (an actual data-quality
project, not a UI task), or (b) an honest map that shows aggregate counts *by
state/country* (choropleth-style, using the strings that DO exist) rather than
literal pins. Recommendation for Phase 1: **build the choropleth version now,
defer literal pins/geocoding to a dedicated future data project** — this
respects the project's "no fake GPS" rule (`country.ts`'s own header comment)
which this Control Center audit must not violate just because the reference
image shows pins.

---

## 10. Finance Control Center

Engine 7 (Payments & Finance) is the strongest foundation in the repository
for Control Center purposes. Real, read-available today: `wallet_ledger`
(append-only, single source of truth), `wallet_accounts` (cached balance),
`payment_transactions`, `seller_payout_accounts` (encrypted NUBAN + audit
table), `seller_finance_accounts`. Real, already-exposed via `api-admin.ts`:
refund creation (`/api/admin/orders/:orderId/refund`), dispute resolution.
**Not yet exposed via any admin route**: payout approval/execution, wallet
balance override/investigation views, settlement reporting. **Do not build a
second ledger or a "finance dashboard" that recomputes balances independently**
— any Control Center finance view must read `wallet_ledger`/
`payment_transactions` directly, exactly as `wallet.ts` already does for every
other consumer.

---

## 11. Promotion / Advertising Control

Directly relevant to the just-closed Engine 12 Legacy Remediation
(`docs/ENGINE-12-LEGACY-REMEDIATION.md`, commit `a9a9871`): Coupons, Brand
Merchandising, and Hero Campaigns are REAL and SAFE/COMPLETE as of that
closure. **Sponsored Listings, Ad Campaigns, Ad Budgets, CPC/CPA billing:
confirmed, again, NOT IMPLEMENTED** — zero tables, zero routes, zero UI, zero
lib code of any kind. Per Pat's explicit instruction, this Phase 0 audit does
**not** design or start that work. The only relevant Phase 0 finding is
architectural: when Sponsored Advertising is eventually authorized, its
billing hook must go through the existing `wallet_ledger`/
`payment_transactions` tables (per the Master Architecture's own Engine 7
principle — "do not create a second ledger"), and its future admin controls
(campaign approval, budget caps, fraud review) should live in `api-admin.ts`
following the same pattern the other 6 admin domains already use, not a new
parallel admin surface.

---

## 12. Analytics Control (Engine 13 — Explicitly Out of Scope)

Confirmed, again: no analytics/events-aggregation engine exists.
`cc_domain_events` and `search_index_events` are **instrumentation logs**, not
an analytics store — they were built for audit-trail and search-indexing
purposes respectively, not for computing GMV/conversion/revenue trends. A
future Engine 13 would most plausibly be built as an aggregation layer that
reads (never duplicates) `orders`, `payment_transactions`, `bookings`, and
these two event logs. **This Phase 0 does not design Engine 13** — noted only
so the Control Center's eventual "Executive Overview" (revenue/GMV/order
counts) has a clearly identified future dependency rather than an ambiguous
one.

---

## 13. Trust / Fraud / Risk

Real: dispute resolution + refund execution (Engine 7, CAS-hardened).
Real-but-thin: reviews table, vendor `verification_status` state machine,
provider `verification_status` state machine (`provider_profile_status_events`
audit table exists and is presumably written to — not independently
re-confirmed this pass since Engine 5's own prior audit already established
this). **Confirmed gap, re-verified this session**: `grep -rn
"verification_status\s*=" src/lib src/routes` finds only read comparisons, no
write path — meaning **no admin API can actually approve/reject/suspend a
seller or provider's verification today**, even though `api-admin.ts` already
has the exact `moderation.ts`-style pattern to build it from. This is the
single most "ready to build" gap in the entire Trust & Safety area: the
pattern, the audit-log table, and the RBAC gate all already exist; only the
route + one lib function are missing.

---

## 14. Approval Center

No approval-workflow infrastructure of any kind exists (no `pending_approvals`
table, no multi-signoff pattern anywhere in the codebase). This is a genuinely
new concept relative to everything else audited — every privileged action
found in `api-admin.ts` today executes **immediately** on a single admin's
request (refund, dispute resolution, user status change, notification
outbox processing) with an audit-log entry recorded *after the fact*, not a
proposal awaiting a second approver. Building a real Approval Center (queue +
multi-party signoff + audit trail) is legitimate new schema + new lib + new
route work — `cc_audit_logs`' `before_json`/`after_json` columns are already
the right shape to record an approval's before/after state, but the queue/
signoff table itself does not exist.

---

## 15. Emergency Operations

No "pause X" mechanism exists anywhere — no maintenance-mode flag, no
kill-switch for orders/payouts/registrations. This is entirely new
infrastructure. The correct minimal building block (a single `platform_flags`
or reuse of `cc_country_settings`-style key/value table, read at the top of the
relevant route handlers) does not exist today and would need to be designed —
flagged as future work, not started.

---

## 16. Feature Flags

Confirmed: **zero feature-flag infrastructure exists** (grep for
`feature_flag`, `FeatureFlag`, `rollout` across `src/` and `migrations/`
returns no matches). `cc_country_settings` (migration 0013, 0 rows) is
structurally the closest existing primitive (`country_id` + `setting_key` +
`setting_value`) but is scoped to countries only, not users/verticals/
percentage-rollouts, and is currently unused. **Per the user's own instruction,
this Phase 0 does not propose converting hardcoded behavior to configurable
behavior** — noted only that no reusable flag system exists to build the
"Feature Flags" panel from the reference image on top of.

---

## 17. Integration Hub

Real schema (`cc_integrations`, `cc_integration_providers`, migration 0023),
partially real usage. Confirmed consumers via grep: `notification-providers.ts`,
`notification-observability.ts`, `api-admin.ts` (`/api/admin/notifications/*`
routes). **Payments (Paystack) and Logistics providers are still hardcoded
configuration, not routed through this registry** — same finding as the prior
Master Completion Audit, re-confirmed this session, not newly discovered. This
is a genuine architecture decision that has not yet been made (should Paystack
config live in `cc_integrations.config_json`, or stay as environment
variables/secrets?) — flagged as an open question for Phase 1, not resolved
here, since secrets should almost certainly NOT move into a database column
readable by a generic admin query without a specific encryption design (the
existing `seller_payout_accounts` encryption pattern would need to be the
template, not a plain `config_json` blob).

---

## 18. Audit Log / Governance

`cc_audit_logs` genuinely answers WHO (`actor_user_id`/`actor_name_snapshot`),
WHAT (`action`, `entity_type`, `entity_id`), WHEN (`created_at`), BEFORE/AFTER
(`before_json`/`after_json`), and IP is a column though not confirmed populated
by every writer. **What it does NOT answer today**: WHY (no `reason` field is
guaranteed populated — `context_json` exists but is writer-optional) or
APPROVAL (no approval-workflow linkage exists, per §14). Only 2 of many
possible admin actions currently write to it (`moderation.ts`,
`user-lifecycle.ts`) — the other 25 routes in `api-admin.ts` (refunds, dispute
resolution, collection CRUD, category attributes, notification-ops) do **not**
appear to write an audit-log row (confirmed by grep — no `cc_audit_logs` INSERT
found in `refunds.ts`, `collections-admin.ts`, or `attributes.ts`). **This is a
real, previously-undocumented gap this Phase 0 audit is the first to surface**:
audit logging is not uniformly applied even across the admin surface that
exists today, let alone across a future Control Center's much larger action
set.

---

## 19. Business Configuration

Confirmed hard-coded (not database-driven) as of this audit: seller commission
rates, delivery fee calculation (`calculateDeliveryFeeKobo` in `orders.ts`),
cancellation windows, most category structures. Confirmed database-driven
already: coupon rules, hero campaign scheduling, brand featuring, country
availability, affiliate commission rate (`default_commission_bps` — a real
column, not hardcoded). Per Pat's own instruction, this Phase 0 does not
propose converting anything — this section only inventories which is which so
a future "Business Configuration" Control Center panel knows what it would
actually be editing (a real DB row) versus what it would need new schema work
to expose (a currently-hardcoded constant).

---

## 20. Africa/Country Architecture

Already covered in detail by the prior Master Completion Audit and
re-confirmed this session: `cc_countries` (10 rows, Nigeria the only `LIVE`
one), `listing_country_availability` (migration 0040 — seller/admin-declared
boolean per listing×country, explicitly documented in its own header as "NO
fake GPS, NO fake location matching"). This is a **genuinely correct,
honest, already-built pattern** — a future Control Center's "Country
Management" panel should be a thin CRUD UI over `cc_countries`/
`cc_country_settings`, not a redesign. The Control Center administers country
config; it must not become a second Country Engine, exactly as Pat's own
prompt specifies.

---

## 21. Aura AI

Confirmed, exhaustively, via grep for `openai|anthropic|gemini|LLM|completion|
chat` across `src/`: **zero AI/LLM integration of any kind exists in this
codebase.** `/aura` renders `ecosystemPreviewPage` — the exact same generic
"coming soon" component used for `/fresh`, `/eats`, `/gigs`, `/stay`, `/drive`,
`/send`, `/stream`. There is no chat UI, no tool-calling scaffold, no API key
binding for any AI provider in `wrangler.jsonc`, no permission model
distinguishing READ/ANALYZE/RECOMMEND/REQUEST-APPROVAL/EXECUTE tiers (per Pat's
own prompt) because there is no AI action of any kind to tier. **This is the
single largest gap between the reference image and reality** — the image shows
a fully conversational "Aura AI — Operations Copilot" panel with suggested
prompts; building even a read-only version of this requires: (a) selecting and
provisioning an LLM provider, (b) building a tool-calling layer that calls
existing engine `lib/*.ts` read functions (never raw SQL, per the Master
Architecture's own integration rule, §7), (c) designing the READ→EXECUTE
permission tiering from scratch, and (d) audit-logging every AI-initiated
action through the same `cc_audit_logs` table every human admin action uses.
None of this exists today in any form.

---

## 22. Database/API Gap Matrix

Legend: 🟢 REAL/COMPLETE · 🟡 REAL/PARTIAL · 🔵 SCHEMA ONLY · ⚪ MISSING

| Capability | Table(s) | Service (lib) | API | UI | RBAC | Gap |
|---|---|---|---|---|---|---|
| Moderation | `product_listings`, `cc_audit_logs` | `moderation.ts` | `api-admin.ts` | ⚪ | `requirePlatformRole('admin')` | UI only |
| Collections | `collections`, `collection_products` | `collections-admin.ts` | `api-admin.ts` | ⚪ | same | UI only |
| Disputes/Refunds | `disputes`(via refunds.ts), `wallet_ledger` | `refunds.ts` | `api-admin.ts` | ⚪ | same | UI + audit logging (§18) |
| Countries | `cc_countries` | `country.ts` | `api-admin.ts` (read-only) | ⚪ | same | Write route missing (no CRUD, only GET) |
| Notification ops | `notification_outbox`, `cc_integrations` | `notifications.ts` | `api-admin.ts` | ⚪ | same | UI only |
| User status | `users` | `user-lifecycle.ts` | `api-admin.ts` | ⚪ | same | UI only |
| Seller/Provider verification decision | `vendors`, `provider_profiles` | 🔵 no lib function exists | ⚪ | ⚪ | none | **Full gap** — needs route + lib + UI |
| RBAC roles/permissions mgmt | `cc_roles` etc. | 🔵 dead schema | ⚪ | ⚪ | n/a | **Full gap** — needs seed data + middleware + route + UI |
| System health | `cc_system_health` | 🔵 dead schema | ⚪ | ⚪ | n/a | **Full gap** — needs a writer (health-check job), route, UI |
| Alerts | `cc_alerts` | 🔵 dead schema | ⚪ | ⚪ | n/a | **Full gap** — needs writers from each engine, route, UI |
| Approval workflow | ⚪ | ⚪ | ⚪ | ⚪ | n/a | **Full gap** — net-new schema + everything |
| Feature flags | ⚪ | ⚪ | ⚪ | ⚪ | n/a | **Full gap** — net-new schema + everything |
| Entity 360 (Customer) | `users`+joins | 🔵 no aggregator | ⚪ | ⚪ | same as admin | Aggregation query + route + UI |
| Command palette | ⚪ (per-entity lookups only) | partial (each engine's own getX) | ⚪ | ⚪ | same | New route(s) + UI |
| Africa map (choropleth) | `organizations`/`vendors` (state strings) | partial | ⚪ | ⚪ | same | Aggregation route + UI (honest, no pins) |
| Finance overview | `wallet_ledger`, `payment_transactions` | `wallet.ts` (read fns exist) | ⚪ (no admin finance route yet) | ⚪ | none yet | Route + UI |
| Integration Hub UI | `cc_integrations` | `notification-providers.ts` (partial) | `api-admin.ts` (notification slice only) | ⚪ | same | Generalize beyond notifications; UI |
| Aura AI | ⚪ | ⚪ | ⚪ | ⚪ | n/a | **Full gap** — see §21 |

---

## 23. Engine ↔ Control Center Matrix

| Engine (Program numbering, per `NAIJADEALS-ENGINE-COMPLETION-MASTER-AUDIT.md`) | Existing capability | Control Center relationship | Missing work |
|---|---|---|---|
| 1 — Identity & Access | Auth, orgs, RBAC (real) | READ (user list/detail), CONTROL (status changes — exists), CONFIGURE (org roles — exists via org UI, not CC) | CC-side user list/detail UI |
| 2 — Marketplace/Commerce | Deepest engine, real | READ (products/orders), CONTROL (moderation — exists), APPROVE (none yet) | Product/order admin views |
| 3 — Booking | Real, hardened (55/55 tests) | READ (bookings/listings), CONTROL (none via CC yet) | Booking admin view; verification-decision route (shared w/ Engine 5) |
| 4 — Logistics/Delivery | Real code, near-zero data | READ (shipments/drivers) | Admin view; still low priority given near-zero live volume |
| 5 — Trust/Verification | Real state machines, zero admin route | APPROVE (missing — see §13) | Verification decision route + UI — **highest-readiness gap in repo** |
| 6 — Maps/GPS | Schema-only, 0 rows | ANALYZE (blocked — no data) | Out of scope; documented gap only |
| 7 — Payments & Finance | Real, most hardened engine | READ (wallet/tx), APPROVE (refunds — exists) | Finance overview UI, payout approval route |
| 8 — Trust & Safety | Schema real, thin app layer | APPROVE (disputes — exists), MODERATE (reviews — missing) | Review moderation route + UI |
| 9 — Communication | Done/closed | READ (outbox/observability — exists via CC API), CONTROL (retry/process — exists) | UI only |
| 10 — Content & Media | Hero campaigns real; R2 upload missing | CONFIGURE (hero campaigns — no CC route yet) | Upload route (Engine-level gap, not CC-specific); CC UI |
| 11 — Search & Discovery | Phase 1 done (instrumentation only) | ANALYZE (none — no query API exists yet) | Not CC's job to build Engine 11 Phase 2; CC can consume once it exists |
| Control Center (native) | RBAC/audit real, roles/health/alerts dead | — | See §22 |
| Integration Hub | Partial (notifications only) | CONFIGURE | Generalize to Payments/Logistics; CC UI |
| Africa/Country Engine | Real, honest | CONFIGURE (exists, read-only via CC) | Write route (CRUD) + UI |
| Affiliates/Growth | Real ledger | READ, APPROVE (payout requests) | Admin view for payout approval |
| Engine 12 (Promotion/Legacy) | Coupons/Brands/Hero real+safe (just closed) | CONFIGURE | CC UI for existing admin routes; Sponsored Advertising explicitly deferred |
| Engine 13 (Analytics) | Does not exist | — | Out of scope, per Pat's instruction |

---

## 24. Vertical ↔ Control Center Matrix

| Vertical | Customer route reality | Backend engine reality | CC administers today? | Gap |
|---|---|---|---|---|
| NaijaShop | Real (`/shop`, `/cart`, `/checkout`) | Real — Marketplace+Payment+Logistics | Partial (moderation/disputes/refunds) | Product/order full admin view |
| NaijaFresh | Ecosystem preview only | `0031_naijafresh_categories.sql` (categories only, 0 product rows found this pass) | No | Nothing to administer yet — honest "not real" state |
| NaijaEats | Ecosystem preview only | Real schema (`restaurants`/`dishes`/`menus`), **0 rows** confirmed | No | Same — schema exists, zero live data |
| NaijaGigs | Ecosystem preview only | **Real, non-trivial data**: Booking Engine (120 bookings, 186 listings), Provider Identity (32 profiles) | **No — but should, this is a genuine near-term opportunity** | Booking/provider admin views would have real data to show today |
| NaijaStay | Ecosystem preview only | Shares Booking Engine with Gigs (same tables, `bookable_listings.listing_type` presumably differentiates — not independently re-verified this pass) | No | Same opportunity as Gigs |
| NaijaDrive | Ecosystem preview only | 0 vehicles, 2 driver_profiles, 5 shipments | No | Not enough real data yet to justify a CC view |
| NaijaSend | Ecosystem preview only | Logistics Engine code real, near-zero data | No | Same |
| NaijaStream | Ecosystem preview only | Zero backing tables of any kind found | No | Nothing exists |
| Aura AI | Ecosystem preview only | Zero | No | See §21 — full gap |

**Key finding for Phase 1 planning**: NaijaGigs/NaijaStay are **not** "same as
NaijaFresh/Eats/Send/Drive/Stream" in Control Center terms, even though their
own customer-facing pages currently look identical. The Booking Engine behind
them is real, tested, and has live data — a Control Center "Bookings" panel is
buildable and meaningful **today**, independent of whether/when the `/gigs` and
`/stay` customer pages themselves go live.

---

## 25. UX / Visual System Audit

The reference image's structure (top KPI strip → Africa map + live feed +
Aura panel three-column layout → vertical performance charts → pending
actions/top cities tables → critical alerts + city image) is a reasonable
**target layout for a future build**, but three of its panels
(Africa live map with pins, live operational feed as truly real-time, Aura AI
chat) require infrastructure that does not exist (§9, §8, §21) and must not be
mocked with placeholder/fake data to "match the screenshot" — that would
violate this project's own standing "no fake functionality" rule (Master
Architecture §11, rule 6). Existing NaijaDeals visual language (`nd-green`
brand tokens referenced in the historical recovery report, Tailwind-based
styling already used throughout `src/pages/*.tsx`) should be the actual design
system extended for the Control Center — not a disconnected new dark theme
invented solely from the reference image.

---

## 26. Responsive / Accessibility

Not evaluated in depth this pass — no Control Center UI exists yet to
evaluate. Existing pages (`seller-dashboard.tsx` etc.) use Tailwind
utility classes; no design-system component library or dedicated
accessibility audit exists in the repo today. Flagged as a Phase 1
consideration, not investigated further here since there is nothing to
retrofit against yet.

---

## 27. Performance

D1 (SQLite-based) constraints relevant to a future Control Center: no native
window-function-heavy aggregation should run per-request without caching —
`homepage_feed_cache` (existing pattern) is the established precedent for
"expensive read, cache it" and should be reused for Control Center dashboard
aggregates rather than computing GMV/order-count live on every page load.
Given current data volumes (hundreds, not millions, of rows per table),
premature optimization is not warranted for Phase 1 — but any "Executive
Overview" aggregate query should be designed cache-first from day one given
this project's own stated goal of eventually serving millions of users.

---

## 28. Security Risks (Identified, Not Yet Mitigated — Nothing Built Yet)

1. **All-or-nothing admin role** (§4): a single compromised `admin` account has
   unrestricted access to every current and future Control Center capability —
   the highest-priority security gap to close before Phase 1 ships anything
   beyond what exists today.
2. **Inconsistent audit logging** (§18): 25 of 27 existing admin routes don't
   write to `cc_audit_logs` — any Control Center expansion must not repeat this
   gap; every new privileged route should audit-log by default, not by author
   discipline.
3. **No approval workflow** (§14): every privileged action today is single-
   admin, immediate, irreversible-by-UI (refund, user suspension). A future
   Control Center that adds MORE dangerous actions (country activation, fee
   changes, emergency pause) without an approval layer would compound this risk
   at exactly the moment the blast radius of a mistake grows.
4. **`cc_integrations.config_json` as a plaintext-capable column** (§17): if
   Payments/Logistics secrets are ever moved into this table without the
   `seller_payout_accounts`-style encryption pattern, any future "Integration
   Hub" read UI becomes a credential-leak vector.
5. **Cross-organization data leakage risk in a future Entity 360**: `rbac.ts`'s
   own §27 "organization enumeration" concern (never leak org existence to a
   non-member) must be preserved when a platform admin views ANY organization's
   360 — a Control Center admin bypassing `resolveMembership()` to read
   organization data directly (which they legitimately need to, as an admin)
   must still go through an explicit, logged, platform-role-gated path, never
   silently reuse a customer-facing route with the auth check removed.

---

## 29. Dependencies (For Phase 1 Sequencing)

- Any granular RBAC (§4) work should land **before** any Control Center route
  beyond what already exists behind `requirePlatformRole('admin')`, so new
  capability isn't built on top of the all-or-nothing gate only to be re-gated
  later.
- Uniform audit logging (§18) should be established as a **shared middleware
  helper** before more admin routes are added — retrofitting 25 existing routes
  is a separate, smaller task that should happen alongside or just before
  Phase 1, not after Phase 1 adds 20 more ungated routes.
- Entity 360 (§6) depends on nothing new schema-wise — it can be built any time.
- Africa map (§9) depends on a geocoding data project that is NOT part of the
  Control Center build itself — the CC should ship the honest choropleth
  version independent of that project's timeline.
- Aura AI (§21) has no dependency on the rest of the Control Center and could
  even be sequenced last, or run as a fully separate initiative — nothing else
  in this matrix requires it to exist first.

---

## 30. Recommended Phased Delivery (Revised From Pat's Suggested Outline, With Rationale)

| Phase | Scope | Rationale for placement |
|---|---|---|
| 0 | This audit | Done |
| 1 | Control Center Core Shell + granular RBAC (`cc_roles`/`cc_permissions` activation) + uniform audit-log middleware | Must exist before adding more privileged surface, per §29 |
| 2 | Users/Entities/Identity admin views + Entity 360 (Customer first) | Lowest schema risk, highest immediate visibility |
| 3 | Operations views: Bookings (Gigs/Stay data — real today!), Orders, Logistics | Surfaces real existing data with zero new schema |
| 4 | Finance + Trust & Safety (incl. the verification-decision route — highest-readiness single gap in the repo, §13) | High business value, patterns already proven (`moderation.ts`) |
| 5 | Marketing/Promotions admin UI (existing Engine 12 legacy routes) + Affiliates admin view | Reuses just-closed Engine 12 work |
| 6 | Integration Hub generalization (Payments/Logistics providers) + Country CRUD | Medium risk (secrets handling, §28.4) |
| 7 | Approval Center + Feature Flags + Emergency Operations (all net-new infrastructure) | Genuinely new build, sequence after the lower-risk reuse work above |
| 8 | Africa choropleth map + Executive Overview (depends on future Engine 13 for real metrics; ship honest partial version first) | |
| 9 | Aura AI Operations Copilot (READ tier only first) | Independent track, can run in parallel with 7-8 if resourced separately |
| 10 | Hardening/security/performance pass across the whole Control Center | Standard closing phase |

This differs from Pat's suggested outline mainly in **moving granular RBAC and
audit-log uniformity to Phase 1** (ahead of "Identity/Users/RBAC" as its own
later phase) — because every subsequent phase adds privileged surface that
should not be built on the current all-or-nothing admin gate.

---

## 31. Open Questions (Require Pat's Decision Before Phase 1)

1. Reuse dormant `cc_roles`/`cc_permissions` schema for granular RBAC, or design
   fresh? (Recommendation in §4: reuse — shape is already correct.)
2. Should Payments/Logistics provider config move into `cc_integrations`, and if
   so, with what encryption design? (§17, §28.4 — not decided here.)
3. Is a 13-role hierarchy (SUPER ADMIN through READ-ONLY ADMIN) actually needed
   at current team size, or would 4-5 roles suffice for now with room to grow?
   Over-building roles nobody uses yet is its own maintenance cost.
4. Should the Control Center get its own top-level route (`/control-center`,
   `/admin`, `/enterprise`) — no route name has been reserved yet.
5. Timeline/priority for the geocoding data project that would eventually make
   the Africa map honest with real pins (§9) — independent of CC build itself.

---

## 32. Explicit Non-Goals (This Phase and Immediate Next Phases)

- Sponsored Listings / Ad Campaigns / Ad Budgets / CPC/CPA billing — explicitly
  deferred, per Pat's standing instruction from the Engine 12 engagement.
- Engine 13 (Analytics) build-out — out of scope per Pat's Part 10 instruction
  this session.
- Engine 11 (Search) Phase 2/3 (FTS5/ranking/Aura search contract) — not this
  Control Center's job to build.
- Geocoding/GPS backfill project — a separate, dedicated data-quality
  initiative, not Control Center UI work.
- Building any of the 12 reserved future verticals (NaijaPay, NaijaHealth,
  NaijaAuto, etc., per `NAIJADEALS_MASTER_ARCHITECTURE.md` §3) — untouched,
  not implicated by this audit.
- Any code, migration, or UI implementation — this document is Phase 0 only.

---

## 33. Definition of Ready for Phase 1

Phase 1 (Control Center Core Shell + granular RBAC + audit middleware) may
begin once Pat has:

1. Answered the Open Questions in §31 (at minimum #1, #3, and #4).
2. Confirmed the Phase 1 scope in §30 is the right starting slice (or
   re-ordered it).
3. Explicitly authorized starting Phase 1 — this document authorizes nothing
   by itself, per the standing rule that architecture/audit documents propose
   but do not begin implementation.

---

## Final Statement

```
ENTERPRISE CONTROL CENTER — PHASE 0

Repository SHA: a9a987136d577de7c6fb83e023ea41724353c28c (unchanged)
Audit document: docs/ENTERPRISE-CONTROL-CENTER-PHASE-0-GAP-MATRIX.md
Application code modified: NO
Database schema modified: NO
Production touched: NO
Control Center implementation started: NO
Audit status: COMPLETE

Major existing capabilities found:
- Dual-layer RBAC (platform role + organization role/permission) — real
- Audit log + domain event log — real, actively written (partial coverage)
- Admin API — 27 routes across 6 domains — real, UI-less
- Booking Engine — real, tested, has live data (120 bookings) despite
  NaijaGigs/NaijaStay customer pages still being "coming soon"
- Payments/Finance — deepest, most hardened engine in the repo
- Africa/Country Engine — real, honest, config-driven

Major gaps found:
- No granular RBAC (all-or-nothing admin role)
- No Control Center UI of any kind
- Audit logging not uniformly applied (25/27 admin routes don't log)
- cc_roles/cc_permissions/cc_system_health/cc_alerts schema exists, 100% dead
- No Approval Center, no Feature Flags, no Emergency Operations infrastructure
- No Africa map data (0 geocoded listings) — literal pins would be dishonest
- Aura AI: zero implementation of any kind (not even a stub endpoint)
- Seller/provider verification has no admin mutation route despite being the
  single most "ready to build" gap in the repository

Recommended Phase 1: Control Center Core Shell + granular RBAC activation +
uniform audit-log middleware (see §30, §33).

Dependencies requiring Pat's decision before Phase 1: §31.

CONTROL CENTER IMPLEMENTATION: NOT STARTED.
STOPPING per Phase 0 scope.
```

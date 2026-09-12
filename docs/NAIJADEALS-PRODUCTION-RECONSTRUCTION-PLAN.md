# NaijaDeals — Production Application Reconstruction Plan (Phase 1)

**Status:** Living document. Created concurrently with Checkpoint 1 (schema reconstruction) rather than strictly before it — see §0 "Sequencing Note" for why, and for the honest acknowledgement of that deviation from the literal instruction order.
**Branch:** `production-reconstruction`
**Date:** 2026-09-12
**Authorization state:** Implementation authorized. **Production deployment NOT authorized** (see §8).

---

## 0. Sequencing Note (Honesty Disclosure)

The governing instructions for this phase list an explicit step order:
`A. Git safety check → B. Create branch → C. Create reconstruction plan → D. Inspect local migrations → E. Inspect production schema → F. Build schema mapping → G. Identify missing migrations → H. Reconstruct migrations → I. Create local DB → J. Verify schema → K. Commit → L. Push → M. Verify SHA`

In practice, this document (step **C**) was written **after** steps D–H (migration inspection, schema mapping, and the 24 migration files themselves) had already been completed, because writing a meaningful reconstruction plan required first knowing the actual migration counts, table counts, and mapping confidence levels that only became known during D–F. Writing C first would have produced a plan with placeholder numbers that needed rewriting anyway. This is flagged here rather than silently reordered, per the standing rule of documenting deviations rather than hiding them. Steps I–M are completed in this same working session immediately after this document (see the accompanying Checkpoint 1 commit).

---

## 1. Current State (SHAs, Migration Counts)

| Item | Value |
|---|---|
| GitHub repository | `naijadeals001-hash/naijadeals002` |
| GitHub `main` HEAD (baseline for this branch) | `1cdfdcbc976d2dbb1f9885a4576ba8cfc5ed58e1` |
| Reconstruction branch | `production-reconstruction` (created off the above HEAD, unmerged) |
| Live production URL | `https://naijadeals.com` |
| Production `git_sha` (unrecovered source) | `99b1664df552ce1cd707330e17207d8869f12a4e` |
| Production migration count | 36 (`0001`–`0036`), `db.in_sync: true`, `missing_migrations: []`, `unexpected_migrations: []` |
| Production table count | 106 (105 application tables + `d1_migrations`), 0 views, 173 indexes — confirmed via fresh `gsk hosted d1_schema` read this session, unchanged from the prior audit |
| Local migration count (before this phase) | 12 (`0001`–`0012`) |
| Local migration count (after Checkpoint 1) | 36 (`0001`–`0036`) — 24 new files reconstructed this phase |
| Local table count (after Checkpoint 1, verified) | 105 application tables, matching production exactly (see `docs/NAIJADEALS-PRODUCTION-SCHEMA-MAP.md` §1 for the verification methodology and results) |

---

## 2. Confirmed Production Systems (What We Know Is Real)

Evidence hierarchy applied per Section 3 of the governing instructions: **observed production behavior** (highest) informs this list, cross-checked against the recovered schema.

From `docs/NAIJADEALS-LIVE-PRODUCTION-AUDIT.md` (direct browsing + real production `app.js` bundle inspection, GET-only):

| System | Evidence | Status |
|---|---|---|
| NaijaShop (core catalog/cart/checkout/orders) | `/`, `/shop`, `/shop/:slug`, `/cart`, `/checkout` (auth-gated), 44 real product listings with real slugs; `/api/catalog/*`, `/api/cart`, `/api/orders/*` all real | **LIVE — full buyer journey** |
| Seller/Vendor identity + finance | `seller_finance_accounts`, `seller_payout_accounts`, `seller_ledger` schema; seller onboarding routes referenced in bundle | **LIVE — backend confirmed** |
| Control Center | `/control-center` (auth-gated, redirects to login rather than 404); `cc_*` schema (15 tables: roles/permissions/countries/capabilities/integrations/audit/alerts) | **LIVE, gated — confirmed real, not generic dashboard** |
| Provider Identity (shared across Gigs/Eats/Stay) | `provider_profiles`/`provider_organizations` schema; referenced across restaurant `owner_provider_profile_id`, gigs, stay host onboarding | **LIVE — backend confirmed** |
| NaijaEats | `/eats`, `/eats/partner` render real vertical content; `/api/eats/cart` (200), `/api/eats/provider/menu-items`, `/api/eats/provider/onboard` all real and correctly behaved; 15-table schema (restaurants/menus/dishes/cuisines/orders) | **LIVE backend, empty catalog** ("No restaurants match yet") |
| NaijaGigs | `/gigs`, `/gigs/provider` both real (200); `gig_service_details` schema exists | **PARTIAL — route confirmed, deeper API surface not fully enumerated** |
| NaijaStay | `/stay`, `/stay/host` both real; `/api/stay/bookings` (401, auth-gated correctly), `/api/stay/host/onboard` referenced; `stay_properties` schema | **LIVE backend, auth-gated as expected** |
| NaijaSend (logistics/partner side) | Partner/fleet-registration flows live per page copy ("logistics partners can already register their fleets today"); `logistics_providers`/`driver_profiles`/`vehicles` schema; `/api/logistics/*` real and auth-gated | **PARTIAL — partner side live, consumer quote/track side explicitly "coming soon" per production's own page copy** |
| Affiliates | 10-table schema (`affiliate_profiles` through `affiliate_fraud_events`); Affiliates referenced in bundle's API surface | **LIVE backend confirmed via bundle, UI depth not fully audited** |
| Bookings (shared engine) | `bookable_listings`/`bookings`/`booking_status_events`; referenced in bundle | **LIVE backend confirmed via bundle** |
| Reviews (polymorphic) | `reviewable_type`/`reviewable_id`/`status` columns confirmed present in production's `reviews` table (see Schema Map §3.1); Reviews-as-API referenced in bundle | **LIVE backend confirmed** |

**Confirmed NOT live (do not fabricate, per Section 12/28):**

| Vertical | Evidence | Status |
|---|---|---|
| NaijaDrive | Page title itself says "Coming Soon"; nav badge "Soon" | **NOT LIVE** |
| NaijaStream | Page title itself says "Coming Soon"; nav badge "Soon" | **NOT LIVE** |
| Aura AI | Page title itself says "Coming Soon"; nav badge "Soon" | **NOT LIVE** — a route existing is not evidence of a working AI assistant |
| NaijaFresh | Page renders, vertical-branded, but **no product data observed**; schema is categories-only (no dedicated Fresh product table — confirmed by `0031_naijafresh_categories.sql` having zero attributable new tables) | **PARTIAL — thinnest vertical, page shell only** |

---

## 3. Systems Already Represented Locally (Before This Phase)

Local's 12 pre-existing migrations already implement, at the schema level: `users`, `vendors`, `products`/`categories`/`brands`, `carts`/`cart_items`, `orders`/`order_items`, `payment_transactions`, `wallet_accounts`/`wallet_ledger`, `reviews` (non-polymorphic, pre-fix), `addresses`, `sessions`, `notifications`, `hero_campaigns`, `seller_finance_accounts`/`seller_payout_accounts`, `ecosystem_verticals` (the vertical-teaser/waitlist system), `wishlists`, `coupons`, `saved_payment_methods`, `product_questions`, `product_variants`/`product_listings`. **Zero of these needed to be replaced** — per Section 9's "no parallel competing systems" rule, all 71 new production tables extend or sit alongside these without renaming or duplicating any of them (verified exhaustively — see Schema Map §8).

## 4. Systems Requiring Reconstruction (Application Code, Not Yet Started)

Everything below is **schema-only** as of Checkpoint 1. No application code (Hono routes, business logic, frontend) has been written yet for any of these — that is the Phase A–K work in §6.

- Authentication + RBAC (real roles beyond a single admin flag — `cc_roles`/`cc_permissions`/`cc_user_roles` now exist as schema, no route/middleware yet)
- Provider/vendor identity API layer (`provider_profiles`/`provider_organizations` schema exists, no endpoints yet)
- Country/Africa engine (`cc_countries`/`cc_country_settings` schema exists, no application logic yet; NaijaDeals must not be Nigeria-hardcoded per Section 26)
- Booking engine application logic (schema exists, no state-machine code yet)
- NaijaSend shipment lifecycle + logistics pricing interface (schema exists; pricing formula is `UNKNOWN — SOURCE CODE REQUIRED` per Section 25, must be isolated behind `LogisticsPricingProvider`)
- Affiliate calculation layer (schema exists; commission formula is `UNKNOWN — SOURCE CODE REQUIRED` per Section 23, must be isolated behind a configurable calculation interface)
- Control Center application (schema exists, no admin UI/routes yet)
- Integration Hub (schema exists, no application logic yet)
- All 5 vertical applications (NaijaEats, NaijaGigs, NaijaStay, NaijaSend consumer side, NaijaFresh) — schema exists per above, zero application code yet

---

## 5. Known Production Routes (From Live Audit)

Non-exhaustive, GET-only observed set (full list in `docs/NAIJADEALS-LIVE-PRODUCTION-AUDIT.md`):

`/`, `/shop`, `/shop/:slug`, `/cart`, `/checkout`, `/orders`, `/wallet`, `/account/wishlist`, `/account/addresses`, `/help`, `/fresh`, `/eats`, `/eats/partner`, `/eats/cart`, `/gigs`, `/gigs/provider`, `/stay`, `/stay/host`, `/drive` (coming soon), `/send`, `/stream` (coming soon), `/aura` (coming soon), `/control-center` (auth-gated).

## 6. Known Production APIs (From Bundle Inspection)

~50 endpoints confirmed real via `app.js` bundle inspection and GET-probing (401 for protected, 200 for public — never a bare 404 for anything the bundle references). Full contract-level capture (method/path/auth/request/response shapes) is **Checkpoint 2+ work**, tracked as the pending `docs/NAIJADEALS-PRODUCTION-API-CONTRACT.md` deliverable (Section 10). Known endpoint families so far: `/api/catalog/*`, `/api/cart`, `/api/orders/*`, `/api/eats/cart`, `/api/eats/provider/*`, `/api/stay/bookings`, `/api/stay/host/*`, `/api/logistics/*`, plus unenumerated Affiliates/Bookings/Reviews/Provider-Profile/Integrations/Capabilities endpoints referenced in the bundle.

## 7. Known Unknowns (Explicit, Per Section 38)

| Unknown | Marker | Where it will be isolated |
|---|---|---|
| Logistics shipping-rate formula | `UNKNOWN — SOURCE CODE REQUIRED` | Behind `LogisticsPricingProvider` interface (Phase H) |
| Affiliate commission rate/tier formula | `UNKNOWN — SOURCE CODE REQUIRED` | Behind a configurable commission-calculation layer (Phase I) |
| Exact original 0013–0036 migration-by-migration column history for 5 ALTER-only migrations (0029, 0030, 0031, 0033, 0036) | `UNKNOWN — SOURCE CODE REQUIRED` | Documented per-migration in `docs/NAIJADEALS-PRODUCTION-SCHEMA-MAP.md` §4 |
| Full API request/response contract for ~50 bundle-referenced endpoints beyond the ones already probed | `UNKNOWN — PRODUCTION BEHAVIOR NOT OBSERVABLE` (would require authenticated calls, which are prohibited without explicit scope authorization — flagged to Pat in the prior turn) | `docs/NAIJADEALS-PRODUCTION-API-CONTRACT.md` (pending) |
| Booking state-machine full transition set beyond create/pending/confirm/cancel/complete | `UNKNOWN — SOURCE CODE REQUIRED` unless additional production evidence surfaces | Phase G booking engine implementation |
| Any additional ALTER-only column drift on the 32 local tables not already caught by the Checkpoint 1 diff (the diff is a snapshot; SQLite type widening within the same declared type wouldn't show as a diff) | `UNKNOWN — PRODUCTION BEHAVIOR NOT OBSERVABLE` | Flagged in Schema Map §3, revisit if application-level bugs surface during Phase A–K |

---

## 8. Reconstruction Order

Per Section 11 of the governing instructions, core systems before verticals:

```
Phase A: Authentication + users + roles
Phase B: Provider/vendor identity
Phase C: Categories + catalog
Phase D: Orders + order lifecycle
Phase E: Payments/wallet abstraction
Phase F: Reviews
Phase G: Booking engine
Phase H: Logistics/GPS
Phase I: Affiliates
Phase J: Control Center
Phase K: Integration Hub
   ↓ (only after A–K stable)
Verticals: NaijaShop (verify/extend) → NaijaEats → NaijaGigs → NaijaStay →
           NaijaSend (consumer side) → NaijaFresh
           (NaijaDrive / NaijaStream / Aura AI: NOT built beyond what
            evidence supports — currently zero evidence supports any
            functional implementation for these three)
```

Checkpoint numbering (Section 33) tracks this 1:1 — see `docs/NAIJADEALS-PRODUCTION-RECOVERY-INDEX.md` for the master index and this plan's own checkpoint ledger below.

## 9. Test Strategy

Per Section 31: unit tests for business logic (especially the two isolated-interface unknowns — pricing and commission calculation), API tests for every reconstructed Hono route, database tests against the verified local schema, auth/authz tests for RBAC, state-transition tests for bookings/shipments/orders, regression tests to ensure NaijaShop is never broken by later vertical work, and Playwright/Chromium browser tests for actual UI verification — never claimed without being run. A GET-only production-compatibility comparison matrix (Section 32) will track MATCH/PARTIAL/MISMATCH/UNKNOWN per feature, never "PASS" unless genuinely tested.

## 10. Deployment Safety Strategy

Unchanged and absolute for the duration of this phase:

- All work happens on `production-reconstruction`, never `main`.
- Every checkpoint: test → `git diff` review → commit → push to `origin/production-reconstruction` → 3-way SHA verification (local `git rev-parse HEAD` = `git ls-remote origin` = `gh api .../commits/production-reconstruction --jq .sha`) → only then continue.
- **No merge to `main`** until: reconstruction reaches a stable state, tests pass, the compatibility matrix is reviewed, a deployment plan exists, and Pat gives explicit authorization.
- **No `gsk hosted deploy`, no Cloudflare production deploy, no production D1 migration/seed/write of any kind** during this phase. `PRODUCTION DEPLOYMENT AUTHORIZATION: NO` remains in force until Pat explicitly changes it.
- Synthetic/local-only test data throughout — never production user data, secrets, or credentials.

---

## 11. Checkpoint Ledger

| # | Checkpoint | Status |
|---|---|---|
| 1 | Schema reconstruction | **In progress — migrations 0013–0036 written and verified against production (0 table/column/FK drift after 2 real ALTERs found and fixed, 173/173 indexes matched); plan + schema-map docs written; commit/push/SHA-verify still pending as of this document's writing** |
| 2 | Authentication/RBAC/provider identity | Not started |
| 3 | Categories/catalog | Not started |
| 4 | Orders/payments/wallet | Not started |
| 5 | Reviews/booking | Not started |
| 6 | Logistics/Send | Not started |
| 7 | Control Center/Integration Hub | Not started |
| 8 | NaijaFresh | Not started |
| 9 | NaijaEats | Not started |
| 10 | NaijaGigs | Not started |
| 11 | NaijaStay | Not started |
| 12 | NaijaDrive | Not started — no evidence supports building anything beyond the existing honest "Coming Soon" state |
| 13 | NaijaStream | Not started — same as above |
| 14 | Aura | Not started — same as above |

---

## 12. Cross-Reference

- `docs/NAIJADEALS-PRODUCTION-RECOVERY-REPORT.md` — why the original source for SHA `99b1664d...` could not be found
- `docs/NAIJADEALS-LIVE-PRODUCTION-AUDIT.md` — full route/API observation this plan's §2/§5/§6 summarize
- `docs/NAIJADEALS-PRODUCTION-RECOVERY-INDEX.md` — master index of all recovery/audit documents
- `docs/NAIJADEALS-PRODUCTION-SCHEMA-MAP.md` — full table/column/index/FK mapping this plan's §1/§4 summarize
- `docs/NAIJADEALS-PRODUCTION-API-CONTRACT.md` — **pending**, Checkpoint 2+ deliverable
- `docs/NAIJADEALS-PRODUCTION-COMPATIBILITY-MATRIX.md` — **pending**, ongoing deliverable updated per checkpoint

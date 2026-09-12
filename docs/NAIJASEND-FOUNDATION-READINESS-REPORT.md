# NaijaSend Lifecycle-A — Foundation Readiness Report

**Date:** 2026-09-12
**Inspected commit:** `b32a16a` (current verified `main` tip, tag
`naijadeals-sop-checkpoint-2026-09-12` → `bd43c0f` one commit prior — same
codebase state)
**Method:** Direct inspection only — `git log`/`grep`/`find` against the
actual repository, migrations, and `tsc`/`build` output. **Nothing in this
report is taken from the prior conversation's inherited summary.** That
summary describes a session's own account of code it wrote; it is not
evidence of what exists here. Where the summary's claims are checked against
reality below, that is stated explicitly.

---

## 1. Executive Finding

**NaijaSend does not exist as a functional module in this repository.**
There is no logistics/shipment/driver code, no corresponding schema, and no
route wiring anywhere in `b32a16a`'s history (checked from `Initial commit`
through the current tip — 34 commits, none touch this domain). `/send` is
registered as **one of eight identical marketing "coming soon" preview
pages**, sharing a single generic handler with `/fresh`, `/eats`, `/gigs`,
`/stay`, `/drive`, `/stream`, `/aura`.

This is not a partial implementation with gaps — it is **zero implementation**.
Every item in the inherited Lifecycle-A prompt (Items 6–15: provider
dashboard, driver home, customer tracking, the 4 "flagged" backend files,
concurrency tests, security tests, Chromium verification, the "verified
checkpoints" `0957147`/`97cc6fd`/`35df994`) describes work that was done in a
sandbox that was never pushed to GitHub and is now unrecoverable (see the
prior recovery-exhaustion report). **None of it is a rollback or an
extension task. It is a from-zero build.**

## 2. What Actually Exists (Verified)

### 2.1 Database schema — 12 migrations, 34 tables total, zero logistics tables

| Migration | Tables created | Logistics-relevant? |
|---|---|---|
| `0001_initial_schema.sql` | users, sessions, addresses, categories, vendors, products, reviews, carts, cart_items, orders, order_items, wallet_ledger, wallet_accounts, payment_transactions, newsletter_subscribers | No |
| `0002_marketplace_depth.sql` | brands, product_listings, product_variants, product_questions, wishlists, coupons, saved_payment_methods, homepage_feed_cache | No |
| `0003_review_avatars.sql` | (alter only) | No |
| `0004_checkout_depth.sql` | (alter only) | No |
| `0005_account_experience.sql` | notifications | No |
| `0006_brand_merchandising.sql` | (brand display fields) | No |
| `0007_address_book_depth.sql` | nigerian_states | No |
| `0008_hero_campaigns.sql` | hero_campaigns | No |
| `0009_seller_portal.sql` | nigerian_banks, seller_payout_accounts, seller_payout_account_audit, seller_finance_accounts (+ vendor→user bridge columns) | **Partially reusable — see §3** |
| `0010_ecosystem_verticals.sql` | ecosystem_verticals, ecosystem_vertical_features, ecosystem_waitlist | Marketing/preview only |
| `0011_ecosystem_waitlist.sql` | ecosystem_waitlist_signups | No |
| `0012_locale_preference.sql` | (alter only) | No |

**Confirmed absent, searched by exact name across every migration file:**
`shipments`, `pickup_jobs`, `delivery_jobs`, `driver_profiles`,
`driver_vehicle_assignments`, `shipment_status_events`, `shipment_addresses`.
Zero matches. The only appearances of the words "shipment"/"driver"/"vehicle"
anywhere in `migrations/` are inside `0010`'s marketing copy strings (e.g.
"NaijaDrive will bring vehicle rentals, driver bookings...") — plain text in
a `seo_description` column, not schema.

### 2.2 Application code — zero logistics files, zero dead references

- `src/lib/`: `addresses, auth, cart, catalog, coupons, ecosystem-verticals,
  ecosystem-waitlist, guest, hero-campaigns, homepage-feed, money, orders,
  paystack, seller, wallet, wishlist` — no `shipments.ts`, `drivers.ts`, or
  `logistics-vehicles.ts`.
- `src/routes/`: `api-addresses, api-auth, api-cart, api-catalog,
  api-ecosystem, api-i18n, api-orders, api-wallet, api-webhooks,
  api-wishlist, placeholder, version` — no `api-drivers.ts` or
  `api-logistics.ts`.
- `src/pages/`: `addresses, auth, cart, checkout, ecosystem-preview,
  ecosystem, help, home, orders, product, seller-stubs, seller, shop,
  wallet, wishlist` — no `logistics.tsx`, `driver.tsx`, or
  `naijasend-track.tsx`.
- Full-text search of `src/` for `shipment|pickup_job|delivery_job|
  driver_profile|logistics`: **one hit**, a comment in `src/lib/orders.ts`
  using the word "shipment" generically ("Delivery is charged PER SELLER
  SHIPMENT") — describing the existing per-vendor delivery-fee model, wholly
  unrelated to a shipment/logistics domain object.
- `src/index.tsx` route table: `/send` → `ecosystemPreviewPage` (the shared
  8-vertical preview handler). No `/send/*` sub-routes, no `/api/logistics/*`
  or `/api/drivers/*` mount. No dangling imports referencing removed
  logistics modules — the route table is internally consistent with what's
  actually on disk.

### 2.3 Git history — confirms zero, not "reset to zero"

34 commits total, from `Initial commit` to current tip `b32a16a`. Read every
commit subject line: marketplace MVP → buy-box refactor → product photography
→ homepage/carousel → checkout → wishlist/addresses → seller portal → hero
campaigns → 8-gate deploy pipeline → seller onboarding → ecosystem preview
pages → waitlist → phase-b signup split → mobile-nav fix → i18n locale
propagation → **[this session's SOP commits]**. No commit message anywhere
mentions NaijaSend, driver, shipment, or logistics as an implementation (only
as the marketing-preview seed data in `0010`). This is not evidence of a
reset/rollback erasing prior work — the commit graph is linear and complete
with no gaps, and `git fsck --dangling` found nothing. The logistics work
described in the inherited summary simply never reached this repository at
any point in its real history.

### 2.4 Build & TypeScript baseline (true, freshly measured)

- `npm run build` → **PASS** (199ms, `dist/_worker.js` 304.76 kB / gzip 76.43 kB).
- `npx tsc --noEmit` → **17 errors**, all pre-existing and unrelated to
  logistics (in `auth.tsx`, `home.tsx`, `orders.tsx`, `product.tsx`,
  `renderer.tsx`, `api-cart.ts`, `api-catalog.ts` — generic typing issues:
  a `string`/`number` mismatch, an undeclared `VendorRow` name, argument-count
  mismatches, a possibly-undefined property, a JSX children type mismatch,
  and several `D1Database.prepare().all()` result-shape mismatches where code
  expects `{results: T[]}` but the type is `Record<string, unknown>[]`).
  **This contradicts the inherited summary's claimed "12 baseline" —
  the real, current, measured baseline is 17.** These are pre-existing,
  unrelated to any logistics work, and out of scope to fix here per the
  "don't fix unrelated pre-existing TS errors" principle — noted for
  awareness, not an action item of this report.

## 3. Readiness Matrix — What Lifecycle-A Can Build On

| Component Lifecycle-A needs | Status | Detail |
|---|---|---|
| `users` / `sessions` / password auth | ✅ **Reusable as-is** | `role` column already distinguishes `customer\|vendor\|admin` — no `driver` value yet, but the column is free text, not a fixed enum at the DB level (no CHECK constraint on `users.role`), so adding `driver`/`logistics_provider` is additive |
| Session/auth middleware pattern (`requireAuthPage`) | ✅ **Reusable as-is** | Clean composable Hono middleware; `requireActiveSeller` is the exact precedent for a future `requireActiveLogisticsProvider`/`requireActiveDriver` |
| A "provider owns a store, verification state machine, onboarding steps" pattern | ✅ **Reusable as pattern, not as data** | `vendors` (migration 0009) is the closest existing analog to "logistics provider": user→entity bridge, `verification_status` enum (`pending/verified/rejected/suspended`), `onboarding_step`, `store_status`. This is a **template to copy**, not a table to repurpose — a logistics provider is a distinct business concept from a product seller and must be its own table (e.g. `logistics_providers`), reusing the *pattern*, never aliasing onto `vendors` |
| Financial ledger pattern (`wallet_ledger` + cached balance) | 🟡 **Needs extension, not creation** | `wallet_ledger`/`wallet_accounts`/`seller_finance_accounts` establish the exact ledger+cache pattern a driver-earnings or provider-earnings system would reuse later — but Lifecycle-A explicitly excludes payment/settlement, so this is future-phase awareness only, not a current dependency |
| Addresses / Nigerian states reference data | ✅ **Reusable as-is** | `addresses` table + `nigerian_states` reference table already exist and are exactly what shipment pickup/dropoff addresses would reference — no need for a new address model |
| Route/vertical registration pattern | ✅ **Reusable as-is** | `ecosystem_verticals` + the single shared `ecosystemPreviewPage` handler is the current `/send` behavior. Building real NaijaSend means **replacing** that one row's routing (adding real `/send/*` sub-routes registered in `src/index.tsx` ahead of the generic preview catch, exactly as `/seller/*` already overrides the generic seller gateway pattern) |
| `shipments` table | 🔴 **Missing — must be created** | No trace anywhere |
| `driver_profiles` / `driver_vehicle_assignments` | 🔴 **Missing — must be created** | No trace anywhere |
| `pickup_jobs` / `delivery_jobs` | 🔴 **Missing — must be created** | No trace anywhere |
| `shipment_status_events` (ledger) | 🔴 **Missing — must be created** | No trace anywhere |
| Vehicle/logistics-provider marketplace (`logistics-vehicles.ts`, vehicle listings) | 🔴 **Missing — must be created** | No trace anywhere |
| `/api/logistics/*`, `/api/drivers/*` routes | 🔴 **Missing — must be created** | No trace anywhere |
| i18n keys for driver/logistics/tracking UI | 🔴 **Missing — must be created** | `TranslationDict` (`src/i18n/types.ts`) has zero driver/logistics/shipment keys currently — the inherited summary's claim of pre-existing `driver_jobs_heading` etc. from "an earlier Stage 6a session" **does not match this repository** |

## 4. What This Means for Planning

This is a **greenfield build**, not a resume-from-Item-6 continuation. The
original Lifecycle-A prompt's Items 1–5 (schema design, migration, the 4
backend files: `drivers.ts`, `shipments.ts`, `api-drivers.ts`,
`api-logistics.ts`) are **not done** — they need to be designed and written
from scratch against this actual codebase's conventions (the `vendors`/
`seller_payout_accounts` migration style, the `requireAuthPage`/
`requireActiveSeller` middleware pattern, the existing `addresses`/
`nigerian_states` tables) before Items 6–15 (the UI/workflow layer) can mean
anything.

The strategic upside: this repo's existing patterns (verification state
machines, ledger+cache, ownership-scoped queries, `ecosystem_verticals`
routing override) are genuinely good precedents to build Lifecycle-A on.
Nothing here needs to be invented from nothing — the *architecture* is
already Lifecycle-A-shaped, just not yet the *tables and routes themselves*.

## 5. Recommended Next Step

Do not start writing Lifecycle-A code in this same message/session. Per the
adopted SOP: create a named checkpoint tag for "last state before NaijaSend
build starts" (this current `b32a16a` state already has a checkpoint tag —
`naijadeals-sop-checkpoint-2026-09-12` — so it can double as this marker, or
a fresh `naijasend-lifecycle-a-before-build` tag can be added for clarity),
then produce a **short schema + route design doc** for Items 1–5 (mirroring
the `0009_seller_portal.sql` documentation style) for review before writing
any migration file — given how much was lost building UI on assumed
backend contracts last time, get the contract agreed first.

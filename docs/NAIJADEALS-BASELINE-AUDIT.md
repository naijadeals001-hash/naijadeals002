# NaijaDeals — Complete Baseline Audit

**Audit type:** Phase 0 / Phase 2 combined, read-only, evidence-based.
**Audit date:** 2026-09-12
**Auditor scope:** This sandbox's local repository (`naijadeals001-hash/naijadeals002`, branch `main`), its remote GitHub state, and read-only live HTTP probes of production endpoints.
**Baseline commit at start of audit:** `ca40f936e3533ec0b7b86c9498bb455fe784cb05` (tag `naijadeals-bootstrap-repair-complete-2026-09-12`)
**Repository change made by this audit:** creation of this single file, `docs/NAIJADEALS-BASELINE-AUDIT.md`. No application code, migration, seed data, or configuration was modified, per the explicit read-only restriction governing this checkpoint.

> **Evidentiary standard used throughout this document:** every claim below is backed by a specific file path, line reference, grep/find result, migration name, or live HTTP response captured during this audit. Where evidence was insufficient to confirm or deny a capability, it is marked **UNKNOWN** rather than assumed. "Exists" is never inferred from a filename, route name, or prior prompt alone — each capability is independently checked for UI / API / DATABASE / BUSINESS LOGIC / INTEGRATION / TEST / BROWSER VERIFICATION / PRODUCTION VERIFICATION as distinct, non-interchangeable facts.

---

## 1. Executive Summary

NaijaDeals, as it exists in **this sandbox's local repository**, is a single-vertical (NaijaShop) e-commerce marketplace MVP built on Hono + Cloudflare D1, with a working — if partial — Seller Portal foundation, a real Nigerian-market checkout/wallet/order flow, and a well-designed (but not yet content-populated) 8-vertical "Ecosystem Preview" placeholder system plus a 50-country/10-language i18n architecture. The codebase is disciplined: ownership checks are server-resolved, money is integer kobo, migrations are schema-only, and unimplemented features are honestly labeled "coming soon" rather than faked. 17 pre-existing TypeScript errors and zero formal test framework are known, disclosed gaps.

**The single most important finding of this audit is not about this repository's own code quality — it is that this repository is demonstrably not the source of what is running in production.** Live probing of `https://naijadeals.com/api/version` (and independently, the Genspark-hosted deployment URL `https://393ef41c-f7b9-4ded-996a-2f5265e3280d.vip.gensparksite.com/api/version`) both report:
- `git_sha: 99b1664df552ce1cd707330e17207d8869f12a4e` — confirmed via `git cat-file -e` to **not exist anywhere in this repository's local git history**, and confirmed via GitHub's own API (`gh api repos/.../commits/99b1664d...` → HTTP 422 "No commit found") to **not exist anywhere on the `origin` remote either**.
- 36 applied migrations (`0001` through `0036`, `in_sync: true`), naming real schema for a Control Center, Integration Hub, Affiliate system, Booking Engine, provider identity/verification RBAC, Maps/GPS foundation, polymorphic reviews, and genuine NaijaSend logistics/driver/shipment/vehicle-marketplace tables — against this local repository's 12 migrations (`0001`–`0012`).
- Live-fetched HTML for `/send`, `/fresh`, `/eats`, `/gigs`, `/stay` on production shows vertical-specific `<title>`/meta-description copy that is materially different from — and in the case of `/send`, structurally incompatible with — this repository's single shared `ecosystemPreviewPage` handler (36 lines, `src/pages/ecosystem-preview.tsx`).

This means: **the "baseline" this audit is measuring only describes what exists in the git history this sandbox has access to.** It does **not** describe what a real visitor to `naijadeals.com` sees today, which is running unidentified, unrecovered code approximately 24 migrations ahead of this repository. Root cause is not yet determined (see §3 and §33). This audit proceeds on the honest basis that its Gap Matrix, Roadmap, and every vertical/shared-system finding describe **this local repository only**, and flags every section where that scope limitation materially matters.

---

## 2. Repository Baseline

| Item | Value | Evidence |
|---|---|---|
| Repository | `naijadeals001-hash/naijadeals002` | `git remote -v` |
| Branch | `main` (only branch, local and remote) | `git branch -a`, `gh api .../branches` |
| Local HEAD | `ca40f936e3533ec0b7b86c9498bb455fe784cb05` | `git rev-parse HEAD` |
| Remote HEAD (`origin/main`) | `ca40f936e3533ec0b7b86c9498bb455fe784cb05` (matches) | `git ls-remote origin refs/heads/main`, `gh api .../branches` |
| Working tree at audit start | Clean (`git status --porcelain` empty) | direct check |
| Migrations present locally | 12 (`0001`–`0012`) | `ls migrations/*.sql` |
| Tags | `naijadeals-bootstrap-repair-complete-2026-09-12` → `ca40f93`; `naijadeals-sop-checkpoint-2026-09-12` → `316031...` | `git show-ref` |
| `npm run build` | PASS (per prior-turn verified run; unchanged this turn, no code touched) | prior session evidence, re-confirmed no diff |
| `npx tsc --noEmit` | 17 errors, all pre-existing, all in `src/routes/api-catalog.ts` (D1 `.all()` typing) | ran this turn, verbatim tail captured |
| Test framework installed | None (`node_modules/.bin` has only `playwright`/`playwright-core`) | `ls node_modules/.bin \| grep -iE "jest\|vitest\|mocha\|playwright"` |
| Package scripts | `dev`, `build`, `preview`, `deploy`, `cf-typegen` only — **no** `db:migrate:*`/`db:seed`/`test` convenience scripts | `cat package.json` |
| Dependencies | `hono@^4.13.5` only (runtime) | `cat package.json` |

---

## 3. Git/GitHub State

**Local/remote self-consistency: CONFIRMED IN SYNC.**
- `git rev-parse HEAD` = `ca40f936e3533ec0b7b86c9498bb455fe784cb05`
- `git ls-remote origin refs/heads/main` = `ca40f936e3533ec0b7b86c9498bb455fe784cb05` (exact match)
- `gh api repos/naijadeals001-hash/naijadeals002/branches` → `main` commit `ca40f936e3533ec0b7b86c9498bb455fe784cb05` (exact match, independent confirmation via GitHub's own API, not just `git`)
- Working tree clean at audit start; only one branch exists locally and remotely; no stash entries; reflog is a clean linear history back through the bootstrap-repair commits to the original `clone` event (`b1fb48f`).
- Recent commit history (`git reflog`, newest first): `ca40f93` (bootstrap doc), `93b6e61` (seed-dev-account.sql), `89c2558` (0005 schema-only fix), `73ea663` (NaijaSend Lifecycle-A design doc), `a9ba93e` (NaijaSend Foundation Readiness Report), `b32a16a` (SOP checkpoint correction), `bd43c0f` (SOP adoption), `b1fb48f` (clone).

**⚠️ CRITICAL CAVEAT — this "in sync" result is necessary but NOT sufficient evidence that GitHub `main` is what's deployed.** It only proves this repo's local and remote refs agree with each other. It says nothing about what Cloudflare/Genspark is actually serving. See §33 for the full divergence finding — production is running a commit (`99b1664d...`) that:
- Does not exist in local `git log --all`
- Does not exist on the GitHub remote (`gh api` returns HTTP 422 "No commit found for SHA")
- Is dated `2026-09-11T18:15:24Z` per `/api/version`'s `build_time` — **after** several of this repository's own bootstrap-repair commits but the migration list it reports (36 files, ending in NaijaSend vehicle-marketplace work) has no corresponding commit anywhere this audit could find on `origin`.

**Conclusion: GitHub `origin/main` and the running production application are two different codebases as of this audit.** The GitHub repo is internally consistent and matches this sandbox exactly; it is not, however, provably the source of `naijadeals.com`.

---

## 4. Architecture Overview

The repository documents its own intended architecture in `docs/NAIJADEALS_MASTER_ARCHITECTURE.md` (640 lines, dated 2026-08-31): **9 "current" verticals** (NaijaShop, NaijaFresh, NaijaEats, NaijaGigs, NaijaStay, NaijaDrive, NaijaSend, NaijaStream, Aura AI) sitting on **15 "Core Shared Engines"** (Identity, Marketplace, Service, Booking, Logistics, Mobility, Payment & Finance, Trust/Safety/Review, Communication, Content & Media, Search & Discovery, Promotion & Advertising, Analytics, AI/Aura, Admin/Operations), plus **12 "reserved" future verticals** not authorized to build (NaijaPay, NaijaHealth, NaijaAuto, NaijaHomes, NaijaTravel, NaijaEvents, NaijaFarm, NaijaLearn, NaijaJobs, NaijaHome, NaijaBeauty, and one more per the doc's own count).

**This document is itself a piece of audit evidence, not a source of truth to take on faith** — it is dated 2026-08-31, describing an "exists today" state consistent with roughly migrations `0001`–`0009` of this local repo. Its explicit conclusions (Service Engine, Booking Engine, Mobility Engine, Analytics Engine, Admin/Operations Engine do not exist; Search is ad-hoc `LIKE`; Trust is embedded not standalone; AI/Aura has zero implementation) were **independently re-verified by this audit via direct grep/find against the current local repo** (§7, §17–29) and found to still hold true **for this local repository**. They do **not** hold true for whatever is running in production, where migration names (`0024_booking_engine_foundation.sql`, `0023_integration_hub.sql`, `0013_control_center_foundation.sql`, `0026_maps_gps_foundation.sql`) imply several of these "does not exist" engines now have real schema — a state this local repo's architecture document has no record of.

**Actual local implementation architecture (verified this audit):**
- **Runtime**: Hono 4.13.5 on Cloudflare Workers, JSX SSR (`hono/jsx`), no client framework — vanilla `public/static/app.js` (1,407 lines) handles all client interactivity.
- **Data**: D1 (SQLite) only. No KV, no R2 usage despite an R2 binding being declared (`SELLER_UPLOADS`) — see §31/§33.
- **8 route files** in `src/routes/` (1,140 total lines) + 1 placeholder SVG-generator route + 1 version endpoint.
- **15 files** in `src/lib/` (1,723 total lines) implementing all business logic — auth, cart, catalog, orders, wallet, seller, addresses, coupons, ecosystem-verticals/waitlist, wishlist, paystack, money, homepage-feed, hero-campaigns, guest.
- **12 page handlers** in `src/pages/`, **9 reusable components** in `src/components/`.
- **i18n**: a dedicated `src/i18n/` module (7 files + 10 translation dictionaries) — genuinely decoupled from country (see §21).
- One shared multi-tenant placeholder pattern (`ecosystemPreviewPage`) serves 8 of 9 verticals; only NaijaShop has a real, distinct implementation locally.

---

## 5. Database Inventory (local repository only)

**12 migrations, 30 distinct tables created, 77 index/unique-constraint statements, 48 FK/REFERENCES statements** (counts from direct `grep` against `migrations/*.sql`).

| Migration | Type | Tables created / altered |
|---|---|---|
| `0001_initial_schema.sql` | Schema | `users`, `sessions`, `addresses`, `categories`, `vendors`, `products`, `reviews`, `carts`, `cart_items`, `orders`, `order_items`, `wallet_ledger`, `wallet_accounts`, `payment_transactions`, `newsletter_subscribers` |
| `0002_marketplace_depth.sql` | Schema | `brands`, redefines `products`, `product_listings` (buy-box), `product_variants`, redefines `reviews`, `product_questions`, redefines `cart_items`/`order_items`, `wishlists`, `coupons`, `saved_payment_methods`, `homepage_feed_cache` |
| `0003_review_avatars.sql` | Additive | `ALTER TABLE reviews ADD COLUMN avatar_url` |
| `0004_checkout_depth.sql` | Additive | `ALTER TABLE orders ADD COLUMN delivery_method / coupon_code / discount_kobo` |
| `0005_account_experience.sql` | Schema (repaired, now schema-only per commit `89c2558`) | `notifications` |
| `0006_brand_merchandising.sql` | Additive | `ALTER TABLE brands ADD COLUMN is_featured / display_order / status` |
| `0007_address_book_depth.sql` | Schema | `nigerian_states` (reference data) |
| `0008_hero_campaigns.sql` | Schema | `hero_campaigns` |
| `0009_seller_portal.sql` | Schema | `vendors` bridge columns, `nigerian_banks` (reference), `seller_payout_accounts`, `seller_payout_account_audit`, `seller_finance_accounts` |
| `0010_ecosystem_verticals.sql` | Schema | `ecosystem_verticals`, `ecosystem_vertical_features`, `ecosystem_waitlist` (legacy, single-email) |
| `0011_ecosystem_waitlist.sql` | Schema | `ecosystem_waitlist_signups` (new, richer, coexists with 0010's table) |
| `0012_locale_preference.sql` | Additive | `ALTER TABLE users ADD COLUMN preferred_language` |

**Orphaned/unused-table findings (evidence-based):**
- `seller_finance_accounts` (0009) has a schema but **no application code reads or writes it** — `src/lib/payouts.ts` and `src/lib/seller-finance.ts`, both referenced by name in the migration's own comments, **do not exist** in `src/lib/` (confirmed via `ls src/lib/`). **PLACEHOLDER / BLOCKED** maturity.
- `seller_payout_accounts` / `seller_payout_account_audit` (0009): same finding — schema exists, zero consuming application code found via grep.
- `ecosystem_waitlist` (0010, legacy) coexists with `ecosystem_waitlist_signups` (0011) — both have live consuming code (`ecosystem-verticals.ts`'s `addToVerticalWaitlist()` vs `ecosystem-waitlist.ts`'s `upsertWaitlistSignup()`), confirmed a genuine **duplicate architecture** case (§32), not simply an orphan.
- `saved_payment_methods` (0002): consumed only by `seed-dev-account.sql`'s fixture rows and displayed in `wallet.tsx`'s history view; no route in `src/routes/` creates/updates a row — **PARTIAL** (UI display exists, no write API found).
- `homepage_feed_cache` (0002): named as a cache table; `src/lib/homepage-feed.ts` (103 lines) was not fully read this audit for its exact read/write behavior against this table — flagged **UNKNOWN**, not claimed either way.

**wrangler.jsonc's `database_id`** is explicitly a placeholder (`00000000-0000-0000-0000-000000000000`) per its own inline comment — confirms local dev has never been pointed at a real production D1 instance from this sandbox's own tooling.

---

## 6. API Inventory (local repository only)

**11 route files, 1,140 total lines.** Full route registration (from `src/index.tsx`, confirmed via grep of every `app.*` call):

| Path prefix / route | Handler file | Auth |
|---|---|---|
| `/api` (version) | `version.ts` | None (public) |
| `/api/catalog/*` | `api-catalog.ts` | Mixed (some public, contains the 17 tsc errors) |
| `/api/cart/*` | `api-cart.ts` | Guest-cookie-aware, not `requireAuth`-gated |
| `/api/auth/*` | `api-auth.ts` | Self (login/register/logout) |
| `/api/orders/*` | `api-orders.ts` | `requireAuth` (global `.use('*', requireAuth)`) |
| `/api/addresses/*` | `api-addresses.ts` | `requireAuth` (global) |
| `/api/wallet/*` | `api-wallet.ts` | `requireAuth` (global) |
| `/api/webhooks/*` | `api-webhooks.ts` | Paystack-signature-verified (not session auth) |
| `/api/wishlist/*` | `api-wishlist.ts` | `requireAuth` (global) |
| `/api/ecosystem/*` | `api-ecosystem.ts` | Public (waitlist signup, explicitly documented as intentionally public) |
| `/api/i18n/*` | `api-i18n.ts` | Public (22 lines, locale switch) |
| `/ph.svg` | `placeholder.ts` | Public (SVG generator, zero DB/network dependency) |

**Ownership enforcement pattern (verified):** every authenticated route resolves ownership server-side via `c.get('user')!.id` (set by `attachUser` middleware reading the session cookie) — never trusts a client-supplied user/vendor ID. Confirmed directly in `api-addresses.ts`, `api-orders.ts`, `api-wallet.ts`, `api-wishlist.ts`.

**APIs that exist but are NOT connected to real UI (orphaned-from-frontend, evidence-based):**
- No route consumes `seller_finance_accounts`/`seller_payout_accounts` — the Seller Finance page (`seller-stubs.tsx`'s `sellerFinancePage`) renders the vendor's real data fields that DO exist on `vendors`, but nothing exposes payout-account management. **PLACEHOLDER.**
- `SELLER_UPLOADS` R2 binding (declared in `wrangler.jsonc` and `src/types.ts`) has **zero** route implementation anywhere — confirmed via `grep -r "R2\|SELLER_UPLOADS" src/routes/` returning no route-level usage. **NOT IMPLEMENTED.**

**API idempotency/concurrency:** confirmed evidence of intentional design in two places — `ecosystem-waitlist.ts`'s `upsertWaitlistSignup()` uses `ON CONFLICT(email) DO UPDATE ... MAX()` merge (idempotent, race-safe via DB constraint, not SELECT-then-branch), and `wallet.ts`'s ledger writes use `db.batch()` for atomic ledger+cache updates. No explicit idempotency-key pattern was found for order/payment creation in the code read this audit — **UNKNOWN**, would need a dedicated read of `api-orders.ts`'s POST handler and `paystack.ts` to confirm double-submit protection, which was not completed to full-line-level this audit.

---

## 7. Shared Systems Audit

For each shared system: (1) exists? (2) where? (3) which verticals use it? (4) genuinely shared? (5) duplicates? (6) production-grade? (7) tested? (8) browser verified? (9) preserve/extend/replace?

| System | Exists (local)? | Where | Verticals using it | Genuinely shared | Duplicates found | Prod-grade | Tested | Browser verified | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| **Authentication** | YES | `src/lib/auth.ts` (201 lines): PBKDF2/SHA-256/100k iter, session cookie | All (only NaijaShop has consuming pages) | Yes — single implementation | None found | Reasonable crypto choices; no rate-limiting/lockout found (UNKNOWN — not explicitly checked) | No automated test found | Manually verified via curl login in prior bootstrap-repair session | **KEEP / EXTEND** (add rate limiting before scale) |
| **Identity (RBAC)** | PARTIAL | `users.role` column exists; **zero enforcement code** | None functionally | N/A — dead column | N/A | NOT PRODUCTION-GRADE — `requireAdmin` does not exist | No | No | **BUILD** |
| **Seller architecture** | YES | `vendors` table (0009) + `src/lib/seller.ts` (101 lines, 6-state machine) + `SellerLayout.tsx` (honest `implemented` flags) | NaijaShop only | Designed to be reusable (state-machine pattern explicitly documented for future logistics providers) but not yet reused | None yet — but a "provider identity" duplicate is implied by production's separate `0025_provider_identity_foundation.sql`, which this local repo has no trace of | PARTIAL — onboarding/verification real; finance/payout layer is schema-only | No | Not confirmed | **EXTEND** |
| **Provider architecture** (non-seller: gigs/logistics/hospitality providers) | NOT IMPLEMENTED locally | — | None | N/A | Production has `0025_provider_identity_foundation.sql`, `0029_provider_verification_rbac.sql` — local repo has neither | N/A | N/A | N/A | **BUILD** (or reconcile with production first) |
| **Customer architecture** | YES | `users` + `attachUser`/`requireAuthPage` | NaijaShop | Yes | None | Reasonable | No | No | **KEEP** |
| **Control Center** | NOT IMPLEMENTED locally | — (confirmed via `find src -iname "*control*"` empty) | None | N/A | Production has `0013_control_center_foundation.sql` | N/A | N/A | N/A | **BUILD** (or reconcile) |
| **Integration Hub** | NOT IMPLEMENTED locally | — (confirmed via `find`/`grep` empty) | None | N/A | Production has `0023_integration_hub.sql` | N/A | N/A | N/A | **BUILD** (or reconcile) |
| **Africa/Country Engine** | YES | `src/i18n/countries.ts` (144 lines, ~50 countries) | Architecture-level, not yet vertical-consumed | Yes, cleanly separated from language | None | Well-designed but unused beyond locale suggestion | No | No | **KEEP / EXTEND** |
| **i18n/locales** | YES | `src/i18n/*` (7 files) + 10 translation dicts | Layout/header only observed as consuming translations | Yes | None | 10 "live" dicts are AI-generated, explicitly marked `reviewed: false` except `en` | No | No | **EXTEND** (native-speaker review before claiming production quality) |
| **Catalog** | YES | `src/lib/catalog.ts` (222 lines), `products`/`product_listings`/`product_variants` | NaijaShop | Yes | None locally | Real buy-box logic | No | No | **KEEP** |
| **Listings (buy box)** | YES | `product_listings` table, `product.tsx`'s Compare Sellers UI | NaijaShop | Genuinely multi-seller | None | Real | No | Manually described in prior session, not re-verified this turn | **KEEP** |
| **Search** | PARTIAL | `shop.tsx`'s dynamic WHERE-builder — confirmed ad-hoc filter/sort, not a search engine (no full-text index, no relevance ranking found) | NaijaShop | N/A | N/A | Adequate for MVP catalog size, not scalable | No | No | **EXTEND / REPLACE** at scale |
| **Cart** | YES | `src/lib/cart.ts` (209 lines), `cart_items` keyed by row id not product id (multi-seller-aware) | NaijaShop | Yes | None | Real | No | No | **KEEP** |
| **Checkout** | YES | `checkout.tsx` (342 lines, 4-step wizard) + `api-cart.ts`/`api-orders.ts` | NaijaShop | Yes | None | Real, supports Buy-Now + cart flows | No | No | **KEEP** |
| **Orders** | PARTIAL | `src/lib/orders.ts` (173 lines) | NaijaShop | Yes | None | **Backend lifecycle stops at `processing`/`escrow_held`** — `shipped/delivered/completed/cancelled/refunded` are UI labels the backend never reaches (confirmed via `orders.tsx`'s `STATUS_LABEL` map vs `confirmOrderPayment()`'s actual transitions, per prior-session evidence, not re-derived from scratch this turn but consistent with this turn's read of `orders.tsx`) | No | No | **EXTEND** (finish lifecycle) |
| **Payments** | PARTIAL | `src/lib/paystack.ts` (77 lines) + wallet | NaijaShop | Yes | None locally | Wallet-only checkout works per README's own disclosure; Paystack requires an unconfigured secret (`PAYSTACK_SECRET_KEY`) — returns HTTP 503 until set, per README | No | No | **EXTEND** (configure + verify live) |
| **Wallet** | YES | `src/lib/wallet.ts` (108 lines) — append-only ledger + cached balance, `db.batch()` atomic updates | NaijaShop | Yes | None | Real, sound pattern | No | No | **KEEP** |
| **Bookings** | NOT IMPLEMENTED | — confirmed absent (no `bookings` table in local migrations, no booking logic in `src/lib/`) | None (would serve Gigs/Stay/Drive) | N/A | Production has `0024_booking_engine_foundation.sql` | N/A | N/A | N/A | **BUILD** (or reconcile) |
| **Reviews** | PARTIAL | `reviews` table (0001/0002), rendered on PDP | NaijaShop only, tied to `product_id` — **not polymorphic** (can't review a vendor, a booking, a driver) | Not yet — single-purpose | Production has `0027_polymorphic_reviews_foundation.sql` — a generalized system this repo lacks | Real for its narrow scope | No | No | **REFACTOR** (generalize before other verticals need reviews) |
| **Messaging** | NOT IMPLEMENTED | Only mentioned in `help.tsx`'s static FAQ prose ("dispute" text) — zero functional chat/dispute system | None | N/A | N/A | N/A | N/A | N/A | **BUILD** |
| **Notifications** | PARTIAL | `notifications` table (0005) exists, no route found generating them beyond fixture seed data | NaijaShop (display only) | Unclear | N/A | Table-only, no generation logic confirmed | No | No | **EXTEND / BUILD** |
| **Logistics** | NOT IMPLEMENTED | — confirmed absent locally. NaijaSend design docs exist (`NAIJASEND-LIFECYCLE-A-DESIGN.md`, 384 lines) but are explicitly DRAFT, pre-implementation, and now **known to be stale relative to production**, which already has `0015`/`0016`/`0019`/`0020`/`0035`/`0036` NaijaSend migrations this design doc's authors had no visibility into | Would serve NaijaSend, potentially NaijaEats/NaijaDrive | N/A | Production likely has a real logistics system already (`/api/logistics` returns 401 — exists, auth-gated, not 404) | N/A | N/A | N/A | **DO NOT BUILD FROM THE STALE LOCAL DESIGN DOC** — reconcile with production first (see §33) |
| **GPS/Maps** | NOT IMPLEMENTED | — confirmed absent | Would serve NaijaSend/NaijaDrive/NaijaGigs | N/A | Production has `0026_maps_gps_foundation.sql` | N/A | N/A | N/A | **BUILD** (or reconcile) |
| **Media** | PARTIAL | `HeroCarousel.tsx` (288 lines, fully DB-driven), `ProductCard.tsx`, SVG placeholder generator | NaijaShop | Yes | None | Real, no fabricated content | No | No | **KEEP** |
| **AI (Aura)** | NOT IMPLEMENTED | `/aura` is a "coming soon" ecosystem-preview page only; zero AI/LLM integration code found anywhere in `src/` | None | N/A | N/A | N/A | N/A | N/A | **BUILD** |
| **Affiliates** | NOT IMPLEMENTED | — confirmed absent (no `affiliate` table/file locally) | None | N/A | Production has `0017_affiliate_foundation.sql`, `0018_affiliate_account_state.sql` | N/A | N/A | N/A | **BUILD** (or reconcile) |
| **Promotions** | PARTIAL | `coupons` table + `src/lib/coupons.ts` (55 lines) | NaijaShop | Yes | None | Real but narrow (single coupon-code model, no campaign/tiered promo engine) | No | No | **EXTEND** |
| **CRM** | NOT IMPLEMENTED | — confirmed absent | None | N/A | N/A | N/A | N/A | N/A | **BUILD** |
| **Analytics** | NOT IMPLEMENTED | Referenced only as a disabled "Coming soon" nav item in `SellerLayout.tsx` | None functionally | N/A | N/A | N/A | N/A | N/A | **BUILD** |
| **Trust & Safety** | PARTIAL/COSMETIC | Footer has static "Trust & Safety" badges (`Layout.tsx`) with no functional backing | None functionally | N/A | N/A | Cosmetic only | No | No | **BUILD** |
| **Admin** | NOT IMPLEMENTED | Confirmed via `find src -iname "*admin*"` → empty. `/admin` footer link is a copy/paste "Careers" mislabel, not a real route | None | N/A | N/A | N/A | N/A | N/A | **BUILD** |
| **API architecture** | YES | Hono route-file-per-domain pattern, consistent | All local | Yes | None | Reasonably consistent | Partial (17 tsc errors in one file) | No | **KEEP** |
| **Database architecture** | YES | D1/SQLite, schema-only migrations, integer-kobo money | All local | Yes | See duplicate waitlist tables (§32) | Sound discipline | No | No | **KEEP** |
| **Migration system** | YES | `wrangler d1 migrations apply`, numbered files in `migrations/` | All | Yes | N/A | Known footgun already fixed once (auto-scan of any `.sql` in the dir, hence `seed-dev-account.sql` living at root) | Verified via full wipe-and-reapply in prior session | Yes (prior session) | **KEEP** |
| **Testing framework** | NO formal framework | Only `scripts/*.cjs` hand-written Node assertion scripts + Playwright installed but usage not fully confirmed this audit | N/A | N/A | N/A | Not production-grade test coverage | See §29 | Partial | **BUILD** |
| **Build system** | YES | Vite + `@hono/vite-build`, `vite.config.ts` bakes `__GIT_SHA__`/`__EXPECTED_MIGRATIONS__` | All | Yes | None | Sound, clever self-verification design | Verified (`npm run build` passes) | N/A | **KEEP** |
| **Deployment** | PARTIAL/CONTRADICTORY | See §30 | All | N/A | See §33 divergence | Documented contradiction in README itself | N/A | N/A | Resolve contradiction, see §33 |
| **Cloudflare/D1** | YES (config), UNKNOWN (real binding) | `wrangler.jsonc` | All | Yes | N/A | `database_id` is a placeholder locally | N/A | N/A | **KEEP config pattern, VERIFY real binding** |
| **Environment/configuration** | PARTIAL | `PAYSTACK_SECRET_KEY`, `PAYOUT_ENCRYPTION_KEY` referenced in code/types, not confirmed set anywhere locally | All | Yes | N/A | Unconfigured secrets = degraded functionality (Paystack 503) | N/A | N/A | **EXTEND** |
| **Assets** | YES | `public/static/` (CSS, JS, favicon); SVG placeholder generator for products | All | Yes | None | Deliberate zero-licensing-risk design | N/A | N/A | **KEEP** |
| **Seed data** | YES | `seed.sql` (507 lines) + `seed-dev-account.sql` (127 lines, root-level by design) | NaijaShop | Yes | None (already fixed from a real duplicate/misplacement bug) | Verified idempotent | Verified via double-run in prior session | Yes | **KEEP** |
| **Scripts** | PARTIAL | `scripts/*.cjs` (6 files, 89–373 lines each) + `gen_seed.py` (598 lines) | Deployment verification, seed generation | Yes | None | Ad-hoc verification scripts, not a test suite | See §29 | Partial | **EXTEND** into formal tests |
| **Git/GitHub workflow** | YES | commit+push+verify SOP (`ENGINEERING-SOP-BACKUP-RULE.md`), annotated tags | All | Yes | None | Disciplined, evidenced by this session's own bootstrap-repair work | N/A | N/A | **KEEP** |

---

## 8. NaijaShop Audit

The only vertical with a real, distinct local implementation.

- **A. Customer pages**: `/`, `/shop`, `/shop/:slug`, `/cart`, `/checkout`, `/checkout/callback`, `/login`, `/register`, `/orders`, `/orders/:orderNumber`, `/wallet`, `/account/wishlist`, `/account/addresses`, `/help` — all confirmed registered in `src/index.tsx`.
- **B. Customer APIs**: `/api/catalog/*`, `/api/cart/*`, `/api/orders/*`, `/api/wallet/*`, `/api/wishlist/*`, `/api/addresses/*`, `/api/auth/*` — all confirmed present with line counts in §6.
- **C. Customer database**: `users`, `products`, `product_listings`, `product_variants`, `carts`/`cart_items`, `orders`/`order_items`, `wallet_accounts`/`wallet_ledger`, `wishlists`, `addresses`, `reviews`, `product_questions`, `coupons`, `saved_payment_methods`.
- **D. Customer business logic**: real — buy-box comparison, cart multi-seller grouping, 4-step checkout with live recalculation, integer-kobo money throughout (`src/lib/money.ts`).
- **E–H. Provider/vendor functionality**: real, see Seller Portal in §7. `/seller`, `/seller/onboarding`, `/seller/dashboard`, `/seller/products`, `/seller/orders`, `/seller/finance` all registered and gated by `requireActiveSeller`. `customers`/`analytics`/`promotions`/`store`/`settings` nav items are honestly disabled (`implemented: false` in `SellerLayout.tsx`), never fake pages.
- **I/J. Admin**: **NOT IMPLEMENTED.** No admin route, no admin API, `users.role='admin'` unused.
- **K. Payments**: Wallet functional; Paystack code exists but secret unconfigured (503 per README).
- **L. Orders**: Lifecycle stops at `processing`/`escrow_held` — see §7 Orders row.
- **M. Reviews**: Real, product-scoped only, computed rating distribution (not fabricated).
- **N. Messaging**: None beyond static FAQ text.
- **O. Notifications**: Table + display exist; generation logic UNKNOWN.
- **P/Q. Logistics/GPS**: None for NaijaShop (delivery is address-only, no live tracking).
- **R. Search**: Ad-hoc filter/sort in `shop.tsx`, no relevance ranking.
- **S. Analytics**: None (Seller nav item disabled).
- **T. Assets**: Real product images + SVG fallback generator.
- **U. i18n**: Header/footer strings pass through the i18n layer per `Layout.tsx`'s language selector; page-body copy translation coverage not verified line-by-line this audit — UNKNOWN extent.
- **V. Tests**: None formal; `scripts/verify_*.cjs` cover deployment/mobile-menu/signup-fork/ecosystem-preview smoke checks only.
- **W. Browser verification**: Confirmed done in prior sessions via Playwright-driven responsive smoke tests (per `DEPLOYMENT.md`'s Gate 8) — not re-run this audit (read-only).
- **X. Deployment status**: See §30/§33 — local code is NOT confirmed to be what's live.

**Classification: KEEP.** Maturity: **PARTIAL** (core shop flow complete; order lifecycle, admin, search, and seller-finance layers are gaps).

---

## 9. NaijaFresh Audit

- **A–X**: `/fresh` registered locally only as `ecosystemPreviewPage` (shared handler, `src/pages/ecosystem-preview.tsx`). Zero NaijaFresh-specific table, route, or business logic exists locally (confirmed via `grep -ri "fresh" src/` returning only the ecosystem-preview vertical-row lookup and nav labels).
- **Production evidence** (out of local-repo scope but relevant): `naijadeals.com/fresh` returns distinct copy ("Order fresh fruits, vegetables, meat, fish, grains...") and production's migration list includes `0031_naijafresh_categories.sql` — implying real category schema exists in production that this repo has no trace of.

**Classification: BUILD** (locally). Maturity: **NOT IMPLEMENTED** (local); **UNKNOWN, possibly PARTIAL/COMPLETE** (production — unverified, see §33).

---

## 10. NaijaEats Audit

- Same pattern as NaijaFresh: `/eats` = shared `ecosystemPreviewPage` locally, zero NaijaEats-specific schema/logic.
- Production migrations `0032_naijaeats_foundation.sql`, `0033_naijaeats_imagery.sql` and `0028_gigs_stay_customer_activation.sql` suggest real activation logic exists in production this repo has no record of. Production's `/eats` HTML shows distinct restaurant-marketplace copy ("Discover authentic African dishes, restaurants and food vendors...").

**Classification: BUILD** (locally). Maturity: **NOT IMPLEMENTED** (local); **UNKNOWN** (production).

---

## 11. NaijaGigs Audit

- `/gigs` = shared `ecosystemPreviewPage` locally. Zero gigs-specific schema.
- Production has `0028_gigs_stay_customer_activation.sql`, `0029_provider_verification_rbac.sql`, `0030_gigs_marketplace_imagery.sql` — strongly implying a real provider-marketplace exists in production. Production's `/gigs` copy references "verified home repair, cleaning, tutoring, design, events, tech-support and beauty providers."

**Classification: BUILD** (locally). Maturity: **NOT IMPLEMENTED** (local); **UNKNOWN** (production).

---

## 12. NaijaStay Audit

- `/stay` = shared `ecosystemPreviewPage` locally. Zero booking/hospitality schema.
- Production has `0034_naijastay_foundation.sql` plus the shared `0024_booking_engine_foundation.sql`. Production's `/stay` copy references "hotels, apartments, villas, resorts, guesthouses and unique stays."

**Classification: BUILD** (locally). Maturity: **NOT IMPLEMENTED** (local); **UNKNOWN** (production).

---

## 13. NaijaDrive Audit

- `/drive` = shared `ecosystemPreviewPage` locally, explicitly still "Coming Soon" **even in production** — production's own `<title>` reads "NaijaDrive — Vehicle Rentals & Mobility in Nigeria, Coming Soon," matching the generic preview pattern's tone.
- However, production's migration list includes `0035_naijasend_vehicle_marketplace.sql` and `0036_naijasend_vehicle_type_expansion.sql` — note these are filed under **NaijaSend** naming, not NaijaDrive, suggesting vehicle-marketplace schema may be logistics-fleet-oriented (trucks/vans for delivery) rather than consumer vehicle rental — this is an inference, not confirmed; flagged **UNKNOWN, needs clarification with Pat** before assuming overlap or conflict between NaijaDrive and NaijaSend's vehicle schema.
- Two NaijaDrive prompt files exist outside this repo per inherited context (`pasted-text-*.txt`) — explicitly deferred, untouched this session.

**Classification: BUILD.** Maturity: **NOT IMPLEMENTED** (local); production status **UNKNOWN but likely still preview-stage** based on its own "Coming Soon" title.

---

## 14. NaijaSend Audit

**This is the vertical with the most local design work AND the most severe local/production mismatch.**

- **Local**: `/send` = shared `ecosystemPreviewPage`. Two design documents exist: `docs/NAIJASEND-FOUNDATION-READINESS-REPORT.md` (164 lines) — correctly concluded, as of its writing, that logistics does not exist in this repo (0 tables, 0 files, 0 routes) — and `docs/NAIJASEND-LIFECYCLE-A-DESIGN.md` (384 lines) — a DRAFT schema/route design for migration `0013_naijasend_logistics.sql` covering `logistics_providers`, `vehicles`, `driver_profiles`, `driver_vehicle_assignments`, `shipments`, `pickup_jobs`, `delivery_jobs`, `shipment_status_events`. **Status: draft, pre-implementation, explicitly never migrated locally** (local migration `0013` does not exist — `0012` is the last local file).
- **Production**: reports `0015_naijasend_logistics_foundation.sql`, `0016_naijasend_driver_foundation.sql`, `0019_naijasend_shipment_foundation.sql`, `0020_naijasend_commerce_bridge.sql`, `0035_naijasend_vehicle_marketplace.sql`, `0036_naijasend_vehicle_type_expansion.sql` — a **different migration numbering and naming scheme** than the local design doc's own proposed `0013_naijasend_logistics.sql`. Production's `/send` page is a genuinely distinct rendered page (`<title>NaijaSend — Delivery Across Africa | NaijaDeals</title>`, referencing "delivery quotes," "track shipments," "register as a logistics partner") — not the shared preview template.
- `curl -I /api/logistics` on production → **401** (exists, auth-gated). `curl -I /api/shipments` → **401** (exists, auth-gated). `curl -I /api/send` → **404**.

**This local design doc must be treated as SUPERSEDED/STALE, not as a ready-to-implement spec.** Implementing `0013_naijasend_logistics.sql` as drafted would very likely create migration-numbering collisions and schema duplication against whatever is actually running in production under different migration numbers and possibly a different table design. **Do not implement this design until the production divergence (§33) is resolved.**

**Classification: BUILD is BLOCKED pending reconciliation, not a clean BUILD.** Maturity: **PLACEHOLDER/DESIGN-ONLY** (local); **UNKNOWN, likely PARTIAL-to-COMPLETE** (production).

---

## 15. NaijaStream Audit

- `/stream` = shared `ecosystemPreviewPage`, "Coming Soon" both locally and in production (`<title>NaijaStream — African Music, Movies & Creator Content, Coming Soon`). No corresponding migration name found in production's 36-migration list either (no `stream`/`media`/`content` migration visible).

**Classification: BUILD.** Maturity: **NOT IMPLEMENTED** (both local and, per available evidence, production).

---

## 16. Aura AI Audit

- `/aura` = shared `ecosystemPreviewPage`, "Coming Soon" both locally and in production (`<title>Aura AI — Your Intelligent NaijaDeals Shopping Companion, Coming Soon`). Zero AI/LLM code anywhere in `src/`. No AI-related migration name found in production's list.

**Classification: BUILD.** Maturity: **NOT IMPLEMENTED** (both local and, per available evidence, production).

---

## 17. RBAC/Security Audit

- `users.role` column exists (`0001_initial_schema.sql`) but is referenced only twice in `src/`: once fetched (never branched on) in `auth.ts`'s SELECT, once in a comment in `auth.tsx` confirming the Customer/Seller signup fork does NOT set it.
- No `requireAdmin` middleware exists (`src/lib/auth.ts` only exports `requireAuth`/`requireAuthPage`; `src/lib/seller.ts` only exports `requireActiveSeller`).
- `/admin` is never a registered route (`grep -n "'/admin'" src/index.tsx` → no match).
- Password hashing is sound (PBKDF2/SHA-256/100k iterations/16-byte salt, Web Crypto API — Workers-safe).
- Session tokens: cookie-based, `getSessionToken()`/`setSessionCookie()`/`clearSessionCookie()` confirmed to exist; no explicit CSRF-token mechanism found for state-changing POST routes — **UNKNOWN**, not fully verified this audit whether Hono's cookie `SameSite` setting alone is considered sufficient (would need a direct read of `setSessionCookie()`'s cookie options, which was read in a prior session but not re-verified line-by-line this turn).
- Production's `0029_provider_verification_rbac.sql` suggests a real RBAC layer exists in production that this repo has zero trace of.

**Classification: BUILD** (a real admin/RBAC layer). Maturity: **NOT IMPLEMENTED** (local).

---

## 18. Control Center Audit

- Zero implementation locally (`find src -iname "*control*"` empty).
- Production reports `0013_control_center_foundation.sql` — the very first migration number after this repo's own `0012`, suggesting production's fork point diverged from this repo almost immediately after the local `0012_locale_preference.sql` commit (`b1fb48f`'s clone point, or shortly after).

**Classification: BUILD** (locally) or **RECONCILE** (if production's Control Center should become this repo's baseline instead). Maturity: **NOT IMPLEMENTED** (local); **UNKNOWN** (production — schema confirmed to exist via migration name only, no content inspected).

---

## 19. Integration Hub Audit

- Zero implementation locally.
- Production reports `0023_integration_hub.sql`.

**Classification: BUILD or RECONCILE.** Maturity: **NOT IMPLEMENTED** (local); **UNKNOWN** (production).

---

## 20. Africa Engine Audit

- **YES, genuinely exists locally.** `src/i18n/countries.ts` (144 lines): ~50 African ISO-3166-1 countries mapped to `{countryCode, countryName, currency, availableLanguages, defaultLanguage}`. Explicit product rule (confirmed in code comments): country only ever narrows the *offered* language set, never dictates the default — `defaultLanguage` stays `'en'` unless a genuinely live dictionary exists for that country's dominant language (`getCountrySuggestedLanguage()` checks against `LIVE_LANGUAGES`).
- Currently consumed only by the i18n detector's country-signal step (priority 4 of 5 in `detector.ts`'s resolution chain) — not yet used to gate catalog/vertical availability by country (i.e., there's no "this product/vertical is only available in Nigeria" enforcement found).

**Classification: KEEP / EXTEND** (architecture is sound and genuinely Africa-wide; actual country-scoped business rules are not yet built on top of it). Maturity: **PARTIAL** (config layer COMPLETE, business-rule integration NOT IMPLEMENTED).

---

## 21. i18n Audit

- **Locales registered**: 13 total in `languages.ts`'s `LanguageCode` type (`en, pcm, ig, yo, ha, tw, sw, fr, pt, ar, rw, rn, am`) — but only **10 have populated dictionaries** (`en, pcm, ig, yo, ha, fr, ar, pt, sw, tw` — confirmed via `ls src/i18n/translations/`). `rw` (Kinyarwanda), `rn` (Kirundi), `am` (Amharic) are registered as `status: 'coming_soon'` with **no dictionary file** — by design, never served.
- **Translation file sizes**: `en.ts` 119 lines (canonical), others 106–109 lines each — meaning **non-English dictionaries are each ~10 lines/keys short of English's full key set**, an as-yet-unquantified gap (not confirmed which specific keys are missing without a line-by-line diff, which was not performed this audit — flagged **UNKNOWN, needs a proper missing-key audit**, not assumed to be trivial).
- **Review status honesty**: every non-English "live" dictionary is explicitly flagged `reviewed: false` in `languages.ts` — an AI-generated first draft, disclosed as such, not silently presented as production-quality translation. This is a genuine content-quality gap, not a coding gap.
- **Resolution chain** (from `detector.ts`, previously read in full): 5-step priority — `?lang=` query → logged-in `users.preferred_language` → guest `nd_lang` cookie → browser `Accept-Language` → Cloudflare `cf.country` signal → English default.
- **Currency/date/phone formatting**: `src/lib/money.ts` (33 lines) handles kobo formatting; no dedicated date/phone-formatting utility was found in `src/lib/` — **UNKNOWN/NOT IMPLEMENTED** for locale-aware date/phone display beyond whatever Nigeria-specific hardcoding exists in address forms.
- **Africa-wide expansion readiness**: the country/language separation architecture is genuinely extensible (confirmed), but content coverage (10 of ~50+ African languages, only Nigeria-specific banks/states reference data) means the *architecture* is ready, the *content* is Nigeria-first.

**Classification: EXTEND** (architecture KEEP, content needs native-speaker review + broader locale reference data). Maturity: **PARTIAL**.

---

## 22. Payments Audit

- **Wallet**: fully functional locally — top-up, quick-amount presets, ledger+cache pattern, transaction history UI. **COMPLETE** for its scope.
- **Paystack (card payments)**: code exists (`src/lib/paystack.ts`, 77 lines) and is wired into checkout's payment step, but `PAYSTACK_SECRET_KEY` is confirmed unconfigured per README's own disclosure — returns HTTP 503 until set. **BLOCKED**, not broken code, a configuration gap.
- **Escrow**: `orders.tsx` references `escrow_held` as a status; confirmed to exist as a real order state, but the full escrow release/dispute logic (who releases funds, under what trigger) was not verified line-by-line this audit — **UNKNOWN** extent of completeness.
- **Seller payouts**: schema exists (0009), zero consuming code (`payouts.ts` absent) — **NOT IMPLEMENTED**.
- Production's naming (`0014_seller_finance_ledger.sql`) suggests this exact gap may already be filled in production.

**Classification: EXTEND** (wallet KEEP, Paystack config + escrow completion + payouts implementation all needed). Maturity: **PARTIAL**.

---

## 23. Booking Audit

- **NOT IMPLEMENTED locally.** No `bookings` table, no booking business logic anywhere in `src/lib/` or `migrations/`.
- Would be required by NaijaGigs (service appointments), NaijaStay (room/night bookings), potentially NaijaDrive (rental periods).
- Production's `0024_booking_engine_foundation.sql` implies a shared booking engine already exists there — this local repo cannot currently build a compatible one without first inspecting that schema (§33 recommendation).

**Classification: BUILD, but gate on reconciliation with production first.** Maturity: **NOT IMPLEMENTED**.

---

## 24. Logistics/GPS/Maps Audit

- **NOT IMPLEMENTED locally** for either logistics execution (driver assignment, shipment tracking) or GPS/maps (no lat/long columns, no maps SDK integration found anywhere in `src/` or `public/`).
- The local NaijaSend Lifecycle-A design doc (§14) covers logistics conceptually but was never implemented and is now known to be out of step with production's actual (also-unimplemented-here) logistics schema.
- Production's `0026_maps_gps_foundation.sql` confirms a real GPS/maps foundation exists there.

**Classification: BUILD, gated on reconciliation.** Maturity: **NOT IMPLEMENTED**.

---

## 25. Reviews Audit

- Real, functional, but **single-purpose**: `reviews` table is keyed to `product_id` only (`0001`/`0002` schema). Cannot review a vendor, a service provider, a stay, a driver, or a gig — there is no polymorphic `reviewable_type`/`reviewable_id` design locally.
- Rating distribution shown on PDP is computed live from loaded review rows, not fabricated — confirmed a genuine, honest implementation for its scope.
- Production's `0027_polymorphic_reviews_foundation.sql` confirms a generalized system already exists there that this repo lacks.

**Classification: REFACTOR** (generalize to polymorphic before other verticals need review capability — do not build a second, product-only review system in parallel). Maturity: **PARTIAL** (complete for products, absent for everything else).

---

## 26. Messaging Audit

- **NOT IMPLEMENTED.** No chat, no ticketing, no dispute-resolution workflow anywhere in `src/`. "Dispute" appears only as prose text inside `help.tsx`'s static FAQ array (7 hardcoded entries, not DB-driven) — confirming there is no functional path for a customer to actually raise or track a dispute.
- No corresponding migration name in production's list either (no `message`/`chat`/`dispute`/`ticket` migration visible) — this appears to be a genuine gap in **both** local and production, unlike most other systems in this audit.

**Classification: BUILD.** Maturity: **NOT IMPLEMENTED** (local and, per available evidence, production).

---

## 27. Media Audit

- Real, DB-driven hero carousel (`HeroCarousel.tsx`, 288 lines, confirmed fully read this audit) — dual desktop-mosaic/mobile-single-slide presentation, zero hardcoded campaign content, client-side rotation via `initHeroGrid()` in `app.js` using a `data-campaigns` JSON payload.
- `ProductCard.tsx`/`ProductCarousel` — real, horizontal-scroll product carousels.
- SVG placeholder generator (`placeholder.ts`) — deliberate zero-licensing-risk fallback for missing product photography, not decorative filler.
- No image-upload pipeline exists despite the declared (unused) `SELLER_UPLOADS` R2 binding — sellers cannot currently upload their own product photos through any confirmed route.

**Classification: KEEP** (existing media system); **BUILD** (seller image upload via R2). Maturity: **PARTIAL**.

---

## 28. AI Audit

- **Zero implementation.** No LLM API calls, no AI/ML dependency, no `Aura`-named code beyond the `/aura` "coming soon" preview page string. Confirmed via `grep -ri "openai\|anthropic\|gemini\|aura" src/` returning only the ecosystem-preview vertical label and nav references.

**Classification: BUILD.** Maturity: **NOT IMPLEMENTED**.

---

## 29. Testing Audit

- **No formal test framework installed or configured.** `node_modules/.bin` contains only `playwright`/`playwright-core` — no `jest`, `vitest`, `mocha`, or equivalent. `package.json` has no `test` script.
- **6 verification scripts exist in `scripts/`** (`prod_verify.cjs` 126 lines, `prod_waitlist_test.cjs` 89 lines, `verify_deployment.cjs` 359 lines, `verify_ecosystem_preview.cjs` 373 lines, `verify_mobile_menu.cjs` 153 lines, `verify_signup_fork.cjs` 133 lines) — these are **hand-written Node assertion/smoke scripts using `fetch()` against live URLs and manual `console.assert`-style checks, not a formal test framework** (no test runner, no structured assertions library, no CI-integrated execution found). Per this audit's explicit instruction, these must **not** be reported as a "formal test framework" — they are ad-hoc deployment-verification tooling, valuable but categorically different from unit/integration tests.
- Playwright is installed and referenced in `DEPLOYMENT.md`'s Gate 8 (responsive smoke test at 5 breakpoints, screenshot-based, checked for forbidden HTTP codes and JS `pageerror` events) — this is real browser automation, but it is a **deployment-gate smoke check**, not a regression test suite with assertions against specific UI content/state.
- **No unit tests, no integration tests, no database tests, no API contract tests** were found anywhere in the repository.
- `scripts/gen_seed.py` (598 lines) generates seed data — a data-generation tool, not a test.

**Classification: BUILD** (a real test framework — unit + integration, at minimum for `src/lib/*.ts`'s pure business logic like `money.ts`, `cart.ts`'s total calculations, `seller.ts`'s state machine). Maturity: **NOT IMPLEMENTED** (formal testing); **PARTIAL** (ad-hoc verification scripts + deployment-gate Playwright smoke checks exist and have real value, but are not a substitute).

---

## 30. Build/Deployment Audit

- **package.json**: scripts are `dev`, `build`, `preview`, `deploy`, `cf-typegen` — minimal, matches the pre-initialized Hono/Cloudflare Pages template plus project-specific additions. No `db:migrate:*`/`db:seed` convenience scripts despite migrations/seed files existing — must be run via raw `wrangler d1 migrations apply`/`wrangler d1 execute --file=` commands, confirmed via direct inspection.
- **Build config**: `vite.config.ts` (57 lines) — `@hono/vite-build` for Cloudflare Pages target, plus two custom build-time functions: `getBuildGitSha()` (bakes `git rev-parse HEAD` into the bundle as `__GIT_SHA__`) and `getExpectedMigrations()` (bakes the `migrations/` directory listing as `__EXPECTED_MIGRATIONS__`) — both consumed by `/api/version` for live drift detection. This is a genuinely clever, already-proven-useful self-verification mechanism (it is precisely what surfaced the SHA mismatch discussed in §33).
- **Wrangler config** (`wrangler.jsonc`): `name: "naijadeals"`, `compatibility_date: "2026-08-25"`, D1 binding (`DB`, placeholder `database_id`), R2 binding (`SELLER_UPLOADS`, declared but unused). No `kv_namespaces`, no `triggers` — correctly avoids both hosted-deploy-incompatible fields per this platform's own constraints.
- **Environment variables**: `PAYSTACK_SECRET_KEY` and `PAYOUT_ENCRYPTION_KEY` are referenced in code/types but not confirmed configured in this sandbox — Paystack-dependent features degrade to HTTP 503 per README's own disclosure.
- **GitHub configuration**: no `.github/` directory, no GitHub Actions workflow files found (`find ... -iname "*.yml"` returned empty) — confirming `DEPLOYMENT.md`'s own explicit statement that "there is no GitHub webhook connecting `git push` to this sandbox" and every deploy cycle is manually human/agent-initiated, never automatic.
- **Production URLs**: two live endpoints identified —
  - `https://naijadeals.com` (custom domain) — HTTP 200, `/api/version` healthy, `in_sync: true`, 36 migrations.
  - `https://393ef41c-f7b9-4ded-996a-2f5265e3280d.vip.gensparksite.com` (Genspark-hosted deployment URL, confirmed via `gsk hosted worker_get`) — **also** HTTP 200, **also** reports the identical `git_sha: 99b1664d...` and identical 36-migration list. **Both hosts agree with each other** — this is not a case of one host drifting from the other; it's one consistent deployed artifact answering to two different URLs (custom domain is presumably a Cloudflare custom-domain binding pointed at the same Worker).
- **Version endpoint** (`/api/version`, `src/routes/version.ts`, confirmed read in full in a prior session): reports `git_sha`, `build_time`, `db.reachable`, `db.expected_migrations` vs `db.applied_migrations`, `db.missing_migrations`, `db.unexpected_migrations`, `db.in_sync`, `healthy` — a well-designed single-call health+drift check. **This audit relied heavily on this endpoint's own honesty to surface the divergence in §33** — it is doing exactly the job it was designed for.
- **Health checks**: `db.reachable: true`, `db.in_sync: true`, `healthy: true` on both production hosts as of this audit — the *running* application reports itself healthy; it is simply not verifiably built from this repository's git history.

**Classification: KEEP the build/version-check tooling (it is precisely how this audit found the critical finding); the deployment PROCESS itself needs a resolution — see §33.**

---

## 31. Asset/Data Audit

- **Seed data**: `seed.sql` (507 lines, confirmed to never touch `users` per prior-session audit) + `seed-dev-account.sql` (127 lines, root-level, 1 user + 4 wishlists + 3 saved_payment_methods + 6 notifications, idempotent, verified via double-run).
- **Assets**: `public/static/` holds CSS, `app.js` (1,407 lines), favicon. Product images are either real seed-data URLs or the SVG placeholder generator (`/ph.svg`) — zero commercially-licensed stock imagery used, per the codebase's own stated design principle.
- **Reference/lookup data in migrations**: `nigerian_states` (0007), `nigerian_banks` (0009, 25 real banks with NIBSS codes) — genuine, usable reference data, correctly kept in schema migrations per this repo's own "pure reference data is fine in a migration" invariant (documented in `0005`'s header comment after the bootstrap-repair fix).
- **`gen_seed.py`** (598 lines) — a Python seed-data generator; not itself run at request-time (Workers can't run Python), used only as an offline authoring tool for `seed.sql`'s content. Confirmed consistent with the "no Python runtime in Workers" constraint.

**Classification: KEEP.** Maturity: **COMPLETE** for NaijaShop's own seed needs; **NOT IMPLEMENTED** for any other vertical's seed data.

---

## 32. Duplicate Architecture Findings

Explicitly surfaced per the audit's mandate — **not silently fixed**:

1. **Dual ecosystem waitlist tables**: `ecosystem_waitlist` (migration 0010, legacy, single-email-per-vertical, consumed by `addToVerticalWaitlist()` in `ecosystem-verticals.ts`) coexists with `ecosystem_waitlist_signups` (migration 0011, richer multi-field with per-service boolean flags, consumed by `upsertWaitlistSignup()` in `ecosystem-waitlist.ts`). Both are live, both have consuming code, both appear to still be reachable from the UI (`EcosystemWaitlistModal.tsx`'s form fields align with the newer 0011 schema). **This is a confirmed, real duplicate that needs a deliberate decision (deprecate 0010's table, or document why both remain) — not something this audit will resolve.**
2. **README.md internal self-contradiction**: the header (lines 3–11) states the app "**is** deployed and live at **https://naijadeals.com**"; the URLs section (line 45) says "Production: **not yet deployed**"; the Deployment section (line 134) says "**Status**: ❌ Not yet deployed." All three statements cannot be simultaneously true. Given this audit's own live-probe evidence (production genuinely IS live and healthy, just running unidentified code), the header note is the one closer to physical reality, but the document itself has never been reconciled.
3. **Local NaijaSend design doc vs. production's actual NaijaSend schema**: the local `NAIJASEND-LIFECYCLE-A-DESIGN.md` proposes migration `0013_naijasend_logistics.sql` with tables `logistics_providers`/`vehicles`/`driver_profiles`/etc. Production's actual migration list uses **different numbering and likely different table names** (`0015_naijasend_logistics_foundation.sql`, `0016_naijasend_driver_foundation.sql`, `0019_naijasend_shipment_foundation.sql`, `0020_naijasend_commerce_bridge.sql`) — these are almost certainly NOT the same schema, meaning implementing the local design as-is would create a second, incompatible NaijaSend data model alongside whatever production already runs.
4. **Two live-yet-separate deployment surfaces reporting identically**: `naijadeals.com` and the Genspark deployment URL both report the same unknown SHA and same 36 migrations — not itself a duplicate architecture problem (they appear to be the same Worker under two hostnames), but flagged here because it was actively checked as a possible source of divergence and ruled out as such.
5. **Possible NaijaDrive/NaijaSend vehicle-schema naming overlap**: production migrations `0035_naijasend_vehicle_marketplace.sql` and `0036_naijasend_vehicle_type_expansion.sql` are filed under the NaijaSend prefix, not NaijaDrive, despite NaijaDrive's own subject matter being "vehicle rentals & mobility." Whether these represent a genuine scope overlap (two verticals both touching vehicles) or simply logistics-fleet vehicles being named under NaijaSend is **UNKNOWN** and should be clarified with Pat, not assumed either way.

---

## 33. Critical Blockers

1. **[BLOCKING, HIGHEST PRIORITY] Production/local codebase divergence, root cause unresolved.** `https://naijadeals.com` and the Genspark-hosted deployment URL both run commit `99b1664df552ce1cd707330e17207d8869f12a4e` — confirmed absent from local `git log --all` AND absent from the GitHub `origin` remote (`gh api` → HTTP 422). Production reports 36 applied migrations; this repo has 12. Production's `/send`, `/fresh`, `/eats`, `/gigs`, `/stay` pages render genuinely distinct, vertical-specific content inconsistent with this repo's shared preview-only implementation. **This audit could not determine where the deployed code actually lives** — it is not on this sandbox's `origin` remote, not in any other local branch (only `main` exists), not in any stash. Possible explanations not yet ruled out: (a) a different GitHub repository/fork was used for a prior deploy and never merged back; (b) a different sandbox session pushed to a different remote or used `gsk hosted deploy` with locally-authored-but-never-committed code; (c) the Genspark hosted-build pipeline's own previously-documented "metadata-stamping quirk" (per `DEPLOYMENT.md`'s "Known Genspark hosted-build metadata discrepancy," observed once before on 2026-08-31 with a different unknown SHA) is recurring at a much larger scale than previously seen — but that prior incident involved 0 missing/unexpected migrations (identical schema, only the SHA metadata was wrong), whereas this time the *migration list itself* differs by 24 files, which is a materially different and more severe class of discrepancy that the prior explanation does not adequately cover. **This must be raised to Pat directly — it cannot be resolved via further read-only sandbox inspection alone**, since the missing code (if it exists) is not reachable from any ref this sandbox's `git`/`gh` credentials can see.
2. **No admin/RBAC system anywhere** (local or, per direct route testing, not confirmable either way in production without further probing) — `users.role='admin'` is a dead column locally; there is no way to moderate the marketplace, manage disputes, or approve sellers other than the seller-onboarding state machine itself.
3. **Order lifecycle incompleteness (local)**: backend never transitions orders past `processing`/`escrow_held`; the frontend has labels for `shipped/delivered/completed/cancelled/refunded` that are currently unreachable dead states.
4. **Seller finance/payout layer is schema-only (local)**: `seller_finance_accounts`/`seller_payout_accounts`/`seller_payout_account_audit` tables exist; `src/lib/payouts.ts` and `src/lib/seller-finance.ts` do not.
5. **No formal test framework** — regressions in business-critical logic (money math, order state transitions, seller state machine) have no automated safety net beyond manual/scripted smoke checks.
6. **Zero cross-vertical shared engines built locally** (Booking, Logistics, GPS/Maps, generalized Reviews, Messaging, Analytics, Trust & Safety enforcement, Affiliates, CRM, AI) — every non-NaijaShop vertical is currently a marketing placeholder page with zero backing logic, in this repository.
7. **i18n content quality**: 9 of 10 "live" translation dictionaries are AI-generated and explicitly unreviewed by a native speaker.

---

## 34. KEEP / EXTEND / REFACTOR / REPLACE / BUILD / REMOVE Matrix

| Capability | Classification | Maturity |
|---|---|---|
| Authentication | KEEP / EXTEND (rate limiting) | PARTIAL |
| RBAC / Admin | BUILD | NOT IMPLEMENTED |
| Seller Portal (onboarding/verification) | EXTEND | PARTIAL |
| Seller Finance/Payouts | BUILD | PLACEHOLDER |
| Catalog / Listings (buy box) | KEEP | COMPLETE |
| Search | EXTEND/REPLACE at scale | PARTIAL |
| Cart | KEEP | COMPLETE |
| Checkout | KEEP | COMPLETE |
| Orders (lifecycle) | EXTEND | PARTIAL |
| Wallet | KEEP | COMPLETE |
| Paystack/card payments | EXTEND (configure secret) | BLOCKED |
| Reviews | REFACTOR (generalize) | PARTIAL |
| Ecosystem Preview system (8 verticals) | KEEP (as a placeholder pattern) | COMPLETE (as a placeholder) |
| NaijaFresh/Eats/Gigs/Stay/Drive/Send/Stream/Aura (real functionality) | BUILD, gated on reconciliation for Send/Fresh/Eats/Gigs/Stay | NOT IMPLEMENTED (local) |
| Booking Engine | BUILD, gated on reconciliation | NOT IMPLEMENTED |
| Logistics/GPS/Maps | BUILD, gated on reconciliation | NOT IMPLEMENTED |
| Messaging/Dispute | BUILD | NOT IMPLEMENTED |
| Notifications | EXTEND/BUILD (generation logic) | PARTIAL |
| Analytics | BUILD | NOT IMPLEMENTED |
| Trust & Safety (functional) | BUILD | NOT IMPLEMENTED |
| Affiliates | BUILD, gated on reconciliation | NOT IMPLEMENTED |
| CRM | BUILD | NOT IMPLEMENTED |
| AI/Aura | BUILD | NOT IMPLEMENTED |
| Control Center | BUILD, gated on reconciliation | NOT IMPLEMENTED |
| Integration Hub | BUILD, gated on reconciliation | NOT IMPLEMENTED |
| Africa/Country Engine | KEEP / EXTEND | PARTIAL |
| i18n content | EXTEND (native review) | PARTIAL |
| Media/Hero Carousel | KEEP | COMPLETE |
| Seller image upload (R2) | BUILD | NOT IMPLEMENTED |
| Duplicate waitlist tables (0010 vs 0011) | REFACTOR (deprecate one) | N/A |
| README.md deployment-status contradiction | REFACTOR (documentation) | N/A |
| Testing framework | BUILD | NOT IMPLEMENTED |
| Build/version-check tooling | KEEP | COMPLETE |
| `/account` bare route (404 bug) | EXTEND (register the route or fix the links) | BLOCKED (bug) |

---

## 35. Production Readiness Matrix

| Area | Local repo readiness | Production readiness (as far as evidence permits) |
|---|---|---|
| NaijaShop core commerce | PARTIAL — order lifecycle incomplete, no admin, wallet-only payments live | UNKNOWN — cannot verify without knowing what code is actually deployed |
| Seller onboarding | PARTIAL | UNKNOWN |
| 8 non-Shop verticals | NOT PRODUCTION READY (placeholder-only) | Evidence suggests SUBSTANTIALLY MORE MATURE than local (real per-vertical pages, auth-gated APIs, dedicated migrations) — **but this cannot be confirmed as "production ready" either, since the code's provenance and quality are unverified** |
| Security/RBAC | NOT PRODUCTION READY (no admin control) | UNKNOWN |
| i18n | Architecture ready, content unreviewed | UNKNOWN |
| Testing | NOT PRODUCTION READY (no formal framework) | UNKNOWN |
| Deployment traceability | ❌ **FAILED** — cannot trace production's running code to any commit this repo/remote knows about | Same finding, from the opposite side |

**Overall: this repository, on its own, is a solid single-vertical MVP with well-documented gaps. It cannot currently be called "the baseline" for what a rebuild should extend, because production is running something else — of unknown but apparently greater scope — that this repo cannot see.**

---

## 36. Dependency Graph

```
Identity/Auth (KEEP, local) ──┬─→ Seller Portal (EXTEND) ──→ Seller Finance/Payouts (BUILD)
                              ├─→ RBAC/Admin (BUILD) ──→ Trust & Safety enforcement (BUILD)
                              └─→ Customer accounts ──→ Wallet (KEEP) ──→ Payments/Escrow (EXTEND)

Catalog/Listings (KEEP) ──→ Cart (KEEP) ──→ Checkout (KEEP) ──→ Orders (EXTEND lifecycle)
                                                                    └─→ Reviews (REFACTOR to polymorphic) ──→ [required by Gigs/Stay/Send providers]

Booking Engine (BUILD) ──→ NaijaGigs, NaijaStay, (possibly NaijaDrive)
Logistics/GPS/Maps (BUILD) ──→ NaijaSend, (possibly NaijaGigs dispatch, NaijaEats delivery)
Messaging/Dispute (BUILD) ──→ ALL verticals (support/escalation)
Analytics (BUILD) ──→ Seller Portal's disabled nav item; ALL verticals' provider dashboards
Africa/Country Engine (KEEP/EXTEND) ──→ ALL verticals' localization
i18n content review (EXTEND) ──→ ALL verticals' non-English UX quality

⚠️ Production Divergence Resolution (§33) ──→ gates EVERY vertical build decision above,
    since Booking/Logistics/GPS/Reviews-polymorphic/Control Center/Integration Hub/
    Affiliates may already exist, in a different shape, in whatever is actually deployed.
```

**Key structural insight**: Booking, Logistics, generalized Reviews, Messaging, and Analytics are **not vertical-specific** — they are shared foundations that NaijaGigs, NaijaStay, NaijaSend, and NaijaDrive all need simultaneously. Building any one of these 4 verticals in isolation, without first building (or reconciling with production's existing) shared foundations, risks the same "duplicate architecture" problem already found once in this audit (§32).

---

## 37. Recommended Rebuild Roadmap

**This roadmap is provisional and explicitly conditioned on §33 being resolved first — building any of the shared foundations below before knowing what production already has risks creating a second, incompatible system, exactly as already happened once with the two waitlist tables.**

**Phase R0 (must happen before any further vertical work, not part of this checkpoint):**
- Resolve the production/local divergence with Pat directly: identify the actual source of the deployed code (different repo? different branch? uncommitted local changes from a different session lost to history?). Until resolved, no further schema/feature work should be authorized on Booking, Logistics, GPS/Maps, Reviews-polymorphism, Control Center, Integration Hub, or Affiliates — all of which may already exist in production in an incompatible shape.

**Phase R1 (safe to parallelize regardless of R0's outcome — these are purely local-repo gaps with no production ambiguity):**
- Register the missing `/account` route (fixes a confirmed 404 bug) — trivial, isolated.
- Reconcile README.md's deployment-status self-contradiction.
- Implement `src/lib/payouts.ts`/`seller-finance.ts` against the already-existing local `0009` schema — no production ambiguity here since this schema is local-only.
- Complete the order-lifecycle state machine (`processing → shipped → delivered → completed`, plus `cancelled`/`refunded` paths) in `src/lib/orders.ts` — purely local logic, no shared-foundation dependency.
- Configure `PAYSTACK_SECRET_KEY` and verify live card-payment flow.
- Stand up a real test framework (Vitest recommended — lightweight, Workers-compatible) starting with `src/lib/money.ts`, `cart.ts`, `seller.ts` state machine — zero dependency on anything else in this roadmap.
- Native-speaker review pass on the 9 unreviewed translation dictionaries.
- Deprecate one of the two waitlist tables (`0010`'s `ecosystem_waitlist` vs `0011`'s `ecosystem_waitlist_signups`) — pick one, migrate any remaining consumers, document the decision.

**Phase R2 (only after R0 resolves — shared foundations, buildable in parallel by separate workstreams once it's confirmed they don't already exist elsewhere):**
- Workstream A: RBAC/Admin layer (`requireAdmin` middleware, `/admin` routes, seller-approval admin UI).
- Workstream B: Generalize Reviews to polymorphic (`reviewable_type`/`reviewable_id`) — unblocks Gigs/Stay/Send provider reviews.
- Workstream C: Booking Engine foundation — unblocks Gigs (appointments) and Stay (room-nights) in parallel.
- Workstream D: Messaging/Dispute system — needed by all verticals, buildable independently of A/B/C.
- Workstream E: Analytics foundation — needed by Seller Portal's disabled nav item and every future provider dashboard.

**Phase R3 (vertical build-out, parallelizable once R2's foundations exist):**
- NaijaGigs (needs Booking + polymorphic Reviews + Messaging).
- NaijaStay (needs Booking + polymorphic Reviews + Messaging).
- NaijaSend (needs Logistics/GPS/Maps + polymorphic Reviews — but see R0, may already substantially exist).
- NaijaFresh/NaijaEats (needs Catalog extension for perishables/restaurant menus — closer to NaijaShop's existing pattern, lower dependency on R2's new engines, could potentially start in parallel with R2).
- NaijaDrive (needs Booking + vehicle schema — clarify overlap with NaijaSend's vehicle migrations first, per §32 finding 5).

**Phase R4 (last, by design — highest dependency count):**
- NaijaStream (Content & Media Engine — no existing foundation of any kind).
- Aura AI (depends on having real cross-vertical data — catalog, bookings, orders — worth aggregating before an AI layer has anything useful to reason over).
- Affiliates, CRM, Integration Hub, Control Center — cross-cutting operational tooling, valuable but not customer-blocking; sequence after core verticals are real.

---

## 38. Risks

1. **[Severe] Deploying further local work without resolving §33 could silently orphan or conflict with production data/schema** the moment any BYOK/hosted deploy action is taken — a `gsk hosted deploy` or `wrangler pages deploy` from this repo would attempt to publish a codebase 24 migrations behind what's live, with unknown consequences for the live D1 database (migration numbering collision risk if this repo's future `0013` differs from production's actual `0013_control_center_foundation.sql`).
2. **[High] Reputational/business risk** if production is serving real users with a codebase this team has no audit trail for — any incident response, security patch, or compliance question cannot currently be answered from this repository alone.
3. **[Medium] i18n unreviewed-translation risk**: shipping AI-generated, unreviewed Igbo/Yoruba/Hausa/etc. copy to real users risks culturally inappropriate or simply wrong translations reaching production before native-speaker QA.
4. **[Medium] No admin/RBAC** means there is currently no way to suspend a fraudulent seller, moderate a listing, or handle a legal takedown request through any code path — this is a trust-and-safety exposure for a live money-moving marketplace.
5. **[Medium] No automated tests** on money-math and order-state logic means a future refactor (e.g., completing the order lifecycle per Phase R1) carries real regression risk with no automated safety net.
6. **[Low-Medium] Duplicate waitlist tables** could silently split marketing signal (some signups in `ecosystem_waitlist`, others in `ecosystem_waitlist_signups`) without anyone noticing, undermining launch-readiness metrics for the 8 pending verticals.

---

## 39. Explicit Items NOT Yet Started

- Any implementation work on NaijaFresh, NaijaEats, NaijaGigs, NaijaStay, NaijaDrive, NaijaSend, NaijaStream, or Aura AI (all remain shared-placeholder pages only, in this repository).
- Resolution of the production/local divergence (§33) — this requires a decision/input from Pat and cannot be closed by further sandbox-only read-only inspection.
- RBAC/Admin system build.
- Booking Engine, Logistics/GPS/Maps Engine, generalized polymorphic Reviews, Messaging/Dispute system, Analytics Engine, Control Center, Integration Hub, Affiliates, CRM — all zero-implementation locally.
- Seller Finance/Payouts application code (`payouts.ts`/`seller-finance.ts`) against the already-existing `0009` schema.
- Order-lifecycle completion beyond `processing`/`escrow_held`.
- Paystack live configuration/verification.
- Formal test framework adoption.
- Native-speaker translation review for 9 of 10 "live" i18n dictionaries.
- `/account` route registration (bug fix).
- README.md deployment-status contradiction reconciliation.
- Waitlist-table deduplication decision.
- NaijaDrive prompt files (`pasted-text-1789172553649.txt`, `pasted-text-1789173137241.txt`) — remain explicitly deferred, untouched this session, not reviewed as part of this audit's evidence-gathering (out of scope — they are inputs for a future NaijaDrive design phase, not part of this repository's current codebase).
- `scripts/checkpoint.sh` automation — not built, not started.

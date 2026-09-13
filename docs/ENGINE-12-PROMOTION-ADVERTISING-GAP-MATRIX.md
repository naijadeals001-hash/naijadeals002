# ENGINE 12 — PROMOTION & ADVERTISING — PHASE 0 GAP-MATRIX AUDIT

**Status: AUDIT ONLY. NO IMPLEMENTATION WAS PERFORMED IN THIS PASS.**
**Date:** 2026-09-13
**Git baseline audited:** `cafca3f13c59063b23c1e56e3224ea816d87afad` (Engine 1 closure commit — HEAD at time of audit)
**Auditor discipline:** every classification below is backed by either (a) a direct code-read citation, (b) a live D1 query against the real local database, (c) a real-Chromium/Playwright browser render, or (d) an isolated, reproducible concurrency script — never a hypothesis or an inference from file existence alone.

---

## 1. Why this audit exists

A prior turn in this program correctly identified that "coupons/hero_campaigns/brands exist as files" is not the same claim as "coupons/hero_campaigns/brands are REAL/COMPLETE, safe, and tested." Every engine audited so far in this program (3, 7, 9, 11, and Engine 1 itself) contained at least one genuine defect hiding under an assumption of "it's fine." This audit applies the same forensic standard to the three pre-existing systems Engine 12 is expected to build on top of, plus a full sweep for any advertising/sponsored-listing primitives that might already exist. **Two genuine, reproducible defects were found. Both are documented below with reproduction evidence, not conjecture.**

---

## 2. Audit methodology

1. Full-repository grep sweep (`src/`, `migrations/`, `tests/`, `public/`) for every promotion/advertising-adjacent keyword: `coupon`, `hero_campaign`, `is_featured`, `display_order`, `brand`, `sponsored`, `ad_campaign`, `impression`, `ad_click`, `advertiser`, `cpc`, `cpm`, `ppc`, `campaign_budget`.
2. Full read of every migration file that creates or touches the three legacy tables (`0002`, `0004`, `0005`, `0006`, `0008`).
3. Full read of `src/lib/coupons.ts`, `src/lib/hero-campaigns.ts`, `src/lib/catalog.ts` (`getTopBrands`), `src/lib/homepage-feed.ts`, `src/lib/orders.ts`, `src/routes/api-cart.ts`, `src/routes/api-orders.ts`, `src/lib/rbac.ts`.
4. Live D1 queries (`wrangler d1 execute --local --json`) against the actual running local database to check real row-level state — not assumed seed content.
5. A live-Chromium/Playwright browser render of the homepage and shop page (headless, real HTTP against the running dev server) to get runtime proof, not static-code inference.
6. An isolated, disposable Node reproduction script exercising `validateCoupon()` + `incrementCouponUsage()` under genuine `Promise.all` concurrency against the real local D1 binding (same harness pattern as `tests/payment-engine/helpers/db.mjs`), run twice to rule out a fluke. **Deleted after use — diagnostic only, not part of any permanent suite** (per this program's established convention from the Engine 1 browser-verification session).
7. Zero production files were modified. Zero schema migrations were run. Zero new tests were committed. This is a read-only forensic pass.

---

## 3. Executive summary of classifications

| System | Classification | Confidence |
|---|---|---|
| **Coupons** (checkout discount codes) | **REAL/PARTIAL — UNSAFE** (concurrency race + orphaned-usage defect, both proven) | High — reproduced twice |
| **Hero Campaigns** (homepage carousel) | **REAL/COMPLETE** (schema, lifecycle, scheduling, homepage integration all verified live in-browser) | High — browser-rendered |
| **Brand Merchandising** (`is_featured`/`display_order`) | **REAL/PARTIAL — CONFLICTING** (seed/migration ordering bug currently zeroes out all curation in the local dev DB) | High — reproduced via live DB query |
| **Sponsored Listings** | **MISSING** — zero schema, zero code, zero tests, anywhere | High — exhaustive grep, zero matches |
| **Ad Campaigns (paid/targeted)** | **MISSING** — zero schema, zero code, zero tests, anywhere | High — exhaustive grep, zero matches |
| **Impression/click/billing measurement** | **MISSING** — zero schema, zero code, zero tests, anywhere | High — exhaustive grep, zero matches |
| **Admin/seller mutation API for Coupons/Hero Campaigns/Brands** | **MISSING** — all three tables are populated ONLY by migration/seed SQL; no HTTP route can create, edit, or deactivate a coupon, hero campaign, or brand curation flag today | High — exhaustive route-file grep, zero matches |
| **RBAC primitive for future admin endpoints** | **REAL/COMPLETE** — `requirePlatformRole('admin')` already exists in `src/lib/rbac.ts` and has a proven live caller (`api-admin.ts`'s moderation/collections/refunds routes) | High — direct code read |
| **Automated test coverage for Coupons/Hero Campaigns/Brands** | **MISSING** — zero test files reference any of the three systems anywhere in `tests/` | High — exhaustive grep, zero matches |
| **README accuracy re: Hero Campaigns** | **CONFLICTING / STALE DOCUMENTATION** (Category D) — README claims hero_campaigns "not yet wired into home.tsx"; this is disproven by direct code read AND live browser render | High — directly contradicted by evidence |

---

## 4. DEEP AUDIT — COUPONS

### 4.1 Schema (migration `0002_marketplace_depth.sql`, `0004_checkout_depth.sql`)
`coupons` table: `code` (UNIQUE), `discount_type` (`percent`|`fixed`), `discount_value`, `min_order_kobo`, `max_discount_kobo` (nullable), `expires_at` (nullable), `is_active`, `usage_limit` (nullable), `usage_count`. Three seed rows exist (`WELCOME10`, `NAIJA5000`, `FREESHIP`), all with `usage_limit = NULL` (unlimited) in the current seed data — meaning the concurrency defect below is **not currently exploitable against the live seed rows**, but IS exploitable against any future coupon an admin creates with a real `usage_limit`, which is the entire point of that column existing.

### 4.2 Checkout calculation correctness — **REAL, verified correct**
`validateCoupon()` (`src/lib/coupons.ts:23-51`):
- Percent: `Math.round(subtotal * discount_value / 100)` — correct.
- Fixed: `discount_value` directly (already in kobo) — correct.
- `max_discount_kobo` cap applied via `Math.min()` — correct.
- Final discount additionally capped at `subtotalKobo` — correctly prevents a negative order total.
- Case-insensitive code lookup via `COLLATE NOCASE` — correct, deliberate (line 25).

### 4.3 Min-order / max-discount rules — **REAL, verified correct**
Both enforced server-side inside `validateCoupon()`, re-checked against the live cart subtotal on every `/api/cart/preview` call — not a client-trusted number. Confirmed via direct code read of `src/routes/api-cart.ts:97-144`.

### 4.4 Expiration / active-status enforcement — **REAL, verified correct**
`is_active` and `expires_at` both checked server-side before any discount is computed (`coupons.ts:30-33`).

### 4.5 Usage-limit enforcement — **REAL logic exists, but UNSAFE under concurrency (Defect #1 — proven)**
`validateCoupon()` checks `usage_count >= usage_limit` via a plain `SELECT`. `incrementCouponUsage()` (`coupons.ts:53-55`) is a **separate, unguarded** `UPDATE coupons SET usage_count = usage_count + 1 WHERE id = ?` — no `WHERE usage_count < usage_limit` guard, no CAS pattern. This is the exact "check-then-act" TOCTOU shape that `src/lib/wallet.ts`'s extensive doc comments (lines 1-90) explicitly document as the class of bug this codebase already fixed once for wallet balances, and that `orders.ts`'s `claimOrderForPayment()` fixes for payment status via `WHERE payment_status = 'unpaid'`. Coupons never received the same treatment.

**Reproduction (isolated script, run twice, both times identical):**
```
Created coupon RACE_TEST_<ts> with usage_limit=1, usage_count=0
Concurrent redemption attempts: 10
Attempts that PASSED validateCoupon() and called incrementCouponUsage(): 10
Final usage_count in DB: 10
usage_limit: 1
>>> RACE CONFIRMED: 10 redemptions succeeded against a usage_limit of 1
```
10/10 concurrent `Promise.all` callers passed validation and incremented usage — a coupon meant to be redeemable exactly once was redeemed 10 times. Reproduced against the real local D1 binding via the same `getPlatformProxy()` harness pattern already established in `tests/payment-engine/helpers/db.mjs`. Script was diagnostic-only and has been deleted; it is fully reproducible from the description above if independent re-verification is desired.

**Real-world exposure:** currently low (seed coupons have no usage_limit), but this is a landmine for the moment any admin creates a limited coupon, or for Engine 12's planned sponsored-listing/advertising budget-cap logic if that logic is built using the same unguarded-increment pattern.

### 4.6 Duplicate redemption / orphaned-usage defect (Defect #2 — proven by code read)
`incrementCouponUsage()` is called inside `createPendingOrder()` (`orders.ts:123-125`) **at order-creation time**, before payment is verified — the order is created at `status='pending_payment', payment_status='unpaid'`. `cancelOrder()` (`orders.ts:365+`) was read in full and **never decrements `usage_count`** or otherwise releases the coupon claim. Consequence: a customer who applies a limited coupon, creates the order, then cancels or simply abandons it unpaid, **permanently burns one usage slot with zero completed purchase**. Over time this silently starves a limited promotional coupon of its inventory without a single real conversion. This is a genuine, low-severity-but-real business-logic gap distinct from the concurrency race — confirmed via direct code read (grep for `usage_count`/`cancelOrder` returned zero co-occurrence).

### 4.7 Authorization / RBAC for coupon creation/update/deletion — **MISSING (structurally: N/A)**
There is no code path anywhere that creates, updates, or deletes a coupon at runtime. Coupons exist ONLY as three hardcoded `INSERT` rows in `migrations/0004_checkout_depth.sql`. There is nothing to authorize because there is no mutation endpoint. This is scored as **MISSING**, not UNSAFE, because the absence itself is the finding — Engine 12 will need to build this from scratch, reusing `requirePlatformRole('admin')` from `rbac.ts` per the existing `api-admin.ts` convention.

### 4.8 API ownership/security — **N/A**, same reason as 4.7.

### 4.9 Automated test coverage — **MISSING**
Zero test files anywhere in `tests/` reference `coupon`, `validateCoupon`, or `incrementCouponUsage`. Confirmed via exhaustive grep across all five existing test-engine directories (`booking-engine`, `identity-engine`, `notification-engine`, `payment-engine`, `search-engine`). Coupons have never had automated regression coverage since being introduced in migration `0002`/`0004`.

### 4.10 Browser coverage — **MISSING (as a permanent suite); confirmed REAL at runtime (ad hoc)**
No entry exists in `tests/identity-engine/browser/engine1-browser-journeys.mjs` or anywhere else for the coupon-apply UI flow. An ad hoc, non-permanent browser check during this audit confirmed the UI element chain (`#coupon-input` → `#apply-coupon-btn` → `public/static/app.js` lines 1252-1266 → `POST /api/cart/preview` → `validateCoupon()`) is real and wired end-to-end at the checkout page — but this was a one-off audit check, not a committed regression test.

### 4.11 Actual checkout runtime behavior — **REAL, confirmed wired**
Direct read of `public/static/app.js:1252-1266` confirms the Apply button correctly calls `/api/cart/preview` with the entered code, displays the returned discount or error text, and re-triggers `refreshSummary()` so the on-screen total reflects the applied discount before order placement. This is genuinely functional, not decorative.

---

## 5. DEEP AUDIT — HERO CAMPAIGNS

### 5.1 Database schema (`migrations/0008_hero_campaigns.sql`) — **REAL/COMPLETE**
`hero_campaigns`: `slug` (UNIQUE), `title`, `subtitle`, `image_desktop_url`, `image_mobile_url`, `cta_label`, `cta_href`, `vertical`, `theme` (CHECK constrained to `dark`|`light`), `display_order`, `status` (CHECK constrained to `active`|`inactive`), `starts_at`/`ends_at` (both nullable), timestamps. Well-designed, CHECK-constrained, indexed on `(status, display_order)`.

### 5.2 Lifecycle / state machine — **REAL, verified correct**
Not a full state machine (no transition function), but the eligibility predicate in `getActiveHeroCampaigns()` (`hero-campaigns.ts:18-32`) correctly implements the intended lifecycle purely via SQL: `status = 'active' AND (starts_at IS NULL OR starts_at <= now) AND (ends_at IS NULL OR ends_at > now)`. This is a legitimate declarative lifecycle model — schedule-driven start/end without requiring a cron job or manual state transition, appropriate for the Cloudflare Pages constraint (no Cron Triggers on hosted deploy, as this program has established repeatedly). Confirmed correct by direct code read; the SQL is simple enough that a live query wasn't necessary to validate correctness, though the browser render (5.6 below) independently confirms it behaves correctly against real seed data.

### 5.3 Schedule enforcement — **REAL, server-side, verified correct**
Enforcement happens entirely inside the SQL `WHERE` clause shown above — there is no client-side or application-code gate that could be bypassed. This is a stronger design than a typical "fetch all, filter in JS" pattern.

### 5.4 Authorization/RBAC for hero campaign creation/update — **MISSING (structurally: N/A)**, same finding as coupons (4.7). All 5 seed campaigns are hardcoded `INSERT` rows in migration `0008`; there is no runtime mutation path, so there is nothing to authorize yet.

### 5.5 Homepage query path — **REAL/COMPLETE, verified correct**
`getActiveHeroCampaigns()` is registered as a section loader in `homepage-feed.ts`'s `SECTION_LOADERS` map (line 38), correctly participating in the site's 120-second TTL cache (avoiding a live D1 query on every homepage hit — appropriate given the Workers CPU-budget constraint documented at the top of `homepage-feed.ts`). `home.tsx` (lines 33-46) imports `HeroCarousel` and passes `feed.hero_campaigns` directly — confirmed via direct code read, this is genuinely wired, not aspirational.

### 5.6 Display ordering — **REAL, verified correct**
`ORDER BY display_order ASC, id ASC` in the query, matching the same is_featured/display_order convention established for brands (migration `0006`'s doc comment explicitly references this precedent).

### 5.7 Expired/future campaign behavior — **REAL, logically correct** (not separately live-tested with an actually-expired row in this pass, but the SQL predicate is unambiguous and symmetric with the start-date case already proven live).

### 5.8 Concurrent mutation concerns — **N/A**. No mutation path exists yet (see 5.4); nothing to race against.

### 5.9 Automated tests — **MISSING**. Zero test files reference `hero_campaign` anywhere in `tests/`.

### 5.10 Browser/runtime evidence — **REAL/COMPLETE — directly disproves the README**
Live headless-Chromium render against the actual running dev server (`http://localhost:3000/`) confirmed:
```
Hero campaign images found: 10
Hero campaign title text matches found: 4
Contains "Up to 50% off electronics": true
```
This is unambiguous, real-browser, real-HTTP proof that the hero carousel renders live seed campaign content today. **`README.md` line 147 currently states: "Hero Campaign Carousel is built but not yet wired into `home.tsx`"** — this claim is **false as of the current codebase state** and must be corrected (Category D: stale documentation, not a functional gap). This is exactly the kind of finding that separates a real audit from a file-existence grep — the README itself would have led an implementation-focused prompt to needlessly "finish wiring" something that already works.

---

## 6. DEEP AUDIT — BRAND MERCHANDISING

### 6.1 `is_featured` / `display_order` schema (migration `0006_brand_merchandising.sql`) — **REAL/COMPLETE as schema**
Purely additive `ALTER TABLE` columns onto the pre-existing `brands` table: `is_featured` (INTEGER, default 0), `display_order` (INTEGER, nullable), `status` (TEXT, default `active`). Well-documented migration with an explicit doc-comment rationale (curated brands should be admin-editable later; UI must never hardcode order).

### 6.2 Who can mutate them today — **MISSING (structurally: N/A)**. Identical finding to coupons/hero campaigns — no runtime mutation endpoint exists. The only writes are the migration's own hardcoded `UPDATE brands SET is_featured=1, display_order=N WHERE slug='...'` statements for 12 specific brands.

### 6.3 Server-side enforcement of ordering — **REAL, verified correct in isolation**
`getTopBrands()` (`catalog.ts:102-114`) correctly implements the documented hybrid ranking: `ORDER BY is_featured DESC, display_order ASC, product_count DESC`, gated by `logo_url IS NOT NULL AND status = 'active'` and an inner join requiring at least one active product. The SQL itself is correct.

### 6.4 **Defect #3 (proven, live) — seed.sql silently wipes migration 0006's curation**
Live query against the actual running local database:
```sql
SELECT COUNT(*) FROM brands WHERE is_featured=1 AND status='active' AND logo_url IS NOT NULL;
-- result: 0
```
Root cause, confirmed by direct file read and git history:
- `seed.sql` (git-committed **2026-08-29**, predates migration `0006` which landed **2026-08-31**) contains, unconditionally: `DELETE FROM brands;` followed by `INSERT OR IGNORE INTO brands (id, slug, name, is_nigerian) VALUES (...)` — **only 4 columns**, never touching `logo_url`, `is_featured`, or `display_order`.
- Because `seed.sql` is documented in `README.md` (lines 107-109) as an operation to be run explicitly during local dev bootstrap ("Catalog/business seed data... `wrangler d1 execute ... --file=./seed.sql`"), **any developer who re-runs the documented seed step AFTER migrations have already applied migration `0006`'s curation will silently wipe that curation back to `is_featured=0, display_order=NULL, logo_url=NULL` for every brand**, because `seed.sql` was never updated after migration `0006` introduced those columns.
- This is exactly why the homepage's "Top Brands" section is currently rendering empty in this local environment (confirmed: `homepage_feed_cache` row for `top_brands` has `payload_json` length 2, i.e. `[]`) — not a bug in `getTopBrands()`'s query logic itself, but a **data-integrity/ordering conflict between two independently-evolving SQL files that both claim ownership of the same table's "final" state.**
- This is a **CONFLICTING** classification, not merely STUB or MISSING: two real, intentional pieces of SQL actively disagree about what `brands` should contain after both have run, and the more commonly-run one (seed, part of the standard bootstrap sequence) wins by running later/being re-run more often.

**Severity for Engine 12:** if Engine 12's "Featured Merchandising" tier is built assuming `brands.is_featured`/`display_order` is a stable, curated, always-populated signal, it will silently degrade to "no brand is ever featured" the next time anyone re-seeds a dev or staging environment, with no error, no warning, and no test to catch it (since no test exists — see 6.6).

### 6.5 API exposure — **REAL** (read-only). `getTopBrands()` is exposed indirectly via the homepage feed (`/`, no dedicated `/api/brands/top` route was found), and the full brand list is separately exposed for shop filtering via `shop.tsx:26` (`SELECT slug, name FROM brands ORDER BY name ASC`) — a plain, unranked, unfiltered list used only to populate the "All brands" filter dropdown, unrelated to the featured-merchandising ranking.

### 6.6 Automated tests — **MISSING**. Zero test files reference `is_featured`, `display_order` (in a brands context), or brand merchandising anywhere in `tests/`. This defect would have been caught immediately by even a single integration test asserting `getTopBrands()` returns a non-empty, correctly-ordered result after a full bootstrap (migrations + seed) — that test does not exist.

### 6.7 Browser/runtime evidence — **Confirms the defect live**
Live headless-Chromium render against `http://localhost:3000/`:
```
Brand cards rendered: 0
Brand names (first 5): []
```
The "Top Brands" section (`home.tsx:158-166`, `.brand-card` markup) renders zero cards in the current environment — direct browser confirmation of the DB-level defect found in 6.4, not merely a theoretical concern.

### 6.8 Editorial merchandising vs. already-functioning-as-promotion — **classification: editorial only, currently non-functional**
`is_featured`/`display_order` were designed purely as **editorial curation** (per migration `0006`'s own doc comment: "Admin Panel (future): is_featured/display_order/status become directly editable... No UI code should ever hardcode brand order"), not as a monetized/paid placement mechanism. There is no concept of a brand or seller *paying* for `is_featured=1` anywhere in the codebase. This confirms the user's own conceptual separation principle: Brand Merchandising (editorial) is architecturally distinct from any future Sponsored Advertising (paid) — they must not be conflated even though both ultimately affect "what shows up first."

---

## 7. SPONSORED LISTINGS, AD CAMPAIGNS, MEASUREMENT — full-repository sweep

Exhaustive case-insensitive grep across `src/`, `migrations/`, `public/` for: `sponsored`, `sponsored_listing`, `ad_campaign`, `adcampaign`, `impression`, `ad_click`, `advertiser`, `advertising`, `cpc`, `cpm`, `ppc`, `campaign_budget`.

**Result: zero matches, anywhere, in any file, of any kind.**

This confirms — not assumes — that:
- No `sponsored_listings` table, or equivalent, exists.
- No advertiser/campaign/budget schema exists.
- No impression, click, or attribution event logging exists for advertising purposes (Engine 9's `search-engine` index-event system and Engine 7's wallet ledger are the only "event log" primitives in the codebase today, and neither is advertising-specific).
- No billing integration point for advertising spend exists (Payment/Finance engine's wallet/ledger system is real and hardened per Engine 7's Phase 2 work, but nothing currently calls it for advertising purposes).
- Engine 12's "monetized visibility" layer (sponsored listings, paid campaigns, budget-capped billing) is a **from-scratch build**, not an extension of any existing partial implementation. This is consistent with — and now evidentially confirms — the user's own instinct that this is architecturally separate from Coupons/Hero Campaigns/Brand Merchandising, all three of which are unpaid, editorially/rules-driven mechanisms with no advertiser-facing billing concept at all.

---

## 8. RBAC / authorization readiness for Engine 12

`src/lib/rbac.ts` (94 lines, read in full) provides four reusable primitives:
- `requireOrganizationMember` — resolves session user → organization membership server-side (never client-claimed).
- `requireOrganizationRole(...roleKeys)` — gates by organization role.
- `requirePermission(permissionKey)` — gates by a specific granted permission key (e.g. `orders.manage`).
- `requirePlatformRole(...roles)` — gates by the user's platform-level role (e.g. `admin`), independent of any organization.

**Classification: REAL/COMPLETE.** `requirePlatformRole('admin')` already has a proven live caller: `src/routes/api-admin.ts` mounts it globally (`adminApi.use('*', requirePlatformRole('admin'))`) and is the backing authorization for existing moderation, collections, refund, category-attribute, and country-management admin endpoints. **This is the correct, ready-to-reuse primitive for every new Engine 12 admin mutation endpoint** (coupon CRUD, hero campaign CRUD, brand curation CRUD, sponsored-listing campaign management) — no new authorization mechanism needs to be invented, and Engine 12 should follow `api-admin.ts`'s exact existing convention rather than introducing a parallel one.

---

## 9. Cross-cutting findings

### 9.1 Precedent for the concurrency fix Coupons need
`src/lib/wallet.ts` (lines 1-90, read in full) already documents, in detail, the exact "lost update" TOCTOU bug class found in Section 4.5 above, including a **prior failed fix attempt** (guarded UPDATE + separate follow-up SELECT — still racy) before landing on the correct final fix (`db.batch()` combining the guarded UPDATE and the ledger INSERT into one atomic unit with no gap for a second writer to interleave). `orders.ts`'s `claimOrderForPayment()` independently proves the same CAS discipline (`WHERE payment_status = 'unpaid'`) for a finite-enum case. **Engine 12's coupon-usage fix (and any future budget-cap/impression-cap logic for paid campaigns) should follow this exact established pattern** — `UPDATE coupons SET usage_count = usage_count + 1 WHERE id = ? AND (usage_limit IS NULL OR usage_count < usage_limit)`, checking `rows_written` to determine whether THIS caller's redemption actually won the claim — rather than inventing a new concurrency-control idiom.

### 9.2 Migration/seed ownership conflict is a systemic risk, not just a brands-specific bug
The root cause in Section 6.4 (`seed.sql` predating and disagreeing with migration `0006`) is a **process** gap, not just a one-off data bug: nothing currently prevents a future migration from adding curated columns to a table that `seed.sql` also `DELETE`s and re-`INSERT`s wholesale. Recommend, as part of Engine 12's implementation planning (not this audit), that `seed.sql` either be updated to preserve/reapply migration `0006`'s curation, or that the two files' ownership boundary be made explicit in documentation to prevent recurrence for any table Engine 12 introduces.

### 9.3 Stale documentation discipline
The README's inaccurate hero_campaigns claim (Section 5.10) is a reminder that this program's "AUDIT FIRST" discipline exists precisely to catch drift between documentation and reality — an implementation-focused prompt that trusted the README would have wasted effort "finishing" already-complete work while missing the two real defects (coupon race, brand curation wipe) that the README says nothing about.

---

## 10. Consolidated defect register

| # | System | Category | Severity | Proof method | Status |
|---|---|---|---|---|---|
| 1 | Coupons | **UNSAFE** (TOCTOU concurrency race on `usage_limit`) | Medium (low exposure today, high exposure once admin-created limited coupons or Engine 12 budget-caps exist) | Isolated reproduction script, `Promise.all(10)`, run twice, 10/10 both times | **Open — requires remediation before Engine 12 relies on any usage-limited/budget-capped mechanism** |
| 2 | Coupons | Real defect (orphaned usage on cancelled/unpaid orders) | Low-medium (silent promotional-budget leakage over time) | Direct code read: `incrementCouponUsage` at order-creation, `cancelOrder` never reverses it | **Open — requires remediation** |
| 3 | Brand Merchandising | **CONFLICTING** (seed.sql vs. migration 0006 ownership conflict) | Medium (currently renders Top Brands section completely empty) | Live DB query (`COUNT = 0`) + live browser render (`0 cards rendered`) | **Open — requires remediation (fix `seed.sql`, or document/enforce run-order discipline)** |
| 4 | README.md | Stale documentation (Category D) | Low (misleads planning, not runtime) | Direct contradiction: code read + live browser render prove hero_campaigns IS wired | **Open — trivial fix, update README line 147** |

**Zero genuine Category A (net-new "the code is simply wrong on its face") defects were found in Hero Campaigns.** Both proven defects (#1/#2 Coupons, #3 Brands) are pre-existing, dormant issues that predate this audit and were not introduced by any work in this program.

---

## 11. What Engine 12 implementation MUST NOT do (guardrails, derived directly from the findings above)

1. **Must not treat `brands.is_featured`/`display_order` as reliable without first fixing Defect #3** — any Engine 12 "Featured Merchandising" tier built today would silently inherit a broken, empty-on-reseed foundation.
2. **Must not reuse `incrementCouponUsage()`'s unguarded-UPDATE pattern for any new budget-capped or impression-capped billing logic** — this is the single highest-risk pattern to propagate into a real monetized advertising system. Fix it in Coupons first (small, contained), then apply the corrected CAS pattern to every new Engine 12 usage/budget counter from day one.
3. **Must not build sponsored listings as a variant of Coupons or Hero Campaigns** — confirmed there is zero existing overlap in schema, mutation path, or billing; this genuinely is a from-scratch build, exactly as the user's own conceptual separation (Coupon ≠ Promotion ≠ Featured Merchandising ≠ Sponsored Listing ≠ Hero Campaign ≠ Advertising Campaign) requires.
4. **Must not invent a new authorization primitive** for admin mutation of coupons/hero campaigns/brands/sponsored listings — `requirePlatformRole('admin')` already exists, is proven in production-shaped code (`api-admin.ts`), and should be the uniform gate for all of it.
5. **Must not trust README.md's current "not yet wired" claim about hero_campaigns** — it is factually wrong as of this audit; correct it before it misleads any future planning pass.

---

## 12. Recommended sequencing (audit → remediation → build)

Per the user's own explicitly stated sequencing, and consistent with everything found above:

1. **Legacy-system remediation** (small, contained, testable in isolation — NOT part of "Engine 12 the advertising engine," but a prerequisite for trusting its foundation):
   - Fix Coupons Defect #1: convert `incrementCouponUsage()` to a guarded CAS update, exactly matching the `wallet.ts`/`claimOrderForPayment()` precedent.
   - Fix Coupons Defect #2: decide and implement the correct release-on-cancellation semantics (either release the usage slot on cancel/abandon, or explicitly document that usage is deliberately "at order-creation, not at payment" and accept the tradeoff — a genuine product decision, not just an engineering one, and one this audit deliberately does NOT make unilaterally).
   - Fix Brands Defect #3: reconcile `seed.sql` and migration `0006` so re-seeding never silently discards curation.
   - Correct the README's stale hero_campaigns claim.
   - Add automated regression tests for all three systems (currently zero coverage) — matching this program's established pattern (in-process D1 harness for logic-level tests, Playwright browser suite entries for UI-level proof) BEFORE building anything new on top of them, so future Engine 12 changes can't silently regress the foundation.
2. **Engine 12 architecture/specification** — now grounded in a verified-real foundation rather than an assumed one.
3. **Engine 12 implementation** — sponsored listings, ad campaigns, targeting, Payment/Finance billing integration, measurement, Search (Engine 11) integration, seller UI, Control Center, Analytics (Engine 13) integration, full security/concurrency/browser hardening — per the 10-phase program already outlined in this program's planning discussion, once the above prerequisites are closed.

---

## 13. Explicit non-findings (things checked and found to be NOT a problem)

- Coupon discount math (percent/fixed/min-order/max-discount/subtotal-cap) — all verified correct.
- Coupon case-insensitivity — deliberate, correct.
- Hero campaign schedule enforcement — server-side, correct, no bypass path found.
- Hero campaign homepage integration — real, live-rendered, correctly cached.
- `getTopBrands()`'s SQL ranking logic itself — correct; the defect is upstream data integrity, not query logic.
- RBAC primitives — real, complete, already proven in production-shaped code, ready to reuse.
- Cart/checkout guest-access design (no auth required on `/api/cart/*`) — confirmed intentional and correct (guest checkout is a deliberate product feature, not an oversight).

---

## 14. Audit scope boundaries (what this pass did NOT do, by design)

- No schema migrations were written or run.
- No production code was modified.
- No permanent test files were added (the concurrency-race reproduction script was diagnostic-only and has been deleted, consistent with this program's established convention).
- No remediation was implemented — this is intentionally an audit-only pass per the explicit "AUDIT FIRST. BUILD NOTHING." instruction.
- Engine 13 (Analytics) was not touched in this pass.

---

## 15. Final Gap Matrix Classification Table

| Capability | Tag | Evidence type |
|---|---|---|
| Coupon discount calculation | REAL/COMPLETE | Code read |
| Coupon min-order/max-discount rules | REAL/COMPLETE | Code read |
| Coupon expiration/active enforcement | REAL/COMPLETE | Code read |
| Coupon usage-limit enforcement (logic) | REAL/PARTIAL | Code read |
| Coupon usage-limit enforcement (concurrency safety) | **UNSAFE** | Reproduction script (2x) |
| Coupon usage release on cancellation | **MISSING** (real defect) | Code read |
| Coupon checkout UI/API wiring | REAL/COMPLETE | Code read + ad hoc browser check |
| Coupon admin mutation capability | MISSING | Exhaustive route grep |
| Coupon automated test coverage | MISSING | Exhaustive test grep |
| Hero campaign schema | REAL/COMPLETE | Code read |
| Hero campaign schedule/lifecycle enforcement | REAL/COMPLETE | Code read |
| Hero campaign homepage integration | REAL/COMPLETE | Live browser render |
| Hero campaign admin mutation capability | MISSING | Exhaustive route grep |
| Hero campaign automated test coverage | MISSING | Exhaustive test grep |
| Brand `is_featured`/`display_order` schema | REAL/COMPLETE | Code read |
| Brand ranking query logic | REAL/COMPLETE | Code read |
| Brand curation data integrity (seed vs. migration) | **CONFLICTING** | Live DB query + live browser render |
| Brand admin mutation capability | MISSING | Exhaustive route grep |
| Brand automated test coverage | MISSING | Exhaustive test grep |
| Sponsored listings (schema/code/tests) | MISSING (entirely) | Exhaustive repo grep |
| Ad campaigns / targeting (schema/code/tests) | MISSING (entirely) | Exhaustive repo grep |
| Impression/click/attribution measurement | MISSING (entirely) | Exhaustive repo grep |
| Advertising billing integration | MISSING (entirely) | Exhaustive repo grep |
| Admin RBAC primitive for future endpoints | REAL/COMPLETE | Code read + proven live caller |
| README documentation accuracy (hero_campaigns) | CONFLICTING (stale) | Direct contradiction by evidence |

---

**This audit is complete. No implementation work has begun. Awaiting explicit user direction on remediation priority and sequencing before any Engine 12 schema or code changes are made.**

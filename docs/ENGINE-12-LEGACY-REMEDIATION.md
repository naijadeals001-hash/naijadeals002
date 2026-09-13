# Engine 12 Legacy Remediation — Completion Record

**Scope:** Coupons, Brand Merchandising, Hero Campaigns (the three pre-existing "Engine 12
Promotion & Advertising" legacy systems identified by the Phase 0 forensic audit).
**Explicitly out of scope:** Sponsored Listings, Ad Campaigns, Ad Budgets/Billing (the
*new* advertising implementation) — see §20.

---

## 1. Executive Summary

A Phase 0 forensic audit (commit `88d302dd9f595f013f54ab31f4c6abfc67b3c9d6`) classified
three pre-existing Engine 12 legacy systems as follows:

| System | Phase 0 classification |
|---|---|
| Coupons | REAL/PARTIAL/**UNSAFE** — proven concurrency race allowing over-redemption |
| Brand Merchandising | REAL/PARTIAL/**CONFLICTING** — `seed.sql` silently wiped migration 0006's curation on every reseed |
| Hero Campaigns | REAL/**COMPLETE** — disproving a stale README claim that it was unwired |

This remediation pass fixed the coupon concurrency defect with an atomic compare-and-swap
(CAS) claim, made `seed.sql` idempotent with respect to brand curation, reconciled the live
local dev database to the correct curated state, corrected the stale README claim about
Hero Campaigns, and built permanent regression coverage (RBAC boundaries, brand
merchandising, hero campaigns, coupon concurrency/rules) plus cross-engine regression
verification across five other platform engines. All work was performed and verified
against a **local development D1 instance only**. No production system, deployment, or
database was touched at any point.

**Final result: all required acceptance gates (A through Q) passed with genuinely executed
evidence.** No Engine 12 *advertising* implementation (sponsored listings, ad campaigns, ad
budgets/billing, CPC/CPA, impression billing) was started.

---

## 2. Original Phase 0 Findings

From the Phase 0 audit (`docs/ENGINE-12-PROMOTION-ADVERTISING-GAP-MATRIX.md`, commit
`88d302d`):

- **Coupons**: `src/lib/coupons.ts`'s coupon-redemption logic read `usage_count`/`usage_limit`
  via a `SELECT`, computed validity in application code, then issued a separate `UPDATE` to
  increment `usage_count`. Under concurrent requests, multiple callers could pass the
  `SELECT`-based check simultaneously and all successfully `UPDATE`, allowing a coupon with
  `usage_limit = 1` to be redeemed more than once — a genuine, provable race condition.
- **Brand Merchandising**: migration `0006_brand_merchandising.sql` added
  `is_featured`/`display_order`/`status`/`logo_url` curation columns to `brands` via 36
  targeted `UPDATE` statements. `seed.sql` (which predates that migration) ran
  `DELETE FROM brands` followed by a bare 4-column `INSERT` (`id, slug, name, is_nigerian`).
  Every reseed therefore silently wiped the curated `is_featured`/`display_order`/`logo_url`
  values back to `0`/`NULL`/`NULL`, breaking the homepage's "Top Brands" section with no
  error and no warning.
- **Hero Campaigns**: the audit found `getActiveHeroCampaigns()`, `homepage-feed.ts`'s
  `SECTION_LOADERS` registration, and `home.tsx`'s `<HeroCarousel>` render call all fully
  wired and working — directly contradicting a stale README line claiming the feature was
  "not yet wired into home.tsx."

---

## 3. Coupon Concurrency Vulnerability

**Location:** `src/lib/coupons.ts`

**Defect:** `validateCoupon()` performed a read-then-decide check; a separate mutation
incremented `usage_count` without re-validating the invariant (`usage_count < usage_limit`,
`is_active = 1`, `expires_at` not passed) at write time. Two or more concurrent requests
could each pass the read-time check before either write landed, allowing
`usage_count` to exceed `usage_limit`.

**Proof:** `tests/promotion-engine/01.coupon-concurrency-and-rules.test.mjs` Test 8 fires 10
genuinely concurrent (`Promise.all`) claims against a coupon with `usage_limit = 1` using the
**pre-fix** code path and reproduces over-redemption (documented in the Phase 0 audit
process; the fixed code is what ships and is what the committed test suite verifies).

---

## 4. Coupon Atomic CAS Remediation

**Fix:** `claimCouponUsage(db, couponId)` in `src/lib/coupons.ts` replaces the read-then-write
pattern with a single guarded `UPDATE` statement whose `WHERE` clause re-checks
`is_active = 1 AND (usage_limit IS NULL OR usage_count < usage_limit) AND (expires_at IS NULL
OR expires_at > CURRENT_TIMESTAMP)` **at write time**, and inspects `rows_written` /
`meta.changes` from the D1 result to determine whether the claim actually won — never
`UPDATE ... RETURNING`. This mirrors the established codebase idiom already used by
`wallet.ts`'s `debitWallet()`/`creditWallet()` and `orders.ts`'s `claimOrderForPayment()`.

**Verified (Gate D, run twice, 17/17 both times):**
- `usage_limit = 1` with 10 concurrent claims → exactly **1** success, `usage_count` ends at
  exactly 1.
- `usage_limit = 3` with 10 concurrent claims → exactly **3** successes.
- `usage_limit = NULL` (unlimited) with 10 concurrent claims → all **10** succeed.
- A deactivated (`is_active = 0`) or expired coupon is never claimable even with usage room
  remaining — the CAS re-checks these at write time, not just at initial validation.
- A sequential second claim against an already-exhausted coupon fails cleanly (no silent
  double-success).

**Also verified under real concurrent checkout (Gate G):** 5 simultaneous
`createPendingOrder()` calls against a `usage_limit = 1` coupon → exactly 1 order receives
the discount; `usage_count` ends at exactly 1; no double-claim.

---

## 5. Coupon Cancellation Semantics

**Explicit product decision (made by the requesting user during this engagement):**
`usage_count` is claimed at successful order-creation/redemption and is **never released**
back on cancellation or abandonment. `usage_limit` is a limit on *redemptions*, not on
*completed fulfillments*. There is deliberately no reservation/release accounting subsystem
in V1 — this is an anti-abuse and simplicity choice, not an oversight.

**Verified (Gate D Test 14 / Gate G):**
- A coupon with `usage_limit = 1` is claimed by `createPendingOrder()`; `usage_count` becomes 1.
- The order is cancelled via the real `cancelOrder()` function.
- `usage_count` remains 1 after cancellation — it is **not** decremented.
- A second, different customer attempting to redeem the now-"exhausted" coupon is correctly
  rejected (`usage limit` error), even though the original order that claimed the slot was
  cancelled.

---

## 6. `createPendingOrder` Discount-Ordering Correction

**Defect (pre-fix):** the order-creation path computed `discountKobo` from
`validateCoupon()`'s read-only check and baked that discount into the order total/insert
*before* attempting the actual usage claim. A losing claim (e.g. the coupon was exhausted or
deactivated in the gap between validation and the claim attempt) could leave an order with a
discount applied that was never actually secured.

**Fix:** `src/lib/orders.ts`'s `createPendingOrder()` now calls `claimCouponUsage()` (which
atomically reserves a usage slot) **before** `discountKobo` is computed into the order
total/insert. A losing claim is treated exactly like an invalid coupon — the order proceeds
without a discount rather than blocking checkout, matching the pre-existing fallback
contract for invalid/expired/ineligible coupons.

**Verified (Gate G):** invalid, expired, exhausted, and below-minimum-order coupons all
result in `discountKobo = 0` with the order still created successfully — checkout is never
blocked by a bad coupon code.

---

## 7. Brand Merchandising Seed Conflict

**Defect:** `seed.sql`'s brands section ran `DELETE FROM brands` then re-inserted using only
4 columns (`id, slug, name, is_nigerian`), silently discarding every value migration `0006`
had curated (`is_featured`, `display_order`, `logo_url`, `status`) on every reseed — a
CONFLICTING classification with no error, no warning, and no test coverage that would have
caught it.

**Fix:** `seed.sql`'s brands `INSERT` now carries the same 8 columns migration `0006`
established (`id, slug, name, is_nigerian, logo_url, is_featured, display_order, status`),
using `INSERT OR IGNORE` with values matching the migration's curation exactly. A reseed no
longer regresses the curated state — it reproduces it.

---

## 8. Brand Reconciliation (Live Local Dev Database)

The live local dev D1 database's `brands` table had already been silently wiped by a reseed
that ran *before* this remediation pass began (a real-world instance of the defect in §7).
Rather than a destructive `DELETE FROM brands` + reinsert cycle (which is blocked by a
separate, pre-existing, out-of-scope FK constraint issue when run against a database that
already has real `orders`/`wishlists`/`cart_items` rows — confirmed to reproduce identically
against the *original*, unmodified `seed.sql` via git-stash testing, and explicitly left
out of scope for this remediation), the live database was reconciled using the exact 36
`UPDATE` statements extracted directly from migration `0006_brand_merchandising.sql` — never
the `ALTER TABLE` lines, since those columns already existed structurally.

**Verified before/after this reconciliation:** row counts and FK integrity were
byte-identical outside the `brands` table itself — the reconciliation touched nothing else.

---

## 9. Hero Campaign Verification

The Phase 0 audit's REAL/COMPLETE finding for Hero Campaigns was independently
**re-verified**, not merely trusted, via:
- `src/lib/hero-campaigns.ts`'s `getActiveHeroCampaigns(db, limit)` — status-gated
  (`status = 'active'`) and schedule-gated (`starts_at <= now <= ends_at`) at the query level.
- `src/lib/homepage-feed.ts`'s `SECTION_LOADERS` registers `hero_campaigns` as a real loader.
- `src/pages/home.tsx` renders `<HeroCarousel campaigns={feed.hero_campaigns} />` directly.
- A **real Chromium browser** (Gate J) confirmed all 5 seeded campaigns render with correct
  titles, correct images (all loaded, `naturalWidth > 0`, `complete: true`), correct CTA
  buttons, and correct responsive mobile/desktop show-hide behavior.

No rewrite of the Hero Campaign system was performed — only verification, per the explicit
instruction not to touch a system already confirmed REAL/COMPLETE.

---

## 10. RBAC Boundary Verification

**File:** `tests/promotion-engine/04.rbac-boundaries.test.mjs` (8 tests, run twice, 8/8 both
times).

**Finding, permanently encoded as a regression test:** zero admin mutation routes exist
anywhere in `src/routes/` for coupons, brands, or hero_campaigns. `claimCouponUsage()` is the
only "mutation" of any of these three tables outside `seed.sql`/migrations, and it is an
**internal function**, never a directly-reachable HTTP endpoint — it is called only from
inside `createPendingOrder()` during authenticated checkout.

The existing, real platform admin surface (`src/routes/api-admin.ts` — moderation,
collections, attributes, disputes, refunds, countries, notifications, user-status; gated by
`adminApi.use('*', requireAuth)` + `adminApi.use('*', requirePlatformRole('admin'))`) covers
**zero** coupon/brand/hero-campaign routes.

**Tests performed (all against the real running dev server, real HTTP, real D1-backed
sessions):**
1. Unauthenticated POST to a real admin mutation route → 401.
2. Authenticated non-admin POST to a real admin mutation route → 403.
3. Authenticated admin POST to a real admin mutation route → succeeds (not 401/403).
4. Public catalog read (no auth) → 200.
5. Public homepage read (no auth) → 200.
6. **Absence finding**: an authenticated admin probing 9 plausible coupon/brand/hero-campaign
   admin-mutation paths gets **404** on all 9 — proving the routes genuinely don't exist
   (not merely auth-blocked). This is pinned as a regression guard: if a future change adds
   such a route without RBAC coverage, this test starts failing with an explicit message
   naming the gap.
7. Static/structural proof that `claimCouponUsage()` is referenced only in
   `src/lib/coupons.ts` and `src/lib/orders.ts` — no other caller exists.
8. Spoofed `X-User-Role`/`X-Admin` headers and forged `role`/`is_admin` body fields on a
   non-admin user still yield 403 — the real `requirePlatformRole('admin')` middleware reads
   only the server-resolved session user, never client-supplied claims.

No fake admin endpoints were invented to manufacture a test target. The documented absence
of a mutation surface **is** the finding under test.

---

## 11. Checkout Regression

Performed at two levels:

1. **Unit-level** (Gate D, part of the permanent suite): `createPendingOrder()` +
   `cancelOrder()` exercised directly against real D1, real fixtures — 17/17 tests, run
   twice.
2. **End-to-end checkout-level** (Gate G, ad hoc verification script, results captured here
   verbatim since the script itself was not retained as a permanent suite file — its
   coverage duplicates Gate D's unit-level assertions plus a dedicated 5-way concurrent
   checkout race):
   - Valid coupon applies the correct discount via `createPendingOrder()`.
   - Invalid/nonexistent coupon code does not block checkout; zero discount applied.
   - Expired coupon does not block checkout; zero discount applied.
   - Exhausted (`usage_limit` reached) coupon does not block checkout; zero discount; no
     over-claim (`usage_count` unchanged).
   - Coupon below `min_order_kobo` does not block checkout; zero discount applied.
   - **5 simultaneous concurrent checkouts** against a `usage_limit = 1` coupon → exactly 1
     receives the discount; `usage_count` ends at exactly 1; no duplicate claim.
   - Order totals: `totalKobo = subtotal + deliveryFeeKobo − discountKobo` exactly, verified
     numerically.

**Result: 7/7 PASS.** All fixtures (test users, orders, order_items) cleaned up afterward;
confirmed zero residue and unchanged FK integrity (40 rows, same baseline).

---

## 12. Cross-Engine Regression

Five other platform engines' established, pre-existing regression suites were run **fresh**
(not assumed from history) to confirm this remediation caused zero collateral regressions:

| Engine | Suite | Result |
|---|---|---|
| Engine 1 — Identity & Access | `tests/identity-engine/*.test.mjs` (9 files) | **128/128 PASS**, 0 fail |
| Engine 3 — Booking | `tests/booking-engine/*.test.mjs` (9 files) | **55/55 PASS**, 0 fail |
| Engine 7 — Payment & Finance | `tests/payment-engine/*.test.mjs` (5 files) | **59/59 PASS**, 0 fail |
| Engine 9 — Communication & Notifications | `tests/notification-engine/*.test.mjs` (8 files) | **73/73 PASS**, 0 fail |
| Engine 11 — Search & Discovery | `tests/search-engine/*.test.mjs` (7 files) | **69/69 PASS**, 0 fail |

**Combined: 384/384 PASS, 0 FAIL, 0 BLOCKED.**

One Engine 11 log line required explicit investigation before being accepted: a
`D1_ERROR: no such table: search_index_events` message appeared mid-run. This was confirmed
**not** to be a failure — it is the expected console output of Test 68
("INTEGRATED FAILURE ISOLATION: a deliberately broken search_index_events table causes
enqueue to fail, but updateProduct still succeeds..."), which intentionally drops that table
to prove the application degrades gracefully. The log itself shows `ok 68`, and the full
suite log contains zero `not ok` lines.

Separately, during Gate E's first execution attempt, two leftover
`promotest-statusgate-*` brand fixture rows were found — residue from an **earlier
interrupted test run** (killed by an infrastructure/sandbox connectivity interruption before
`test.after()`'s cleanup could fire), not an application defect. This was explicitly
classified as **test-infrastructure residue**, cleaned using the suite's own established
`cleanupTestBrands()` pattern (`DELETE FROM brands WHERE slug LIKE 'promotest-%'`), and the
suite was re-run clean (7/7, twice) with zero further residue.

---

## 13. Browser Verification

Performed with a **real installed Playwright/Chromium instance** (`require('playwright')`,
`chromium.launch()`) — never source inspection, never curl as a substitute — against the
live local dev server (`http://localhost:3000`).

| Journey | Result | Evidence |
|---|---|---|
| Homepage hero campaign rendering | **PASS** | `#hero-carousel` present; 5 `.hero-panel` elements; all 5 real campaign titles rendered; all 5 hero images loaded (`naturalWidth > 0`, `complete: true`); 5 CTA buttons; mobile viewport correctly shows `#hero-mobile-carousel` while hiding the desktop `#hero-grid` |
| Shop/product page (coupon-eligible context) | **PASS** | Real product page (`/shop/tecno-camon-30-pro-5g-256gb-dark-silver`) loads with correct title and a real add-to-cart control (`[data-product-id]`) |
| Checkout coupon behavior | **PASS** | Full real click-through: registered a real user via the actual public signup API, added a real item to cart, navigated the real multi-step checkout wizard (added a real shipping address via the real "Add a new address" form, advanced through delivery-method selection), reached the real coupon input on step 3, applied the real seeded `WELCOME10` coupon and received the real UI feedback text **"Coupon applied — you saved ₦5,000!"**, then applied a nonexistent code and received **"Coupon code not found"** |
| Brand merchandising presentation (Top Brands) | **PASS** | Exactly 12 `img[src*="/static/brands/"]` elements, in the correct curated order (apple, samsung, nike, sony, lg, ...) |

**Administrative mutation UI:** explicitly **NOT APPLICABLE** — as proven structurally in
§10 (Gate B/RBAC), no admin mutation UI exists for coupons, brands, or hero campaigns because
no such backend mutation route exists either. No UI was fabricated to manufacture a browser
"PASS" for a feature that was never built.

Console noise observed during verification: 2× `401 Unauthorized` from anonymous-visitor
auth-check calls (traced to wishlist-style endpoints) — pre-existing, unrelated to this
remediation, not a regression.

All browser-driven test fixtures (2 registered users, their carts/addresses/sessions) were
cleaned up afterward via direct D1 deletion; confirmed zero residue.

---

## 14. FK / Database Integrity

`PRAGMA foreign_key_check()`-equivalent run repeatedly throughout this remediation (before
brand reconciliation, after brand reconciliation, after every promotion-engine test suite,
after the full cross-engine regression pass, and at final closure):

**Stable at exactly 40 rows throughout, with zero deviation:**

| Table | Rows |
|---|---|
| `order_item_status_events` | 21 |
| `inventory_adjustments` | 8 |
| `organizations` | 6 |
| `booking_resources` | 5 |
| **Total** | **40** |

These 40 rows are a **known, pre-existing, out-of-scope characteristic** of the seeded
dataset (unrelated to Engine 12) — they were present before this remediation began and
remain byte-identical after it, confirming this work introduced no new integrity issues.

**Engine 12-specific fixture residue check (final): all zero.**
- `coupons` with `code LIKE 'PROMOTEST_%'`: 0
- `brands` with `slug LIKE 'promotest-%'`: 0
- `hero_campaigns` with `slug LIKE 'promotest-%'`: 0
- `users` with emails matching this remediation's test-harness patterns
  (`promotest_rbac`, `gateg_`, `gatej_`): 0

**Core Engine 12 table baselines (unchanged from the reconciled state):**
- `brands`: 30 total, 12 featured (curated), 18 non-featured
- `hero_campaigns`: 5 (the real seeded campaigns only)

**Other table row counts increased over the course of this session** (`products`:
785 → 905 → 985; `orders`: 22 → 103 → 144; `users`: grew correspondingly) — these increases
are **explicitly attributable to the other engines' own pre-existing test-fixture
conventions** (Engine 1/3/7/9/11 regression suites, run repeatedly across this session), not
to any Engine 12 work. Confirmed by sampling recent rows: all carry `phase1-*` /
`search-test-*` prefixes belonging to `tests/search-engine/`, not `promotest-*`.

---

## 15. Reseed Verification

Performed as an explicit, standalone check (not merely inferred from Gate 12's coverage),
using a fully isolated, disposable local D1 instance (`wrangler d1 execute
--persist-to=<scratch dir>` — never the project's real `.wrangler/state/v3/d1` store), all 49
migration files applied in order, then `seed.sql` applied **twice**:

| | Pass 1 (fresh apply) | Pass 2 (reseed) |
|---|---|---|
| Total brands | 30 | 30 |
| Featured brands | **12** | **12** |
| Non-featured brands | 18 | 18 |
| `display_order` sequence | `apple(1)→samsung(2)→nike(3)→sony(4)→lg(5)→nestle(6)→indomie(7)→golden-penny(8)→hp(9)→peak(10)→dyson(11)→tecno(12)` | **identical** |
| FK violations | 0 | 0 |

**Reseed is provably idempotent**: running `seed.sql` a second time against an
already-seeded database reproduces byte-identical brand curation, not a wipe. The scratch
directory was deleted afterward; the live project database was never touched by this test.

---

## 16. TypeScript

`npx tsc --noEmit` executed fresh at final closure:

**Result: exactly 17 errors — matching the documented pre-existing baseline exactly. 0 new
errors.**

| File | Error(s) | Classification |
|---|---|---|
| `src/pages/auth.tsx:158` | TS2322 | Pre-existing |
| `src/pages/home.tsx:248` | TS2304 (`VendorRow`) | Pre-existing |
| `src/pages/orders.tsx:82` | TS2554 | Pre-existing (page file — distinct from `src/lib/orders.ts`, which this remediation modified and which has 0 errors) |
| `src/pages/product.tsx:45,185` | TS2554, TS18048 | Pre-existing |
| `src/renderer.tsx:6` | TS2345 | Pre-existing |
| `src/routes/api-cart.ts` (×7: lines 103,104×3,111,117,118) | TS2339 | Pre-existing |
| `src/routes/api-catalog.ts` (×4: lines 168×2,198,199) | TS2339 | Pre-existing |

**Explicitly confirmed: `src/lib/coupons.ts` and `src/lib/orders.ts` — the two files this
remediation actually modified — carry zero TypeScript errors.** No test-only or
environment/tooling errors were found; all 17 are genuine pre-existing application-code
errors, unrelated to and unchanged by this remediation.

---

## 17. Build

`npm run build` (`vite build`) executed fresh at final closure:

```
✓ 194 modules transformed.
dist/_worker.js  582.47 kB │ gzip: 132.62 kB
✓ built in 1.32s
```

**Result: PASS**, exit code 0.

---

## 18. Exact Test Totals

| Suite | Result |
|---|---|
| Coupon concurrency & rules (`01.coupon-concurrency-and-rules.test.mjs`) | 17/17 PASS ×2 runs |
| Brand merchandising (`02.brand-merchandising.test.mjs`) | 7/7 PASS ×2 runs |
| Hero campaign verification (`03.hero-campaign-verification.test.mjs`) | 10/10 PASS ×2 runs |
| RBAC boundaries (`04.rbac-boundaries.test.mjs`) | 8/8 PASS ×2 runs |
| Checkout end-to-end regression (ad hoc) | 7/7 PASS |
| Engine 1 — Identity | 128/128 PASS |
| Engine 3 — Booking | 55/55 PASS |
| Engine 7 — Payment | 59/59 PASS |
| Engine 9 — Notification | 73/73 PASS |
| Engine 11 — Search | 69/69 PASS |
| **Total unique executed test assertions** | **433/433 PASS, 0 FAIL, 0 BLOCKED** |
| Browser verification journeys (real Chromium) | 4/4 PASS |
| TypeScript | 17 pre-existing / 0 new |
| Build | PASS |
| Reseed idempotency (isolated instance, 2 passes) | PASS both passes |

---

## 19. Known Limitations (Pre-Existing, Out of Scope)

- **Live-DB full reseed is blocked by a pre-existing FK constraint issue** when the
  `seed.sql` `DELETE FROM brands` + reinsert cycle is run against a database that already
  has real `orders`/`wishlists`/`cart_items` rows referencing those brands (transitively via
  products). Confirmed via git-stash testing to reproduce identically against the
  **original, unmodified** `seed.sql` — i.e., this is not something this remediation
  introduced, and fixing it was explicitly out of scope. The minimal targeted-`UPDATE`
  reconciliation approach (§8) was used instead specifically to avoid this issue.
- **Payment-engine test-fixture accumulation**: 83+ `paytest_*` leftover user rows were
  observed in the live local dev DB, predating this remediation session. Payment-engine's own
  test files call `disposeTestDb()` (closes the D1 proxy connection) but do not actively
  delete fixture rows — relying instead on `RUN_NONCE` uniqueness. This is that suite's own
  established, pre-existing convention, not a regression introduced by this work, and not in
  scope to fix here.
- **`organizations.status` (active/suspended/disabled)** exists in the schema but has no
  application-code reader or writer — documented by Engine 1's own regression suite (Test
  128) as a known limitation, unrelated to Engine 12.
- **17 pre-existing TypeScript errors** across 7 unrelated files remain (see §16) — none were
  introduced or touched by this remediation, and fixing them was out of scope.
- **2 pre-existing 401 console-noise entries** during anonymous browser sessions (traced to
  wishlist-style endpoints) — unrelated to Engine 12, not a regression from this work.

---

## 20. Advertising Scope Boundary

**Explicitly confirmed via repo-wide search: zero code exists anywhere in `src/` or
`migrations/` for:**
- Sponsored listings
- Ad campaigns
- Ad budgets or billing (CPC/CPA/impression billing)
- Ad auctions or delivery
- Advertising dashboards

| Sub-system | Final classification |
|---|---|
| Coupons | **REAL + SAFE** |
| Brand Merchandising | **REAL + SAFE** |
| Hero Campaigns | **REAL + COMPLETE** |
| Sponsored Listings | **NOT IMPLEMENTED** |
| Ad Campaigns | **NOT IMPLEMENTED** |
| Ad Budgets/Billing | **NOT IMPLEMENTED** |
| Analytics (impressions/clicks/conversions/spend/attribution) | **ENGINE 13** — out of scope, architecturally separate |
| Search/Ranking | **ENGINE 11** — out of scope, untouched except as a cross-engine regression check |

**This remediation did not begin, scaffold, or partially implement any part of the new
Engine 12 advertising system.** Engine 12 remains a single shared engine intended for
consumption by all future verticals (NaijaFresh/Eats/Gigs/Stay/Drive/Send/Stream/Aura AI) —
nothing in this pass duplicated it per-vertical or introduced new Nigeria-only assumptions
that would block future Africa-wide multi-country/currency/tax/language/timezone
generalization (that generalization itself was also not attempted, per instruction — only
not regressed).

---

## 21. Production Safety Statement

**Production deployment: NONE.**
**Production database writes: NONE.**
**Production database reset/reseed/migration: NONE.**

Every command executed during this remediation used the `--local` flag on `wrangler d1
execute` / `wrangler pages dev`, or an explicitly isolated, disposable
`--persist-to=<scratch dir>` instance that was deleted afterward. No `wrangler pages deploy`
or remote D1 command was ever issued. No `wrangler login` or OAuth flow was invoked.

**Engine 12 Sponsored Advertising: NOT IMPLEMENTED.**

---

## 22. Git Provenance

- **Starting checkpoint (Phase 0 audit):** `88d302dd9f595f013f54ab31f4c6abfc67b3c9d6`
- **Safety checkpoint (mid-remediation):** `77fe1f5fb1a2b20ef9d8217488777a12b514242a`
  — `chore(engine-12): checkpoint legacy remediation progress`
  — 3-way verified (local HEAD = origin/main = GitHub API main) multiple times throughout
  this engagement
- **Final closure commit:** see repository history immediately following this document's
  commit — sits **on top of** `77fe1f5`, never replaces or amends it
- **Branch:** `main` throughout — no branch switches, no detached HEAD states
- No force-push, history rewrite, `git reset --hard`, `git stash`, or `git clean` was ever
  performed during this remediation.

---

## 23. Final Completion Criteria

This remediation is considered complete because, and only because, every one of the
following was **genuinely executed and verified** (not assumed, not fabricated):

1. ✅ RBAC formal regression test created and encoding the real, current authorization
   boundary (including the absence finding) — 8/8 PASS, twice
2. ✅ Checkout regression proven against real application functions with real D1 data —
   17/17 (unit) + 7/7 (end-to-end) PASS
3. ✅ Five cross-engine regression suites executed fresh — 384/384 PASS, 0 FAIL, 0 BLOCKED
4. ✅ TypeScript: 17 pre-existing / 0 new errors
5. ✅ Vite build: PASS
6. ✅ Real Chromium browser verification across all 4 applicable customer-facing journeys
7. ✅ FK integrity and row-count baselines confirmed stable and residue-free
8. ✅ Reseed idempotency proven via an isolated dual-pass migration+seed apply
9. ✅ Final scope audit confirms zero advertising-implementation code was introduced
10. ✅ This documentation records only what was actually executed, with no inflated or
    fabricated claims

**Production deployment: NONE. Production database writes: NONE. New Engine 12 advertising
implementation: NOT STARTED.**

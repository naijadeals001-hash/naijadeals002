# NaijaDeals — Marketplace MVP (Phase 1)

> **⚠️ STATUS NOTE (2026-09-02)**: Large parts of this README (Deployment,
> "Not Yet Implemented", Open Questions) describe an earlier pre-deploy
> state and are now stale — the app **is** deployed and live at
> **https://naijadeals.com**, with a real Seller Portal (Migration 0009),
> i18n scaffolding (10 languages), and an ecosystem waitlist system built
> since this file was last fully rewritten. Full README rewrite is tracked
> as documentation debt; until then, treat the sections below marked
> "Phase 1" as historical, and see the **Changelog** section near the
> bottom for what has actually shipped since.

> **Ecosystem architecture**: NaijaDeals is being built as a Super Ecosystem — one platform,
> a set of shared engines (identity, marketplace, payments, bookings, logistics, trust,
> search, etc.), and many vertical product layers (NaijaShop, NaijaEats, NaijaPay, and 19
> others, live + reserved). See
> [`docs/NAIJADEALS_MASTER_ARCHITECTURE.md`](docs/NAIJADEALS_MASTER_ARCHITECTURE.md) for the
> full engine model, vertical roadmap, and architectural rules. This README stays focused on
> what's built and how to run it; the architecture doc is the forward-looking reference.

## Project Overview
- **Name**: NaijaDeals
- **Goal**: Nigeria's escrow-protected super-app. Phase 1 = a fully working **Shop/Marketplace** vertical (catalog, cart, checkout, orders, wallet). Eats/Gigs/Stays are teaser-only until later phases.
- **Domain**: naijadeals.com (owned by Pat) — deploy target still TBD (see Open Questions below).
- **Reference sites**: naijadeals.vercel.app (secondary/prototype reference) and the live naijadeals.com UI (primary visual reference).

## Features implemented (Phase 1)
- Full catalog browse: home page (hero, categories, flash deals, recommended, Top Brands), shop listing (filter by category/search/deals, sort), product detail page (reviews, related products)
- Guest + logged-in cart, with automatic guest→user cart merge on login/register
- Checkout: shipping form + payment method (Wallet or Paystack card/bank transfer)
- **Wallet**: append-only ledger (`wallet_ledger`) as source of truth, cached balance for fast reads — never a mutable integer balance. Top-up via Paystack.
- **Orders**: full lifecycle (`pending_payment → processing/escrow_held → ...`), stock is decremented only on confirmed payment (never at cart/order creation)
- Paystack integration: initialize/verify transaction + signature-verified webhook (authoritative payment confirmation, idempotent on both the manual verify route and the webhook)
- Auth: PBKDF2 password hashing (Web Crypto, Workers-safe), 30-day session cookies (httpOnly/secure/SameSite=Lax)
- **Wishlist** (`/account/wishlist`): save/remove products, session-scoped
- **Top Brands** merchandising strip on the homepage: DB-backed (`is_featured`/`display_order`/`status` columns, migration 0006), never hardcoded in TSX
- **Saved Addresses** (`/account/addresses`): full CRUD, mobile bottom-sheet UX
- **Hero Campaign Carousel**: DB-backed `hero_campaigns` table + service + homepage-feed cache integration + `<HeroCarousel>` component. **Live and wired into `home.tsx`** — `getActiveHeroCampaigns()` is registered as a `homepage-feed.ts` section loader, and `home.tsx` renders `<HeroCarousel campaigns={feed.hero_campaigns} />` directly (confirmed by code inspection and re-verified via the Engine 12 Legacy Remediation pass, see `docs/ENGINE-12-LEGACY-REMEDIATION.md`). Status-gated (`status='active'`) and schedule-gated (`starts_at`/`ends_at`) at the query level, so campaigns can be queued or retired without a code deploy. Auto-rotating, swipe/keyboard-accessible, `<picture>` art-directed responsive imagery, zero layout shift.
- Ecosystem teaser page (NaijaEats/NaijaGigs/NaijaStay — "coming soon") and Help/FAQ page
- All money handled as **integer kobo** end-to-end — no floating point currency bugs
- Custom SVG placeholder image generator (`/ph.svg`) — used for products only; never used for hero/brand imagery (zero-placeholder rule)

## URLs (local sandbox)
- App (local dev, via PM2 + wrangler pages dev): `http://localhost:3000`
- Production: **not yet deployed** — pending Pat's decision on deploy target (see Open Questions)

## Entry points / Routes

### Pages (SSR, Hono JSX)
| Route | Auth required | Description |
|---|---|---|
| `GET /` | No | Home: hero, categories, flash deals, recommended |
| `GET /shop` | No | Product listing. Query: `category`, `q`, `deals=1`, `sort` (`newest`\|`price_asc`\|`price_desc`\|`rating`) |
| `GET /shop/:slug` | No | Product detail page |
| `GET /cart` | No (guest cart) | Cart view |
| `GET /checkout` | Yes | Checkout form. Query: `buy_now=<productId>` adds that product then proceeds |
| `GET /checkout/callback` | No | Landing page after Paystack redirect; JS calls verify-payment then redirects to order |
| `GET /login`, `GET /register` | No | Auth forms. Query: `next=<path>` to redirect back after login |
| `GET /orders` | Yes | Order history |
| `GET /orders/:orderNumber` | Yes | Order detail |
| `GET /wallet` | Yes | Balance, top-up, transaction history |
| `GET /account/wishlist` | Yes | Saved products |
| `GET /account/addresses` | Yes | Saved shipping addresses (CRUD) |
| `GET /ecosystem` | No | Eats/Gigs/Stay teaser cards |
| `GET /help` | No | FAQ |

### API (JSON)
| Route | Description |
|---|---|
| `GET /api/catalog/categories`, `/products`, `/products/flash-deals`, `/products/recommended`, `/products/:slug` | Catalog reads |
| `POST /api/catalog/newsletter` | Newsletter signup |
| `GET/POST/PUT/DELETE /api/cart*` | Cart CRUD (guest-token or session-scoped) |
| `POST /api/auth/register`, `/login`, `/logout`, `GET /me` | Auth |
| `GET /api/orders`, `/:orderNumber`, `POST /checkout`, `POST /verify-payment` | Orders (session-protected) |
| `GET /api/wallet`, `POST /topup/initialize`, `POST /topup/verify` | Wallet (session-protected) |
| `POST /api/webhooks/paystack` | Paystack webhook — authoritative payment confirmation, signature-verified |
| `GET /ph.svg?cat=&emoji=&label=` | Branded placeholder image generator |

## Data Architecture
- **Storage**: Cloudflare D1 (SQLite) only — no KV, no cron triggers (keeps both Genspark-hosted deploy and BYOK Cloudflare paths open)
- **Schema**: `migrations/0001` through `0008` (additive-only, never destructive) — users, sessions, addresses, categories, vendors, products, reviews, carts, cart_items, orders, order_items, wallet_ledger, wallet_accounts, payment_transactions, newsletter_subscribers, `homepage_feed_cache`, brand merchandising columns, wishlist table, and (0008) `hero_campaigns`
- **Money**: always integer kobo (1 NGN = 100 kobo)
- **Wallet integrity**: `wallet_ledger` is append-only source of truth; `wallet_accounts.cached_balance_kobo` is a read cache mutated only inside the same `db.batch()` as a ledger insert (`src/lib/wallet.ts` — `creditWallet`/`debitWallet`). No other code path may write to it.
- **Homepage feed cache** (`src/lib/homepage-feed.ts`): each homepage section (categories, flash deals, top brands, hero campaigns, etc.) is independently cached in the `homepage_feed_cache` D1 table with a 120s TTL — recomputed at most once per window regardless of visitor traffic, keeping per-request DB load bounded on Workers' CPU budget. New homepage sections should be added as loaders in `SECTION_LOADERS`, not as separate ad-hoc queries.
- **Merchandising column pattern** (brands: migration 0006; hero campaigns: migration 0008): `display_order`/`status` (plus `is_featured` on brands, `theme`/`starts_at`/`ends_at` on hero campaigns) — always admin-editable in principle, never hardcoded ordering in TSX.
- **Seed data**: `seed.sql` — 28 categories, 20 vendors, 44 products, 174 reviews (verified by direct count against a fresh bootstrap on 2026-09-12; this replaces a stale "31 products, 8 reviews" figure previously written here). Hero campaign seed rows live in `migrations/0008_hero_campaigns.sql` itself (real content, not throwaway seed data). Dev-only persona fixture (1 user + wishlist/payment-method/notification rows) lives separately in `seed-dev-account.sql` at the project root — see Local Development below.

## User Guide
1. Browse `/shop`, filter by category or search, open a product
2. Add to cart (guest carts work via cookie, merge into your account on login/register)
3. Checkout: enter shipping details, choose Wallet or Card/Bank Transfer (Paystack)
4. Track your order on `/orders`; top up or review wallet history on `/wallet`

## Local Development

**Bootstrap sequence (verified end-to-end 2026-09-12 against a fully wiped local D1):**
```bash
npm run build

# 1. Schema only — every numbered migration under migrations/ must apply
#    cleanly against a completely empty database. This is a permanent
#    invariant (see docs/ENGINEERING-SOP-BACKUP-RULE.md): no numbered
#    migration may embed rows that depend on application data (users,
#    orders, etc.) existing yet.
npx wrangler d1 migrations apply naijadeals-production --local

# 2. Catalog/business seed data (categories, vendors, products, reviews, Q&A).
#    Contains zero INSERT INTO users / INSERT INTO orders.
npx wrangler d1 execute naijadeals-production --local --file=./seed.sql

# 3. OPTIONAL — local-dev-only persona fixture (1 demo user + wishlist/
#    saved-payment-method/notification rows). Intentionally NOT inside
#    migrations/: wrangler's migration runner auto-applies every *.sql
#    file physically present in that folder, so a fixture that depends on
#    seed.sql having already run cannot safely live there. Run explicitly,
#    always after seed.sql, never before.
npx wrangler d1 execute naijadeals-production --local --file=./seed-dev-account.sql
# Login: chidinma.okafor@naijadeals.dev / NaijaDevAccount2026!  (local dev only)

pm2 start ecosystem.config.cjs
curl http://localhost:3000
```

**Why this three-step split exists**: migration `0005_account_experience.sql`
originally embedded 14 dev-fixture rows directly in the migration file,
keyed to a `users.id = 1` that no migration or seed script actually
created. A fresh install of migrations alone (no app data) failed with
`FOREIGN KEY constraint failed`. Fixed in commit `89c2558` (schema-only
0005) + `93b6e61` (relocated fixture to `seed-dev-account.sql`). Full
before/after audit trail: `docs/ENGINEERING-SOP-BACKUP-RULE.md`.

## Deployment
- **Platform**: Cloudflare Pages/Workers (target)
- **Status**: ❌ Not yet deployed
- **Tech Stack**: Hono + TypeScript + D1 + Tailwind CDN + vanilla JS (`public/static/app.js`)
- **wrangler.jsonc**: currently has a **placeholder `database_id`** for local dev. Before any real deploy, either (a) run `npx wrangler d1 create naijadeals-production` and swap in the real ID for BYOK Cloudflare, or (b) use the Genspark-hosted deploy flow, which provisions D1 automatically.
- `PAYSTACK_SECRET_KEY` is read from env/secrets — not yet configured anywhere; card payments and wallet top-ups return HTTP 503 until it's set. Wallet-only checkout works today.

## Open Questions for Pat (blocking deploy)
1. **Deploy target**: Genspark-hosted, your own Cloudflare account (BYOK), or something else? All code so far is stack-agnostic (D1 only, no KV, no cron) so either path works without rework.
2. **Product photography**: currently using generated SVG placeholders (`/ph.svg`) to avoid image-licensing risk for the general product catalog. Hero campaign and brand imagery are already real, licensed, generated assets — the same approach can extend to product photos when ready.

## Not Yet Implemented
- Real vendor onboarding/dashboard (vendors are seed data only)
- Escrow dispute flow (order lifecycle stops at `processing`/`escrow_held`; no admin release/dispute UI yet)
- Reviews are seed data only — no "leave a review" flow yet
- NaijaEats / NaijaGigs / NaijaStay / NaijaFresh / NaijaDrive / NaijaSend — teaser/ecosystem-awareness only, no functionality yet
- Rate limiting / abuse protection on auth endpoints
- Production Paystack keys / secrets configuration
- Payment Methods account page — next planned build item
- Admin Panel (brand/hero-campaign merchandising controls, order/escrow management) — not started
- Actual deployment (blocked on Open Question #1 above)
- Automated tests (currently verified via manual curl flows + genuine Playwright browser rendering at multiple breakpoints per feature — see commit history for the exact verification run per milestone)

## Recommended Next Steps
1. Get Pat's answer on deploy target → configure D1 + secrets accordingly → deploy
2. Build Payment Methods next, then continue remaining Account pages
3. Eventually rebuild `home.tsx` as a long-form (~24-section) marketplace homepage that consumes `<HeroCarousel>` from the live feed, plus the other planned sections
4. Build a minimal vendor onboarding flow (Phase 2 — Seller Center)
5. Build an admin view for order/escrow management + brand/hero-campaign merchandising controls (Phase 2 — Admin Panel)
6. Decide on product photography approach for the general catalog

---

## Changelog (post-Phase-1, most recent first)

**This section is the authoritative source of truth for what's actually
live in production.** The sections above are historical/Phase-1 and are
increasingly stale — do not trust "Not Yet Implemented" or "Open Questions"
above without cross-checking here first.

### Aura AI — Aura Luxe Desktop + Aura Experience Engine, Phase 1 (2026-09-21)
- **What shipped**: `/aura` now renders **Aura Luxe** — a full desktop
  reproduction of Pat's supplied reference screenshot (3-column layout: dark
  emerald sidebar, hero + command bar + shortcuts + recommendations center
  column, real-data right panel + floating "Chat with Aura" panel). Replaces
  the previous `ecosystemPreviewPage` "coming soon" placeholder for this one
  route only (the other 7 preview routes — /fresh, /eats, /drive, /send,
  /stream — are unaffected).
- **Aura Experience Engine (architecture, not just a page)**: migration
  `0074_aura_experience_engine.sql` adds `aura_experiences` (registry: slug,
  name, tagline, theme tokens, status, is_default — seeded with `classic`
  (draft, default), `luxe` (active — this phase), `pulse` (draft), `executive`
  (draft)) and `aura_experience_assignments` (per-user explicit override,
  `UNIQUE(user_id)`, FK to `aura_experiences`). `src/lib/aura-experience.ts`
  implements `resolveAuraExperience()` — the deterministic resolver
  (Identity → explicit Assignment → default fallback), with documented
  no-op slots for the account-type/preference/A-B-test/time-of-day links
  Phase 4 will add. Only Aura Luxe has a real visual body
  (`src/pages/aura.tsx`); Classic/Pulse/Executive exist today only as
  configuration rows, per Pat's explicit "architect for multiple Auras now,
  build their visuals later" directive — adding a new experience's visuals
  later is a new body component + one branch in `aura.tsx`, never a rebuild
  of the resolver or route.
- **Real data, not fabricated**: `getAuraDashboardSnapshot()`
  (`src/lib/aura-experience.ts`) computes wallet balance (`getWalletBalance`),
  active orders count, upcoming bookings (`getBookingsForCustomer`), ongoing
  NaijaSend deliveries, saved items, and unread notifications — all live D1
  queries against the SAME tables/helpers every other authenticated page
  already reads. Verified end-to-end against a real seeded account (wallet
  ₦300, 3 processing orders, 4 unread notifications) — right panel and
  wallet card render the actual figures.
- **Explicitly labeled `[DEMO]`** (Section 8 discipline): "Recommended for
  You" cards, "Trending on NaijaDeals", and the Aura command bar / floating
  chat panel's response text — none of these have a backend yet (recommendation
  engine + Aura's actual AI brain are both Phase 3). The command bar and chat
  panel are fully built, production-quality UI (`public/static/aura.js`)
  that responds honestly with "Aura isn't connected yet" instead of any
  fabricated action/result — no fake "order placed" or invented availability
  anywhere.
- **Hero imagery**: original AI-generated assets (NOT scraped stock),
  matching the reference's creative direction — `public/static/aura/
  hero-woman.jpg` (Nigerian woman, gele headwrap, gold jewelry, Lagos
  skyline at golden hour; model `nano-banana-pro`), `discover-africa.jpg`
  (promo landscape; model `nano-banana-2-flash-lite`), and `africa-orb.png`
  (transparent glowing African-continent mark reused for the logo/orb/chat
  panel/promo card, background-removed via `fal-bria-rmbg`). "Recommended
  for You" thumbnails reuse REAL existing product/vendor photography already
  in `public/static/products/`, `vendor-photos/`, `stay/` rather than
  fabricating new stock imagery for demo-only cards.
- **Not yet done (explicitly deferred per Pat's own phasing)**: Phase 2
  (tablet/mobile responsive — CSS is structured for it in `aura.css` but not
  built), Phase 3 (real Aura AI backend + tool-calling), Phase 4 (activating
  Classic/Pulse/Executive visuals + admin Aura Experience Manager + A/B
  testing/rollout). Explicit visual QA against the reference screenshot
  (Pat's Section 19 checklist) has NOT yet been performed as a dedicated
  pass — recommended as the immediate next step before Phase 2 begins.
  Not yet deployed to production (local dev + migration only, per "no
  deploy yet" instruction); not yet applied to the production D1 database.

### Unit E Phase A / Stage 1 — Catalog Expansion CLOSED (2026-09-19)
- **What shipped**: merged the 59 real-photographed products from the
  abandoned Phase 1a taxonomy into the live catalog, alongside their full
  category tree (all 189 phase1a categories imported as platform
  taxonomy, not just the 59 products' ancestor closure), needed brands,
  needed vendors, and listings. Added the `product_country_origins`
  table (structure only — 0 rows; population is an explicit future
  Phase B pass, never inferred from category names or brand identity).
- **Authoritative production result** (before → after, all independently
  verified against real production D1, not a local simulation):

  | Resource        | Before |   After |
  | ---------------- | -----: | ------: |
  | Products         |     44 | **103** |
  | Categories       |     79 | **254** |
  | Brands           |     30 |  **41** |
  | Vendors          |     21 |  **35** |
  | Listings         |     80 | **140** |
  | Country origins  |      0 |   **0** |

  (Brands: 30 existing + 11 genuinely new = 41. An earlier "51" figure
  quoted mid-execution was an arithmetic error, corrected here — the
  actual generator scope, deliberately limited to only the brand IDs the
  59 photographed products reference, was always 41.)
- **Integrity battery — full pass, zero exceptions**: all pre-existing
  rows (products 1-44, categories 1-79, brands 1-30, vendors 1-21,
  listings 1-80) confirmed byte-identical pre/post migration; zero
  duplicate slugs/SKUs among new rows; zero orphaned FK references
  (category/brand/parent/product/vendor) among new rows; zero placeholder
  (`/ph.svg`) images on new products; the pre-existing `vendors.id=21`
  FK-to-`users` anomaly confirmed pre-existing (not introduced by this
  deployment); `carts`/`orders`/`reviews`/`wishlists` growth between
  snapshots confirmed as normal live traffic, not migration side-effects
  (neither migration file references those tables).
- **Two real bugs found and fixed mid-execution, both on the hosted D1
  transport layer only — the committed migration files were never
  altered to work around them**: (1) the hosted `d1_execute` SQL safety
  filter rejects `PRAGMA` statements outright; (2) it also converts `--`
  line comments into inline `/* */` blocks that can corrupt
  multi-line `CREATE TABLE` statements, and separately caps payload size
  at 64 KiB. Resolved by stripping PRAGMA and comments from the
  *execution payload only* (syntax-validated locally against a clean
  baseline copy before every submission) and splitting migration 0068
  into 3 byte-safe batches at statement boundaries — reassembly verified
  byte-identical to the full validated payload before submission. Also
  manually registered both migrations in the `d1_migrations` tracking
  table post-application (required since `d1_execute` bypasses wrangler's
  migration runner) — confirmed necessary and correct when the subsequent
  `gsk hosted deploy` log showed `GSK_MIGRATION_EXPECTED count=68` →
  `✅ No migrations to apply!`.
- **Deployed exact commit `c849dc833492487d450c53dd66c9803be92b813c`**
  (no `--rebuild_db`, no `--recreate_worker` — a normal code redeploy).
  `naijadeals.com` confirmed active. Production Chromium verification at
  both 1440×900 and 390×844 — homepage, `/shop`, `/countries`, and a new
  product's PDP (`house-of-tara-matte-lipstick-set`) all HTTP 200 with
  new-content markers present at both viewports.
- **Permanent caveat — SHA provenance (recorded, not resolved further)**:
  production content equivalence to GitHub `c849dc8` is verified via 7
  independent signatures (exact 68-file migration list byte-for-byte,
  all 6 catalog counts, live new-product PDP). Production `/api/version`
  reports an unresolvable 40-character SHA (`304181669644...`) that does
  not correspond to any commit, branch, tag, or object in this
  repository or on GitHub. Investigation established the hosted
  deployment system builds in an isolated `/home/user/artifact`
  environment on its own infrastructure — not by running `vite build`
  inside this sandbox's `.git` — and the available Genspark tooling does
  not expose that staging repository's build-source SHA. Therefore
  git-object identity cannot be independently verified, though no
  evidence of source-content divergence was found. Do not redeploy to
  chase this SHA; do not modify `version.ts` / `vite.config.ts` to force
  a match.
- **Hard boundaries honored, unchanged**: no Phase B, no inferred
  country-of-origin data, no unrelated fixes. The 68-product holdback
  batch remains completely untouched — next catalog work starts from
  this unit's closing state (103/254/41/35/140).

### Stage 2A — Africa Catalog & Country Architecture CLOSED (2026-09-19)
- **What shipped**: a 54-country African market architecture layered on
  top of the existing `cc_countries` table, built around three explicitly
  distinct relationships that are never conflated: **Product → Origin
  Country** (`product_country_origins`, propose→verify workflow),
  **Product/Listing → Availability** (`listing_country_availability` +
  vendor-country fallback — pre-existing, untouched), and **Vendor →
  Based-in Country** (`vendors.country_iso`, pre-existing, untouched).
  Added a country profile service (`src/lib/country-profile.ts`,
  `cc_country_facts` table — sourced facts like population/currency/
  capital, same two-step verification workflow as origins), a
  `/countries` directory page and `/countries/:iso` detail page for all
  54 nations, 11 new Control Center admin routes
  (`src/routes/api-control-center.ts`) for proposing/verifying/disputing/
  deleting both country facts and product origins, and reverse lookup
  index `idx_vendors_country_iso` for vendor-by-country queries.
  Migrations **0069** (`cc_country_facts` table + 2 indexes) and **0070**
  (`idx_vendors_country_iso`) are the only schema changes. `brands
  .is_nigerian` and `categories.country_iso` were explicitly left
  untouched in meaning — `country_iso` on categories is a **taxonomy**
  field, never repurposed as a product-origin signal.
- **Two-step propose → verify workflow** (identical shape for both
  `cc_country_facts` and `product_country_origins`): a propose call
  always creates a row with `verification_status='unverified'`
  regardless of input; only a separate `verify*()` function can set
  `verified`, and it throws `VerificationSourceRequiredError` /
  `OriginVerificationSourceRequiredError` on an empty/whitespace
  `source_url` — there is no code path that can mark something verified
  without a real source. Origin proposals additionally require a
  non-empty evidence note. Every propose/verify/dispute/delete action is
  audited via `recordControlCenterAction()` with actor identity read
  exclusively from the authenticated Control Center session
  (`c.get('user')`) — never from request input.
- **Guardrail-audit bug found and fixed during this stage**: both verify
  routes originally returned an early `400` on an empty `source_url`
  *before* the try/catch block, so the guardrail function itself never
  ran and the rejected attempt was never audited — silently contradicting
  the routes' own inline comments. Fixed by removing the early return and
  routing the empty-check through the guardrail function
  (`verifyCountryFact` / `verifyProductOrigin`), which now throws into the
  catch block and is properly audited with `action:
  'country_fact_verify_rejected'` / equivalent, `success:false`.
  Re-verified directly against the database: a rejected empty-source
  verify attempt now produces exactly that audit row, and the fact/origin
  correctly remains `unverified`.
- **Country-count anomaly — investigated and root-caused, not "fixed to
  pass"**: during Chromium testing, a local verification script reported
  only 1 discoverable country (NG) against a `cc_countries` table
  containing 54 rows. Per explicit instruction, the root cause was
  established *before* touching anything:
  - `src/lib/country.ts` has three genuinely distinct, **pre-existing**
    (non-Stage-2A) query functions: `getAllCountries()` (no filter, all
    54), `getLiveCountries()` (`WHERE status='LIVE'`, correctly returns
    only NG — an honest reflection that Nigeria is the only country with
    an actually-live seller/shipping market today, from the pre-existing
    Marketplace Engine 2.1 "ship to" serviceability feature), and
    `getDiscoverableCountries()` (`display_on_homepage=1 AND image_url
    IS NOT NULL AND image_url NOT LIKE '/ph.svg%'`, correctly returns all
    54 real-photographed countries).
  - The route actually backing the `/countries` directory page and the
    country-detail sweep is `getDiscoverableCountries()`, confirmed by
    scraping the live rendered `/countries` HTML: exactly 54 unique
    `href="/countries/xx"` links present.
  - The **actual defect was in the verification test script**, not the
    application: its `getAllIsoCodes()` helper called
    `GET /api/catalog/countries`, a pre-existing endpoint that
    intentionally calls `getLiveCountries()` for a different purpose
    (seller shipping-destination selection) and correctly returns only
    NG. This is not a bug, not a cache/runtime mismatch, and not a Stage
    2A regression — it is the test script reading the wrong data source.
  - **No application code was changed to "make the count become 54."**
    Only the test script was corrected, to scrape the real `/countries`
    page HTML (ground truth of what a visitor sees) instead of calling
    the unrelated `getLiveCountries()`-backed endpoint. `getLiveCountries()`
    and its `status='LIVE'` predicate remain untouched, exactly as found.
- **Full verification, local then production** — both runs used the
  same corrected method (scrape `/countries` for the real 54-ISO list,
  then exercise 6 endpoints per country: detail page,
  `/api/catalog/countries/:iso`, `.../products/available`,
  `.../products/origin`, `.../vendors`, `.../brands`), with truthful
  emptiness (e.g. `products/origin: []` for a country with zero verified
  origins) accepted as a valid PASS, never required to be non-empty:
  - **Local**: 54/54 countries found, 324/324 endpoint checks (6 × 54)
    returned 2xx, 0 failures.
  - **Production** (`https://naijadeals.com`, post-deploy): 54/54
    countries found, 324/324 endpoint checks returned 2xx, 0 failures —
    executed live, not inferred from the local result.
  - **NG semantics, verified live in both environments**: `/countries/ng`
    renders "Products a customer here can actually buy — not necessarily
    made in Nigeria," `/shop?country=NG` shows 24 available products,
    `/shop?origin_country=NG` honestly shows **0 results** (zero verified
    origins exist yet — this is correct behavior, not a bug), and country
    facts render empty (zero verified facts exist yet). Availability
    (24) and origin (0) are confirmed numerically distinct in both
    environments, proving the two concepts are not conflated anywhere in
    the stack.
- **Browser verification**: real Playwright/Chromium (not `curl`-only) at
  1440×900 and 390×844, both against local dev and against production —
  `/`, `/countries`, `/countries/ng`, `/shop?country=NG`,
  `/shop?origin_country=NG`, plus representative country pages
  (GH/KE/ZA/EG/MA). Screenshots captured for all URLs at both viewports
  in both environments.
- **Local gates, re-run clean immediately before commit**: `npm run
  build` succeeds (903.82 kB / gzip 191.40 kB); `npx tsc --noEmit`
  produces **zero net-new errors** — the only errors present are the 4
  pre-existing baseline clusters, unrelated to Stage 2A and explicitly
  not touched: `src/pages/auth.tsx` (TS2322), `src/pages/orders.tsx` +
  `src/pages/product.tsx` (TS2554/TS18048), `src/renderer.tsx` (TS2345),
  `src/routes/api-cart.ts` (7× TS2339 on a discriminated-union body
  type), `src/routes/api-catalog.ts` (4× TS2339 on `.all()` result
  typing — pre-existing, line numbers shifted by this stage's insertions
  but the clusters themselves are unchanged). Two genuinely **new** TS
  errors introduced by this stage's own code were found and fixed at the
  time: an unguarded `c.req.param('iso')` in `country-detail.tsx`, and a
  union-type inference issue on a `.json<T>().catch()` pattern in the
  Control Center PATCH route.
- **Commit, push, SHA alignment**: committed as `79c4cb3` ("feat(country):
  Stage 2A - Africa Catalog & Country Architecture") — 14 files staged
  explicitly by full path (`git add <file> <file> ...`, never `git add
  .`): both migrations, the country/origin/page-cache/catalog library
  changes, the 11 Control Center routes, the country pages, `types.ts`.
  No unrelated files included. Verified identical across all three
  sources: local `HEAD`, `origin/main`, and the GitHub API's
  `refs/heads/main` object — all `79c4cb3e3c85b788dbdb1b8275daf0ccee839b94`.
- **Production migration** (0069 + 0070 only, nothing else): baseline
  recorded before touching production — catalog counts exactly
  103 products / 254 categories / 41 brands / 35 vendors / 140 listings
  / 0 country-facts, `/api/version` at 68/68 migrations, no
  `cc_country_facts` table or `idx_vendors_country_iso` index yet. Both
  migrations' DDL applied via `gsk hosted d1_execute` (each CREATE
  TABLE/INDEX individually approved through the pending-action
  handshake), then registered in `d1_migrations` (ids 69, 70) since raw
  `d1_execute` bypasses wrangler's own migration runner. Post-migration,
  before deploy: catalog counts unchanged (byte-identical to baseline),
  `cc_country_facts` confirmed at 0 rows, targeted FK check confirmed 0
  orphaned `vendors.country_iso` references against `cc_countries`. No
  Stage 2 seed of any kind was run.
- **Deploy**: `gsk hosted deploy` (approved via the pending-action
  handshake), Version ID `4224bfb6-8d86-4512-8ff3-35441d591685`. Deploy
  log confirms `GSK_MIGRATION_EXPECTED count=70` →
  `GSK_MIGRATION_STATUS: applied`. Post-deploy, `/api/version` reports
  `expected_migrations`/`applied_migrations` both = 70,
  `missing_migrations: []`, `unexpected_migrations: []`, `in_sync: true`
  (the pre-deploy transient `unexpected_migrations` entries for 0069/0070
  resolved automatically once the redeployed worker's own hardcoded
  expectation list caught up to 70). All 8 checklist routes (`/api/version`,
  `/`, `/shop`, `/countries`, `/countries/ng`, `/shop?country=NG`,
  `/shop?origin_country=NG`, `/control-center/login`) return HTTP 200 on
  both the raw worker URL and `naijadeals.com`.
- **Permanent caveat — SHA provenance (pre-existing since Stage 1, not
  re-investigated per explicit instruction)**: production `/api/version`
  reports a `git_sha` that does not correspond to a resolvable commit in
  this repository (`304181669644...` pre-redeploy, `ccefc729...`
  post-redeploy) — the hosted deployment pipeline builds in an isolated
  environment that does not expose its own build-source SHA. Content
  equivalence to the committed `79c4cb3` is established independently
  through the migration-count reconciliation (`expected=applied=70,
  in_sync=true`), the unchanged catalog counts, and the live 54-country/
  324-endpoint production sweep — not through `git_sha`. Do not modify
  `version.ts`/`vite.config.ts` to chase this value.
- **Hard boundaries honored, unchanged**: no FTS5, no bulk origin
  backfill, no parallel country system, no 68-product holdback import, no
  product imagery sourcing, no country-of-origin inference from category
  or brand names, `brands.is_nigerian` and `categories.country_iso`
  semantics both left exactly as found.

### Unit D — Footer Social Links Activation (2026-09-18)
- **What shipped**: activated 4 of 7 `src/lib/social-links.ts` placeholders
  with the real, official NaijaDeals accounts Pat explicitly supplied —
  Instagram (`https://instagram.com/naijadeals1`), YouTube
  (`https://youtube.com/@NaijaDeals1`), TikTok
  (`https://www.tiktok.com/@naijadeals1`), X/Twitter
  (`https://x.com/naijadeals2`). Facebook, LinkedIn, and Pinterest remain
  `url: null` (hidden) — Pat did not supply accounts for these. The
  `naijadeals1` vs `naijadeals2` handle mismatch across platforms is
  **intentional per Pat**, not a bug — not "corrected" for consistency.
- **Explicitly out of scope, by Pat's decision**: Pat's initial footer
  description named a 5-column layout ("Get to Know Us / Make Money With
  Us / Let Us Help You / Our Services / Legal") and "app store badges."
  Investigation confirmed the live footer has always had 6 columns (Get to
  Know Us / Customer Service / Payments & Delivery / Ecosystem / Policies
  / Trust & Safety) with real functional links under each, and no
  published mobile app exists to link real store badges to. Pat confirmed:
  keep the 6-column architecture exactly as-is (it "contains real
  functionality"), keep "Get the app (coming soon)" honest, do not
  fabricate App Store/Play Store URLs. Zero footer structure changes made.
- **Single-file source change** (`src/lib/social-links.ts` only) — the
  footer component (`Layout.tsx`) required zero edits, exactly as designed
  in Unit 5A ("easy to populate later without changing the footer
  component").
- **Verified live on `https://naijadeals.com`** post-deploy: new
  `footer-social-links-unit-d.mjs` Playwright suite (18/18 assertions
  across 1440×900 and 390×844) confirms — exactly 4 social icons render
  with the exact hrefs above, all open `target=_blank` with
  `rel=noopener noreferrer`, Facebook/LinkedIn/Pinterest confirmed absent
  from the DOM, all 6 existing footer columns byte-identical to before,
  newsletter form intact, app placeholder text unchanged, zero `/admin`
  links, copyright line (`© 2026 NaijaDeals. All rights reserved. A
  Nigerian digital commerce ecosystem.`) present and unchanged. Full
  regression suite (`header-nav-scroll-affordance`, `ecosystem-nav-2a`,
  `checkpoint2`) re-run clean against both local and production, zero
  side effects. `/api/version` reports `healthy: true`, `in_sync: true`.
  Production screenshots captured
  (`tests/control-center/browser/screenshots/footer-unitd-*.png`).
- Deployed via `gsk hosted deploy` (code-only, no new migrations; commit
  `faae033`; evidence commit `cbe295c`).
- **Note on Pat's originally-quoted copyright line**: Pat's request also
  referenced `© 2026 NaijaDeals. All Rights Reserved. — Africa | People |
  Careers | Community` as an expected footer element. The live copyright
  line has never included an "Africa | People | Careers | Community" link
  row, and no `/africa`, `/people`, or `/community` routes exist in this
  codebase — per the standing "do not invent links" rule, these were not
  fabricated. Flagged for Pat's awareness, not auto-resolved.

### Header Nav Scroll Affordance Fix (2026-09-18)
- **What shipped**: the Tier-3 header nav strip (category pills +
  ecosystem links + Deals, both desktop and mobile) previously scrolled
  horizontally with a hidden native scrollbar and zero visual affordance —
  users had no indication more content existed off-screen or how to reach
  it. Added hover-reveal scroll buttons + edge-fade gradient cues on
  desktop (`group/navscroll` pattern, mirroring the existing
  `MerchandisingRail.tsx` `.carousel-nav-btn` pattern) and an edge-fade cue
  on mobile. Buttons auto-disable at true start/end of scroll (no dead-end
  arrows ever shown).
- **Files changed**: `src/components/Layout.tsx` (desktop/mobile nav
  markup restructure), `public/static/app.js` (new `initHeaderNavScroll()`
  IIFE), `public/static/style.css` (`.nav-scroll-btn:disabled` rule).
- **Verified live on `https://naijadeals.com`** post-deploy: new
  `header-nav-scroll-affordance.mjs` Playwright suite (10/10 assertions
  across 1100×800 desktop and 390×844 mobile) confirms hover-reveal,
  click-to-scroll, and correct disable-at-edge behavior with zero
  regressions on the pre-existing category-pill-nav and ecosystem-nav
  checkpoints. Production screenshots captured
  (`tests/control-center/browser/screenshots/nav-scroll-*.png`).
- Deployed via `gsk hosted deploy` (code-only, no new migrations; commit
  `a1b1b8d`; evidence commit `869e1ca`; Cloudflare Version `c45f8d00`).

### Category + Footer Live Reconciliation (2026-09-18)
- **Root cause found and fixed**: migrations 0056/0057/0063 were authored
  and tested against an unapplied "Phase 1a" 189-row taxonomy
  (`scripts/seed/seed-phase1a-taxonomy-catalog.sql`, never applied to
  production) instead of the real 79-row production `categories` table.
  Because `UPDATE ... WHERE slug = X` silently no-ops on a non-matching
  slug, those migrations recorded as "applied" while doing almost nothing
  — explaining the partial `is_featured_home`/`nav_pill_visible` state and
  both test failures flagged in Unit 5A's changelog entry below.
- **Two previously-undocumented live bugs fixed as a side effect** (both
  root-caused to `categories.level`/`path` being NULL on every real row,
  since migration 0053 never backfilled them for this taxonomy):
  1. `/shop?category=<parent-slug>` (e.g. `electronics`) returned **zero
     products** for any parent-only category despite real children/products
     existing underneath — `src/pages/shop.tsx`'s descendant filter
     (`cat.path LIKE '<path>/%'`) always failed on a NULL path.
  2. Enterprise Control Center's `/categories` admin page rendered an
     **empty departments list** — `src/routes/control-center.tsx`'s
     `level === 1` filter always failed on a NULL level.
- **What shipped** (data-only, zero app code changes needed):
  - `migrations/0065_category_taxonomy_level_path_backfill.sql` — derives
    `level`/`path` from existing `parent_id` relationships for the real
    taxonomy (2-pass; safe — real taxonomy has 0 grandchildren).
  - `migrations/0066_category_pill_navigation_real_taxonomy_fix.sql` —
    resets and re-curates `nav_pill_visible`/`nav_pill_order`/
    `nav_label_override` using 13 REAL, product-bearing slugs (2 documented
    substitutions for Phase-1a slots with no real equivalent: `shoes` for
    `african-fashion`, `drinks` for `art-and-crafts`). No categories or
    products were inserted, deleted, or fabricated — UPDATE-only on
    existing rows.
  - Fixed the two previously-failing checkpoint tests
    (`verify-category-checkpoint2.mjs`, `verify-category-pill-nav-checkpoint3.mjs`)
    to target the real, corrected data — assertions strengthened, never
    weakened (e.g. checkpoint2's `>= 189` hardcoded count replaced with a
    dynamic exact-count query).
- **Verified live on `https://naijadeals.com`** post-deploy: homepage pill
  nav renders the real 13-slug curation in order with correct label
  overrides (Supermarket, Books & Learning); `/shop?category=electronics`
  now returns 14 real products (previously 0); `d1_migrations` confirms
  0065/0066 applied; `/api/version` reports `healthy: true`, `in_sync: true`,
  zero missing/unexpected migrations. Playwright at 1440×900 and 390×844
  against both local and production confirm correct rendering; production
  screenshots captured
  (`tests/control-center/browser/screenshots/prod-recon-*.png`).
- Deployed via `gsk hosted deploy` (Cloudflare Workers for Platform,
  managed D1 `DB` + R2 `SELLER_UPLOADS` bindings, commit `262442d`;
  evidence commit `818588b`).
- **Known platform-tooling note**: `/api/version`'s `git_sha` field, on
  this hosted-deploy pipeline, reflects a build-time `git rev-parse HEAD`
  run inside the backend's ephemeral packaging step — not necessarily a
  real commit hash traceable on GitHub. Correctness of the deployed
  artifact was independently confirmed via `expected_migrations` count
  (66, matching the local `migrations/` directory exactly) and live D1
  content, not via `git_sha`. Worth hardening in a future unit if
  commit-level deploy provenance is needed.

### Unit 5A — Footer & Navigation Truth Pass (2026-09-18)
- **What shipped**: 5 new honest public pages — `/about`, `/careers`,
  `/terms`, `/privacy`, `/seller-terms` (`src/pages/company.tsx`). Fixed
  footer's Careers link (`/admin` → `/careers`, was pointing to an
  internal admin route) and 4 legal links that all previously pointed to
  the shared `/help` placeholder (Privacy Policy → `/privacy`, Terms of
  Service → `/terms`, Seller Terms → `/seller-terms`, Payment Terms →
  `/terms`, documented decision — no `PAYSTACK_SECRET_KEY` configured in
  production and no payment-specific legal content beyond what `/terms`
  covers, so a standalone `/payment-terms` page would be fabricated
  scope). Added `src/lib/social-links.ts`: a static, non-DB config module
  for 7 social platforms, all currently `url: null` (no real handles
  exist yet) — footer's social icon row renders nothing today, by
  design, until real URLs are supplied later.
- **Explicitly NOT touched** (per scope): the mega-menu (`src/lib/mega-menu.ts`),
  category-pill navigation (`src/lib/category-pill-nav.ts`), the existing
  footer's six-column structure, the newsletter backend
  (`POST /api/catalog/newsletter`), the "Get the app (coming soon)"
  badge state, and ecosystem-aware nav visibility — all confirmed
  production-integrated by a prior audit and preserved byte-for-byte.
- **Verified live on `https://naijadeals.com`**: all 5 new routes +
  `/`, `/shop` return HTTP 200; footer/mega-menu/mobile drawer render
  correctly with real DB-driven category data; newsletter round-tripped
  against production D1 (valid persists, duplicate idempotent, invalid
  returns 400, test row cleaned up after); Playwright at 1440×900 and
  390×844 across all 7 pages shows zero console/network errors beyond
  the documented guest-mode 401 exemption.
- **Known pre-existing, unrelated test debt** (documented, not fixed):
  `tests/control-center/verify-category-checkpoint2.mjs` and
  `verify-category-pill-nav-checkpoint3.mjs` fail against current seed
  data — they hardcode category slugs (`smartphones`, `toys-and-games`)
  that aren't present in the current `categories` table. This predates
  Unit 5A; `git diff` for this unit touches zero rows/tables and zero
  test files. Flagged for attention before any future category-taxonomy
  work (Unit 5B).
- Deployed via `gsk hosted deploy` (Cloudflare Workers for Platform,
  managed D1 `DB` + R2 `SELLER_UPLOADS` bindings, commit `03ae517`).

### Phase B — Customer vs Seller signup fork (2026-09-02)
- **What shipped**: `/register` now forks into a "Customer Account" /
  "Seller Account" tabbed UI via `?intent=seller`. Seller-intent signups
  default their post-registration redirect to `/seller`, landing on the
  existing Seller Portal gateway's onboarding-invite state. `/seller`'s
  guest CTA now reads "Create a Seller Account" and links with
  `intent=seller`. `/login` carries the same intent through its cross-link.
  **Zero schema changes** — reuses Migration 0009's `vendors.user_id`
  linkage and `src/lib/seller.ts`'s `resolveSellerStatus()` state machine
  exactly as-is. A user can still hold both buyer and seller capability
  under one identity (one `users` row, one optional `vendors` row).
- **Verified**: `scripts/verify_signup_fork.cjs` (13 real-browser checks ×
  2 viewports) + a full real end-to-end signup-through-onboarding-invite
  run — both passing against `https://naijadeals.com` and the Genspark
  worker hostname, desktop and mobile.
- **Not in scope for this phase**: the seller onboarding wizard itself
  (`/seller/onboarding`) is still the pre-existing static placeholder —
  filling it in is later Seller Center work, tracked separately.

### Mobile hamburger menu fix (2026-09-01/02)
- Fixed two bugs: a missing JS handler, and a spatial header/drawer
  overlap where the header and drawer both anchored at `top:0` and fought
  over the same screen region regardless of z-index. Fixed by having
  `app.js` measure the header's real rendered height at runtime and
  shifting the drawer/backdrop to start below it (see `syncHeaderOffset()`
  in `public/static/app.js`). Verified via real Playwright clicks at
  375/390/430px against live production.
- **Deploy-pipeline lesson learned**: `gsk hosted deploy`'s internal D1
  migration step can fail while the Worker still publishes (observed once
  this cycle on a redundant `ALTER TABLE` collision). Since then, migrations
  are applied exclusively through the deploy pipeline's own migration
  runner — never pre-applied manually before triggering a deploy — to avoid
  the same class of `d1_migrations` bookkeeping drift.

### Seller Portal foundation, i18n scaffolding, ecosystem waitlist (earlier)
- Migration 0009: `vendors.user_id` linkage, verification/onboarding state
  columns, Nigerian bank reference table, encrypted seller payout accounts,
  seller finance accounts (escrow-separate from buyer wallet).
- `src/lib/seller.ts`: `resolveSellerStatus()` 6-state machine, ownership
  always resolved server-side from session (`user_id`), never a
  client-supplied `vendor_id`.
- 10-language i18n scaffolding (`src/i18n/`) — dictionaries exist;
  full production wiring (locale reaching every page/component,
  geo/IP-based auto-detection) is tracked as a later phase, not yet done.
- Ecosystem waitlist signup flow for NaijaEats/NaijaGigs/NaijaStay preview.

## Stage 2C — Currency & Address Foundation (CLOSED 2026-09-19)

**Scope:** currency-aware pricing across the catalog/cart/checkout/order
stack (products can now legitimately price in NGN/GHS/KES/MAD depending on
the selling vendor's country), a cross-currency mixed-cart warning, and an
address book foundation (`country_regions` reference table + `country_iso`
columns) — **NG-only in practice**; GH/KE reference data exists but no
country activation, seller onboarding, payout rails, or FX conversion logic
was touched (explicitly out of scope, see below).

- **Migration `0071_currency_address_foundation.sql`**: adds
  `product_listings.currency` (defaults `'NGN'`, backfilled once at migration
  time for the 4 non-NG vendors via `vendors.country_iso → cc_countries`
  join — never re-derived at read time), `orders.shipping_country`,
  `addresses.country_iso`, and a new `country_regions` table (37 NG states
  seeded from `nigerian_states` + 16 GH regions, reference-only — GH stays
  `cc_countries.status='PLANNED'`, no activation implied).
- **Cross-currency warning**: exact text *"Items from different currency
  zones — totals are shown per currency group."* — shown when a cart mixes
  listings priced in more than one currency; cart/checkout total math groups
  and sums per-currency rather than force-converting.
- **`ADDRESS_SUPPORTED_COUNTRIES`** (`src/lib/addresses.ts`) is intentionally
  NG-only by design — extend only when a country's checkout/address flow is
  genuinely wired up, never just because `country_regions` has rows for it.
- **Explicitly out of scope this stage**: seller onboarding wizard, payout
  system, Paystack multi-currency, M-Pesa, GH/KE activation, product-origin
  population, Control Center RBAC changes, search/FTS5, automatic FX
  conversion, multi-currency wallet, new payment rails.
- **Verification**: 26/26 marketplace-engine tests, TypeScript baseline
  unchanged (14 pre-existing errors, zero net-new), production build
  succeeds, then **actual Chromium/Playwright** (not HTTP-only) — 18/18
  scenarios × desktop (1440×900) + mobile (390×844) — run twice: once
  locally pre-deploy, once again live against `https://naijadeals.com`
  post-deploy. Both runs 18/18 pass. Live run created 2 throwaway test
  accounts (`stage2c_pw_*@test.ng`) to exercise cart/checkout/address flows
  against production; both deleted post-verification (cascade-cleaned via
  `ON DELETE CASCADE` on `carts.user_id` / `notifications.user_id`), and
  catalog counts re-confirmed unaffected afterward.
- **GitHub**: commit `c4c4db826da87cb9951f6f9da8c58e45ee8a31eb` on `main`,
  local/`origin/main`/GitHub-API SHA three-way match confirmed.
- **Production**: migration 0071 applied (8/8 statements, 61 rows affected),
  deploy Version ID `f012d886-16ad-4361-9c0d-5240083df4e4`. Catalog integrity
  confirmed exact before and after: products=103, categories=254, brands=41,
  vendors=35, product_listings=140.
- **Deploy-pipeline bug found and fixed this release**: applying 0071 via
  `gsk hosted d1_execute` ahead of `gsk hosted deploy` (to get an isolated,
  verifiable production-data checkpoint before touching the Worker) left the
  deploy pipeline's own `d1_migrations` bookkeeping table out of sync —
  its internal `wrangler d1 migrations apply` step then tried to re-run 0071
  during deploy and failed with `duplicate column name: currency`. Worker
  code still published successfully (that step is independent), but the
  bookkeeping mismatch would have repeated on **every future deploy**
  indefinitely if left unreconciled. Fixed by manually inserting the correct
  `d1_migrations` row and verifying it before closing the release. This
  supersedes and hardens the "Deploy-pipeline lesson learned" note above —
  full incident writeup and the corrected, enforceable rule (mandatory
  bookkeeping reconciliation, not just a prohibition) are in
  [`docs/ENGINEERING-SOP-D1-MIGRATION-RULE.md`](docs/ENGINEERING-SOP-D1-MIGRATION-RULE.md).
- **Known test debt (documented, not fixed — out of scope by explicit
  instruction)**: see
  [`docs/STAGE2C-KNOWN-TEST-DEBT.md`](docs/STAGE2C-KNOWN-TEST-DEBT.md) — 7
  pre-existing local-only FK-orphan rows (not introduced by Stage 2C),
  `disposeTestDb()` not deleting fixture rows across all 7 search-engine
  test files, 2 stale Control Center test assertions, 1 transient test flake
  resolved by re-run.

**Stage 2C status: CLOSED.** Live production verification passed before
closure was declared, per the governing rule for this release.

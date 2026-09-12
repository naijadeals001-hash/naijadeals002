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
- **Hero Campaign Carousel foundation** (this pass — see below): DB-backed `hero_campaigns` table + service + homepage-feed cache integration + `<HeroCarousel>` component, ready for `home.tsx` to consume in the eventual homepage rebuild. Auto-rotating, swipe/keyboard-accessible, `<picture>` art-directed responsive imagery, zero layout shift. **Not yet wired into `home.tsx`** — the live homepage still shows the older static `/static/banners/*` images until that rebuild happens.
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
- **Hero Campaign Carousel is built but not yet wired into `home.tsx`** — the DB table, service, cache loader, component, and client JS all exist and are Playwright-verified; the homepage itself still needs a rebuild pass to consume `feed.hero_campaigns` via `<HeroCarousel>` in place of the static `/static/banners/*` grid
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

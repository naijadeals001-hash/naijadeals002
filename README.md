# NaijaDeals — Marketplace MVP (Phase 1)

## Project Overview
- **Name**: NaijaDeals
- **Goal**: Nigeria's escrow-protected super-app. Phase 1 = a fully working **Shop/Marketplace** vertical (catalog, cart, checkout, orders, wallet). Eats/Gigs/Stays are teaser-only until later phases.
- **Domain**: naijadeals.com (owned by Pat) — deploy target still TBD (see Open Questions below).
- **Reference sites**: naijadeals.vercel.app (secondary/prototype reference) and the live naijadeals.com UI (primary visual reference).

## Features implemented (Phase 1)
- Full catalog browse: home page (hero, categories, flash deals, recommended), shop listing (filter by category/search/deals, sort), product detail page (reviews, related products)
- Guest + logged-in cart, with automatic guest→user cart merge on login/register
- Checkout: shipping form + payment method (Wallet or Paystack card/bank transfer)
- **Wallet**: append-only ledger (`wallet_ledger`) as source of truth, cached balance for fast reads — never a mutable integer balance. Top-up via Paystack.
- **Orders**: full lifecycle (`pending_payment → processing/escrow_held → ...`), stock is decremented only on confirmed payment (never at cart/order creation)
- Paystack integration: initialize/verify transaction + signature-verified webhook (authoritative payment confirmation, idempotent on both the manual verify route and the webhook)
- Auth: PBKDF2 password hashing (Web Crypto, Workers-safe), 30-day session cookies (httpOnly/secure/SameSite=Lax)
- Ecosystem teaser page (NaijaEats/NaijaGigs/NaijaStay — "coming soon") and Help/FAQ page
- All money handled as **integer kobo** end-to-end — no floating point currency bugs
- Custom SVG placeholder image generator (`/ph.svg`) — see "Product Photography" open item below

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
- **Schema**: `migrations/0001_initial_schema.sql` — users, sessions, addresses, categories, vendors, products, reviews, carts, cart_items, orders, order_items, wallet_ledger, wallet_accounts, payment_transactions, newsletter_subscribers
- **Money**: always integer kobo (1 NGN = 100 kobo)
- **Wallet integrity**: `wallet_ledger` is append-only source of truth; `wallet_accounts.cached_balance_kobo` is a read cache mutated only inside the same `db.batch()` as a ledger insert (`src/lib/wallet.ts` — `creditWallet`/`debitWallet`). No other code path may write to it.
- **Seed data**: `seed.sql` — 10 categories, 12 vendors, 31 products, 8 reviews (all using `/ph.svg` placeholder images)

## User Guide
1. Browse `/shop`, filter by category or search, open a product
2. Add to cart (guest carts work via cookie, merge into your account on login/register)
3. Checkout: enter shipping details, choose Wallet or Card/Bank Transfer (Paystack)
4. Track your order on `/orders`; top up or review wallet history on `/wallet`

## Local Development
```bash
npm run build
pm2 start ecosystem.config.cjs
curl http://localhost:3000
# DB commands:
npx wrangler d1 migrations apply naijadeals-production --local
npx wrangler d1 execute naijadeals-production --local --file=./seed.sql
```

## Deployment
- **Platform**: Cloudflare Pages/Workers (target)
- **Status**: ❌ Not yet deployed
- **Tech Stack**: Hono + TypeScript + D1 + Tailwind CDN + vanilla JS (`public/static/app.js`)
- **wrangler.jsonc**: currently has a **placeholder `database_id`** for local dev. Before any real deploy, either (a) run `npx wrangler d1 create naijadeals-production` and swap in the real ID for BYOK Cloudflare, or (b) use the Genspark-hosted deploy flow, which provisions D1 automatically.
- `PAYSTACK_SECRET_KEY` is read from env/secrets — not yet configured anywhere; card payments and wallet top-ups return HTTP 503 until it's set. Wallet-only checkout works today.

## Open Questions for Pat (blocking deploy)
1. **Deploy target**: your message "I own the naijadeals.com domain, but I will be hosting it here....." was cut off — Genspark-hosted, your own Cloudflare account (BYOK), or something else? All code so far is stack-agnostic (D1 only, no KV, no cron) so either path works without rework.
2. **Product photography**: currently using generated SVG placeholders (`/ph.svg`) to avoid image-licensing risk (many "CC-licensed" search results turned out to be Amazon/Walmart/eBay commercial photos). For a real launch we need either (a) vendor-uploaded photos once vendor onboarding exists, or (b) a curated `image_generation` batch now for the initial catalog.

## Not Yet Implemented
- Real vendor onboarding/dashboard (vendors are seed data only)
- Escrow dispute flow (order lifecycle stops at `processing`/`escrow_held`; no admin release/dispute UI yet)
- Address book (schema exists — `addresses` table — but not wired into checkout; shipping is entered fresh each time)
- Reviews are seed data only — no "leave a review" flow yet
- NaijaEats / NaijaGigs / NaijaStay — teaser cards only, no functionality
- Rate limiting / abuse protection on auth endpoints
- Production Paystack keys / secrets configuration
- Actual deployment (blocked on Open Question #1 above)

## Recommended Next Steps
1. Get Pat's answer on deploy target → configure D1 + secrets accordingly → deploy
2. Decide on product photography approach → execute
3. Wire `addresses` table into checkout (save/reuse shipping addresses)
4. Build a minimal vendor onboarding flow (Phase 2)
5. Build an admin view for order/escrow management (Phase 2)
6. Add automated tests (currently verified via manual curl flows only — see commit history for the exact test sequence run)

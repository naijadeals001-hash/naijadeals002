# NaijaDeals Master Ecosystem Architecture

**Status**: Living architecture document — permanent project reference
**Created**: 2026-08-31
**Owner**: Pat (Founder)
**Scope**: This document defines how NaijaDeals is built as a **Super Ecosystem**, not a
collection of independent apps. It reserves 12 future verticals, formalizes 15 shared
platform engines, and sets the architectural rules that govern every future feature.

**This document does NOT authorize building any new vertical.** It exists so that when a
vertical *is* authorized, it plugs into existing engines instead of forcing a rebuild of
identity, payments, orders, reviews, or search.

Related documents:
- [`README.md`](../README.md) — current feature status, routes, and "what's built today" changelog.
- [`DEPLOYMENT.md`](../DEPLOYMENT.md) — the non-negotiable build → migrate → deploy → verify pipeline.
  This document is architecture; `DEPLOYMENT.md` is process. Do not merge them.

---

## 1. The Core Idea: One Platform → Shared Engines → Many Verticals

> "The shared engines are the real product foundation. The verticals are what customers see."
> — Pat, 2026-08-31

NaijaDeals is not 21 mini-websites that happen to share a logo. It is **one platform** built
from a small number of **shared engines** (identity, payments, marketplace, bookings,
logistics, trust, search, etc.), with each **vertical** (NaijaShop, NaijaEats, NaijaPay, …)
acting as a thin **product layer** — UI, routing, and vertical-specific business rules — sitting
on top of those engines.

```
                      ┌─────────────────────────────────────────────────┐
                      │                  VERTICALS                      │
                      │  (what the customer sees — 9 live/planned today,│
                      │   12 reserved for later)                        │
                      │                                                  │
                      │  Shop  Fresh  Eats  Gigs  Stay  Drive  Send      │
                      │  Stream  Aura  |  Pay  Health  Auto  Homes ...   │
                      └───────────────▲─────────────────▲───────────────┘
                                      │ consumes         │ consumes
                      ┌───────────────┴─────────────────┴───────────────┐
                      │              15 CORE SHARED ENGINES              │
                      │  Identity · Marketplace · Service · Booking      │
                      │  Logistics · Mobility · Payment & Finance        │
                      │  Trust & Review · Communication · Content/Media  │
                      │  Search & Discovery · Promotion & Advertising    │
                      │  Analytics · AI/Aura · Admin/Operations          │
                      └───────────────┬──────────────────────────────────┘
                                      │ persists to
                      ┌───────────────┴──────────────────────────────────┐
                      │        ONE Cloudflare D1 DATABASE (naijadeals)   │
                      │   ONE R2 bucket · ONE session/auth system        │
                      └────────────────────────────────────────────────────┘
```

**Why this matters commercially (not just technically):** if every vertical had its own
users table, its own wallet, its own order model, and its own payment integration, NaijaDeals
would need to reconcile 21 databases, run 21 KYC/fraud pipelines, and rebuild checkout 21
times. A Nigerian user buying groceries, booking a driver, and paying rent should be **one
identity, one wallet, one trust score, one order history** — that is the entire commercial
case for the engine model, and it is also what makes a unified Admin Dashboard and a
cross-vertical Aura AI assistant possible at all.

This document's job is to make sure every future migration and every future vertical
respects that model.

---

## 2. Current Verticals (Live / In Active Development)

These 9 verticals are part of the core architecture today. Status reflects the actual
repository state as of this document, not aspiration.

| # | Vertical | Status | Route(s) | Backing today |
|---|----------|--------|----------|----------------|
| 1 | **NaijaShop** | ✅ Live (Phase 1 MVP) | `/shop`, `/shop/:slug`, `/cart`, `/checkout` | Full Marketplace + Payment + Trust/Review engines |
| 2 | **NaijaFresh** | 🔵 Preview / waitlist | `/fresh` | Ecosystem Preview (config-driven, `ecosystem_verticals` table) |
| 3 | **NaijaEats** | 🔵 Preview / waitlist | `/eats` | Ecosystem Preview |
| 4 | **NaijaGigs** | 🔵 Preview / waitlist | `/gigs` | Ecosystem Preview |
| 5 | **NaijaStay** | 🔵 Preview / waitlist | `/stay` | Ecosystem Preview |
| 6 | **NaijaDrive** | 🔵 Preview / waitlist | `/drive` | Ecosystem Preview |
| 7 | **NaijaSend** | 🔵 Preview / waitlist | `/send` | Ecosystem Preview |
| 8 | **NaijaStream** | 🔵 Preview / waitlist | `/stream` | Ecosystem Preview |
| 9 | **Aura AI** | 🔵 Preview / waitlist | `/aura` | Ecosystem Preview (zero AI implementation yet) |

Also live today, outside the 9 consumer verticals: the **Seller Portal** (`/seller/*`) — this
is not a "vertical" in the customer-facing sense; it is the seller-side face of the
Marketplace + Payment & Finance engines and must remain engine-based as more verticals gain
their own seller/provider side (e.g. NaijaAuto mechanics, NaijaHealth clinics).

---

## 3. Reserved Future Verticals (NOT Authorized to Build)

These 12 verticals are reserved in the architecture. Building any of them requires an
explicit, separate authorization. Each entry lists the vertical's future capabilities
(verbatim from the product brief) and the specific engine-reuse constraint that must be
respected when it is eventually built.

### 10. NaijaPay — Payments & Financial Services
Wallet · send money · receive money · merchant payments · QR payments · payment links ·
bills · airtime · data · electricity · TV subscriptions · escrow · merchant settlements ·
seller payouts.
**Constraint**: MUST be built as the customer-facing front door to the existing **Payment &
Finance Engine** (`wallet_ledger`, `wallet_accounts`, `payment_transactions`,
`seller_payout_accounts`, `seller_finance_accounts`). Do not create a second wallet or a
second ledger. NaijaPay *is* the Payment & Finance Engine's own vertical — every other
vertical already uses (or will use) the same tables underneath it.

### 11. NaijaHealth — Healthcare
Pharmacies · health products · clinics · doctors · telehealth · diagnostics · labs ·
appointments · home healthcare.
**Constraint**: Must eventually respect Nigerian healthcare regulatory requirements (NAFDAC
for pharmacy/health products sold through the Marketplace Engine, health-data handling for
telehealth records). Uses Marketplace (pharmacy products), Booking (appointments), Service
(doctors/home healthcare), Trust (practitioner verification — a stricter tier than a normal
Marketplace seller).

### 12. NaijaAuto — Automotive
Cars · motorcycles · trucks · heavy equipment · parts · tyres · batteries · mechanics ·
towing · car wash · detailing · rentals.
**Constraint**: Splits cleanly across Marketplace (vehicles/parts as listings) and Service
(mechanics, towing, detailing as service providers) — do not force it into one engine only.

### 13. NaijaHomes — Real Estate
Property for sale/rent, land, apartments, commercial, agents, property management.
**Constraint**: Must stay conceptually and architecturally separate from **NaijaStay**.
NaijaStay = temporary/short-term accommodation (Booking Engine, nightly/date-range
semantics). NaijaHomes = property ownership/long-term rental (a new "Property" concept —
listings with lease terms, not booking dates). They may share Search & Discovery and
Marketplace-style listing UI, but must not share a booking-calendar data model.

### 14. NaijaTravel — Travel
Flights · hotels · bus · train · car rental · tours · packages · transfers.
**Constraint**: Explicitly integrates with NaijaStay (hotels), NaijaDrive (transfers/car
rental), NaijaEvents (tour/event packages), NaijaPay (payment). This is the clearest
candidate for Aura-orchestrated, multi-vertical bundles (see §9).

### 15. NaijaEvents — Events & Experiences
Concerts · conferences · festivals · weddings · tickets · venues · planners · catering · DJs
· photographers.
**Constraint**: Integrates with NaijaGigs (planners/DJs/photographers as service providers),
NaijaStay (venue/accommodation), NaijaDrive (transport), NaijaEats (catering), NaijaTravel,
NaijaPay. Needs a new Ticketing concept (capacity + seat/ticket-tier inventory) layered on
top of the Booking Engine, not a full new engine.

### 16. NaijaFarm — Agriculture
Produce · grains · livestock · poultry · fish · seeds · fertilizer · feed · equipment ·
wholesale · logistics.
**Constraint**: Should eventually supply **NaijaFresh** (and potentially NaijaEats) as an
upstream wholesale source — i.e. NaijaFarm listings can become NaijaFresh's supply chain,
not a disconnected marketplace. Uses Marketplace + Logistics engines; needs a
wholesale/bulk-unit pricing extension the current retail-unit `product_listings` schema
does not yet support (see Gaps, §12).

### 17. NaijaLearn — Education
Courses · tutors · vocational training · coding · certification · JAMB/WAEC/NECO ·
apprenticeships · corporate training.
**Constraint**: Blend of Marketplace (packaged/self-paced courses as purchasable products)
and Service+Booking (live tutors/classes with scheduled sessions). Needs a new
"enrollment/progress" concept the current engines don't model — flagged as a gap.

### 18. NaijaJobs — Employment
Job listings · employer/candidate profiles · CV/applications · recruitment · internships.
**Constraint**: Must stay distinct from **NaijaGigs**. NaijaGigs = hire someone for a
task/service (short-term, task-scoped, paid via escrow per job). NaijaJobs = formal
employment/recruitment (longer-term, no escrow-per-task, application/interview pipeline
instead of a service order). They should share the Identity Engine's professional-profile
concept, but not the Service Engine's order/quote model.

### 19. NaijaHome — Home Services
Plumbing · electrical · cleaning · painting · carpentry · HVAC · generator repair ·
appliance repair · pest control · moving · security · gardening.
**Constraint**: Initially reuse **NaijaGigs' Service Engine infrastructure directly** — this
is explicitly *not* a separate engine at launch. NaijaHome is a curated,
home-services-specific presentation layer on top of the same Service + Booking + Trust
engines NaijaGigs already needs.

### 20. NaijaBeauty — Beauty & Wellness
Salons · barbers · spas · makeup · nails · hair · wigs · beauty products · appointments ·
at-home services.
**Constraint**: Initially reuse the existing Marketplace (beauty products) + Service +
Booking (appointments) infrastructure rather than an independent backend — same reasoning as
NaijaHome.

---

## 4. The 15 Core Shared Engines

For each engine: **responsibility**, **primary/secondary vertical usage**, and — critically —
**what already exists in the codebase today**, so this document is grounded in evidence, not
aspiration. "Gap" notes what is missing before the engine can support its full reserved
vertical set.

### Engine 1 — Identity & Account Engine
**Responsible for**: users, profiles, authentication, roles, permissions, identity
verification, seller identity, customer identity, business accounts, organization accounts,
addresses, preferences.
**Every vertical reuses this. No exceptions.**
**Exists today**: `users` (role: customer\|vendor\|admin), `sessions` (30-day httpOnly
cookie sessions, PBKDF2 password hashing via Web Crypto — `src/lib/auth.ts`), `addresses`
(+ `nigerian_states` reference data). Seller identity is bridged onto `vendors.user_id`
(migration 0009) rather than a separate seller-identity table — the correct pattern to
repeat for future provider types (doctors, mechanics, tutors, drivers).
**Gap**: no formal "organization/business account" (multi-user company account) yet — every
account today is a single natural person, even sellers. NaijaHealth (clinics), NaijaAuto
(garages), and NaijaEvents (event companies) will eventually need multi-staff business
accounts under one identity — this is the biggest Identity Engine gap to solve *before*
those verticals are built, not after.

### Engine 2 — Marketplace Engine
**Responsible for**: products, vendors, stores, listings, categories, brands, inventory,
pricing, promotions, shopping cart, orders, reviews, product media.
**Primary**: NaijaShop, NaijaFresh, NaijaAuto, NaijaFarm, NaijaBeauty, NaijaHealth (products).
**Exists today**: the deepest engine in the codebase — `categories`, `brands`, `vendors`,
`products` (canonical catalog entry), `product_listings` (one row per seller's offer — the
"buy box" model, correctly separating *what* is sold from *who* sells it), `product_variants`,
`carts`/`cart_items`, `orders`/`order_items`, `coupons`. This is genuinely reusable: any
future vertical selling discrete, priced, stocked items (auto parts, farm produce, beauty
products, pharmacy items) plugs directly into `products` + `product_listings` with zero
schema change — a new `category` row is enough.
**Gap**: only per-unit retail pricing exists (`price_kobo` per listing). NaijaFarm's
wholesale/bulk use case (buy 50kg of rice at a bulk rate) is not representable without an
additive extension (e.g. `unit_type` + tiered pricing table) — flagged as a gap, not built now.

### Engine 3 — Service Engine
**Responsible for**: service providers, service categories, service listings, quotes,
requests, availability, service orders, ratings, reviews.
**Primary**: NaijaGigs, NaijaHome, NaijaBeauty, NaijaHealth, NaijaAuto (service side).
**Exists today**: **does not exist as a distinct engine.** The Seller Portal
(`vendors.verification_status`, `onboarding_step`, `seller_finance_accounts`) proves the
*provider onboarding/verification* half of this pattern, but there is no `service_listings`,
`quotes`, or `service_orders` table — NaijaGigs today is only an Ecosystem Preview page with
no backend.
**Gap (major)**: this is the first genuinely new engine required before NaijaGigs, NaijaHome,
or NaijaBeauty can be real. It should reuse `vendors`-as-provider (rename/generalize
conceptually to "provider" rather than "store") and the Trust/Review engine, but needs its
own listing + request/quote + order-lifecycle tables, distinct from `product_listings` /
`order_items` because a service has no SKU/stock — it has availability and a quoted price.

### Engine 4 — Booking Engine
**Responsible for**: availability, reservations, appointments, time slots, booking status,
cancellations, booking payments, capacity.
**Primary**: NaijaStay, NaijaTravel, NaijaEvents, NaijaHealth, NaijaBeauty, NaijaHome, NaijaGigs (where appropriate).
**Exists today**: **does not exist.** No calendar/availability/reservation table anywhere in
the schema.
**Gap (major)**: needed before NaijaStay can become a real (non-preview) vertical. Should be
designed once, generically (a bookable "resource" with time-slot capacity), so NaijaStay
(nightly stays), NaijaHealth (appointment slots), NaijaBeauty (salon appointments), and
NaijaEvents (ticketed capacity) all share one booking-lifecycle model instead of four.

### Engine 5 — Logistics Engine
**Responsible for**: delivery, drivers, dispatch, routes, tracking, pickup, dropoff, delivery
pricing, proof of delivery, delivery status.
**Primary**: NaijaSend, NaijaEats, NaijaShop, NaijaFresh, NaijaFarm, NaijaAuto, NaijaHealth.
**Exists today**: only the *pricing* slice exists — `orders.delivery_method`
(standard\|express) and a flat per-vendor delivery fee (`calculateDeliveryFeeKobo` in
`src/lib/orders.ts`). There is no driver, dispatch, route, or tracking table — NaijaShop's
"delivery" today is a checkout line item, not an operational logistics pipeline.
**Gap (major)**: needed before NaijaSend can be real, and before NaijaShop's delivery can be
anything beyond a flat fee. This is a prerequisite for NaijaEats too (food delivery dispatch).

### Engine 6 — Mobility Engine
**Responsible for**: drivers, riders, vehicles, ride requests, dispatch, trip lifecycle, fare
calculation, tracking, ratings.
**Primary**: NaijaDrive (with reuse potential for any future transportation vertical).
**Exists today**: does not exist. `NaijaDrive` is Ecosystem Preview only.
**Gap (major)**: closely related to but distinct from the Logistics Engine — Mobility moves
*people*, Logistics moves *things*. They will likely share the dispatch/tracking primitives
(driver location, trip/delivery status enum) even though they serve different verticals —
worth designing dispatch as a shared primitive under both engines when the time comes,
rather than duplicating it.

### Engine 7 — Payment & Finance Engine
**Responsible for**: wallets, payments, escrow, ledger, merchant settlements, seller
earnings, payouts, refunds, transaction records, payment methods.
**Primary**: NaijaPay. **Must also power**: NaijaShop, NaijaFresh, NaijaEats, NaijaGigs,
NaijaStay, NaijaDrive, NaijaSend, NaijaTravel, NaijaEvents, Seller Portal, and every future
vertical. **Do not create separate payment databases per vertical.**
**Exists today**: this is the second-deepest engine in the codebase and already proves the
"one ledger, many consumers" model works: `wallet_ledger` (append-only, `entry_type`
credit\|debit, `reference_type` topup\|order_payment\|refund\|payout\|escrow_release —
free-text field, already extended once for `seller_earning`/`seller_payout` without a schema
change), `wallet_accounts` (cached balance, read-cache only — never source of truth),
`payment_transactions` (provider paystack\|wallet), `seller_payout_accounts` +
`seller_payout_account_audit` (encrypted NUBAN, audit trail, soft-delete only),
`seller_finance_accounts` (cached available-earnings balance, keyed by vendor not user —
correct scoping for future multi-staff business accounts). Escrow lifecycle already lives on
`orders.payment_status` (`unpaid → escrow_held → released → refunded`).
**This is the strongest evidence in the whole codebase that the engine model works**: when
Seller Portal needed seller payouts, it did NOT create a new payments table — it extended
`wallet_ledger`'s `reference_type` vocabulary and added one new cache table
(`seller_finance_accounts`) scoped correctly by vendor. NaijaPay should do the same for
bills/airtime/QR/payment-links: new `reference_type` values and new UI, not new ledgers.
**Gap**: no merchant-to-merchant settlement or bill-payment provider integration yet — that
is expected, since NaijaPay itself isn't built. No architectural gap in the ledger design
itself.

### Engine 8 — Trust, Safety & Review Engine
**Responsible for**: ratings, reviews, verification, fraud controls, disputes, reports,
seller trust, provider trust, user reputation, moderation, suspensions.
**Every marketplace/service vertical should reuse this.**
**Exists today**: **not a standalone engine — currently embedded inside the Marketplace
Engine** as a plain `reviews` table (product-scoped, `rating`/`comment`/`photo_url`/
`avatar_url`/`helpful_count`) plus `vendors.verification_status` (pending\|verified\|
rejected\|suspended) and `vendors.positive_feedback_percent`. There is no dispute table, no
fraud-signal table, no user-reputation-across-verticals concept — a NaijaGigs freelancer's
trust score and a NaijaShop seller's trust score would today be two unrelated columns on two
different rows, not one Trust Engine.
**Gap (major, cross-cutting)**: before Service/Booking-based verticals (NaijaGigs,
NaijaHealth, NaijaHome, NaijaBeauty) go live, `reviews` needs to be generalized from
"product review" to "reviewable entity" (product OR service order OR booking OR driver
trip), and verification/dispute handling needs to become genuinely vertical-agnostic rather
than living only on `vendors`.

### Engine 9 — Communication Engine
**Responsible for**: in-app notifications, email, SMS, push, buyer/seller communication,
order/booking/delivery/transaction notifications.
**Exists today**: `notifications` table exists (migration 0005) with a `type` vocabulary
(order_confirmed, payment_received, order_shipped, wishlist_price_drop, promotion,
security, etc.) and `action_url`/`reference_type`/`reference_id` — a solid in-app
notification model. **However, it is currently read/display-only inside the Account area
(seed data), with no write-path wired from real events, and no email/SMS/push provider
integrated at all** — `newsletter_subscribers` (migration 0001) is the only other
communication-adjacent table, and it's a bare marketing list.
**Gap**: needs (a) real event-driven writers (order state changes, booking confirmations,
waitlist confirmations should insert real `notifications` rows, not just seed data), and (b)
an actual outbound channel (email/SMS provider) before any vertical can promise "we'll notify
you" as more than an in-app-only feature. The ecosystem waitlist feature (this repo, current
work) is the first real precedent — it should eventually also *write* to `notifications`/an
email queue rather than only persisting to its own table.

### Engine 10 — Content & Media Engine
**Responsible for**: images, video, audio, user-generated content, product media, seller
media, stream content, hero campaigns, promotional content.
**Exists today**: two clean, already-correct patterns exist side by side and must NOT be
merged: (1) **curated, git-tracked static assets** under `public/static/*` (brand logos,
hero campaign art, ecosystem preview art) — versioned with the code, no runtime write path;
(2) **runtime user uploads** via the `SELLER_UPLOADS` R2 bucket (binding declared in
`wrangler.jsonc`, `Bindings` type in `src/types.ts`), intended for seller-uploaded store
logos/product images through an ownership-checked route (per migration 0009's design
comment) — **not yet actually implemented as a route** (`src/routes/` has no upload
endpoint yet). `hero_campaigns` (migration 0008) is the Promotion/Content merchandising
table, built but **not yet wired into `home.tsx`** (still shows static banner images).
**Gap**: the R2 upload route itself needs to be built before Seller Portal's own product
photo upload works — this is an existing-vertical gap (NaijaShop/Seller Portal), not a
future-vertical one, and should likely be prioritized ahead of any new vertical work.
NaijaStream (media playback/streaming) will need a materially different capability
(video transcoding/streaming, not just file storage) that R2 alone does not provide —
flagged as a gap specific to that vertical.

### Engine 11 — Search & Discovery Engine
**Responsible for**: global search, category search, filters, location search,
recommendations, vendor/product/service/event/property discovery.
**Aura AI should eventually be able to use this engine.**
**Exists today**: **not a standalone engine — a set of ad-hoc SQL `LIKE` queries and filter
params inside `src/lib/catalog.ts` and `src/routes/api-catalog.ts`** (`title LIKE ? OR
description LIKE ? OR vendor.name LIKE ?`, plus category/brand/price/rating filters). This
works for NaijaShop's current catalog size but is not a reusable, vertical-agnostic search
engine — there is no unified index across products + (future) services + (future) bookings +
(future) properties, and no location-based search at all despite `vendors.state` existing.
**Gap (major, cross-cutting)**: before Aura AI can "discover products, compare options, find
deals" across verticals (§9), Search needs to become a real cross-entity engine (likely
D1 full-text search or an external index) rather than per-table `LIKE` queries duplicated in
every vertical's own lib file.

### Engine 12 — Promotion & Advertising Engine
**Responsible for**: promotions, coupons, discounts, sponsored listings, seller advertising,
campaigns, featured products/stores, hero campaigns, analytics.
**Should eventually support a NaijaDeals advertising business.**
**Exists today**: `coupons` (percent/fixed, min-order/max-discount rules, usage limits —
already wired into real checkout discount logic), `hero_campaigns` (scheduled, status-gated
promotional slides), `brands.is_featured`/`display_order` (curated merchandising). All three
follow the same "status + display_order, DB-driven, never hardcoded in TSX" pattern — a
genuinely reusable convention.
**Gap**: no sponsored-listing/seller-paid-boost mechanism yet (an actual ads product would
need a new `sponsored_listings`-style table plus a billing hook into the Payment & Finance
Engine) — expected, since monetized advertising hasn't been prioritized yet, not a design flaw.

### Engine 13 — Analytics Engine
**Responsible for**: sales, traffic, conversion, seller/customer/product/service/campaign
analytics, revenue analytics, operational metrics.
**Exists today**: **does not exist.** No analytics/events table, no aggregation job, no
dashboard. `homepage_feed_cache` is a *performance* cache (avoids N-query fan-out), not an
analytics store, and should not be confused with one.
**Gap (major)**: needed before any real Admin Dashboard (Engine 15) can show meaningful
seller/business metrics. Should be designed as an additive, append-only event log (similar
philosophy to `wallet_ledger`) rather than mutable aggregate counters, to stay consistent
with the "one source of truth, never estimates" principle already established for wallets.

### Engine 14 — AI / Aura Engine
See dedicated §9 below (Aura architecture). **Exists today**: zero implementation — `aura`
is an Ecosystem Preview route only (`ecosystem_verticals` row with `status='coming_soon'`).

### Engine 15 — Admin / Operations Engine
See dedicated §8 below (Admin architecture). **Exists today**: zero implementation — there
is no `/admin` route, no admin authentication tier beyond `users.role='admin'` (which exists
as a column value but is not checked/used anywhere in `src/`), and no admin UI.

---

## 5. Vertical → Engine Mapping (All 21 Verticals)

| Vertical | Engines used |
|---|---|
| NaijaShop | Marketplace, Payment & Finance, Logistics, Trust & Review, Search & Discovery, Promotion & Advertising |
| NaijaFresh | Marketplace, Logistics, Payment & Finance, Search & Discovery, Trust & Review |
| NaijaEats | Marketplace (menu), Logistics, Payment & Finance, Trust & Review |
| NaijaGigs | Service, Booking, Payment & Finance, Trust & Review, Communication |
| NaijaStay | Booking, Payment & Finance, Trust & Review, Search & Discovery, Communication |
| NaijaDrive | Mobility, Logistics, Payment & Finance, Trust & Review, Search & Discovery (location) |
| NaijaSend | Logistics, Payment & Finance, Communication (tracking) |
| NaijaStream | Content & Media, Payment & Finance (subscription), Search & Discovery (recommendation) |
| Aura AI | AI/Aura, Search & Discovery, Identity & Account, + read access to all permitted engines |
| **NaijaPay** | Payment & Finance (is the primary vertical for this engine), Identity & Account |
| **NaijaHealth** | Service, Booking, Marketplace, Payment & Finance, Trust & Review |
| **NaijaAuto** | Marketplace, Service, Booking, Payment & Finance, Logistics |
| **NaijaHomes** | Marketplace (listings model), Search & Discovery, Booking (viewing appointments only — not nightly stays), Payment & Finance |
| **NaijaTravel** | Booking, Payment & Finance, Logistics, Search & Discovery |
| **NaijaEvents** | Booking (+ Ticketing extension), Payment & Finance, Search & Discovery |
| **NaijaFarm** | Marketplace (+ wholesale-pricing extension), Logistics, Payment & Finance |
| **NaijaLearn** | Marketplace (packaged courses), Service, Booking (live sessions), Content & Media, Payment & Finance |
| **NaijaJobs** | Identity & Account (professional profiles), Search & Discovery, Communication |
| **NaijaHome** | Service, Booking, Payment & Finance, Trust & Review, Logistics |
| **NaijaBeauty** | Marketplace (products), Service, Booking, Payment & Finance, Trust & Review |

---

## 6. Data Ownership Principles

1. **Identity is singular.** One `users` row per human being, regardless of how many
   verticals they use — a NaijaShop customer, a NaijaGigs freelancer, and a future NaijaPay
   wallet holder are the same person, the same row.
2. **Money is singular.** All wallet balance, escrow, and transaction truth lives in
   `wallet_ledger` / `payment_transactions`. A vertical never invents its own balance field.
3. **Orders/bookings are typed, not duplicated.** A future `service_orders` or `bookings`
   table is a *new entity type*, not a rebuild of `orders` — but it must still settle through
   the same Payment & Finance Engine, and should reuse `order_number`-style human-readable
   reference conventions already established.
4. **Trust is portable.** A user's reputation, once the Trust Engine is generalized (§4,
   Engine 8), should be visible across verticals — a suspended NaijaGigs provider should not
   be able to quietly resurface as a "verified" NaijaHome provider under the same account.
5. **Reference tables are shared.** `nigerian_states`, `nigerian_banks`, and any future
   reference data (LGAs, industries, categories) are created once and read by every vertical
   that needs them — never duplicated per vertical.

---

## 7. Integration Architecture

Engines integrate through **direct D1 queries within the same Worker**, not through internal
network calls — this is a single Cloudflare Pages/Workers deployment with one D1 database,
so "integration" today means: a vertical's route/lib file imports and calls another engine's
existing `src/lib/*.ts` functions (e.g. checkout calling `wallet.ts`'s `debitWallet`, or a
future NaijaEvents booking calling the Payment & Finance Engine's escrow functions directly).

As the codebase grows, the enforceable rule is:

- A vertical's route/page file (`src/routes/api-*.ts`, `src/pages/*.tsx`) may call any
  engine's `src/lib/*.ts` functions.
- A vertical's route/page file must **never** write directly to another engine's tables with
  raw SQL — it must go through that engine's lib functions (e.g. never
  `UPDATE wallet_accounts SET cached_balance_kobo = ...` from outside `wallet.ts`). This is
  already the convention `orders.ts`/`wallet.ts` follow (`db.batch()` atomic ledger+cache
  updates encapsulated inside `wallet.ts`) and must be preserved as more engines are added.
- Cross-vertical orchestration (e.g. a NaijaTravel booking that also books a NaijaDrive
  transfer) is the Aura/orchestration layer's job conceptually, but mechanically it is just
  one route handler calling two engines' lib functions in sequence — no message queue or
  event bus exists or is needed at this scale.

---

## 8. Admin / Operations Architecture (Requirement, Not Built)

A unified Admin Dashboard must eventually manage: users, vendors/sellers/providers,
products, orders, services, bookings, drivers, deliveries, payments, wallets, payouts,
disputes, reviews, promotions, advertising, content, ecosystem verticals, Aura, analytics,
settings, feature flags, and permissions.

**Architectural requirement**: the Admin Dashboard reads and writes the *same* engine
tables every vertical already uses — it is a privileged UI over the shared engines, **not a
separate database per vertical**, and not a separate copy of any entity. Concretely: an
admin "suspend seller" action updates the same `vendors.verification_status` column the
Seller Portal itself reads; it does not maintain a parallel "admin_vendors" table.

**Current gap**: `users.role = 'admin'` exists as a schema value but is never checked by any
route today (no `requireAdmin` middleware exists alongside `requireAuth`/`requireActiveSeller`
in `src/lib/auth.ts`/`src/lib/seller.ts`). Building `requireAdmin` following the exact same
pattern as `requireActiveSeller` is the correct, additive first step whenever Admin work is
authorized — not a new auth system.

---

## 9. Aura AI Architecture (Requirement, Not Built)

Aura is the ecosystem's **intelligence/orchestration layer**, not a transaction owner. It
should eventually understand user intent, products, services, stores, locations, orders,
bookings, travel, events, payments, and delivery — and use that understanding to query and
sequence calls into the engines above, especially Search & Discovery and Identity & Account.

**Illustrative scenario** (from the product brief): *"Aura, I need to attend a wedding in
Abuja next Saturday."* Aura orchestrates, but does not itself execute, transactions across:
NaijaTravel (flight) → NaijaStay (hotel) → NaijaDrive (airport transfer) → NaijaEvents (the
wedding) → NaijaShop (outfit) → NaijaGigs (makeup/photography) → NaijaPay (payment for all
of the above).

**Architectural rule**: Aura must never become a 22nd place where orders, bookings, or
money live. Every transaction Aura initiates still lands in the same `orders`,
future-`bookings`, and `wallet_ledger` tables a human clicking through the UI would produce.
Aura's own "engine" surface (Engine 14) is limited to: intent parsing, cross-engine search
(depends on Engine 11 being generalized first — see Gap in §4), and orchestration sequencing.
**Current status**: zero implementation. The `/aura` route is an Ecosystem Preview page only.

---

## 10. Master Ecosystem Navigation

```
SHOP                    NaijaShop · NaijaFresh · NaijaAuto · NaijaFarm
FOOD & LIFE             NaijaEats · NaijaHealth · NaijaBeauty · NaijaHome
WORK & LEARNING         NaijaGigs · NaijaJobs · NaijaLearn
PROPERTY                NaijaStay · NaijaHomes
TRANSPORT & LOGISTICS   NaijaDrive · NaijaSend · NaijaTravel
ENTERTAINMENT & EXPERIENCES   NaijaStream · NaijaEvents
MONEY                   NaijaPay
INTELLIGENCE            Aura AI
```

This is the target information architecture for global navigation once more verticals go
live. Today's `Layout.tsx` `ECOSYSTEM_LINKS` is a flat list of the 8 preview verticals plus
Shop; it should be regrouped into these categories only when there are enough live (not
preview) verticals per category to justify sub-menus — regrouping a flat 9-item list into
8 categories today would add UI complexity with no navigational benefit, so this is
recorded as the target, not applied now.

---

## 11. Architectural Principles (Permanent Project Rules)

1. **Reuse before create.** Before adding a table, API, wallet, order system, booking
   system, or notification system, check whether an existing engine already covers it.
2. **One source of truth.** No duplicate users, vendors, wallets, payments, orders,
   products, reviews, addresses, or logistics records without a documented reason.
3. **Verticals are not separate apps.** They are product layers sharing engines.
4. **Additive database changes.** Migrations extend, they do not rebuild, unless explicitly
   justified (as migration 0002 did once, before any real user data existed).
5. **Do not build future verticals prematurely.** Reserving ≠ building.
6. **No fake functionality.** A vertical is not "functional" until its backend, DB, UI,
   business logic, and verification are genuinely complete and verified.
7. **Honest empty states.** Unlaunched verticals say "coming soon" — they never fabricate
   listings, drivers, availability, or stats. (Already the standard set by migration 0010's
   Ecosystem Preview seed data.)
8. **Future-proof current engines without over-engineering.** When building today's
   features, ask whether the data model would block an obvious future reuse — but do not
   add speculative columns/tables for capabilities nobody has asked for yet.

---

## 12. Development Sequencing (Roadmap, Not Authorization)

**CURRENT PRIORITY**
1. NaijaShop core marketplace
2. Seller Portal
3. NaijaFresh
4. NaijaEats
5. NaijaGigs
6. NaijaStay
7. NaijaDrive
8. NaijaSend
9. NaijaStream
10. Aura AI

**NEXT EXPANSION**
11. NaijaPay · 12. NaijaHealth · 13. NaijaAuto · 14. NaijaHomes · 15. NaijaTravel · 16. NaijaEvents

**LATER EXPANSION**
17. NaijaFarm · 18. NaijaLearn · 19. NaijaJobs · 20. NaijaHome · 21. NaijaBeauty

This sequencing does not authorize building items 3–21 now. Each requires a separate,
explicit go-ahead.

---

## 13. Architectural Gaps Summary (What Must Exist Before Each Major Future Vertical)

| Future vertical | Must exist first |
|---|---|
| NaijaPay | Nothing new structurally — extend Payment & Finance Engine's `reference_type` vocabulary + build bill/airtime provider integrations. Lowest-gap future vertical. |
| NaijaHealth | Service Engine, Booking Engine, generalized Trust Engine (practitioner verification tier), regulatory compliance review |
| NaijaAuto | Service Engine (mechanics/towing side); Marketplace already covers the vehicle/parts side |
| NaijaHomes | Booking Engine (viewing appointments) is optional; mainly needs a distinct "Property" listing model kept separate from NaijaStay's booking model |
| NaijaTravel | Booking Engine, deeper Logistics Engine (transfers), third-party flight/bus inventory integration |
| NaijaEvents | Booking Engine + a Ticketing/capacity extension on top of it |
| NaijaFarm | Marketplace Engine's wholesale/bulk-unit pricing extension, Logistics Engine |
| NaijaLearn | Service + Booking Engines, an Enrollment/progress concept (new), Content & Media Engine (video hosting/streaming) |
| NaijaJobs | Identity Engine's professional-profile/CV concept (new), Search & Discovery Engine |
| NaijaHome | Service + Booking Engines (shared with NaijaGigs — lowest-gap of the service verticals) |
| NaijaBeauty | Service + Booking Engines (shared with NaijaGigs/NaijaHome — low gap) |

**Cross-cutting gaps that block multiple future verticals regardless of order built:**
Service Engine, Booking Engine, generalized Trust & Review Engine, real Search & Discovery
Engine, Logistics Engine, Communication Engine's outbound channel, and Analytics Engine.
These seven are the actual "foundation debt" — prioritizing any of the 12 reserved verticals
without first addressing its required gaps above would recreate exactly the "20 partially
built mini-websites" outcome this document exists to prevent.

---

## 14. Appendix — Current Schema Inventory Mapped to Engines

*(Evidence base for §4, gathered from `migrations/0001`–`0011` and `src/lib/*.ts`, 2026-08-31.)*

| Engine | Existing tables |
|---|---|
| Identity & Account | `users`, `sessions`, `addresses`, `nigerian_states` |
| Marketplace | `categories`, `brands`, `vendors`, `products`, `product_listings`, `product_variants`, `product_questions`, `carts`, `cart_items`, `orders`, `order_items`, `coupons`, `wishlists` |
| Service | *(none yet — gap)* |
| Booking | *(none yet — gap)* |
| Logistics | `orders.delivery_method` only (no dedicated tables — gap) |
| Mobility | *(none yet — gap)* |
| Payment & Finance | `wallet_ledger`, `wallet_accounts`, `payment_transactions`, `saved_payment_methods`, `nigerian_banks`, `seller_payout_accounts`, `seller_payout_account_audit`, `seller_finance_accounts` |
| Trust, Safety & Review | `reviews`, `vendors.verification_status`/`positive_feedback_percent` (embedded in Marketplace — not standalone) |
| Communication | `notifications`, `newsletter_subscribers` |
| Content & Media | `hero_campaigns`, `public/static/*` (curated assets), `SELLER_UPLOADS` R2 bucket (declared, upload route not yet built) |
| Search & Discovery | *(none — ad-hoc `LIKE` queries in `catalog.ts` only)* |
| Promotion & Advertising | `coupons`, `hero_campaigns`, `brands.is_featured/display_order` |
| Analytics | *(none)* |
| AI/Aura | *(none — `ecosystem_verticals` row only)* |
| Admin/Operations | *(none — `users.role='admin'` unused)* |

Ecosystem-specific (not a core engine, config/marketing layer): `ecosystem_verticals`,
`ecosystem_vertical_features`, `ecosystem_waitlist` (legacy, per-vertical email capture),
`ecosystem_waitlist_signups` (migration 0011, richer multi-service waitlist).

---

*End of document. Update this file whenever a new engine capability ships, a new vertical is
authorized, or a gap listed in §13 is closed — do not let it go stale the way `README.md`'s
deployment section did.*

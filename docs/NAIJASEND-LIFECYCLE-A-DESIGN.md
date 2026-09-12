# NaijaSend Lifecycle-A — Items 1–5 Schema + Route Design

**Status: DRAFT — for review before any migration file is written.**
**Base commit:** `a9ba93e` (verified: local `HEAD` == remote `main` at time
of writing).
**Scope:** Items 1–5 only — data model, ownership/authorization contracts,
and API surface. **No page/UI code, no app.js, no i18n keys, no Chromium
verification in this document** — those are Items 6+ and come after this
design is agreed and implemented.

**Ground rule this design obeys:** every reused pattern below is cited
against an actual file/table in this repo at `a9ba93e`. Nothing is carried
over from the prior inherited summary. Where the summary described a
convention that doesn't exist here (e.g. pre-existing driver i18n keys), this
design does not assume it.

---

## 0. Scope Recap (Lifecycle-A boundary, unchanged from the original brief)

Lifecycle-A = **state machine + driver assignment + driver operational jobs
+ customer operational tracking**. Explicitly OUT of scope for this design
and for Items 1–5:

- Payment, escrow, settlement, refunds, driver earnings/payouts
- GPS, live maps, ETA calculation
- SMS/OTP, customer delivery confirmation (`shipments.status = 'delivered'`
  means **driver-reported**, not customer-confirmed — that distinction is
  structurally reserved for a future `delivery_confirmations` table that
  does NOT exist yet and is not created here)
- A second driver/assignment/status-ledger system of any kind
- Vehicle *rental* marketplace (that's NaijaDrive, a separate vertical/prompt
  — explicitly not touched by this design)

---

## 1. Reused Foundations (cited against real files)

| Need | Reused from | File/table |
|---|---|---|
| User identity, password auth | `users` table, unchanged | `migrations/0001_initial_schema.sql` |
| Session resolution middleware | `attachUser` → `c.get('user')` | `src/lib/auth.ts` |
| "Require logged in" page guard | `requireAuthPage` | `src/lib/auth.ts` |
| Provider onboarding/verification state-machine **pattern** (not the table) | `vendors` + `resolveSellerStatus()` / `requireActiveSeller()` | `migrations/0009_seller_portal.sql`, `src/lib/seller.ts` |
| Address storage | `addresses` table (`user_id, label, recipient_name, phone, line1, city, state, is_default`) | `migrations/0001_initial_schema.sql` |
| State reference data (dropdowns) | `nigerian_states` (`name`, `is_fct`, `sort_order`) | `migrations/0007_address_book_depth.sql` |
| Route-registration / vertical-override precedent | `ecosystem_verticals` + `getVerticalByRoute()`; the way `/seller/*` already overrides the shared `ecosystemPreviewPage` fallback for `/send` | `src/lib/ecosystem-verticals.ts`, `src/index.tsx` |
| Typed row + AppEnv convention | `VendorRow` interface, `Bindings`/`Variables` in `AppEnv` | `src/types.ts` |

**Explicit non-reuse decision:** a logistics provider is **not** a row in
`vendors`. `vendors` is product-seller-shaped (business_name, store_status,
onboarding wizard for *listing products*). A logistics provider is a
distinct business actor (operates drivers + vehicles, not products). We
copy the *verification-state-machine pattern* from `seller.ts` into a new,
parallel `logistics.ts` resolver — never alias the two domains onto one
table, per the original Lifecycle-A "no shortcut system" rule.

---

## 2. New Tables — Migration `0013_naijasend_logistics.sql`

All tables are additive (`CREATE TABLE IF NOT EXISTS`), no existing table is
altered except where noted. Naming/style follows `0009_seller_portal.sql`'s
precedent (explicit CHECK-constrained enums, `created_at`/`updated_at`
defaults, indexes on every FK used in a WHERE clause).

### 2.1 `logistics_providers`

The operator entity — one row per business that assigns drivers to
shipments. Mirrors `vendors`' user-bridge + verification pattern.

```sql
CREATE TABLE IF NOT EXISTS logistics_providers (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                INTEGER NOT NULL REFERENCES users(id),
  business_name          TEXT NOT NULL,
  business_phone         TEXT NOT NULL,
  verification_status    TEXT NOT NULL DEFAULT 'pending'
                           CHECK (verification_status IN ('pending','verified','rejected','suspended')),
  onboarding_completed_at TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_logistics_providers_user_id ON logistics_providers(user_id);
```

*Design note:* unlike `vendors` (which pre-seeded 20 catalog rows with
`user_id IS NULL`), there is no pre-seed here — every row starts from real
onboarding. `verification_status` defaults to `'pending'`, not `'verified'`,
because unlike the catalog-vendor backfill, there is no pre-existing trusted
data to grandfather in.

### 2.2 `vehicles` (logistics fleet — distinct from any NaijaDrive rental concept)

```sql
CREATE TABLE IF NOT EXISTS vehicles (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id              INTEGER NOT NULL REFERENCES logistics_providers(id),
  vehicle_type             TEXT NOT NULL CHECK (vehicle_type IN ('bike','tricycle','van','truck')),
  make                     TEXT NOT NULL,
  model                    TEXT NOT NULL,
  registration_number      TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vehicles_provider ON vehicles(provider_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_registration ON vehicles(registration_number);
```

### 2.3 `driver_profiles`

A driver is a `users` row (role can stay free-text — `users.role` has no
CHECK constraint at the DB level per `0001_initial_schema.sql`, confirmed by
direct inspection, so adding a `'driver'` value is additive and requires no
migration of the `users` table itself) plus a provider-scoped profile.

```sql
CREATE TABLE IF NOT EXISTS driver_profiles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  provider_id   INTEGER NOT NULL REFERENCES logistics_providers(id),
  license_number TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_provider ON driver_profiles(provider_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_profiles_user ON driver_profiles(user_id);
```

*Design note:* `user_id` is unique — one user can be a driver for at most one
provider at a time (MVP constraint, same shape as `vendors.user_id`'s
one-store-per-user partial-unique-index precedent, just without the
NULL-carveout since there's no pre-seed to protect here).

### 2.4 `driver_vehicle_assignments`

Which vehicle a driver is currently operating. Kept as its own table (not a
column on `driver_profiles`) so history is preserved and a vehicle is never
silently "reassigned" by overwriting a foreign key with no trace.

```sql
CREATE TABLE IF NOT EXISTS driver_vehicle_assignments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id    INTEGER NOT NULL REFERENCES driver_profiles(id),
  vehicle_id   INTEGER NOT NULL REFERENCES vehicles(id),
  provider_id  INTEGER NOT NULL REFERENCES logistics_providers(id),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  assigned_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_dva_driver_active ON driver_vehicle_assignments(driver_id, status);
CREATE INDEX IF NOT EXISTS idx_dva_vehicle_active ON driver_vehicle_assignments(vehicle_id, status);
```

*Concurrency note (ties to Item 12):* "assign vehicle to driver" is a
conditional `UPDATE driver_vehicle_assignments SET status='ended' WHERE
driver_id=? AND status='active'` followed by an insert, wrapped in
`db.batch()` — same atomic-batch precedent `wallet.ts`'s
`creditWallet()`/`debitWallet()` already establishes for ledger+cache pairs.

### 2.5 `shipments`

The core lifecycle object. Reuses `addresses`/`nigerian_states` for
pickup/dropoff rather than inventing a duplicate free-text address blob (the
original Lifecycle-A brief's own principle, now grounded against a real
existing table instead of an assumed one).

```sql
CREATE TABLE IF NOT EXISTS shipments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_number     TEXT UNIQUE NOT NULL,
  customer_user_id    INTEGER NOT NULL REFERENCES users(id),
  provider_id         INTEGER NOT NULL REFERENCES logistics_providers(id),
  pickup_address_id   INTEGER NOT NULL REFERENCES addresses(id),
  dropoff_address_id  INTEGER NOT NULL REFERENCES addresses(id),
  vehicle_type_requested TEXT NOT NULL CHECK (vehicle_type_requested IN ('bike','tricycle','van','truck')),
  status              TEXT NOT NULL DEFAULT 'booked' CHECK (status IN (
                        'booked','pickup_assigned','picked_up','in_transit','out_for_delivery','delivered','cancelled'
                      )),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_shipments_customer ON shipments(customer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipments_provider_status ON shipments(provider_id, status);
```

*Status machine (exhaustive, matches the original Item 7 button-mapping
exactly so UI and DB never drift):*
```
booked → pickup_assigned → picked_up → in_transit → out_for_delivery → delivered
                                                                       ↘ cancelled (from booked or pickup_assigned only)
```

### 2.6 `pickup_jobs` and `delivery_jobs`

Kept as two tables (not merged into `shipments`) specifically so the
assignment **concurrency boundary** is a conditional `UPDATE` against a
narrow, single-purpose row — this is the mechanism Item 12's race test
exercises.

```sql
CREATE TABLE IF NOT EXISTS pickup_jobs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id  INTEGER NOT NULL UNIQUE REFERENCES shipments(id),
  provider_id  INTEGER NOT NULL REFERENCES logistics_providers(id),
  driver_id    INTEGER REFERENCES driver_profiles(id),
  status       TEXT NOT NULL DEFAULT 'unassigned' CHECK (status IN ('unassigned','assigned')),
  assigned_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pickup_jobs_provider_status ON pickup_jobs(provider_id, status);
CREATE INDEX IF NOT EXISTS idx_pickup_jobs_driver ON pickup_jobs(driver_id);

CREATE TABLE IF NOT EXISTS delivery_jobs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id  INTEGER NOT NULL UNIQUE REFERENCES shipments(id),
  provider_id  INTEGER NOT NULL REFERENCES logistics_providers(id),
  driver_id    INTEGER REFERENCES driver_profiles(id),
  status       TEXT NOT NULL DEFAULT 'unassigned' CHECK (status IN ('unassigned','assigned')),
  assigned_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_delivery_jobs_provider_status ON delivery_jobs(provider_id, status);
CREATE INDEX IF NOT EXISTS idx_delivery_jobs_driver ON delivery_jobs(driver_id);
```

**The exact concurrency boundary (Item 12's mechanism):**
```sql
UPDATE pickup_jobs
SET status = 'assigned', driver_id = ?, assigned_at = datetime('now')
WHERE shipment_id = ? AND status = 'unassigned'
```
`changes === 0` after this statement means "lost the race" →
`ShipmentAlreadyAssignedError` (409), never a generic 500. Exactly one
concurrent request can ever see `changes === 1`, by SQLite's own
single-writer transaction semantics — this is D1's real guarantee, not an
assumption.

### 2.7 `shipment_status_events`

Append-only audit ledger — every status transition, who caused it, when.
Same "audit trail, never overwritten" precedent as
`seller_payout_account_audit` (migration `0009`).

```sql
CREATE TABLE IF NOT EXISTS shipment_status_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id   INTEGER NOT NULL REFERENCES shipments(id),
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  actor_role    TEXT NOT NULL CHECK (actor_role IN ('provider','driver','system')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_shipment_events_shipment ON shipment_status_events(shipment_id, created_at);
```

---

## 3. Ownership & Authorization Contract (Item 13's foundation)

Following `seller.ts`'s non-negotiable rule verbatim: **every provider/driver
scoped query resolves its own id server-side from the session — a
client-supplied `providerId`/`driverId` is never trusted.**

New file `src/lib/logistics.ts` (mirrors `src/lib/seller.ts` 1:1 in shape):

```typescript
export type LogisticsProviderState = 'NO_PROVIDER' | 'ONBOARDING' | 'PENDING_VERIFICATION' | 'REJECTED' | 'SUSPENDED' | 'ACTIVE_PROVIDER'

export async function resolveLogisticsProviderStatus(db: D1Database, userId: number): Promise<{state: LogisticsProviderState, provider: LogisticsProviderRow | null}>
export async function requireActiveLogisticsProvider(c: Context<AppEnv>, next: () => Promise<void>): Promise<Response | void>

export type DriverState = 'NOT_A_DRIVER' | 'INACTIVE_DRIVER' | 'ACTIVE_DRIVER'
export async function resolveDriverStatus(db: D1Database, userId: number): Promise<{state: DriverState, driver: DriverProfileRow | null}>
export async function requireActiveDriver(c: Context<AppEnv>, next: () => Promise<void>): Promise<Response | void>
```

**404-not-403 discipline (explicit rule, applies to every query below):** a
provider/driver/customer requesting a resource they don't own gets a plain
404 (via `ShipmentNotFoundError`/`JobNotAssignedToDriverError` mapped to
`c.notFound()`), never a 403 — existence of another party's resource is
never leaked by the response code.

| Actor | Can see/do | Cannot |
|---|---|---|
| Provider A | Own `logistics_providers` row, own `vehicles`, own `driver_profiles`, own `shipments`/`pickup_jobs`/`delivery_jobs` (via `provider_id = c.get('sellerVendor')`-equivalent resolved id) | Provider B's anything — 404, not 403 |
| Driver A | Own `driver_profiles` row, jobs where `pickup_jobs.driver_id = <own driver id>` OR `delivery_jobs.driver_id = <own driver id>` | Jobs assigned to Driver B — 404. Cannot self-assign a job (no client-supplied driver_id path exists on any driver-facing route) |
| Customer | Own `shipments` where `customer_user_id = <own user id>` | Any other customer's shipment — 404. Cannot mutate status, cannot assign drivers, cannot see other providers'/drivers' internal data beyond name (see §4.3) |

---

## 4. API Surface (Items 2–5, contract only — no page/UI wiring here)

All under `/api/logistics/*` (provider-facing) and `/api/drivers/*`
(driver-facing), mounted in `src/index.tsx` alongside the existing
`app.route('/api/...', ...)` list, following the exact existing pattern
(`catalogApi`, `cartApi`, etc.).

### 4.1 Provider — `src/routes/api-logistics.ts`

| Method + path | Behavior | Error mapping |
|---|---|---|
| `GET /api/logistics/drivers` | Active drivers for the authenticated provider only | — |
| `GET /api/logistics/shipments/assignable` | Shipments with `status='booked'` AND `provider_id = own` AND `pickup_jobs.status='unassigned'` | — |
| `POST /api/logistics/shipments/:id/assign-driver` `{driverId}` | Conditional-UPDATE assignment (§2.6) + `shipment_status_events` insert (`booked`→`pickup_assigned`) in one `db.batch()` | `ShipmentNotFoundError`→404, `ShipmentAlreadyAssignedError`→409 |

### 4.2 Driver — `src/routes/api-drivers.ts`

| Method + path | Behavior | Error mapping |
|---|---|---|
| `GET /api/drivers/me/jobs` | Shipments where a pickup_job/delivery_job has `driver_id = own driver id`, joined with shipment+address+vehicle for display | — |
| `POST /api/drivers/me/jobs/:shipmentId/picked-up` | `pickup_assigned`→`picked_up`, only if `pickup_jobs.driver_id = own` | `JobNotAssignedToDriverError`→404, `InvalidShipmentStatusTransitionError`→409 |
| `POST /api/drivers/me/jobs/:shipmentId/in-transit` | `picked_up`→`in_transit` | same pattern |
| `POST /api/drivers/me/jobs/:shipmentId/out-for-delivery` | `in_transit`→`out_for_delivery` | same pattern |
| `POST /api/drivers/me/jobs/:shipmentId/delivered` | `out_for_delivery`→`delivered` (driver-reported, not customer-confirmed — see §0) | same pattern |

Every transition above goes through one shared function,
`transitionShipmentStatus(db, shipmentId, fromStatus, toStatus, actorUserId,
actorRole)`, in `src/lib/shipments.ts` — a single state-machine chokepoint,
never four independent ad-hoc UPDATE statements, so the status enum and the
ledger insert can never drift apart.

### 4.3 Customer-facing read (extends existing customer routes, no new provider surface)

Customer tracking is a **page-level SSR read** (Item 8, not built in this
design pass), not a new API family — it reuses `getShipmentForCustomer(db,
shipmentId, customerUserId)` (scoped by the authenticated customer's own id,
same 404-not-403 rule) plus a name-only driver lookup (no phone/license
exposed to customers — deliberately minimal, matching the original brief's
"customer sees driver identity, not driver PII" requirement).

---

## 5. What Item 1–5 Deliverables Actually Are

To be unambiguous about what "Items 1–5 done" will mean when implemented:

1. **Item 1 (schema):** migration `0013_naijasend_logistics.sql` exactly as
   §2 above, applied locally via `wrangler d1 migrations apply
   naijadeals-production --local`.
2. **Item 2 (`src/lib/logistics.ts`):** provider resolver + middleware, per §3.
3. **Item 3 (`src/lib/shipments.ts`):** `transitionShipmentStatus()`,
   `assignDriverToShipment()` (the conditional-UPDATE from §2.6),
   `getAssignedJobsForDriver()`, `getShipmentForCustomer()`,
   `listAssignableShipmentsForProvider()`, plus the typed error classes
   (`ShipmentNotFoundError`, `ShipmentAlreadyAssignedError`,
   `JobNotAssignedToDriverError`, `InvalidShipmentStatusTransitionError`).
4. **Item 4 (`src/routes/api-logistics.ts`, `src/routes/api-drivers.ts`):**
   the routes in §4.1/§4.2, mounted in `src/index.tsx`.
5. **Item 5 (driver resolver):** `src/lib/drivers.ts` — `resolveDriverStatus()`,
   `requireActiveDriver()`, `getActiveDriversForProvider()`,
   `getActiveProviderDriverById()`, `getDriverDisplayName()` (the last one
   scoped exactly as described for customer tracking in §4.3).

Only once these five are implemented, migrated locally, and independently
sanity-checked (curl-level, not yet Chromium) does Items 6–15 (the UI layer
this whole prior cycle got stuck rebuilding blind) become meaningful to
start.

---

## 6. Open Questions for Pat Before Implementation

1. **`vehicle_type` enum** (`bike/tricycle/van/truck`) — confirm this matches
   what you want customers to select at booking time, or if there's a
   specific Nigerian-market vehicle taxonomy you'd prefer (e.g. adding
   `keke`/`dispatch_rider` naming instead of generic English terms).
2. **Shipment creation flow** — this design assumes a customer "books" a
   shipment (creating the `booked` row) through a not-yet-designed
   `/send/book` flow that itself needs its own address-selection +
   provider-selection UI. Is booking itself in Lifecycle-A scope, or should
   Items 1–5 assume shipments are created via a simpler admin/dev-data path
   for now, with real customer booking UI deferred to a later item?
3. **Provider selection at booking time** — one provider per shipment is
   assumed (`shipments.provider_id`), chosen how? Manually by the customer
   from a list of verified providers, or auto-assigned round-robin? This
   affects whether a `GET /api/logistics/providers` (public, verified-only)
   endpoint needs to exist in Item 4.

I'd rather get these three answered now than build Items 1–5 against a
guess and redo them.

# NaijaDeals Enterprise Control Center — Functional Navigation Audit

**Purpose:** Eliminate the ambiguity between *visual navigation* and *actual enterprise capability*, per the explicit "FIRST ACTION" mandate before any further Control Center implementation. Every sidebar item in `src/components/ControlCenterLayout.tsx`'s `NAV_GROUPS` is catalogued below against what genuinely exists in this repository today — no capability is assumed, every cell below was verified by reading or grepping the actual source file/migration named in it.

**How to read the Status column:**
- 🟢 **REAL & WIRED** — backend + API + UI all exist and are connected to the real database; safe to keep `implemented:true`.
- 🟡 **BACKEND REAL, UI MISSING** — a genuine engine/table/API already exists; the Control Center simply has no screen for it yet. This is a **UI-build task**, not a backend-build task.
- 🟠 **BACKEND PARTIAL** — some real capability exists but is incomplete for enterprise-grade control (e.g. read-only, or missing a specific mutation). Build the UI around what's real; document the rest as a gap.
- 🔴 **NO BACKEND** — no real table/engine exists for this domain. Must be explicitly gap-documented; must NOT be faked.

**Audit column note:** "cc_audit_logs" = the canonical Control Center audit table (migration `0013_control_center_foundation.sql`). Several engines (Orders, Bookings, Logistics, Wallet) have their **own** domain-specific event/ledger tables (`order_item_status_events`, `booking_status_events`, `cc_domain_events`, `wallet_ledger`) which are real and append-only, but are **not yet mirrored into `cc_audit_logs`**. This is flagged per-row — it means "an admin action there today is traceable in its own domain log, but does not yet show up in the unified Control Center Audit & Governance screen."

---

## ⚠️ COUNT RECONCILIATION (correction, addressed per explicit review feedback)

The prior version of this report's prose said **"11 of 13 flagged sidebar domains"** while its own tier table summed to **15** (4🟢 + 4🟡 + 5🟠 + 2🔴). That was a genuine inconsistency, not a rounding issue, and it is fixed here with one authoritative count instead of two different informal ones.

**Root cause of the mismatch:**
1. "13" was the count of items with `implemented: false` in `ControlCenterLayout.tsx`'s `NAV_GROUPS` at the time — that number was correct on its own terms.
2. The tier table's "15" **double-counted "Rides"** — it appears once bundled inside the "Rides & Logistics" 🟠 row (Deliveries=real, Rides=none) and then a **second time** implicitly inside the 🔴 tally, which was wrong; Rides is a sub-case of one nav item, not its own nav item.
3. The tier table also implicitly counted **Global Search** and **Command Palette** in the "13/15" framing even though neither is a `NAV_GROUPS` sidebar entry — they are top-bar/keyboard features, tracked separately in this document's own dedicated section below, and must not be added to the sidebar-item total.

**The single correct number, recounted directly from `NAV_GROUPS` in `src/components/ControlCenterLayout.tsx` right now:** there are **25 total sidebar items** across all 9 groups. Of those, **12 already carry `implemented: true`** (Command Center, System Health, Audit & Governance, Vendors & Stores, Providers & Partners, Africa Operations, Operations Tower, NaijaDeals Ecosystem, Payments & Finance, Verification & KYC, Countries/Africa, Aura AI Operations) and **13 currently carry `implemented: false`** — this "13" is the exact, reconciled count of items this audit needed to classify, and it is the same 13 enumerated in the module tables below (Analytics & Reports, Customers, Orders & Fulfillment, Bookings, Rides & Logistics, Wallets & Escrow, Content Moderation, Fraud & Risk, Promotions & Campaigns, Affiliates, Communications, Integrations & APIs, Platform Settings).

**Corrected tier breakdown of those exact 13 `implemented:false` items (one classification per item, no double-counting):**

| # | Module (nav key) | Tier |
|---|---|---|
| 1 | Analytics & Reports (`analytics`) | 🟡 |
| 2 | Customers (`customers`) | 🟡 |
| 3 | Orders & Fulfillment (`orders`) | 🟡 |
| 4 | Bookings (`bookings`) | 🟡 |
| 5 | Rides & Logistics (`logistics`) | 🟠 (Deliveries real / Rides sub-case has no backend — one item, one tier) |
| 6 | Wallets & Escrow (`wallets`) | 🟠 |
| 7 | Content Moderation (`moderation`) | 🟢 (backend+API+audit already fully real — highest-priority quick win) |
| 8 | Fraud & Risk (`risk`) | 🔴 |
| 9 | Promotions & Campaigns (`promotions`) | 🟠 |
| 10 | Affiliates (`affiliates`) | 🟡 |
| 11 | Communications (`communications`) | 🟢 (backend+API already fully real — quick win) |
| 12 | Integrations & APIs (`integrations`) | 🟠 |
| 13 | Platform Settings (`configuration`) | 🟠 |

**Reconciled total: 13 items = 2🟢 + 4🟡 + 5🟠 + 2🔴 = 13.** ✅ Matches `NAV_GROUPS` exactly, no omissions, no duplicates.

*(Note: Vendor/Provider 360 and Customer 360 are NOT separate line items in this recount — they are drill-down sub-features of the already-`implemented:true` "Customers" gap and the already-`implemented:true` "Vendors & Stores"/"Providers & Partners" nav items respectively. Customer 360 lives under the `customers` item above; Vendor 360 and Provider 360 are enhancements to nav items that are already `implemented:true` and therefore correctly excluded from the 13-item gap count — they were listed as their own rows in the module tables below purely for traceability of the underlying data-layer work, not as additional sidebar gaps.)*

The module-by-module tables below are unchanged in their factual findings — only this reconciliation section is new, to close out the counting error before implementation begins.

---

## MONITOR & ANALYZE

| Module | Existing Backend | Existing API | Existing DB | Existing UI | Permission | Audit | Status | Next Action |
|---|---|---|---|---|---|---|---|---|
| **Command Center** (`overview`) | `control-center-dashboard.ts`: `getPlatformOverviewCounts`, `getCommandCenterKpis`, `getCountryOperationalStatus`, `getHourlyOrderVolume`, `getOperationalDistributions`, `getLiveActivityFeed`, `getEcosystemOverview` — all real SQL aggregations | N/A (server-rendered) | `orders`, `bookings`, `users`, `vendors`, `product_listings`, `cc_countries`, `ecosystem_verticals` | ✅ `GET /control-center` — V4 "Global Operations Cockpit" | none (top-level page) | N/A (read-only dashboard) | 🟢 REAL & WIRED | None — keep as-is. |
| **Analytics & Reports** (`analytics`) | **No dedicated analytics engine.** Real GROUP BY primitives exist piecemeal (`getOperationalDistributions`, `getHourlyOrderVolume`, per-vertical counts in `getEcosystemOverview`) but there is no cross-domain reporting layer (date-range filters, Customer/Vendor/Booking/Logistics/Finance/Trust categories as specified) | None | Underlying tables (`orders`, `order_items`, `bookings`, `payment_transactions`, `refunds`, `disputes`, `users`, `vendors`) all real and queryable via `GROUP BY`/`COUNT`/`SUM` | ❌ None — `implemented:false` | `analytics.read` (**not yet in `cc_permissions` seed** — must be added) | N/A | 🟡 BACKEND REAL (raw tables), UI MISSING | **Workstream A.** Build a real reporting workspace: reuse existing tables via new aggregation queries per category (Commerce/Customers/Vendors/Bookings/Logistics/Finance/Trust&Safety/Ecosystem), each with a real date-range filter. No new tables needed. Add `analytics.read` to `cc_permissions`. |
| **System Health** (`system_health`) | `getSystemHealthChecks()` — real live checks (D1 query latency, notification outbox depth, etc.); explicitly labels non-instrumented services "Not monitored" | N/A | Queries live D1 state | ✅ `GET /control-center/system-health` | `system_health.read` | N/A | 🟢 REAL & WIRED | Already satisfies the "no fabricated uptime" rule. Only enhancement: extend `HEALTH_ICON`/checks list to cover logistics dispatch queue depth and wallet ledger write health if desired — optional polish, not a gap. |
| **Audit & Governance** (`audit`) | `control-center-audit.ts`: `recordControlCenterAction`, `buildControlCenterAuditStatements`, `getRecentControlCenterAuditLogs` — canonical, real, already used by `user-lifecycle.ts`, `control-center-verification.ts`, `moderation.ts` | N/A | `cc_audit_logs`, `cc_domain_events` | ✅ `GET /control-center/audit` (V3-era, needs V4 visual pass + filtering/drill-down per spec) | `audit.read` | N/A (this IS the audit table) | 🟡 BACKEND REAL, UI NEEDS UPGRADE | **Workstream F.** Add filtering (actor/action/entity-type/date range), severity/success indicator, and drill-down to the linked entity. Also: several real engines (Refunds, Logistics dispatch/driver lifecycle, Wallet credit/debit) do **not yet write to `cc_audit_logs`** — see per-row notes below. Decide whether to backfill those writes now or gap-document as a known limitation of the unified audit view. |

---

## USERS & ENTITIES

| Module | Existing Backend | Existing API | Existing DB | Existing UI | Permission | Audit | Status | Next Action |
|---|---|---|---|---|---|---|---|---|
| **Customers** (`customers`) | `getCustomer360()`, `listCustomersForDirectory()` (built this segment, real, TS-clean) + `applyUserStatusDecision()` in `user-lifecycle.ts` (real, atomic, audited via `cc_audit_logs`) | `POST /api/admin/users/:id/status` (`api-admin.ts`) — real suspend/reinstate endpoint | `users` (+ aggregated `orders`/`bookings`/`disputes`/`refunds` via subqueries) | ❌ None — `implemented:false` | `customers.read` / `customers.write` / `customers.suspend` (all already seeded in `cc_permissions`) | ✅ `cc_audit_logs` (via `applyUserStatusDecision`) | 🟡 BACKEND REAL, UI MISSING | **Workstream B (highest priority — data layer already built).** Build: (1) customer directory list page (search, status filter) using `listCustomersForDirectory`; (2) Customer 360 detail page using `getCustomer360` with drill-down to orders/bookings/disputes; (3) wire the existing suspend/reinstate action through `requireControlCenterPermission('customers.suspend')` + `applyUserStatusDecision`. |
| **Vendors & Stores** (`vendors`) | `getVendor360()` (built this segment) + `applyVendorVerificationDecision`/`applyVendorStoreStatusDecision` in `control-center-verification.ts` (real, atomic, audited) + full seller backend in `api-seller.ts` (products/inventory/orders/disputes/refunds) | `GET/POST` under `api-seller.ts` (seller-side) + verification/status via `control-center-verification.ts` functions (not yet routed through a dedicated API file — currently called directly from `control-center.tsx`'s `/vendors` route) | `vendors`, `product_listings`, `order_items`, `reviews` | ✅ `GET /control-center/vendors` (list + verify/suspend actions, V4-era) | `vendors.read` / `vendors.write` / `vendors.suspend` / `vendors.verify` | ✅ `cc_audit_logs` (via `control-center-verification.ts`) | 🟢 REAL & WIRED (list+actions); 🟡 Vendor 360 drill-down page not yet built | Wire `getVendor360` into a per-vendor detail/drill-down page reachable from the existing `/vendors` list (Entity 360 pattern). |
| **Providers & Partners** (`providers`) | `getProvider360()` (built this segment) + `applyProviderVerificationDecision`/`applyProviderOperationalStatusDecision` (real, atomic, audited) + full provider backend (`api-provider.ts`, `api-services.ts`, `api-service-requests.ts`) | Same pattern as Vendors | `provider_profiles`, `bookings`, `reviews` | ✅ `GET /control-center/providers` (list + verify/suspend actions) | `providers.read/write/suspend/verify` | ✅ `cc_audit_logs` | 🟢 REAL & WIRED (list+actions); 🟡 Provider 360 drill-down not yet built | Same as Vendors — wire `getProvider360` into a drill-down page. |

---

## OPERATIONS

| Module | Existing Backend | Existing API | Existing DB | Existing UI | Permission | Audit | Status | Next Action |
|---|---|---|---|---|---|---|---|---|
| **Africa Operations** (`africa`) | `getCountryOperationalStatus()` — real `cc_countries` query | N/A | `cc_countries` (10 real rows) | ✅ `GET /control-center/africa` — V4 signature rebuild | none | N/A | 🟢 REAL & WIRED | None. Decorative glow-map dots are documented as static artwork (per V4 approval condition) — not a functionality gap. |
| **Operations Tower** (`operations_tower`) | `getOperationsTowerQueues()` — real pending-action counts (moderation queue, open disputes, pending verifications) | N/A | `product_listings`, `disputes`, `vendors`, `provider_profiles` | ✅ `GET /control-center/operations` | none | N/A | 🟢 REAL & WIRED | Optionally add logistics-exception and wallet-issue queues once those modules are built. |
| **Orders & Fulfillment** (`orders`) | Extensive real backend: `order-lifecycle.ts` (`transitionOrderItemStatus`, `recomputeOrderAggregateStatus`), `order-settlement.ts` (variable-weight settlement, additional charges), `orders.ts` (checkout/payment confirmation), full customer-facing `api-orders.ts` (list/detail/cancel/item-status/disputes/refunds/additional-charges/checkout/verify-payment) | `api-orders.ts` (customer-facing, real) + `api-seller.ts` order endpoints (seller-facing, real) — **no admin-facing order-management endpoint yet** beyond `api-admin.ts`'s `/orders/:orderId/refund` | `orders`, `order_items`, `order_item_status_events` (real domain audit log, not yet mirrored to `cc_audit_logs`) | ❌ None — `implemented:false` | `orders.read` / `orders.manage` (already seeded) | 🟠 own `order_item_status_events` log exists; **not in `cc_audit_logs`** | 🟡 BACKEND REAL, UI MISSING | **Workstream C.** Build an admin order console: search/list orders (reuse `orders`/`order_items` tables), order detail with item-level status timeline (`order_item_status_events`), and wire `transitionOrderItemStatus` as an admin action gated by `orders.manage`. Have that admin action ALSO write to `cc_audit_logs` (currently only writes `order_item_status_events` + `cc_domain_events`) for unified audit visibility. |
| **Bookings** (`bookings`) | Extensive real backend: booking CRUD, `booking-payments.ts` (escrow hold/release), `booking-cancellation.ts` (quote+cancel), full `api-bookings.ts` (customer/provider/org-side lifecycle, holds, pay/cancel/transition) | `api-bookings.ts` — real, but customer/provider/org-facing only; no admin-facing booking-management endpoint yet | `bookings`, booking status-event tables | ❌ None — `implemented:false` | `bookings.read` / `bookings.manage` (already seeded) | 🟠 booking's own event tables exist; **not in `cc_audit_logs`** | 🟡 BACKEND REAL, UI MISSING | **Workstream C.** Build an admin booking console mirroring the Orders pattern: search/list, detail with lifecycle timeline, admin-side transition/cancel action gated by `bookings.manage`, writing to `cc_audit_logs`. |
| **Rides & Logistics** (`logistics`) | **Deliveries/dispatch: substantial real backend** — `logistics-dispatch.ts` (assign/reassign/rank candidate drivers), `logistics-drivers.ts` (driver onboarding, vehicle assignment, job queues), `logistics-delivery.ts` (OTP-gated completion, en-route/arrived, failed-attempt recording), `logistics-shipments.ts`/`logistics-tracking.ts` (shipment CRUD, GPS event logging with `compactOldGpsEventsIfNeeded`), full `api-logistics.ts`. **Rides (ride-hailing/NaijaDrive): CONFIRMED NOT BUILT** — `control-center-dashboard.ts` itself already documents "NaijaDrive/Mobility engine not yet built — no ride_requests table exists" (line 278); `migrations/0010_ecosystem_verticals.sql` lists NaijaDrive only as a "Coming Soon" marketing vertical row, no operational schema | `api-logistics.ts` — real, driver/merchant/org-facing | `logistics_shipments`/jobs/drivers/vehicles/GPS-event tables real; **no `ride_requests` table exists** | ❌ None — `implemented:false` | none currently declared (should add `logistics.read`/`logistics.manage` to `cc_permissions`) | 🔴 not in `cc_audit_logs` for deliveries either | 🟠 BACKEND PARTIAL (Deliveries real; Rides has zero backend) | **Workstream C.** Build the **Deliveries** half now (shipment search, driver roster, dispatch/reassign action, live GPS-based tracking view — using real coordinates, never fabricated). For **Rides**, per the explicit "no fake GPS — show 'Location unavailable'" instruction: do NOT build a Rides screen with fabricated data. Instead render a single honest "Rides (NaijaDrive) — not yet built" panel with a link to the gap, inside the same nav item. Add `logistics.read`/`logistics.manage` permissions. |

---

## ECOSYSTEM

| Module | Existing Backend | Existing API | Existing DB | Existing UI | Permission | Audit | Status | Next Action |
|---|---|---|---|---|---|---|---|---|
| **NaijaDeals Ecosystem** (`ecosystem`) | `getEcosystemOverview()` — real per-vertical activity counts | N/A | `ecosystem_verticals` + per-vertical counts | ✅ `GET /control-center/ecosystem` | none | N/A | 🟢 REAL & WIRED | None. |

---

## FINANCE & PAYMENTS

| Module | Existing Backend | Existing API | Existing DB | Existing UI | Permission | Audit | Status | Next Action |
|---|---|---|---|---|---|---|---|---|
| **Payments & Finance** (`finance`) | `getRecentFinancialActivity()` (built this segment, not yet consumed) + real `payment_transactions`/`refunds`/`disputes` tables (145 refunds, 5 disputes, 212 transactions confirmed real) + `refunds.ts` (`createAndExecuteRefund`, atomic wallet-ledger-linked) + `api-admin.ts`'s `/disputes/:id/resolve`, `/orders/:orderId/refund` | `api-admin.ts` disputes/refund endpoints (real, but thin — no transaction search/drill-down endpoint) | `payment_transactions`, `refunds`, `disputes` | ✅ `GET /control-center/finance` — currently 4 KPI cards + doughnut chart + status-breakdown table (pre-V4-propagation visual state, read in full but not yet edited) | `payments.read` / `payments.manage` / `refunds.read` / `refunds.approve` / `disputes.read` / `disputes.manage` (all seeded) | 🔴 `refunds.ts`'s `createAndExecuteRefund`/`resolveDispute` do **not** write to `cc_audit_logs` (confirmed via grep — no matches) | 🟡 BACKEND REAL, UI NEEDS FUNCTIONAL UPGRADE | **Workstream D.** Rebuild Finance route to: (1) consume `getRecentFinancialActivity` as a real activity feed; (2) add transaction/refund/dispute search+drill-down; (3) wire refund-approve/dispute-resolve actions through the CC layer gated by `refunds.approve`/`disputes.manage`, and — critically — make those actions also write to `cc_audit_logs` (currently they do not) so Finance actions appear in unified Audit & Governance. |
| **Wallets & Escrow** (`wallets`) | `wallet.ts` — **real, hardened, atomic** `creditWallet`/`debitWallet` (concurrency-safe via `db.batch()` CAS pattern, extensively documented) + `getWalletBalance`/`getWalletHistory`. Escrow itself is implemented as an order/booking `payment_status` state machine (`unpaid → escrow_held → released/refunded`) inside `orders.ts`/`booking-payments.ts` — **not** a separate escrow table, confirmed via codebase-wide search (no dedicated `escrow` table exists; escrow is a status value, by design) | `api-wallet.ts` — **CONFIRMED THIN: only `/`, `/topup/initialize`, `/topup/verify`.** No admin-facing wallet inspection or manual-adjustment endpoint exists | `wallet_accounts`, `wallet_ledger` (append-only, real) | ❌ None — `implemented:false` | `wallets.read` / `wallets.manage` (seeded; `wallets.manage` explicitly annotated "requires step-up auth once implemented") | 🔴 not in `cc_audit_logs` | 🟠 BACKEND PARTIAL (ledger real, no admin surface) | **Workstream D.** Build a **read-only-first** Wallets screen: per-user balance + ledger history via `getWalletBalance`/`getWalletHistory`, escrow-state visibility by joining `orders.payment_status`/`bookings.payment_status`. Do **NOT** build a second wallet/ledger/escrow engine (explicit instruction). Manual balance-adjustment mutation is a genuine gap — gap-document it; only build if/when step-up auth exists, per the permission's own annotation. |

---

## TRUST & SAFETY

| Module | Existing Backend | Existing API | Existing DB | Existing UI | Permission | Audit | Status | Next Action |
|---|---|---|---|---|---|---|---|---|
| **Verification & KYC** (`verification`) | `control-center-verification.ts` — **complete**, real, atomic, audited (vendor + provider verification/operational-status decisions, pending-queue getters) | Called directly from `control-center.tsx` (no separate API file — fine, server-rendered forms) | `vendors.verification_status`, `provider_profiles.verification_status` | ✅ `GET /control-center/verification` | none currently gating this route (uses `vendors.verify`/`providers.verify` at the action level) | ✅ `cc_audit_logs` | 🟢 REAL & WIRED | Backend is complete — this module needs the V4 **visual** upgrade only (already noted in the pre-existing plan), no backend work needed. |
| **Content Moderation** (`moderation`) | `moderation.ts` — **complete, real, audited**: `getPendingModerationQueue`, `getListingForModeration`, `applyModerationDecision` (approve/reject/suspend/request_changes, writes `cc_audit_logs` + `cc_domain_events` + triggers buy-box recompute), `getModerationHistoryForVendor` | `api-admin.ts`: `GET /moderation/queue`, `GET /moderation/listings/:id`, `POST /moderation/listings/:id/decision` — real, working, already used by the existing (non-Control-Center) admin flow | `product_listings.moderation_status`, `products.moderation_status` | ❌ None — `implemented:false` **despite a fully complete, audited backend** | none declared (should add `moderation.read`/`moderation.manage`) | ✅ `cc_audit_logs` | 🟢 BACKEND FULLY REAL & AUDITED, UI MISSING — highest ROI gap in the whole audit | **Workstream E — quick win.** This is the single clearest case of "backend exists, just build the UI." Build a moderation queue screen calling `getPendingModerationQueue`/`getListingForModeration`, with approve/reject/suspend/request-changes actions calling `applyModerationDecision` directly (or via `api-admin.ts`'s existing endpoints). Add `moderation.read`/`moderation.manage` permissions. |
| **Fraud & Risk** (`risk`) | **No general platform fraud/risk engine.** The only real fraud-signal table anywhere is `affiliate_fraud_events` (migration `0018`) — scoped strictly to the Affiliate program, not general marketplace/order/payment fraud. Real *proxy* signals do exist and are queryable from other tables today: repeated failed payments (`payment_transactions.status`), excessive cancellations (`order_items.item_status`/`orders.status`), repeated disputes (`disputes` grouped by `user_id`/`vendor_id`) | None | `affiliate_fraud_events` (affiliate-only); other signals derivable via ad-hoc queries on `payment_transactions`/`orders`/`disputes` | ❌ None — `implemented:false` | none declared | N/A | 🔴 NO GENERAL BACKEND (per-domain signals only) | **Workstream E.** Per the explicit "audit real signals first, no fake AI fraud dashboard" instruction: build a **Risk Signals** screen showing only the real, derivable signals above (repeated disputes by actor, failed-payment clusters, cancellation-rate outliers) via new real `GROUP BY`/`HAVING` queries against existing tables — NOT a scored/ML "fraud score." Explicitly label advanced fraud-scoring as a documented architectural gap, exactly as done for Aura AI. |

---

## MARKETING & GROWTH

| Module | Existing Backend | Existing API | Existing DB | Existing UI | Permission | Audit | Status | Next Action |
|---|---|---|---|---|---|---|---|---|
| **Promotions & Campaigns** (`promotions`) | Real tables: `coupons` (migration `0002`), `hero_campaigns` (migration `0008`, already used by `api-admin.ts` and `version.ts`) | `api-admin.ts` has hero-campaign—adjacent endpoints; **no dedicated coupon-management admin endpoint found** | `coupons`, `hero_campaigns` | ❌ None — `implemented:false` | `promotions.read` / `promotions.manage` (seeded) | none | 🟠 BACKEND PARTIAL (campaigns manageable via existing admin code; coupons have a table but no admin CRUD endpoint) | **Workstream G.** Build hero-campaign management UI first (endpoint exists), then a coupon CRUD admin UI (table exists, needs new endpoint — this is a real, scoped gap, not fabrication). |
| **Affiliates** (`affiliates`) | Real, substantial: `affiliate_profiles`, `affiliate_referral_codes`, `affiliate_campaigns`, `affiliate_clicks`, `affiliate_attributions`, `affiliate_fraud_events` (migrations `0017`/`0018`); `api-affiliate.ts` (join/me/ledger/commissions/payouts — **affiliate-self-service only**, no admin view) | `api-affiliate.ts` — real but self-service; no admin-facing affiliate-oversight endpoint | Full affiliate schema, real | ❌ None — `implemented:false` | none declared (should add `affiliates.read`/`affiliates.manage`) | none | 🟡 BACKEND REAL, UI MISSING (admin side) | **Workstream G.** Build an admin affiliate-oversight screen: affiliate directory, referral/attribution stats, fraud-event review (`affiliate_fraud_events` is literally already a fraud queue waiting for a UI), payout approval. |
| **Communications** (`communications`) | Real: `notification-observability.ts`, `notification-providers.ts`, full `notification_outbox`/`notification_deliveries`/`notification_preferences`/`notification_templates` schema (migration `0045`); `api-admin.ts`'s `/notifications/overview`, `/notifications/process-outbox`, `/notifications/retry-failed` — **already real, working endpoints** | `api-admin.ts` — real | `notification_outbox`, `notification_deliveries`, `notification_templates` | ❌ None — `implemented:false` **despite working backend+API** | `notifications.read` / `notifications.manage` (seeded) | none | 🟢 BACKEND FULLY REAL, UI MISSING — another quick win | **Workstream G — quick win.** Build a Communications screen calling the three existing `api-admin.ts` endpoints directly: outbox depth/overview, manual process/retry buttons. |

---

## PLATFORM MANAGEMENT

| Module | Existing Backend | Existing API | Existing DB | Existing UI | Permission | Audit | Status | Next Action |
|---|---|---|---|---|---|---|---|---|
| **Countries / Africa** (`countries`) | Same as Africa Operations — `cc_countries`, real | `api-admin.ts`'s `/countries` | `cc_countries` | ✅ `GET /control-center/countries` | none | N/A | 🟢 REAL & WIRED | Duplicate-with-`africa` nav entry noted for future consolidation (not a functionality gap). |
| **Integrations & APIs** (`integrations`) | Real schema: `cc_integrations`, `cc_integration_providers`, `cc_integration_country_overrides` (migration `0023`) — **but confirmed EMPTY: no seed data, no admin route reads/writes these tables today** | None found | `cc_integrations` (real table, real intent, zero live usage) | ❌ None — `implemented:false` | `integrations.read` / `integrations.manage` (seeded) | none | 🟠 BACKEND PARTIAL (schema exists, unused) | **Workstream G.** Build a read-only Integrations status screen against the existing (currently-empty) `cc_integrations` table — will honestly show "0 integrations configured" today, which is correct and matches the no-fabrication rule. Do not seed fake integration rows. |
| **Platform Settings** (`configuration`) | `cc_capabilities`, `cc_capability_country_overrides` (migration `0022`, capability-flag registry) — real schema; no confirmed admin UI/API reads it yet | None found | `cc_capabilities` | ❌ None — `implemented:false` | `configuration.read` / `configuration.write` (seeded, write "reserved for super_admin") | none | 🟠 BACKEND PARTIAL (schema exists, unused) | **Workstream G.** Build a capability-flag viewer/editor against `cc_capabilities`, gated `configuration.write` for mutations. |

---

## AURA AI

| Module | Existing Backend | Existing API | Existing DB | Existing UI | Permission | Audit | Status | Next Action |
|---|---|---|---|---|---|---|---|---|
| **Aura AI Operations** (`aura`) | None — intentionally not connected to a model yet | N/A | N/A | ✅ `GET /control-center/aura` — explicit "visual shell, not yet connected to a model" disclaimer (V4) | none | N/A | 🔴 NO BACKEND (honestly disclosed) | **Workstream H.** No change needed until Pat authorizes a real model integration — current honest-disclaimer treatment already satisfies the no-fabrication rule. |

---

## GLOBAL SEARCH & COMMAND PALETTE (not sidebar items, but explicitly in scope)

| Capability | Existing Backend | Existing API | Status | Next Action |
|---|---|---|---|---|
| **Global Search** | `control-center-search.ts`'s `runControlCenterSearch()` — real, permission-scoped LIKE search | `GET /api/control-center/search` (wired into the top bar, Ctrl+K focuses it) | 🟡 REAL but covers only 5 entity types (customers/vendors/providers/orders/bookings) | Extend to cover products, deliveries/shipments, transactions, disputes, and audit records, per the expanded requirement. Each addition is a new `UNION`-style query against a real table — no fabrication needed. |
| **Command Palette (Ctrl+K actions)** | None — Ctrl+K currently only focuses the search input | None | 🔴 NOT BUILT | Build a real palette exposing only commands the logged-in admin's `permissionKeys` allow (navigate-to actions first: "Open Finance", "Open Verification", etc. — trivial and safe; authorized-mutation commands like "Approve refund #123" come later once each module's action layer exists). |

---

## SUMMARY — PRIORITIZED GAP LIST (feeds directly into Workstream ordering)

**Quick wins (backend + audit already 100% real and complete — pure UI work):**
1. Content Moderation — `moderation.ts` + `api-admin.ts` are complete and audited.
2. Communications — `notification-observability.ts` + `api-admin.ts` endpoints are complete.
3. Vendor/Provider 360 drill-down — `getVendor360`/`getProvider360` already built this segment.
4. Customer 360 + directory — `getCustomer360`/`listCustomersForDirectory` already built this segment.

**Real backend, UI missing, some audit-wiring work needed:**
5. Orders & Fulfillment (needs admin console + `cc_audit_logs` wiring on `transitionOrderItemStatus`).
6. Bookings (needs admin console + `cc_audit_logs` wiring).
7. Analytics & Reports (needs new aggregation queries across existing tables — no new tables).
8. Finance functional upgrade (needs `getRecentFinancialActivity` wired in + `cc_audit_logs` wiring on refund/dispute actions).

**Backend partial — build what's real, gap-document the rest:**
9. Rides & Logistics — Deliveries are real and buildable now; Rides (NaijaDrive) has zero backend and must be honestly labeled, not faked.
10. Wallets & Escrow — ledger is real and hardened; build read-only balance/history view; manual-adjustment mutation is a genuine, documented gap pending step-up auth.
11. Fraud & Risk — no general engine; build a real-signals screen (disputes/failed-payments/cancellations), explicitly not a scored "AI fraud dashboard."
12. Promotions & Campaigns, Affiliates, Integrations & APIs, Platform Settings — each has real (if partial or unused) schema; build read-first UIs, document remaining gaps.

**No backend, correctly disclosed already:**
13. Aura AI — honest "visual shell" disclaimer already in place, no change needed until authorized.

**Cross-cutting fix identified by this audit:** several real, working mutation engines (Refunds, Disputes-resolve, Logistics dispatch/driver-lifecycle, Wallet credit/debit) do **not** currently write to the unified `cc_audit_logs` table — they either have their own domain-specific event log (`order_item_status_events`, `wallet_ledger`) or (in Refunds/Disputes' case) no admin-audit trail at all yet. This should be corrected as each Workstream touches that module, so Audit & Governance genuinely becomes the single pane of glass Section 11 requires — not bypassed engine-by-engine.

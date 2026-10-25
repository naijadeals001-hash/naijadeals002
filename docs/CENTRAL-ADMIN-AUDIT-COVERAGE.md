# NaijaDeals P0 Central Admin Audit Coverage

**Evidence date:** 2026-10-25  
**Scope:** current worktree, Central Admin routes, shared mutation libraries, migrations and focused HTTP tests.  
**Central tables:** `cc_audit_logs` and `cc_domain_events`.  
**Audit helper:** `src/lib/control-center-audit.ts`.

## 1. Audit policy used for this review

A central administrative event must identify the server-resolved actor, action, resource type/id, success state and only safe context. Passwords, password hashes, session tokens, payment credentials, provider secrets, raw notification content and integration `config_json` are excluded. `cc_domain_events` is a companion event stream; domain tables such as `wallet_ledger`, `order_item_status_events` and logistics events remain useful but are not substitutes for `cc_audit_logs`.

Where the business mutation and audit are both controlled by the same library, they should be in one D1 batch. `recordControlCenterAction()` is suitable for already-completed, non-atomic operational actions; it must not be described as atomic with an unrelated mutation.

## 2. Coverage matrix

| Operation/domain | Entry points reviewed | Current writer | Actor/resource/action evidence | Transactionality | P0 result / gap |
|---|---|---|---|---|---|
| Vendor verification | `/api/control-center/verifications/vendors/:id/decision`; `control-center-verification.ts` | `cc_audit_logs` + `cc_domain_events` | Authenticated CC actor; vendor id; verification action; safe before/after; reason/IP where supported | Atomic D1 batch with vendor update | **Covered** |
| Vendor store/operational status | `/api/control-center/verifications/vendors/:id/store-status` | Central audit + domain event | Actor, vendor, old/new status and safe reason | Atomic | **Covered** |
| Provider verification | `/api/control-center/verifications/providers/:id/decision` | Central audit + domain event | Actor, provider profile id, decision and safe state | Atomic | **Covered** |
| Provider operational status | `/api/control-center/verifications/providers/:id/operational-status` | Central audit + domain event | Actor, provider profile id, operational decision | Atomic | **Covered** |
| Listing moderation | CC decision endpoint and legacy alias | `applyModerationDecision()` writes central audit/domain event | Actor, listing id, old/new moderation status, reason, success | Atomic D1 batch | **Covered; alias intentionally does not add duplicate event** |
| Customer account status | CC endpoint and legacy `/api/admin/users/:id/status` | `applyUserStatusDecision()` writes central audit/domain event and revokes sessions | Actor, target user id, before/after status, reason | Atomic batch | **Covered; tested exactly once** |
| Notification outbox processing | CC and legacy compatibility endpoints | `recordControlCenterAction()` after `processOutboxBatch()` | Actor, aggregate outbox resource, bounded limit/counts, compatibility path | Not atomic with outbox work | **Covered for admin action; failure-path policy remains limited** |
| Failed notification retry | CC and legacy compatibility endpoints | `recordControlCenterAction()` after `retryFailedDeliveries()` | Actor, aggregate delivery resource, bounded limit/counts | Not atomic with retry work | **Covered for successful invocation; no per-recipient content logged** |
| Hero campaigns | `/api/control-center/hero-campaigns*` | `recordControlCenterAction()` in mutation handlers | Actor, campaign id, safe campaign state/action | Route mutation and audit are separate unless handler batches them | **Central event calls present; verify each failure path before claiming atomicity** |
| Category/navigation administration | `/api/control-center/collections*`, `/category-nav*`, `/ecosystem-nav*`, attributes | Central action calls in applicable handlers; domain tables | Actor, entity/action and safe state | Varies by handler | **Partial-to-covered; each mutation needs handler-level audit assertion** |
| Country facts/product origins | `/api/control-center/country-facts*`, `/product-origins*` | Central action calls | Actor, record id, review/verify/dispute/delete action | Varies; no raw sensitive payload should be logged | **Covered at route level; transactionality varies** |
| Refunds | `/api/control-center/orders/:orderId/refund`; `src/lib/refunds.ts`; wallet ledger | Shared refund/wallet domain records; no uniform central admin event verified for every path | Resource/order/refund actor attribution is not consistently proven | Financial mutation has domain transaction controls; CC audit propagation unresolved | **Gap; do not claim complete finance audit** |
| Dispute resolution | `/api/control-center/disputes/:id/resolve`; `src/lib/refunds.ts` | Dispute/domain records; central audit coverage not uniform | Actor/action/resource mapping requires explicit verification | Varies | **Gap; define central event contract before broader operations** |
| Order lifecycle | Customer/seller/operator order APIs; `order-lifecycle.ts`, `orders.ts` | `order_item_status_events` and order/payment records | Domain actor/state events exist; CC administrative actor not consistently distinguished | Domain transactionality exists | **Gap for Central Admin; do not treat domain event as CC audit** |
| Booking lifecycle | Booking/service-order APIs and lifecycle library | Booking status/domain events | Actor/resource/domain state exists in places; no complete CC admin trail verified | Varies | **Gap; future read-first CC console required** |
| Wallet/top-up/payment webhooks | `api-wallet.ts`, `api-webhooks.ts`, `wallet.ts` | `wallet_ledger`, payment transaction rows and provider webhook checks | End-user/provider actor semantics differ from admin actor; no central admin event for all writes | Ledger/idempotency protections are domain-specific | **Not a Central Admin mutation surface in P0; central reconciliation visibility remains needed** |
| Logistics shipment/dispatch/driver lifecycle | `api-logistics.ts`, logistics libraries | Logistics shipment/job/tracking events | Customer/provider/driver ownership and operational actors are domain-scoped; CC actor trail not uniform | Varies | **Gap; do not add broad CC access without logistics actor decision** |
| NaijaDrive preview | `/api/drive/fare-estimate`, `/api/drive/preview-booking` | No operational ride persistence in Worker preview | No live ride admin mutation exists | Booking intentionally unavailable without runtime/provider | **Safeguard preserved; no audit event is fabricated** |
| Control Center login/logout | `/control-center/login`, `/control-center/logout` | Central audit helper | Actor snapshot and session event; no credential/token values | Session mutation and audit are separate by design | **Covered; sensitive data excluded** |

## 3. Duplicate-event review

- The legacy moderation alias calls `applyModerationDecision()` only. It does **not** call `recordControlCenterAction()` a second time.
- The legacy user-status alias calls `applyUserStatusDecision()` only. It does **not** write a second audit row.
- Notification aliases add one central administrative action after the outbox/retry helper returns. They do not log notification body, recipient content, provider credentials or secret configuration.
- Verification libraries own their central event writes; route wrappers do not duplicate them.
- `cc_domain_events` is expected as the companion event for the central helper. It must not be counted as a second independent administrative action in coverage metrics.

## 4. Failure and transaction limitations

The current `ControlCenterAuditEntry` supports `success: false`, but not every legacy/domain failure path records a failed central event. In particular, validation failures and exceptions before a business helper returns are generally HTTP errors without an audit row. This is an evidence-backed limitation, not a reason to claim false coverage.

The notification compatibility routes perform the operational helper first and then write the audit event. If the helper succeeds but the audit write fails, the request can fail after the operational work. A future improvement should add an outbox-operation correlation/idempotency policy or a durable administrative operation record; P0 does not invent that policy.

Financial, booking and logistics changes need a business-approved definition of:

1. which actor is the platform administrator versus customer/provider/driver;
2. which state is safe to serialize before/after;
3. whether the audit must be in the same transaction as the money/state change;
4. how retries and idempotency are represented.

Those are unresolved security/business decisions and are intentionally blockers for broader centralization.

## 5. Coverage classification

| Classification | Current scope |
|---|---|
| **Central and evidence-backed** | Vendor/provider verification and operational status, listing moderation, customer status, Control Center authentication, notification admin triggers, applicable catalog/promotion/country admin mutations |
| **Domain-audited but not central administrative audit** | Order transitions, booking/service transitions, wallet ledger, payment webhook records, logistics shipment/job/tracking events |
| **Insufficient or inconsistent coverage** | Refund/dispute admin actions in all paths, wallet administrative adjustments (not enabled), logistics dispatch administration, future ride operations |
| **Not an active operation** | Registry-only verticals, NaijaDrive live booking/dispatch/presence/payments in the Worker preview |

## 6. P0 conclusion

P0 establishes a central audit boundary for the supported migrated admin operations and documents the remaining domain gaps. It does **not** establish comprehensive audit coverage for every write in the ecosystem. The next phase must be read-first and evidence-led, especially for finance, booking, logistics and ride operations.

# NaijaDeals REA Gaps and Roadmap

This roadmap is based on the current repository evidence and the reference-hypothesis matrix. It does not pretend that blocked REA sessions were completed.

## 1. Immediate evidence and governance gaps

### P0 — Preserve audit truth

1. **Keep the REA limitation explicit.** Do not call the current documents a completed competitor reverse-engineering report. Obtain authorized targets, a supported REA tool/session, or source repositories before making screen-level claims about competitor products.
2. **Reconcile current-worktree source against older audit documents.** Several historical documents describe earlier repository states. For example, older NaijaSend and Control Center reports predate the current worktree's logistics and Control Center implementation. Every future audit should record SHA, branch, migration range and local preview command.
3. **Create a repeatable evidence ledger.** Store target URL/source, access mode, capture date, target version, observed screens, workflow steps, and limitations. Do not store private credentials or private user data.

### P0 — Central authorization consolidation

1. **Audit and plan retirement of `src/routes/api-admin.ts`.** It uses `requirePlatformRole('admin')`, while the Control Center uses `cc_user_roles`/`cc_permissions`. Do not delete it blindly: enumerate callers, tests and clients, then re-home or deprecate each endpoint behind `/api/control-center`.
2. **Add a compatibility test matrix.** For each legacy route test: unauthenticated, ordinary authenticated user, `users.role='admin'` without CC role, CC operator without the requested permission, and authorized CC role.
3. **Propagate `cc_audit_logs`.** Refunds, dispute resolution, wallet mutations, logistics dispatch, order transitions and booking transitions need a deliberate audit policy. Domain event tables remain valuable but are not substitutes for a central administrative trail.
4. **Separate global CC roles from organization roles.** Keep organization RBAC for tenant/country/vertical scope and CC RBAC for platform administration. Document the intersection instead of creating a third role model.

## 2. Shared-engine roadmap

### P1 — Central operational visibility over real engines

Build read-first Control Center workspaces over existing tables, without creating duplicate admin copies:

1. Orders and fulfillment: search, detail, item status timeline, refunds/disputes.
2. Bookings: search, lifecycle timeline, cancellation/refund state.
3. Logistics deliveries: shipment/driver/job queues, assignment/reassignment, tracking and exceptions.
4. Wallets and escrow: user balance/history, ledger entries, order/booking escrow state; no manual balance adjustment until step-up auth exists.
5. Finance: transaction/refund/dispute search, reconciliation state, payout visibility and central audit.
6. Communications: notification outbox depth, failed delivery retry, template/provider status.
7. Moderation: product/listing queue and audited decisions.
8. Customer/vendor/provider 360: shared entity drill-down, verification state, orders/bookings, disputes and financial summaries.

### P1 — Audit and permission completion

Add or verify permissions for:

- `logistics.read` / `logistics.manage`.
- `rides.read` / `rides.manage` / `rides.dispatch` only when ride entities become real.
- `moderation.read` / `moderation.manage`.
- `affiliates.read` / `affiliates.manage`.
- `analytics.read`.
- Any vertical-specific permissions only after that vertical has real entities and operations.

Every mutation should record:

- Actor user ID and name snapshot.
- Permission/action.
- Entity type and ID.
- Safe before/after state.
- Success/failure.
- Correlation/request context.

## 3. Vertical roadmap

### P1 — Finish existing verticals before adding new ones

1. **NaijaShop:** finish admin orders, returns/refunds, catalog media upload, finance reconciliation and audit propagation.
2. **NaijaFresh:** validate data and UI against the local migration state; add substitutions, weighted-item settlement, availability and fulfillment operations only when underlying contracts are real.
3. **NaijaEats:** consolidate restaurant/operator/order/dispatch administration and connect delivery exceptions to the central audit view.
4. **NaijaGigs:** formalize service listing, request, quote and service-order lifecycle; add provider 360 and dispute/audit coverage.
5. **NaijaStay:** centralize property, availability, booking, cancellation and payout operations.
6. **NaijaSend:** distinguish shipment delivery operations from NaijaDrive rides; build central shipment/driver/dispatch console without claiming live GPS where unavailable.
7. **NaijaDrive:** keep Worker preview safeguards; obtain an approved routing provider and persistent runtime before enabling routed booking or payment.
8. **NaijaPay:** extend the existing ledger/transaction architecture for supported rails, reconciliation and settlement; do not create a second wallet.

### P2 — Build shared capabilities required by future verticals

1. Generalized Service Engine for Gigs, Home, Beauty, Health and Auto services.
2. Generalized Booking Engine for Stay, Travel, Events, Health, Beauty and scheduled services.
3. Generalized Trust/Review entity model beyond product-only reviews.
4. Cross-entity Search & Discovery rather than duplicated SQL `LIKE` queries.
5. Organization/business accounts with staff roles for clinics, garages, salons, farms and event companies.
6. Event-driven communication writers and an approved outbound provider.
7. Analytics/event aggregation with provenance and date-range semantics.
8. Media processing and playback pipeline for Stream.

### P3 — Future vertical implementations

Build only after the shared contracts are approved:

- **NaijaAuto:** vehicle/parts listings plus service-provider workflows.
- **NaijaHomes:** property/lease/inquiry model distinct from Stay bookings.
- **NaijaTravel:** inventory, itinerary and cross-vertical bundles.
- **NaijaEvents:** ticketing/capacity extension over Booking.
- **NaijaLearn:** course/content/enrollment/progress model.
- **NaijaJobs:** job/application/interview pipeline distinct from Gigs.
- **NaijaHealth:** regulated provider, appointment, pharmacy and health-data controls.
- **NaijaFarm:** producer/wholesale/traceability/bulk pricing and Fresh supply integration.
- **NaijaHome:** curated Service/Booking presentation over Gigs infrastructure.
- **NaijaBeauty:** product + appointment/service presentation over shared engines.
- **NaijaStream:** media ingestion/transcoding/playback/subscription capabilities.
- **Aura AI:** persisted conversation, permission-aware tools, cross-engine orchestration and AI action audit.

## 4. Reference REA execution plan

When legitimate REA access becomes available:

1. Select one primary and one secondary reference per vertical based on actual product scope, not brand familiarity.
2. Capture public landing/navigation screens first.
3. Capture customer flow: discovery → identity → selection → checkout/booking/request → fulfillment → cancellation/refund → support.
4. Capture provider/operator flow: onboarding → verification → inventory/service setup → acceptance → fulfillment → settlement.
5. Capture admin/operations flow only through an authorized account or public official documentation.
6. Record state transitions, fields, error behavior and role boundaries.
7. Hash or version evidence artifacts and link each matrix claim to an evidence item.
8. Mark unavailable screens as unavailable rather than inferring them from marketing copy.

## 5. Recommended implementation order

| Phase | Objective | Exit evidence |
|---|---|---|
| 9B-6A | Legacy admin route inventory and consolidation plan | Every `/api/admin/*` route has owner, consumer, gate, audit status and migration decision. |
| 9B-6B | Central audit propagation | Refund, dispute, order, booking, wallet and logistics admin actions appear in `cc_audit_logs`. |
| 9B-6C | Read-first operations consoles | Orders, bookings, deliveries, wallets and finance are visible from `/control-center` using real data. |
| 9B-7 | Service/booking integration hardening | Gigs, Stay, Eats and logistics have explicit provider/operator/admin state machines and tests. |
| 9B-8 | Approved REA reference pass | At least one authorized target per priority vertical has captured, traceable evidence. |
| 9B-9 | Future vertical contract design | Auto, Homes, Travel, Events, Learn, Jobs, Health, Farm, Home and Beauty contracts are approved before implementation. |

## 6. Stop conditions

Do not proceed to a new vertical or claim operational readiness if:

- The underlying entity model is missing.
- The customer flow is only a waitlist/preview page.
- A provider or admin mutation has no server-side authorization.
- A financial mutation has no idempotency/concurrency protection and audit plan.
- A reference conclusion is based only on a competitor's marketing page.
- A live location, fare, availability, inventory or revenue metric would be fabricated.

# NaijaDeals P0 Central Admin Route/Auth Matrix

**Evidence date:** 2026-10-25  
**Repository:** `/home/user/worktrees/release-naijaeats-phase1`  
**Branch:** `feat/naijadrive-private-ride-foundation`  
**HEAD observed before this document:** `53b1d478cf1b7ef2df9bf297ab71b1a9211840d4`  
**Canonical admin target:** `admin.naijadeals.com` (prepared in code only; not configured)  
**Preview admin entry:** `/control-center`

This matrix uses the current working tree as the source of truth and supplements the baseline artifacts `REA-ECOSYSTEM-AUDIT.md`, `REA-VERTICAL-REFERENCE-MATRIX.md`, `CENTRAL-ADMIN-COMPLIANCE-MATRIX.md`, and `REA-GAPS-AND-ROADMAP.md`. It does not infer an operational capability from a registry entry or a historical document.

## 1. Inventory and decision summary

| Surface | Current count | Authentication boundary | Central permission boundary | P0 decision |
|---|---:|---|---|---|
| `src/routes/api-admin.ts` compatibility routes | 5 | `requireControlCenterApiAuth` | Route-specific CC permission | Migrated in place; historical URLs preserved |
| `src/routes/api-control-center.ts` | 61 declarations | Global `requireControlCenterApiAuth` | Per-route CC permission on privileged reads/writes | Canonical admin API; retain and test |
| `src/routes/control-center.tsx` | 23 declarations | Global `requireControlCenterAuth` after login/logout | Per-page permission where a page has a scoped surface | Canonical SSR shell; login/logout are the only SSR mutations |
| `src/routes/api-logistics.ts` | 35 declarations | Mixed public, `requireAuth`, ownership/provider/driver gates | No complete CC admin boundary | Do not mechanically migrate customer/provider/driver APIs; document gap |
| Other customer/provider/seller/org APIs | 250+ declarations across route files | Shared session plus ownership, provider, seller or organization RBAC | Not global-admin operations | Preserve domain/tenant authorization; centralize only future admin entry points |

### P0 migration status

- **Complete for the five legacy compatibility routes:** the old `users.role = 'admin'` gate is no longer used by `api-admin.ts`.
- **Complete for existing CC operations:** `/api/control-center/*` has one shared session/CC-role gate followed by least-privilege permissions.
- **Not complete ecosystem-wide:** logistics, order, booking, wallet, refund, dispute and other domain mutations are not all Central Admin operations and do not all emit `cc_audit_logs` records.
- **No new broad permission was added:** missing logistics/vertical permissions remain documented gaps.

## 2. Legacy `/api/admin/*` route-by-route matrix

All five historical routes are mounted under `app.route('/api/admin', adminApi)`. The compatibility router applies `requireControlCenterApiAuth` before the route-specific permission. A user with only `users.role = 'admin'` and no `cc_user_roles` row is denied; a CC role without the route permission is denied.

| Method/path | Existing behavior before P0 | Current gate | Read/mutation | Intended roles / equivalent permission | Compatibility risk | Required/evidenced tests | Status |
|---|---|---|---|---|---|---|---|
| `GET /api/admin/moderation/listings/:id` | Auth plus flat platform admin role | CC session + `moderation.read` | Reads one product listing moderation view | Trust/safety/content operators; `moderation.read` | Existing clients retain URL; users with legacy admin only must receive 403 until assigned an appropriate CC role | 401 anonymous; 403 ordinary/no-role; 403 CC role without permission; authorized read | **Migrated** |
| `POST /api/admin/moderation/listings/:id/decision` | Auth plus flat platform admin role | CC session + `moderation.manage` | Mutates moderation status and reason | Trust/safety/content operators; `moderation.manage` | Same URL and payload preserved; underlying engine already writes the central audit event, so the alias must not write a duplicate | 401/403 boundaries; valid decision; invalid decision; exactly one central audit row | **Migrated; no duplicate audit** |
| `POST /api/admin/notifications/process-outbox` | Auth plus flat platform admin role | CC session + `notifications.manage` | Bounded request-triggered outbox processing; max 100 | Communications operators; `notifications.manage` | Legacy clients retain URL. It is an operational trigger, not a public scheduler. Audit is non-atomic with the outbox work because the helper is separate from the underlying batch | 401/403; authorized bounded execution; audit row and no secrets | **Migrated; audit added** |
| `POST /api/admin/notifications/retry-failed` | Auth plus flat platform admin role | CC session + `notifications.manage` | Bounded retry of eligible failed deliveries; max 100 | Communications operators; `notifications.manage` | Same as process-outbox; retry result is not an entity-level list, so audit records aggregate counts only | 401/403; bound enforcement; audit row and no recipient content | **Migrated; audit added** |
| `POST /api/admin/users/:id/status` | Auth plus flat platform admin role | CC session + `customers.suspend` | Atomic account lifecycle mutation, audit and session revocation | Customer/trust operators; `customers.suspend` | Existing path and payload preserved; permission is intentionally narrower than a generic admin role | 401/403; invalid status; missing user; successful status transition; exactly one audit/domain event | **Migrated; underlying engine audited** |

### Legacy compatibility rule

New privileged functionality must be added to `/api/control-center/*`. The five aliases remain only for client migration compatibility. They are not a second authorization model. Retirement/deprecation requires caller inventory and a separate compatibility decision; this P0 does not silently remove historical URLs.

## 3. Canonical `/api/control-center/*` matrix

The router has **61 route declarations** and begins with `apiControlCenterRoutes.use('*', requireControlCenterApiAuth)`. The following rows cover all current families and their route-level permissions. Routes shown as `read` are privileged reads; routes shown as `manage` or `decision` are mutations.

| Route family / paths | Methods | Permission | Operation | Audit status |
|---|---|---|---|---|
| `/verifications/vendors/:id/decision` | POST | `vendors.verify` | Vendor verification decision | Central, atomic in verification engine |
| `/verifications/vendors/:id/store-status` | POST | `vendors.suspend` | Vendor operational/store status | Central, atomic |
| `/verifications/providers/:id/decision` | POST | `providers.verify` | Provider verification decision | Central, atomic |
| `/verifications/providers/:id/operational-status` | POST | `providers.suspend` | Provider operational status | Central, atomic |
| `/ecosystem`, `/search` | GET | Shared CC gate; search is permission-scoped | Registry and command search | Read only |
| `/moderation/listings/:id`, `/moderation/queue` | GET | `moderation.read` | Moderation queue/detail | Read only |
| `/moderation/listings/:id/decision` | POST | `moderation.manage` | Listing decision | Central in `applyModerationDecision()` |
| `/notifications/overview` | GET | `notifications.read` | Aggregate/provider observability | Read only; response intentionally omits secrets/content |
| `/notifications/process-outbox`, `/notifications/retry-failed` | POST | `notifications.manage` | Bounded operational triggers | Central audit event; non-atomic with helper work |
| `/users/:id/status` | POST | `customers.suspend` | Customer lifecycle mutation | Central in `applyUserStatusDecision()` |
| `/collections`, `/collections/:id*` | GET/POST/PATCH/DELETE | `catalog.read` / `catalog.manage` | Collection/catalog administration | Route-level central audit where implemented; verify per mutation |
| `/categories/:categoryId/attributes`, `/attributes/:id` | GET/POST/PATCH/DELETE | `catalog.read` / `catalog.manage` | Category attribute administration | Same catalog audit caveat |
| `/disputes`, `/disputes/:id/resolve` | GET/POST | `disputes.read` / `disputes.manage` | Dispute queue and resolution | Shared domain/finance records; central audit coverage requires explicit review |
| `/orders/:orderId/refund` | POST | `refunds.approve` | Refund approval/money movement | Refund ledger/domain path; central admin audit policy remains a blocker |
| `/countries` | GET | `configuration.countries.read` | Country configuration read | Read only |
| `/hero-campaigns*` | GET/POST/PATCH | `promotions.read` / `promotions.manage` | Hero campaign CRUD, status, duplicate, archive, restore, reorder | Central `recordControlCenterAction()` calls present in mutation handlers |
| `/category-nav*`, `/ecosystem-nav*` | GET/PATCH/POST | `catalog.read` / `catalog.manage` | Navigation and pill administration | Central audit calls present for mutations |
| `/country-facts*`, `/product-origins*` | GET/POST/PATCH/DELETE | `country.settings.edit` | Country facts/origin review and decisions | Central audit calls present; safe before/after fields required |

The route family table intentionally groups parameterized declarations to keep the matrix reviewable. The source declaration count is the authoritative completeness check: 61 current CC API declarations, all behind the global CC API gate; privileged mutations additionally carry a specific permission at the route declaration.

## 4. Server-rendered Control Center mutation paths

`src/routes/control-center.tsx` declares **23 routes**. `GET` pages are protected by the router-wide `requireControlCenterAuth` plus page-specific permissions where applicable. The only SSR mutation paths are:

| Method/path | Gate | Operation | Audit |
|---|---|---|---|
| `POST /control-center/login` | Public login handler; resolves the shared identity/session and then requires CC role for success | Creates the existing `nd_session` only for an authorized CC user | Writes `control_center_login`; no password/session token in audit context |
| `POST /control-center/logout` | Shared session/CC context | Revokes/destroys current session | Writes `control_center_logout`; no token value logged |

Forms and buttons on protected pages call the canonical CC APIs; they are not independent server-side mutation authorities. The Control Center page gate remains authoritative even when navigation is hidden.

## 5. Privileged domain paths intentionally not migrated in P0

These are real mutations, but they are customer/provider/seller/organization operations rather than Central Admin compatibility routes. They must not be re-gated with a broad CC role merely to make the architecture look uniform.

| Surface | Current boundary | Why not mechanically migrated | Minimal future decision |
|---|---|---|---|
| `api-logistics.ts` dispatch/assignment/reassignment | Shared auth plus organization/provider/driver checks; some paths use `requireAuth` | Customer/provider/driver workflows have ownership and operational semantics distinct from platform administration | Define `logistics.read/manage` and a dispatch operator model only after intended actor scope is approved; do not grant it now |
| Order/seller/provider lifecycle APIs | Shared session, ownership, seller/provider/org checks | These are self-service/domain actions, not global admin actions | Add read-first CC operations and explicit actor-aware admin commands before widening access |
| Wallet/top-up/webhook paths | Shared auth, ownership, provider webhook verification | Financial mutation needs idempotency, reconciliation and step-up policy | Centralize admin visibility first; no manual balance mutation in P0 |
| Booking/service-order lifecycle | Customer/provider ownership and domain state machines | Booking actor scope and cancellation/refund policy are unresolved | Add CC read/decision endpoints with explicit permission and atomic audit policy |

## 6. Acceptance decision

**Accepted for P0 migration:** the supported legacy admin operations now use one canonical Control Center identity/RBAC boundary, with least-privilege permissions and preserved historical URLs.

**Not accepted as complete ecosystem consolidation:** uncovered domain mutations remain explicitly documented. The code does not claim that every customer/provider/domain write is a Central Admin operation or that every domain event is a central administrative audit event.

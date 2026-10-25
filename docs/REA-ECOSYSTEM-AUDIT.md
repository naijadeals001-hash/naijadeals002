# NaijaDeals REA Ecosystem Audit

**Audit date:** 2026-10-25  
**Repository:** `/home/user/worktrees/release-naijaeats-phase1`  
**Branch:** `feat/naijadrive-private-ride-foundation`  
**HEAD verified:** `53b1d478cf1b7ef2df9bf297ab71b1a9211840d4`  
**Audit scope:** repository, source, migrations, tests, existing preview, prior architecture/audit documents, and public reference evidence.

## 1. Executive finding

This audit establishes the current NaijaDeals product inventory and its central-administration posture. It does **not** claim that the entire ecosystem was reverse-engineered through REA against live competitor applications.

The available `gsk` CLI was inspected during this audit. It exposes search/crawl/media/task capabilities but no REA/reverse-engineering command. No APK, emulator, authorized competitor account, connected device, or REA target session was provided. The prior `/tmp/naijadrive-phase8-analysis` evidence is a NaijaDrive repository analysis snapshot, not a reference-platform investigation and not an entire-ecosystem REA run.

Accordingly, every reference finding in `REA-VERTICAL-REFERENCE-MATRIX.md` is labeled as one of:

- **Public-web evidence:** official public documentation/search result used for a product hypothesis; not an REA inspection.
- **Repository evidence:** direct source/schema/test observation in this repository.
- **REA blocked:** no legitimate REA target/session/tool was available.

The result is an evidence-backed repository audit plus a reference hypothesis matrix. It is deliberately not presented as a completed competitor-app reconstruction.

## 2. Ground-truth repository findings

### 2.1 Current shared architecture

The repository contains one Hono/Cloudflare Worker application with a shared global middleware chain in `src/index.tsx`:

1. `attachUser` resolves the `nd_session` cookie through `src/lib/auth.ts`.
2. `attachLocale` resolves language/country presentation context.
3. Vertical and engine routes are mounted into the same Worker.
4. The same D1 database is used by the application.
5. `/control-center` is mounted from `src/routes/control-center.tsx`.
6. `/api/control-center` is mounted from `src/routes/api-control-center.ts`.

The architecture documents explicitly define singular identity, money, and shared reference data in `docs/NAIJADEALS_MASTER_ARCHITECTURE.md`, sections 6–8 and the engine mapping in section 5. Those are design constraints; the matrix distinguishes them from implemented behavior.

### 2.2 Implemented versus planned verticals

The source currently contains customer-facing or operational routes for:

- NaijaShop: `/`, `/shop`, `/shop/:slug`, `/cart`, `/checkout`.
- NaijaFresh: `/fresh`, `/fresh/:slug` with Fresh-specific marketplace code in `src/pages/fresh.tsx` and `src/lib/fresh.ts`.
- NaijaEats: `/eats`, restaurant/item/cart/checkout/order routes and operator routes.
- NaijaGigs: `/gigs`, category/provider/listing/request/dashboard routes.
- NaijaStay: `/stay`, property/book/dashboard/booking routes.
- NaijaDrive: `/drive`, plus a separate NestJS runtime under `services/naijadrive-runtime`; the Worker preview deliberately does not create rides.
- NaijaSend: `/send` currently resolves to the generic ecosystem preview path in `src/index.tsx`; logistics APIs exist in this current worktree, but the audit must distinguish those delivery capabilities from ride-hailing.
- NaijaPay: `/naijapay`, `/wallet`, payment, wallet, refund and ledger surfaces.
- Aura AI: `/aura` and `/api/aura/chat`; the API can call an LLM when configured but has no persisted conversation/tool-orchestration layer and returns an honest configuration error when no LLM configuration is present.

The following names are present in the central registry or architecture documents but do not have a dedicated customer-facing implementation verified in the current source: NaijaAuto, NaijaHomes, NaijaTravel, NaijaEvents, NaijaLearn, NaijaJobs, NaijaHealth, NaijaFarm, NaijaStream, NaijaHome, and NaijaBeauty. They remain discoverable in the Control Center registry but are not evidence of implemented verticals.

Additional platform surfaces discovered:

- Seller Portal: `/seller`, `/seller/dashboard`, `/seller/products`, `/seller/orders`, `/seller/inventory`, `/seller/finance`.
- Affiliates: `/affiliate` and `/api/affiliate/*` self-service APIs.
- Organizations: `/organizations/:organizationId` and `/api/organizations/*` organization RBAC.
- Provider/service engine: `/api/provider/*`, `/api/service-requests/*`, `/api/services/*`.
- Booking engine: `/api/bookings/*` and booking tables.
- Logistics engine: `/api/logistics/*` and logistics tables in the current worktree.
- Notifications/communication: `/api/notifications/*` and Control Center communication routes.

## 3. Reference-platform conclusion

The initial reference hypotheses are directionally appropriate, but a hypothesis is not REA evidence. The reference matrix therefore records the intended product pattern, a public official source where available, the exact repository evidence for NaijaDeals, and the missing REA evidence.

The strongest defensible conclusions are:

- NaijaShop and NaijaFresh are marketplace/buy-box adaptations, not independent commerce engines.
- NaijaEats is a menu/order/operator adaptation requiring dispatch and restaurant operations.
- NaijaDrive is a ride/mobility adaptation but remains operationally unavailable in the Worker preview.
- NaijaGigs and NaijaHome are service-marketplace adaptations requiring provider listings, quotes, service orders, availability and trust.
- NaijaStay and NaijaTravel are booking/reservation adaptations requiring a shared booking lifecycle.
- NaijaSend is a logistics/delivery adaptation, distinct from NaijaDrive mobility.
- NaijaPay is a shared payment/ledger front door, not a second ledger.
- NaijaAuto, NaijaHealth, NaijaFarm, NaijaBeauty, NaijaLearn and NaijaEvents are planned compositions of existing engines plus domain-specific extensions.
- NaijaJobs is a recruitment/workflow product and should not be forced into the Gigs service-order model.
- NaijaStream requires media processing/playback infrastructure not present in the repository.
- Aura AI is an orchestration layer over permitted engines, not a transaction-owning vertical.

## 4. One-central-admin conclusion

The current worktree has a real Central Admin implementation and a real CC-specific RBAC layer:

- SSR page gate: `src/lib/control-center-rbac.ts::requireControlCenterAuth`.
- API gate: `src/lib/control-center-rbac.ts::requireControlCenterApiAuth`.
- Granular permission gate: `requireControlCenterPermission()`.
- Role/permission source: `cc_user_roles`, `cc_roles`, `cc_role_permissions`, `cc_permissions`.
- Canonical audit: `cc_audit_logs` and `cc_domain_events`.
- Shared admin layout/navigation: `src/components/ControlCenterLayout.tsx`.
- Shared ecosystem registry: `src/lib/control-center-ecosystem.ts`.
- Shared finance view: `/control-center/finance`.

However, the architecture is not yet a complete one-pane-of-glass administration system:

- `src/routes/api-admin.ts` remains a legacy admin API gated by `requirePlatformRole('admin')`, not Control Center permissions.
- Some Control Center pages call domain libraries directly from SSR rather than through a dedicated CC API route.
- Some mutations write domain logs but do not write `cc_audit_logs`.
- Many verticals are registry-only and have no vertical-specific admin operations.
- The registry provides discoverability; it does not create missing operational engines.

Therefore the correct status is: **one central admin shell and RBAC foundation exists, but complete cross-vertical administrative coverage is partial and legacy authorization paths remain.**

## 5. Audit limitations

- No REA reference application session was available.
- No competitor source repositories were supplied or authorized.
- Public web search snippets are not a substitute for screen-by-screen REA evidence.
- No production deployment, DNS, production D1 query, or production credential was used in this audit.
- Current local preview and local D1 were used only for safe route/auth checks.
- Existing uncommitted Phase 9B work was preserved.

The authoritative detailed deliverables are:

- `docs/REA-VERTICAL-REFERENCE-MATRIX.md`
- `docs/CENTRAL-ADMIN-COMPLIANCE-MATRIX.md`
- `docs/REA-GAPS-AND-ROADMAP.md`

# NaijaDeals Full Ecosystem Baseline — 2026-10-25

## Execution safety

- Repository: `/home/user/worktrees/release-naijaeats-phase1`
- Branch: `feat/naijadrive-private-ride-foundation`
- HEAD at inspection: `53b1d478cf1b7ef2df9bf297ab71b1a9211840d4`
- Existing uncommitted work: preserved.
- Existing preview: PM2 process `naijadeals`, Wrangler Pages local preview on port `3000`.
- No commit, push, deployment, DNS change, production database write or credential change performed.

## Stack and runtime

- Hono + TypeScript + JSX SSR.
- Vite production build.
- Cloudflare Pages/Workers target.
- Cloudflare D1 local development database.
- Cloudflare R2 binding for seller uploads.
- PM2-managed Wrangler preview.
- Node test runner and Playwright browser tests.

## Existing shared foundations

| Engine | Current state |
|---|---|
| Identity/session | PBKDF2 password hashing, shared `nd_session`, account lifecycle, password reset and organizations. |
| RBAC | Shared platform RBAC plus Central Control Center RBAC: `cc_roles`, `cc_permissions`, `cc_role_permissions`, `cc_user_roles`. |
| Control Center | Protected `/control-center`, ecosystem registry, finance, verification, moderation, communications, customers, vendors, providers, audit and system health surfaces. |
| Audit | `cc_audit_logs`, `cc_domain_events`, domain-specific event tables; coverage remains incomplete for some order/finance/logistics mutations. |
| Marketplace | Catalog, categories, brands, vendors, listings, carts, checkout, orders, seller portal, inventory and reviews. |
| Payment/finance | Integer-kobo money, append-only `wallet_ledger`, wallet accounts, Paystack adapter/webhooks, refunds and seller finance records. |
| Booking | Generic bookable listings, resources, availability, holds, lifecycle, cancellation and booking payments. |
| Logistics | Quotes, shipments, vehicles, drivers, dispatch, delivery status, tracking and OTP primitives. |
| Service | Provider profiles, service categories/listings/packages, service requests and service orders. |
| Search | Catalog/service/bookable listing search eligibility and index events. |
| Notifications | Templates, preferences, outbox, delivery tracking, retry/process APIs and security tests. |
| Aura | Aura Luxe shell, shared Aura API and provider-configurable LLM client; model-backed production capability remains provider-dependent. |

## Vertical baseline

| Vertical | Public route state | Current status |
|---|---|---|
| NaijaShop | `/`, `/shop`, `/cart`, `/checkout` | Strongest live marketplace vertical. |
| NaijaFresh | `/fresh` | Functional marketplace slice on shared catalog; not fully promoted/live. |
| NaijaEats | `/eats` plus cart/checkout/operator routes | Functional customer ordering slice; merchant and delivery operations incomplete. |
| NaijaDrive | `/drive` | Safe planning/fare slice; booking/routing/dispatch/presence/payments unavailable. |
| NaijaGigs | `/gigs` plus service request/dashboard routes | Functional service discovery/request slice; full provider operations incomplete. |
| NaijaStay | `/stay` plus booking/dashboard routes | Functional booking foundation and customer flow; full lifecycle acceptance incomplete. |
| NaijaSend | `/send` plus generic logistics APIs | Logistics engine exists; dedicated public and operations UX incomplete. |
| NaijaPay | `/naijapay`, `/wallet` | Shared finance entry point; broader payment-services product incomplete. |
| NaijaAuto | `/auto` | Honest shared preview route added in migration 0084; dedicated workflows not implemented. |
| NaijaHomes | `/homes` | Honest shared preview route added in migration 0084; property model not implemented. |
| NaijaTravel | `/travel` | Honest shared preview route added in migration 0084; travel inventory not implemented. |
| NaijaEvents | `/events` | Honest shared preview route added in migration 0084; ticketing not implemented. |
| NaijaLearn | `/learn` | Honest shared preview route added in migration 0084; enrollment/progress not implemented. |
| NaijaJobs | `/jobs` | Honest shared preview route added in migration 0084; recruitment workflow not implemented. |
| NaijaHealth | `/health` | Honest shared preview route added in migration 0084; regulated health workflow not implemented. |
| NaijaFarm | `/farm` | Honest shared preview route added in migration 0084; wholesale/bulk workflow not implemented. |
| NaijaStream | `/stream` | Preview route; media storage/processing/playback not implemented. |
| NaijaHome | `/home` | Honest shared preview route added in migration 0084; uses planned shared service/booking engines. |
| NaijaBeauty | `/beauty` | Honest shared preview route added in migration 0084; uses planned shared service/booking engines. |
| Aura AI | `/aura` | Aura Luxe experience shell and shared API; model-backed capability depends on configured provider. |

## REA state

- Existing OpenCode MCP registration: `/home/user/.config/opencode/opencode.jsonc`.
- Configured package: `rea-agents@6.7.0`.
- Existing skill: version `42`, 207 tools.
- Existing REA evidence is documented in `docs/REA-ECOSYSTEM-COVERAGE-MATRIX.md`.
- Current shell could not execute `rea` directly; npx verification was blocked by the root-owned `/opt/npm-cache` permissions. No permissions or REA configuration were changed.

## Immediate implementation delivered in this execution

- Added migration `0084_full_ecosystem_preview_registry.sql` for the missing reserved vertical registry records.
- Added honest shared preview routes for Auto, Homes, Travel, Events, Learn, Jobs, Health, Farm, Home and Beauty.
- Added gradient/icon fallback behavior when no approved vertical-specific image exists.
- Added `tests/full-ecosystem-coverage.test.mjs` for complete registry and route coverage.
- Added migration `0085_pan_africa_rollout_controls.sql`, reusing the existing `cc_capabilities` and `cc_capability_country_overrides` tables for country/vertical activation.
- Added protected Control Center rollout APIs and a functional rollout-control panel on `/control-center/countries`.
- Applied migrations locally only.
- Rebuilt the application successfully.
- Reused and restarted the existing PM2 preview process.
- Smoke-tested the expanded routes: all returned HTTP 200.

## Explicit non-completion

A registry row, route, preview surface or passing build does not mean a vertical is complete. Authenticated competitor workflows, vertical-specific persistence, provider onboarding, payments, dispatch, media processing, regulated workflows and dedicated Control Center operations remain partial, unavailable or blocked as recorded in the coverage matrix.

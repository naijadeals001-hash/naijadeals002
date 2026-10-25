# NaijaDeals REA Ecosystem Coverage Matrix

**Classification:** REA-VERIFIED where an Evidence ID is present; otherwise explicitly blocked or not started.  
**Inspection date:** 2026-10-25  
**Repository:** `/home/user/worktrees/release-naijaeats-phase1`  
**Branch:** `feat/naijadrive-private-ride-foundation`  
**Temporary admin entry:** `/control-center`

## 1. REA integration record

| Item | Status | Evidence |
|---|---|---|
| Official product | Installed | `morluto/rea`, `rea.tools`, npm `rea-agents` |
| Installed package | `rea-agents@6.7.0` | `rea --version` |
| OpenCode MCP registration | Aligned | `/home/user/.config/opencode/opencode.jsonc` |
| REA skill | Aligned, version 42 | `/home/user/.agents/skills/reverse-engineer-anything` |
| Browser provider | Available | `rea-playwright-browser-scenario` v1 |
| Browser evidence artifacts | Available | DOM, accessibility, screenshot, URL and workflow steps |
| Optional native providers | Not configured | Hopper, Ghidra, IDA, JADX and Kuna remain outside web scope |

## 2. NaijaDrive reference coverage

| Reference | URL | REA status | Evidence ID | Public observations | Limitations |
|---|---|---|---|---|---|
| Bolt | `https://bolt.eu/en/` | **REA verified** | `ev_283144f455a1c616a0bc6ef82b7e469a7965a8612209f0c5f644ded74215d1a2` | Public navigation, cookie dialog, main menu interaction, Products/Earn with Bolt/Company navigation, Rides, Rider safety, driver, Bolt Send, Food/merchant/courier links; screenshot, DOM and accessibility captured | No authenticated ride booking, fare quote, driver account or operations workflow |
| Uber | `https://www.uber.com/` | **REA public landing verified** | `ev_81f4b88d58e7186a3ac6628f51b21a86199d36ff087e05c6117f25fe7ee32f3e` | Public landing, Ride/Earn/Business/Uber Eats navigation, pickup/dropoff entry points and public ride product information; screenshot, DOM and accessibility captured | REA fill interaction timed out; no completed pickup search, price quote, booking, payment or driver workflow |
| inDrive | `https://indrive.com/` | **REA loaded target, no usable workflow** | `ev_f1ddb3ffe00f9a6faf6cdf74dfa0acc49d2ac08d9a4153e44dccc1945545196e` | Scenario completed at the browser layer | Target returned/retained a block page; no ride UI, interaction or operations workflow claimed |

### Supporting non-REA observations

Earlier public-browser inspection also observed Bolt and Uber behavior through ordinary Playwright. Those observations are not used as REA Evidence and are retained only in `REFERENCE-PUBLIC-WEB-INSPECTION-2026-10-25.md`.

## 3. NaijaDrive findings mapped to the existing implementation

| Reference capability observed | Existing NaijaDrive state | Decision |
|---|---|---|
| Mobility landing surface | `/drive` exists with private-ride preview, Abuja pilot messaging and separate driver hub | Reuse; do not create another ride landing page |
| Pickup/dropoff planning | Zone-based pickup and destination form exists | Reuse configured Abuja zones; do not claim address-level routing |
| Vehicle/service choices | Car estimate path exists; motorcycle/tricycle/van are disabled | Preserve fail-closed availability; do not enable unsupported categories |
| Fare estimate entry point | `Get routed fare` and `Use demo estimate` exist | Preserve explicit routed/simulated distinction |
| Scheduling / reserve concept | Uber exposes public scheduling language; Bolt exposes mobility service navigation | Record as future product requirement; do not implement booking scheduling without runtime/availability model |
| Driver onboarding entry point | Existing `/drive#driver` shell links to shared registration/login | Reuse shared identity; do not invent driver approval or presence data |
| Driver availability/offers | Reference role is not publicly inspectable without an authorized account; NaijaDrive preview explicitly shows unavailable | Keep disabled; no fake offers, GPS or WebSocket presence |
| Dispatch and booking | Reference operational workflows require authenticated access; NaijaDrive Worker returns 503 | Preserve `NAIJADRIVE_RUNTIME_UNAVAILABLE` and no silent fallback |
| Public service segmentation | Bolt exposes rides, delivery, groceries, business and micromobility | NaijaDeals keeps NaijaDrive separate from NaijaSend and other verticals; no cross-vertical admin duplication |

## 4. Safe vertical slice selected

The highest-value evidence-supported safe slice is:

```text
Public NaijaDrive planning
→ select configured Abuja pickup/destination zones
→ choose the only enabled development vehicle category
→ request an explicitly simulated NGN fare
→ display distance, duration and fare disclaimer
→ keep booking and live routing unavailable
```

Existing implementation reused:

- `src/pages/drive.tsx`
- `src/routes/api-drive-preview.ts`
- `src/lib/drive-preview.ts`
- `src/lib/drive-preview-fare.ts`
- `src/lib/routing.ts`
- Abuja fare rule in `services/naijadrive-runtime/src/config/abuja.js`

No duplicate ride engine, payment integration, dispatch system or admin system was added.

## 5. Central Admin integration

No new NaijaDrive admin identity was created.

Current administrative posture:

- Shared NaijaDeals identity/session remains authoritative.
- Central Admin remains `/control-center`.
- Existing `rides.read`, `rides.manage` and `rides.dispatch` permissions remain seeded but are not used to enable unavailable Worker ride operations.
- No real user was granted a ride-operations role.
- No central audit event is fabricated for preview booking because no booking mutation exists.
- Future ride operations must be added inside Central Admin with actor, permission, resource and audit contracts before activation.

## 6. Test and browser evidence for the slice

### Automated verification completed

- `node --test tests/naijadrive-preview.test.mjs` — **9 passed, 0 failed**.
- Assertions cover configured Abuja zones, structured invalid-zone errors, simulated NGN fare output, explicit simulation disclaimer, routed-provider fail-closed behavior, OSRM parsing, provider failures/timeouts and coordinate validation.
- `npm run build` — **passed**; Vite transformed 259 modules and generated `dist/_worker.js`.
- `npm run test:node` — **not green as a whole-repository gate**. The existing suite reached an unrelated production waitlist timeout and several NestJS runtime tests fail because their source-test loader resolves `.js` imports while the runtime source files are `.ts`. The focused NaijaDrive suite and application build pass.

### Existing preview browser verification completed

Preview process reused without starting another server:

- PM2 process: `naijadeals`.
- Preview URL: `http://127.0.0.1:3000/drive`.
- Scenario: select `abuja-central` → `gwarinpa`, retain `car`, click `Use demo estimate`, then click `Request ride`.
- Fare API: `POST /api/drive/fare-estimate` returned **200**.
- Observed fare: **₦2,900.00**, 12 km, 28 minutes, provider `simulated-fixture`.
- UI disclaimer: `Development simulation only`; explicitly states no live road quote and no booking.
- Booking API: `POST /api/drive/preview-booking` returned **503** with `NAIJADRIVE_RUNTIME_UNAVAILABLE`.
- UI outcome: `No booking was created...`; no persistent booking or live dispatch was activated.
- Screenshot captured locally at `/tmp/naijadrive-safe-slice.png` during verification; it is not treated as REA evidence.

This is a complete safe **public planning** slice, not a completed ride-booking, payment, driver-presence or dispatch workflow.

## 7. Remaining ecosystem coverage

| Vertical | Reference targets | Status |
|---|---|---|
| NaijaShop | Amazon, Jumia | Amazon public REA landing/search attempted; Jumia blocked; authenticated commerce not inspected |
| NaijaEats | Uber Eats, DoorDash | Not yet REA-inspected in this phase; Uber Eats previously blocked by Cloudflare |
| NaijaFresh | Instacart/comparable grocery | Not started |
| NaijaGigs | Fiverr, Upwork | Not started |
| NaijaStay | Airbnb, Booking.com | Not started |
| NaijaSend | Courier/logistics references | Not started |
| NaijaPay | Paystack/Flutterwave-style public flows | Not started |
| NaijaAuto | Vehicle marketplaces | Not started |
| NaijaHomes | Property marketplaces | Not started |
| NaijaTravel | Travel booking platforms | Not started |
| NaijaEvents | Eventbrite | Not started |
| NaijaLearn | Udemy/comparable platforms | Not started |
| NaijaJobs | Indeed/LinkedIn Jobs | Not started |
| NaijaHealth | Healthcare discovery/booking | Not started |
| NaijaFarm | Agricultural marketplaces | Not started |
| NaijaStream | Video discovery/streaming | Not started |
| NaijaBeauty | Beauty discovery/booking | Not started |
| NaijaHome | Separate-vs-overlap determination | Not started |
| Aura AI | Assistant workflows | Not started |

## 8. Status rule

A vertical is not complete unless the matrix contains:

- At least one actual reference target.
- REA Evidence IDs for the claimed workflows.
- Explicit role/access limitations.
- A mapped NaijaDeals implementation.
- Automated tests.
- Browser preview evidence.
- Central Admin authorization/audit status.
- Clear live/simulated/disconnected labels.

## 9. Full ecosystem implementation inventory

This section records the coordinated full-ecosystem state after the registry expansion. A public route or registry row is not considered a complete vertical.

| Vertical / engine | Reference coverage | Implementation surface | Backend / persistence | Central Admin | Tests / preview | Status |
|---|---|---|---|---|---|---|
| NaijaShop | Existing repository/product references; REA not yet expanded in this execution | `/`, `/shop`, `/cart`, `/checkout`, orders, wallet, seller portal | D1 marketplace, orders, wallet, Paystack adapter | Shared Control Center and seller/provider surfaces | Existing marketplace/payment suites; preview online | **Partial / strongest live vertical** |
| NaijaFresh | Existing public reference notes; full REA coverage pending | `/fresh`, product discovery and shared cart/checkout | D1 Fresh taxonomy/products/listings | Registry and shared catalog controls | Existing Fresh implementation; route smoke test pending | **Partial** |
| NaijaEats | Existing REA/public evidence is limited; full merchant workflow pending | `/eats`, restaurants, menus, cart, checkout, order/operator screens | D1 Eats tables, shared orders, logistics interfaces | Shared provider/entity oversight; operator permissions | `tests/naijaeats-operator.test.mjs` and existing suites | **Partial** |
| NaijaDrive | Bolt, Uber and inDrive Evidence IDs above | `/drive`, explicit simulated/routed fare, disabled booking | Preview only; NestJS runtime, routing, dispatch and presence unavailable | Registry/readiness only; no live operations activated | 9 focused tests; browser fare/503 verification | **Partial / safely disconnected** |
| NaijaGigs | REA coverage pending | `/gigs`, service categories/listings/providers/request/dashboard | Service Engine 2.0 and D1 demo fixtures | Shared provider and verification controls | Search/service tests; browser acceptance pending | **Partial** |
| NaijaStay | REA coverage pending | `/stay`, property detail, booking and dashboard | Booking Engine 2.0 and D1 demo fixtures | Shared booking visibility | Booking suites exist; full browser lifecycle pending | **Partial** |
| NaijaSend | REA coverage pending | `/send` preview plus generic logistics APIs | Logistics, shipment, dispatch and tracking tables | Shared logistics APIs; dedicated operations UI incomplete | Logistics suites exist; public workflow pending | **Partial / operational UI incomplete** |
| NaijaPay | REA coverage pending | `/naijapay`, `/wallet`, payment/webhook APIs | Existing wallet ledger and payment transactions | Shared finance entry point | Payment and wallet suites exist | **Partial** |
| NaijaAuto | Reference coverage pending | `/auto` shared honest preview route | No dedicated automotive data contract yet | Unified registry only | Route smoke test passed; no vertical workflow test | **Incomplete** |
| NaijaHomes | Reference coverage pending | `/homes` shared honest preview route | Property model not implemented | Unified registry only | Route smoke test passed; no vertical workflow test | **Incomplete** |
| NaijaTravel | Reference coverage pending | `/travel` shared honest preview route | Travel inventory/integration not implemented | Unified registry only | Route smoke test passed; no vertical workflow test | **Incomplete** |
| NaijaEvents | Reference coverage pending | `/events` shared honest preview route | Ticketing/capacity extension not implemented | Unified registry only | Route smoke test passed; no vertical workflow test | **Incomplete** |
| NaijaLearn | Reference coverage pending | `/learn` shared honest preview route | Enrollment/progress/content model not implemented | Unified registry only | Route smoke test passed; no vertical workflow test | **Incomplete** |
| NaijaJobs | Reference coverage pending | `/jobs` shared honest preview route | Professional profile/application model not implemented | Unified registry only | Route smoke test passed; no vertical workflow test | **Incomplete** |
| NaijaHealth | Reference coverage pending | `/health` shared honest preview route | Regulated provider/appointment model not implemented | Unified registry only | Route smoke test passed; no vertical workflow test | **Incomplete / regulatory dependency** |
| NaijaFarm | Reference coverage pending | `/farm` shared honest preview route | Wholesale/bulk marketplace extension not implemented | Unified registry only | Route smoke test passed; no vertical workflow test | **Incomplete** |
| NaijaStream | Reference coverage pending | `/stream` preview route | Media storage/processing/playback not implemented | Unified registry only | Existing route only | **Incomplete** |
| NaijaHome | Reference coverage pending | `/home` shared honest preview route | Reuses planned Service + Booking engines; no dedicated workflow yet | Unified registry only | Route smoke test passed; no vertical workflow test | **Incomplete** |
| NaijaBeauty | Reference coverage pending | `/beauty` shared honest preview route | Reuses planned Marketplace + Service + Booking engines; no dedicated workflow yet | Unified registry only | Route smoke test passed; no vertical workflow test | **Incomplete** |
| Aura AI | Existing Aura shell and API; REA workflow coverage pending | `/aura`, shared Aura API | Model configuration optional; no transaction-owning AI state | Aura operations shell in Control Center | Existing Aura/UI tests; model-backed acceptance pending | **Partial / provider-dependent** |
| Identity and access | Existing application evidence; reference research pending | Shared auth/session, organizations, RBAC | D1 users/sessions/organizations/CC RBAC | Canonical shared identity/RBAC boundary | Identity and Control Center suites | **Operational foundation** |
| Marketplace engine | Existing application evidence; reference research pending | Catalog, listings, carts, orders, seller portal | D1 marketplace/order/wallet tables | Catalog, moderation, vendor and finance surfaces | Marketplace/payment/search suites | **Operational foundation** |
| Booking engine | Reference research pending | Generic bookable listings, holds, availability, lifecycle | D1 booking tables | Shared booking visibility; vertical ops incomplete | Booking suites | **Operational foundation / integration incomplete** |
| Logistics engine | Reference research pending | Quotes, shipments, drivers, dispatch, tracking | D1 logistics tables | Shared APIs; dedicated operations UI incomplete | Logistics tests | **Partial** |
| Payment and finance | Reference research pending | Wallet, payment transactions, refunds, seller finance | Append-only ledger and payment tables | Shared NaijaPay/finance entry point | Payment, refund and wallet suites | **Partial / provider-dependent** |
| Trust, moderation and audit | Reference research pending | Reviews, verification, reports, Central audit | D1 trust and CC audit tables | Central audit/RBAC/verification surfaces | Control Center/security suites | **Partial** |
| Search and discovery | Reference research pending | Catalog/service/bookable listing search and eligibility | D1 search event/index primitives | Central search/admin controls incomplete | Search engine suites | **Partial** |
| Communications | Reference research pending | Notifications, templates, outbox and provider interfaces | D1 notification tables | Central communications surfaces | Notification security/idempotency suites | **Partial** |

## 10. Current execution blockers

- REA CLI/MCP verification from this shell is blocked by the environment's npm cache permissions; existing REA Evidence IDs and OpenCode registration were preserved and not fabricated.
- Authenticated competitor workflows require authorized test accounts.
- Production payment, routing, driver presence, dispatch, media processing and external inventory credentials are unavailable or intentionally unconfigured.
- `npm run test:node` remains a mixed whole-repository gate with unrelated production waitlist and TypeScript runtime-loader failures; focused suites continue to run independently.
- `npm run test:ts-baseline` still reports 12 new diagnostics in the existing NestJS decorator/runtime files (`services/naijadrive-runtime/src/http/*`), not in the ecosystem registry or Worker preview changes; no unrelated runtime files were modified in this pass.

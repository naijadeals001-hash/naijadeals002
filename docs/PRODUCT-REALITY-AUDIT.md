# NaijaDeals Product Reality Audit — Batch 0

Date: 2026-10-25  
Branch: `feat/naijadrive-private-ride-foundation`  
Preview: `http://localhost:3000` (existing PM2 process `naijadeals`; no duplicate server started)

## Baseline

- Repository: `https://github.com/naijadeals001-hash/naijadeals002.git`
- Baseline HEAD: `69bc64fa703c1f318db7b8c6d3569640facd932f`
- `npm run build`: passed (265 modules)
- `/eats`: HTTP 200
- `/send`: HTTP 200
- Worktree contains only the pre-existing untracked `.npm-cache-rea/`; it is not part of this batch.
- Production deployment, production data mutation, DNS change and force-push: none.

## REA readiness and evidence

- REA CLI: `6.7.0`.
- MCP registration: `/home/user/.config/opencode/opencode.jsonc`, `rea-agents@6.7.0`, enabled.
- Browser research provider: available through the existing REA/Playwright setup.
- Native engines: Hopper, Ghidra, IDA, JADX and Kuna unavailable in this Linux sandbox. No authentication, CAPTCHA or WAF bypass was attempted.
- Existing public browser evidence retained from the previous research batch:
  - Fiverr: `ev_e63b7d0c6b4103bf9982a6735befd4d012b47fd64c54e5008055626c5474e17b`
  - Airbnb: `ev_2a78b88f1f1b11331ab966058d64b5758719b70220303bc2cbcf6044417533fc`
  - Uber: `ev_cd4d7ac8a16a7e171e6b6a58bf8913c480924ee91d37325d222af53d6a9ea337`
  - YouTube: `ev_8f5b35a41117731d1fa55678a07ed071756966f4d59a8cd7967ed10e86b1e7b4`
- These IDs are evidence of the previously captured public reference observations, not claims of authenticated merchant, courier or carrier access. DHL research did not produce valid evidence and is excluded.

## Reference-to-NaijaDeals feature matrix

| Reference behavior observed/documented | Evidence | Existing NaijaDeals capability | Gap / implementation target | Acceptance test |
|---|---|---|---|---|
| Marketplace discovery, search, listing detail and quote/order boundary | Fiverr evidence above | Service Engine, `/gigs`, request → quote → order | Messaging, milestones and revisions remain | Search real listing; create request; provider quote; customer acceptance |
| Destination/date/property discovery and inventory-aware booking pattern | Airbnb evidence above | Booking Engine, `/stay`, property/unit/resource queries | Host/admin workflows and stronger inventory acceptance coverage | Two concurrent booking attempts cannot reserve one unit |
| Passenger pickup/destination/fare/dispatch state pattern | Uber evidence above | NaijaDrive fare preview only; persisted live ride matching is not enabled | Passenger request, driver eligibility, offer acceptance and trip states | Sandbox passenger → eligible driver → completion, with no fabricated GPS |
| Video catalogue, detail/playback and creator boundary | YouTube evidence above | `/stream` truthful empty state; no dedicated catalogue found | Real media model, authorized playback, creator publishing/moderation | Only persisted media can render/play; empty catalogue remains honest |
| Food ordering sequence: discover → restaurant/menu → customize → single-kitchen cart → checkout → order tracking | Public food-delivery interaction pattern documented for this reset; no authenticated evidence claimed | Eats schema, customer pages, cart, checkout, persisted `eats_orders` | Restaurant workflow existed; courier fulfillment bridge was missing | Customer order persists, operator transitions, fulfillment dispatch bridge and courier job are visible |
| Freight marketplace: posted load → qualified carrier bids → customer award → dispatch offer → milestones/POD | No valid authenticated carrier evidence; inaccessible role workflows are explicitly unclaimed | Logistics Engine has shipments, drivers, jobs, tracking and dispatch primitives | Freight load/bid/award/multimodal schemas and carrier workspace | Two fixtures bid; award persists; dispatch fallback is tested without fake GPS |

## Vertical audit

### NaijaEats

**Real:** restaurants/cuisines/menu/items/modifiers, discovery filters, guest cart, single-restaurant cart rule, server-side option/item validation, persisted order snapshots, wallet/Paystack readiness, customer order history, verified restaurant-operator identity, operator order list/detail and CAS-protected status transitions.

**Missing before this batch:** a persisted bridge from an accepted/ready Eats order to the existing Logistics Engine's shipment, pickup/delivery jobs and courier workflow. Restaurant operator and courier were separate islands.

**This batch:** adds an explicit Eats fulfillment bridge. Dispatch creates a real Logistics Engine shipment only when the operator owns the order, the order is ready, payment is held/released, and pickup/dropoff data plus a supported vehicle/price are supplied. The existing courier job workflow remains the source of truth.

**Still not live:** restaurant onboarding/menu editing UI, courier-specific Eats UI, automatic dispatch ranking for food orders, refunds/support policy UI, external payment settlement and live GPS.

### NaijaSend

**Real:** authenticated quotes, standalone shipments, shipment addresses/items, tracking events, driver/provider onboarding primitives, vehicle registry, dispatch assignment, driver acceptance, OTP/POD completion and audit events.

**Major gap:** no freight load, carrier bid, award, carrier eligibility/capability matching or multimodal handoff model. The current `/send` surface is therefore a quote/tracking entry point, not a freight marketplace. No claim of completion is made.

### NaijaDrive

Fare simulation and booking-disabled safeguards are real. Persisted passenger ride requests and driver offers are not yet available; live GPS is not claimed.

### NaijaStay

Customer Booking Engine is real and date/resource-aware at the query layer. Host management, moderation and adversarial double-booking acceptance coverage remain incomplete.

### NaijaStream

No dedicated content catalogue/storage/playback workflow was found in the inspected application surface. The empty state is intentional and truthful; no media, creators, views or earnings are fabricated.

### NaijaGigs

Service discovery and request → quote → order lifecycle are real and tested. Messaging, milestone delivery, revisions and dispute handling are still incomplete.

## Constraints and next implementation gates

- Use test fixtures only in explicitly identified sandbox tests; never present them as live inventory, carriers, drivers, GPS or transactions.
- Complete NaijaEats customer/operator/courier acceptance with test accounts before claiming the vertical complete.
- Build NaijaSend freight posting/bidding/award/automated-dispatch schemas on top of, not beside, the existing Logistics, identity, payment and Control Center engines.
- Keep all production operations disabled for this branch.

# REA Reference Evidence — 2026-10-25

This record documents fresh REA research executed before the next reference-dependent implementation batch.

## REA preflight

- Installed CLI: `rea@6.7.0`
- Doctor command: `rea doctor --format json`
- Doctor result: `healthy=false` for the audit-wide environment because native Hopper/Ghidra/IDA/JADX/Kuna engines are unavailable. This does not disable the browser provider.
- Browser provider used: `rea-playwright-browser-scenario` version `1`
- MCP configuration inspected: `/home/user/.config/opencode/opencode.jsonc`
- MCP command: `npx -y rea-agents@6.7.0 mcp`
- REA catalog reported: 153 CLI commands and 207 MCP tools.
- Browser executable: `/home/user/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`
- Research timestamp: 2026-10-25 UTC, during this development session.
- Research mode: REA-owned temporary headless browser launch. No login, CAPTCHA, WAF or access-control bypass was attempted.

## NaijaEats evidence

### Bolt Food public landing workflow

- Target vertical: NaijaEats customer discovery and courier/partner boundary.
- Reference URL: `https://food.bolt.eu/`
- Exact REA operation: `capture_browser_scenario`
- Scenario: launch Chromium, navigate to the URL, wait 5 seconds, capture URL, DOM, accessibility tree and screenshot.
- Evidence ID: `ev_1a85796f4ca99ff5076eedc38c0f565e9fa6b04ba39ef826115e21f54d15c4c8`
- Provider: `rea-playwright-browser-scenario@1`
- Captured screenshot artifact hash: retained in the REA evidence bundle; screenshot was requested and returned.
- Observed accessibility workflow:
  - Delivery address is the first operational input: `Select destination...` / `Enter your address`.
  - Customer discovery is blocked until a delivery destination is provided.
  - Primary promise: `The food you love, delivered fast`.
  - Authentication is available as `Log in or sign up`, but discovery has a guest address-entry boundary.
  - Separate operational entry points exist for `Become a Courier` and `Become a Partner`.
  - Cookie consent is explicit and blocks/overlays the initial page until handled.
- Mapping to NaijaDeals:
  - `/eats` should keep destination/city context ahead of restaurant discovery.
  - Restaurant results should be filtered by supported delivery location rather than displaying every restaurant globally.
  - Restaurant/operator and courier entry points must remain separate capabilities.
  - Guest browsing can be allowed, while checkout and operational actions remain authenticated.
- Unverified limitations:
  - Bolt location selection, restaurant results, item customization, cart, payment, order status and courier assignment were not entered because the captured public page requires an address and the research session did not invent a valid location or authenticate.
  - No inference is made about hidden or authenticated behavior.

### Uber Eats public landing workflow

- Target vertical: NaijaEats reference comparison.
- Reference URL: `https://www.ubereats.com/`
- Exact REA operation: `capture_browser_scenario`
- Scenario: launch Chromium, navigate to the URL, wait 4 seconds, capture URL, DOM, accessibility tree and screenshot.
- Evidence ID: `ev_3eb588fb13b08025f9dda66896ff65f1ff5d093b898244fcb1df76b47dbb34fd`
- Observed result: Cloudflare security verification page, with accessibility text `Performing security verification`.
- Limitation: Uber Eats workflow was not accessible through legitimate unauthenticated REA browsing in this session. No bypass was attempted. This evidence proves the access limitation only; it does not prove Uber Eats workflow details.

## NaijaSend evidence

### uShip public freight marketplace landing workflow

- Target vertical: NaijaSend freight posting, carrier marketplace and shipment protection.
- Reference URL: `https://www.uship.com/`
- Exact REA operation: `capture_browser_scenario`
- Scenario: launch Chromium, navigate to the URL, wait 5 seconds, capture URL, DOM, accessibility tree and screenshot.
- Evidence ID: `ev_325ec44471ac7070c19430ac1974cb54ccd016bfe5b0393dd8ec8aed2ad241d8`
- Provider: `rea-playwright-browser-scenario@1`
- Captured screenshot artifact hash: retained in the REA evidence bundle; screenshot was requested and returned.
- Observed accessibility workflow:
  - Customer entry point is `Ship` / `Get Shipping Quotes`.
  - Carrier entry point is explicitly separate: `For Carriers`, `Become A Carrier`, `Join`.
  - Cargo categories include `Vehicles & Boats`, `Household Items`, `Moves`, `Heavy Equipment`, `Freight`, `Animals` and `Other`.
  - Freight is explicitly subdivided as `LTL, FTL`.
  - Public value proposition describes `real quotes`, `compare transparent pricing upfront`, then `choose` based on timeline and budget.
  - The marketplace journey is explicitly stated as `1. LIST`, `2. COMPARE`, `3. BOOK & SHIP`.
  - The site claims secure payment control until delivery and real-time status updates, but those claims were not independently exercised in this public capture.
  - Carrier acquisition emphasizes new shipments, route efficiency and reducing empty miles.
- Mapping to NaijaDeals:
  - NaijaSend needs a customer freight-load wizard, not a parcel-only quote form.
  - Cargo category and mode should be explicit, with freight dimensions/weight/equipment requirements.
  - Carrier bids must be comparable before award.
  - Customer award must be a distinct persisted state before dispatch.
  - Payment should protect the customer/carrier lifecycle and not be marked successful before real provider confirmation.
  - Tracking must follow shipment milestones after booking, not substitute for the marketplace workflow.
- Unverified limitations:
  - Carrier sign-in, bidding mechanics, offer expiry, payout and proof-of-delivery pages were not entered because they require authentication or additional state.
  - No carrier, quote, price, shipment, review or delivery event from uShip was copied into NaijaDeals.

## Fresh evidence-to-feature matrix

| Evidence | Implemented/target NaijaDeals feature | Route/API/test mapping | Status |
|---|---|---|---|
| Bolt Food `ev_1a85796f...` | Destination-first Eats discovery and separate courier/partner boundaries | `/eats`, restaurant discovery, existing operator API, future courier API | Evidence verified; destination gating still pending implementation |
| Uber Eats `ev_3eb588fb...` | No implementation claim; recorded as inaccessible | N/A | Blocked by public security verification |
| uShip `ev_325ec444...` | Freight load, carrier bid, customer comparison and award foundation | `/api/freight/loads`, `/api/freight/loads/open`, `/api/freight/loads/:id/bids`, `/api/freight/loads/:id/award` | Existing API foundation mapped; UI and dispatch acceptance pending |

## Implementation and acceptance result

The coding agent implemented the evidence-mapped portion without claiming inaccessible Uber behavior:

- NaijaEats `/eats` now accepts a delivery destination city before restaurant discovery/search (`city` query), preserves the destination through browse/sort links, and exposes an explicit `Find food near me` flow. This maps to Bolt Food's observed address-first boundary.
- NaijaSend `/send` now exposes an authenticated `List a freight load and compare carrier bids` form with route, transport mode, cargo category, description and weight. It calls the persisted `/api/freight/loads` API and reports the real server response; it never displays a carrier or price that was not returned.
- The guest-wide cart badge request was guarded because browser verification found an unrelated `/api/cart` 401 on public pages. After the fix, the public Eats and Send pages have no failed requests.

Browser acceptance against the existing preview:

- `/eats?city=Lagos&q=rice`: desktop 1440x900 and mobile 390x844; no failed requests; no application console errors.
- `/send`: desktop 1440x900 and mobile 390x844; no failed requests; no application console errors.
- Screenshots: `qa-screenshots/eats-reference-batch-desktop.png`, `qa-screenshots/eats-reference-batch-mobile.png`, `qa-screenshots/send-reference-batch-desktop.png`, `qa-screenshots/send-reference-batch-mobile.png`.
- Build: `npm run build` passed, 267 modules.
- Regression: `node --experimental-strip-types --test tests/naijaeats-operator.test.mjs` — 10 passed, 0 failed.
- The Tailwind CDN production warning remains; it is not an application failure.

## Release-gate interpretation

The REA requirement is satisfied for research availability and fresh evidence capture for Bolt Food and uShip. It is not satisfied for Uber Eats workflow inspection because the reference was inaccessible. The implemented batch is therefore accepted only for the Bolt/uShip-mapped behavior and is not an Uber Eats parity claim. Carrier bidding, award, dispatch acceptance and the full restaurant/courier journey remain partially complete.

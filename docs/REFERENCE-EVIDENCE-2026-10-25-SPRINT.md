# REA Reference Evidence — Five-Vertical Autonomous Sprint

Date: 2026-10-25 UTC  
Repository branch: `feat/naijadrive-private-ride-foundation`  
REA: `6.7.0`  
Browser provider: `rea-playwright-browser-scenario@1`

## Preflight

Commands executed before application edits:

```text
rea --version
rea doctor --format json
rea capabilities --format json
```

Active MCP configuration was verified at:

```text
/home/user/.config/opencode/opencode.jsonc
```

The active registration is:

```json
{"mcp":{"rea":{"type":"local","command":["npx","-y","rea-agents@6.7.0","mcp"],"enabled":true}}}
```

REA reported 207 MCP tools. `rea doctor` remains audit-wide unhealthy only because native Hopper/Ghidra/IDA/JADX/Kuna engines are not installed. The browser provider is operational and returned complete browser evidence. No access-control bypass was attempted.

## Fresh captures

Every record below was executed fresh in this sprint with REA `capture_browser_scenario`, using a temporary headless Chromium session, a 4-second wait, and URL, accessibility, DOM and screenshot capture.

| Area | Reference URL | Evidence ID | Result / usable observations |
|---|---|---|---|
| Shop | `https://www.jumia.com.ng/` | `ev_fba5a71f746a59e57bf9e640e36260f179a600e01873a497fbe75b1494912d9a` | Cloudflare security verification; marketplace workflow inaccessible without bypass. No Jumia-specific claim made. |
| NaijaDrive rides | `https://bolt.eu/en/cities/` | `ev_d8befc0cf22b7ec8ca283f124f8d231507cfcd8b4dd8eb4a35696d106af74470` | Public city/service-area discovery with search, African city list, Nigeria city coverage and support entry points. Authenticated ride booking was not exposed. |
| NaijaDrive food | `https://food.bolt.eu/` | `ev_d71162b15ccf2e2a972d7f945d1ba864d709435023cdfaaf9e0087b8c357f02e` | Address-first food delivery entry, destination selector, login/signup boundary, courier and partner entry points. |
| NaijaDrive groceries | `https://glovoapp.com/` | `ev_47cbd593feae86670b0da0cefc539412cb639334a3d7780209f9e4dce48c9ec8` | Address-first discovery, groceries/shops/pharmacies scope, current-location action, store exploration and rider/business entry points. |
| NaijaSend | `https://www.uship.com/` | `ev_feafa6d3921f2310a1578f06c3cc86e870a69ba143ed49fe291410438a79e896` | Freight categories, LTL/FTL, `List → Compare → Book & Ship`, customer/carrier separation, secure payment and tracking claims. |
| NaijaGigs | `https://www.fiverr.com/` | `ev_bf1e13b566f1456d246cd5b37ae7795192e47122986c4ee9e5cd79356c74d4c9` | Anti-bot human-verification page; Fiverr workflow inaccessible without bypass. No Fiverr-specific claim made. |
| NaijaStay | `https://www.airbnb.com/` | `ev_c976c18378f3d2f525de4a9355a11045566223c107ce55030a966d0c66845540` | Destination/date/guest search shell, Homes/Hotels/Experiences/Services tabs, host entry, category discovery and cancellation/help entry points. |

## Feature mapping

### Shop

Jumia was blocked by a legitimate security verification page. Existing NaijaDeals Shop behavior must therefore be audited against its own persisted catalog/cart/checkout models and no Jumia-specific parity may be claimed from this capture.

### NaijaDrive rides and carpool

Bolt evidence confirms the importance of explicit service-area discovery and African city availability. The current NaijaDrive pilot remains fare-simulation/booking-disabled; no live ride or driver availability is fabricated. Carpool remains a separate workflow requirement, not a cab alias.

### NaijaDrive food

Bolt Food confirms destination-first discovery and separate customer, courier and partner boundaries. The existing NaijaEats city-aware discovery and fulfillment bridge are the reusable implementation path.

### NaijaDrive groceries

Glovo confirms that grocery delivery is distinct from food: stores, pharmacies and “anything” are separate discovery concepts but share location/delivery infrastructure. NaijaFresh must retain its own catalog/cart/order rules while reusing logistics.

### NaijaSend

uShip confirms freight listing, comparison and booking as a marketplace sequence rather than a tracking-only flow. Existing freight loads/bids APIs are the implementation base; carrier eligibility, award-to-shipment and dispatch offers remain gaps.

### NaijaGigs

Fiverr was blocked by a human-verification challenge. Existing NaijaGigs Service Engine evidence remains the safe source of truth: real listings, request → quote → order lifecycle and no claim of inaccessible Fiverr internals.

### NaijaStay

Airbnb confirms a compact search shell with destination, dates and guests, plus separate host entry and property category discovery. Existing Stay Booking Engine already provides the server-side search/resource model; host and inventory hardening remain.

## Limitations

- Shop and Gigs reference sites were inaccessible through legitimate public browsing.
- Bolt ride capture was a public city availability page, not an authenticated ride request.
- Bolt Food and Glovo captures stopped at address-first public entry because no valid address or authentication was invented.
- uShip capture observed public marketplace information, not authenticated carrier bidding or payout screens.
- Airbnb capture observed the public search shell, not a real reservation.

These limitations are preserved rather than replaced with assumptions.

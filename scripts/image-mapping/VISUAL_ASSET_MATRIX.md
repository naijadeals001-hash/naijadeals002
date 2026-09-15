# NaijaDeals — Visual Asset Matrix

**Purpose:** the single master tracking table for EVERY customer-facing visual
asset category on NaijaDeals — not just products. Created in direct response to
Pat's "🚨 Full Visual Asset Audit — DO NOT CONTINUE BLINDLY" directive
(2026-09-15), which explicitly reframed the project KPI away from "127/127
products photographed" toward "can I scroll the entire homepage without hitting
a placeholder or a mismatched asset?"

**How to read `Status`:**
- 🟢 **COMPLETE** — every displayed item has a verified real asset; section is
  fully populated at its target count.
- 🟡 **PARTIAL (SAFE)** — fewer real assets exist than the full catalog count,
  but the section only ever DISPLAYS the verified subset (never pads with
  placeholders) — this is the Pat-approved "show fewer, but all real" state.
- 🔴 **BLOCKED / HIDDEN** — zero real assets exist yet, so the section is
  currently not rendering on the live homepage at all (safer than showing
  placeholders, per directive #15, but still a gap to close).
- ⚪ **NOT STARTED** — audit not yet performed for this area.

This file must be updated every time a batch of new assets ships, a new
section is audited, or a data-layer eligibility filter changes. It is the
canonical source Pat asked to see before agreeing to look at the next preview.

---

## Master Table

| Area | Required | Existing Valid | Reusable (found via recovery) | New Needed | Placeholder Count (on live homepage) | Status |
|---|---:|---:|---:|---:|---:|---|
| **Products** | 127 (catalog today) | 59 | 1 (product-20→id45 gas cooker) | 68 | 0 (fixed this session — see Finding #3) | 🟡 PARTIAL (SAFE) — every carousel, `/shop` grid (incl. pagination), PDP "Related" + "Frequently Bought Together", and `/api/catalog/collections` now silently show only the 59 verified-image products, confirmed via live render check returning **0** `/ph.svg` occurrences on homepage, `/shop`, `/shop?page=2`, and a sampled PDP |
| **Brands** | 38 (seed) | 0 | 0 (Asset Recovery Pass: 19/23 legacy logos = real trademark infringement, 4/23 corrupted) | 38 (compliant treatment for ~24 real brands + original identities for ~14 fictional brands) | 0 (section now fully hidden, not placeholder-rendering) | 🔴 BLOCKED / HIDDEN — `getTopBrands()` fixed to exclude `/ph.svg` rows; with 0 real logos, the whole section correctly disappears rather than showing broken cards |
| **Vendors** | 18 real business-type vendors (of 50 total vendor rows, 32 of which are internal `cctest-*` QA fixtures never shown on the customer-facing homepage) | 0 | 0 (Asset Recovery Pass: 20 legacy vendor photos are trademark-safe but carry the WRONG baked-in business names — not directly reusable) | 18 distinct storefront logos | 0 (section now fully hidden) | 🔴 BLOCKED / HIDDEN — `getPopularVendors()` fixed to exclude `/ph.svg` rows AND already implicitly excludes the 32 `cctest-*` fixture vendors via `is_verified=1`+real-logo filter; with 0 real logos, section correctly disappears |
| **Categories (department tiles + icons)** | 22 top-level departments | 0 real photography (100% icon-based via `cat.icon` material-symbol) | 0 | 22 department photos (Electronics, Fashion, African Fashion carve-out, Grocery & Food, Beauty & Personal Care, Health, Baby & Kids, Toys & Games, Sports & Fitness, Automotive, Tools & Hardware, Agriculture, Industrial & Commercial, Office & Business, Books & Education, Art & Crafts, Musical Instruments, Travel & Luggage, Weddings & Events, Gifts & Seasonal, Digital Products, Wholesale & B2B) | N/A — not a placeholder-string problem, an **architecture gap**: `categories.image_url` column exists in schema but is NULL for all 22 rows, and neither `getTopLevelCategories()` nor `getPopularCategories()` selects/uses it | 🔴 NOT WIRED — icons are not literally "placeholders" in the `/ph.svg` sense, but they are exactly what directive #5 forbids ("no generic icons replacing category photography"); needs both new photography AND a query/UI change |
| **Countries** | 4 (Nigeria LIVE + Ghana/Kenya/Morocco PLANNED, per Pat's directive; `cc_countries` table actually has 10 rows total but only NG/GH/KE + South Africa/Uganda/etc. are PLANNED — Pat named NG/GH/KE/Morocco explicitly) | 0 | 0 | 4 (minimum: NG, GH, KE, MA) | N/A — section does not exist | 🔴 NOT BUILT — no Country Discovery section exists anywhere on the homepage today; must be designed and built from scratch using the approved `africa-glow-map.png` plus new per-country photography |
| **Hero** | 5 active campaigns × 2 variants (desktop+mobile) = 10 files | 10 | — (already approved, no recovery needed) | 0 | 0 | 🟢 COMPLETE — all 5 campaigns render, all 10 files load, confirmed via render-based grep (`/static/hero/` × 30 occurrences incl. desktop+mobile+repeated DOM nodes) |
| **Ecosystem verticals** | 8 verticals × 2 variants (desktop+mobile) = 16 files | 16 | — (already approved, no recovery needed) | 0 | 0 (was 0 real usage before this fix; now wired) | 🟢 COMPLETE (as of this session) — all 16 files exist and are correct per-vertical photography; **were 100% UNUSED on the homepage until this session** (Ecosystem Spotlight was icon+text only) — now fixed: 3 of 8 verticals (Eats/Gigs/Stay) surfaced as real photography on the homepage teaser, matching what `EcosystemPreview.tsx` already uses on the full `/eats` `/gigs` `/stay` pages |
| **Collections / Banners (Merchandising Strip)** | 2 slots used today (of 5 banner files that exist) | 2 in active use (`banner-3.jpg`, `banner-4.jpg`) + 3 more available but unused (`banner-1/2/5.jpg`) | 3 unused banners are trademark-safe generic merchandising imagery per Asset Recovery Pass — reusable for future strip expansion | 0 immediate | 0 | 🟢 COMPLETE for the 2 slots currently shown; 3 additional approved-reusable banners sit in reserve for future sections |
| **Africa visual system (`africa-glow-map.png`)** | 1 approved graphic | 1 | — | 0 | N/A — currently unused anywhere on the live site | 🔴 NOT WIRED — approved per Pat's directive #10, but has no current placement; earmarked for the not-yet-built Country Discovery section |
| **Mega-menu category imagery** | Same 22 departments as above | 0 | 0 | Same 22 as Categories row | N/A — mega-menu (`src/lib/mega-menu.ts`) is currently 100% text+icon tree, no images at all | ⚪ Same architecture gap as Categories row — will be resolved together once category photography exists |
| **Shop page (`/shop`) category sidebar/chips** | Same 22 departments | 0 | 0 | Same 22 as Categories row | N/A — text-only sidebar links + chips, no images | ⚪ Same architecture gap as Categories row |

---

## Findings — What Changed This Session

### Finding #1 (root cause, now fixed): Top Brands & Popular Vendors were rendering placeholders due to a query bug, not a missing-asset problem alone
`getTopBrands()` filtered `WHERE b.logo_url IS NOT NULL` — every brand's `logo_url`
was a non-null `/ph.svg?label=...` string, so **all 38 brands** passed and the
12 `is_featured=1` brands rendered as broken placeholder cards. `getPopularVendors()`
had **no image filter at all**. Both are now fixed to exclude `logo_url LIKE '/ph.svg%'`.
Verified live: both sections now render **zero DOM nodes** (fully hidden via the
existing `{feed.x.length > 0 && ...}` guards in `home.tsx`) rather than
placeholder cards — confirmed via fresh `curl` + grep showing 0 occurrences of
"Top Brands" / "Popular Vendors" text and 0 `/static/brands/` or `/static/vendors/`
image references anywhere in the rendered HTML.

### Finding #2 (fixed): Ecosystem Spotlight was icon+text only despite 16 approved, unused photos
16 real, already-approved ecosystem photos (`public/static/ecosystem/*.jpg`,
wired into `ecosystem_verticals.hero_image_desktop/mobile` and already used by
`EcosystemPreview.tsx` on the individual `/eats` `/gigs` `/stay` pages) sat
completely unreferenced on the homepage. Fixed: the homepage's "Ecosystem
Spotlight" section (item 17) now queries `getAllVerticals(db)` and renders the
same 3 vertical photos (Eats/Gigs/Stay) as real photography cards instead of
bare icon+text divs. Verified live: `/static/ecosystem/eats-desktop.jpg`,
`gigs-desktop.jpg`, `stay-desktop.jpg` now appear in the rendered HTML.

### Finding #3 (FIXED this session): Product carousels had no per-card real-asset eligibility filter
Unlike Top Brands/Popular Vendors, none of the `PRODUCT_CARD_SELECT`-based
functions (`getFlashDeals`, `getBestSellers`, `getNewArrivals`, `getTrending`,
`getRecommended`, `getDiscounted`, `getNigerianBrandProducts`,
`getLimitedTimeDeals`, `getDealsNearYou`, `getByCategory`, `getProductsByIds`)
filtered out products whose `image_url` was still `/ph.svg%`. A render-based
audit found **39 `/ph.svg` occurrences across ~29 distinct pending products**
(Hardshell Spinner Luggage, Moroccan Beni Ourain Rug, Wedding Backdrop
Decoration Set, Dangote Cement, Ghanaian Gari, etc.) inside otherwise-legitimate
homepage carousels ("Recommended", "New Arrivals", "Nigerian Brands").

**Fix applied:** added `AND p.image_url IS NOT NULL AND p.image_url NOT LIKE
'/ph.svg%'` to the single shared `PRODUCT_CARD_SELECT` constant in
`src/lib/catalog.ts` — this closed the gap for all functions built on it in one
place. The same filter was additionally applied to the 4 places that duplicate
this join independently rather than reuse the shared constant: `src/pages/
shop.tsx` (the `/shop` grid + its dynamic filter sidebar), `src/routes/
api-catalog.ts` (the public `/api/catalog/products` browse endpoint), `src/
pages/product.tsx` (PDP's "Related products" and "Frequently Bought Together"
sections), and `src/lib/collections.ts` (`getProductsInCollection`, exposed via
`/api/catalog/collections/:slug/products` for future use).

**Verified live** (fresh `curl` + grep after rebuild/restart): **0** `/ph.svg`
occurrences on the homepage, `/shop`, `/shop?page=2`, and a sampled PDP
(`/shop/samsung-galaxy-a54-5g-128gb-8gb-ram`) — all previously showed
placeholders, now all show 0. `/shop`'s result count correctly dropped from
127 to **59** (matching the verified-image product count), confirming the
filter is silently shrinking result sets rather than hiding rows behind
placeholders — exactly the "show fewer, but all real" behavior directive
#19/20 requires. This gap will keep closing automatically as Batches 4-8 add
real photography for the remaining 68 products — no further code change
needed when that happens.

### Finding #4 (open): Category imagery is an architecture gap, not just missing files
`categories.image_url` column exists in the schema but is NULL for every row.
`getTopLevelCategories()` and `getPopularCategories()` don't even `SELECT` it.
Fixing this requires: (1) generate/source real department photography for the
22 departments, (2) populate `categories.image_url`, (3) update both query
functions to select it, (4) update `home.tsx`'s "Shop by Category" and "Popular
Categories" sections (plus `mega-menu.ts` and `shop.tsx`'s sidebar/chips) to
render an image instead of/alongside the icon. This is a multi-file, coordinated
change — not a drop-in asset swap — and should be scoped as its own task before
starting the photography.

### Finding #5 (open): No Country Discovery section exists
Confirmed via full read of `home.tsx` (all 18 numbered sections) — there is no
country-card section anywhere on the homepage. This must be designed and built
from scratch: new component, new section in `home.tsx`, a data source (likely a
new small query against `cc_countries` filtered to `status='LIVE'` or a curated
allowlist matching Pat's named 4: Nigeria/Ghana/Kenya/Morocco), plus new
photography for GH/KE/MA (Nigeria may be able to reuse existing approved hero
imagery pending a content-match check) and use of the already-approved
`africa-glow-map.png` as a backdrop/connective visual.

---

## Summary Statistics (session snapshot, 2026-09-15)

| Metric | Value |
|---|---:|
| Total catalog products | 127 |
| Products with verified real image | 59 (46.5%) |
| Distinct products still showing `/ph.svg` anywhere on the customer-facing site | **0** (filtered out at the query layer this session — see Finding #3) |
| Total brands | 38 |
| Brands with a verified real logo | 0 |
| Total vendor rows in DB | 50 (18 real "business" storefronts shown on the customer-facing site + 32 internal `cctest-*` QA fixtures never customer-facing) |
| Real vendors with a verified real logo | 0 |
| Top-level product departments | 22 |
| Departments with real photography | 0 |
| Hero campaigns live | 5 / 5 (100%) |
| Ecosystem verticals with approved photography that is ACTUALLY WIRED on the homepage | 3 / 8 (Eats/Gigs/Stay — the only 3 surfaced on the homepage teaser by product decision; all 8 have approved assets, used on their own `/slug` pages via `EcosystemPreview.tsx`) |
| Countries with a Discovery-section presence | 0 / 4 named by Pat (section doesn't exist) |
| Sections hidden entirely today due to zero real assets (correct "fail closed" behavior) | 2 (Top Brands, Popular Vendors) |

---

## Priority Order Going Forward (per Pat's directive #16)

1. ~~Fix visible homepage placeholders — Top Brands / Popular Vendors query bug~~ ✅ DONE this session
2. ~~Wire already-approved Ecosystem photography into the homepage~~ ✅ DONE this session
3. ~~Close Finding #3 — real-asset filter across ALL product query paths (carousels, /shop, PDP, collections API)~~ ✅ DONE this session — verified 0 `/ph.svg` on every tested customer-facing route
4. Continue product image Batches 4-8 (toward 127/127, 68 remaining)
5. Design + build Country Discovery section (NG/GH/KE/MA + africa-glow-map.png)
6. Category photography architecture change (schema already supports it; need images + query + UI wiring across home.tsx, mega-menu.ts, shop.tsx)
7. Generate compliant Top Brand assets (licensed/authorized treatment for real trademarked brands, original identities for fictional catalog brands)
8. Generate 18 distinct real-vendor storefront logos
9. Final full desktop+mobile scroll-through QA gate before next preview to Pat

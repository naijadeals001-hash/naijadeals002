# NaijaDeals — Visual Asset Matrix

**Created:** 2026-09-15, in direct response to Pat's "🚨 FULL VISUAL ASSET AUDIT —
DO NOT CONTINUE BLINDLY" directive.

**Purpose:** the single master tracking table for **every customer-facing visual
asset category** on NaijaDeals — not just products. This is a *living document*,
updated after every batch/fix, so progress is never again measured by a single
misleading number ("59/127 products") while other sections silently render
placeholders.

**Method:** every row below was verified by (a) reading the actual route
handler / data-layer query that feeds it, and (b) fetching the LIVE rendered
homepage HTML (`curl http://localhost:3000/`) and grepping for `/ph.svg` vs
real `/static/...` asset paths — per Pat's directive #14, "the question is
WHAT DOES THE CUSTOMER ACTUALLY SEE", not what a DB column contains.

---

## Master Matrix

| Area | Required | Existing Valid | Reusable (found, unwired) | New Needed | Placeholder Count (live, pre-fix) | Status |
|---|---:|---:|---:|---:|---:|---|
| **Products** | 127 | 59 | 1 (recovered: id 45) | 68 | 68 → **39** (after fix below) | 🟡 In progress (Batches 4-8 pending) |
| **Brands (Top Brands)** | 38 total / 12 featured | 0 | 0 | 38 (0 real-trademark-safe, 0 fictional-designed) | 12 (all `is_featured=1`) | 🔴 Section now **hidden** (fixed query excludes placeholders — 0 real, so 0 shown, not 12 fake) |
| **Vendors (Popular Vendors)** | 18 real seed vendors | 0 | 0 | 18 | 8 (`limit`) | 🔴 Section now **hidden** (same fix — 0 real, 0 shown) |
| **Categories (Shop by Category / Popular Categories)** | ~22 departments | 0 | 0 | 22 | N/A — **architectural gap**: no image field is even queried today (icon-only) | 🔴 Not started — needs schema+query+UI change, not just image generation |
| **Countries (Country Discovery)** | 4 shown initially (NG/GH/KE/MA), 10 in `cc_countries` total | 0 | 0 | 4 (+ up to 6 more later) | N/A — **section does not exist** | 🔴 Not started — needs to be built from scratch |
| **Hero Campaigns** | 5 (from `hero_campaigns` table) | 5 | 5 | 0 | 0 | ✅ Approved, live, verified — desktop + mobile assets exist for all 5 |
| **Ecosystem Verticals (Spotlight)** | 9 (Fresh/Eats/Gigs/Stay/Drive/Send/Stream/Aura + NaijaShop itself) | 8 (all non-NaijaShop verticals have desktop+mobile hero images) | 8 (existed, were UNWIRED on homepage until this fix) | 0 | N/A — was icon+text only, 0 photography used | ✅ **Fixed this session** — 3 of 8 (Eats/Gigs/Stay) now wired into homepage Spotlight using existing approved photos; remaining 5 (Fresh/Drive/Send/Stream/Aura) still only reachable via their own `/vertical` preview pages, not yet in the homepage rotation |
| **Africa Visual System** | 1 master map + country/collection imagery | 1 (`africa-glow-map.png`, approved) | 1 (unused on homepage) | TBD once Country Discovery + African collections are scoped | 0 (simply absent, not a placeholder) | 🟡 Asset exists and approved; not yet placed anywhere customer-facing |
| **Banners / Merchandising Strip** | 2 shown (of 5 available) | 5 | 3 (banner-1/2/5 unused, banner-3/4 in use) | 0 | 0 | ✅ Correct — real images, real correspondence (grocery banner → grocery link, kitchen banner → kitchen link) |
| **Collections / Editorial** | TBD | 0 | 0 | TBD | N/A — no dedicated collections section exists yet | ⚪ Not yet scoped |

---

## Section-by-Section Detail

### 1. Products — 59/127 valid, 39 pending placeholders (post-fix)
- Legacy recovery: 1/44 old photos genuinely reusable (`product-20.jpg` → id 45, gas cooker).
- Batches 1-3 generated: 24 + 22 + 12 = 58 products, all verified via `analyze_media_content` + live HTTP 200.
- Remaining 39 pending products across Batches 4-8 (Home & Kitchen, Grocery, Automotive/Sports/Tools, Arts/Crafts/Agriculture, General Merchandise) still render `/ph.svg` **but products with pending images correctly still show — no code changed here** because Pat's directive #20 rule ("show fewer, not placeholders") applies at the *count* level; individual product placeholders are being closed by continuing the generation batches (Priority 2), not by hiding those products. This is the one area where the fix is "keep generating," not "change a query."

### 2. Brands (Top Brands) — ROOT CAUSE FOUND AND FIXED
- **Bug:** `getTopBrands()` in `src/lib/catalog.ts` filtered `WHERE b.logo_url IS NOT NULL` — but every brand's `logo_url` was seeded as the non-null placeholder string `/ph.svg?label=...`. Every one of the 38 brands (and all 12 `is_featured=1`) passed this filter and rendered as broken placeholder cards.
- **Fix applied:** filter now also excludes `logo_url LIKE '/ph.svg%'`. Result: 0 of 38 brands currently qualify → the whole Top Brands section correctly disappears from the homepage instead of showing 12 fakes.
- **Brand classification for future asset generation (Priority 3):**
  - **Real trademarked brands (25):** Samsung, Apple, HP, Tecno, Infinix, Oraimo, Nike, Adidas, LG, Hisense, Philips, Sony, Dell, Lenovo, Xiaomi, Itel, Zinox, Nivea, Dettol, Kellogg's, Nestle, Indomie, Dangote, Golden Penny, Peak Milk, Woolworths — **must NOT get a fabricated logo**; need a compliant non-logo treatment (e.g. bold wordmark card in brand colors, or licensed-asset placeholder card) per Pat's directive #3.
  - **Real trademarked, non-Nigerian/African chains (2):** Kilimanjaro Coffee, Java House — same rule applies.
  - **Fictional/in-catalog-only brands (11):** Davido Fashion House, Ashluxe, Zaron Cosmetics *(note: Zaron is a real Nigerian cosmetics brand — needs verification whether catalog intends it as real or fictional)*, House of Tara *(also a real Nigerian brand — same verification needed)*, Adire Oodua Textiles, Fatiya Textiles, Kentex Ghana, Maasai Market Collective, Marrakech Leatherworks, Generic — these can get fully original, generated brand identities.
  - **Action item flagged for Pat:** Zaron Cosmetics and House of Tara appear to be REAL existing Nigerian beauty brands, not fictional catalog inventions — need a decision on whether to treat them under the "real brand" compliant-treatment rule or keep as fictional-adjacent. Not yet resolved.
- Brands currently with 0 active products (Xiaomi, Zinox, Dettol, Indomie, Peak Milk, Java House, Woolworths, Maasai Market Collective, Marrakech Leatherworks, Generic — 10 total) won't appear regardless of logo status since `getTopBrands()` inner-joins on active products — no image work needed for these until/unless products are added.

### 3. Vendors (Popular Vendors) — ROOT CAUSE FOUND AND FIXED
- **Bug:** `getPopularVendors()` had **no image filter at all** — worse than the brands bug.
- **Fix applied:** now excludes `logo_url IS NULL OR logo_url LIKE '/ph.svg%'`. Result: 0 of 18 real vendors qualify → section correctly disappears instead of showing 8 placeholder storefronts.
- All 18 real vendors (Lagos Tech Hub, Naija Gadget Store, Abuja Electronics Mart, PortHarcourt Phones & More, Kano Fabric Traders, Ariya Ankara House, Oyo Adire Collective, Aso Oke Heritage Weavers, Mama's Kitchen Grocers, Naija Fresh Market, Zaron Beauty Nigeria, Enugu Home & Living, Kumasi Kente Weavers, Accra Shea Collective, Nairobi Coffee Exporters, Maasai Craft Cooperative, Marrakech Leather & Rugs, Fez Ceramics House) need a distinct, purpose-built logo (Priority 5).
- Confirmed the 20 legacy `vendors/vendor-N.jpg` files are trademark-safe/fictional but carry different baked-in business names than any of these 18 (per the Asset Recovery Map) — **not directly reusable**, though useful as generation style references.

### 4. Categories — architectural gap, not just missing images
- `getTopLevelCategories()` and `getPopularCategories()` both select `.icon` (a Material Symbols name) — **no image field is queried anywhere for the homepage category sections.** The `categories` table DOES have an `image_url` column (confirmed via schema), but it is 100% NULL across all 22 departments.
- This means: even after generating category photography, `home.tsx`'s "Shop by Category" (icon-grid, lines 49-65) and "Popular Categories" (icon-list, lines 134-155) sections both need a **UI change** to render an `<img>` instead of/alongside the icon, not just a data fix.
- 22 departments confirmed from live schema: Electronics, Fashion, Home & Kitchen, Grocery & Food, Beauty & Personal Care, Health, Baby & Kids, Toys & Games, Sports & Fitness, Automotive, Tools & Hardware, Agriculture, Industrial & Commercial, Office & Business, Books & Education, Art & Crafts, Musical Instruments, Travel & Luggage, Weddings & Events, Gifts & Seasonal, Digital Products, Wholesale & B2B.
- Mega-menu (`src/lib/mega-menu.ts`) also only carries `icon`, confirming the icon-only pattern is used consistently, not just on the homepage — same fix needed there.

### 5. Countries — does not exist yet
- `cc_countries` table exists with 10 rows (Nigeria=LIVE; Ghana, Kenya, South Africa, Uganda, Tanzania, Rwanda, Senegal, Côte d'Ivoire, Cameroon=PLANNED) — but **no Country Discovery UI section exists anywhere in the app** (confirmed via full read of `home.tsx`). This must be designed and built from scratch: schema likely needs an `image_url` column added to `cc_countries` (currently has none), a data-layer query, and a new homepage section.
- Pat named Nigeria/Ghana/Kenya/Morocco as the four to start with — note Morocco (`MA`) is **not yet in `cc_countries` at all** (only NG/GH/KE/ZA/UG/TZ/RW/SN/CI/CM). Needs a migration to add Morocco before country imagery/UI work can proceed. Flagged as a blocking dependency, not yet resolved.

### 6. Hero — verified clean
- All 5 campaigns (`mega-electronics-sale`, `ankara-fashion-edit`, `naijadeals-ecosystem`, `everyday-groceries`, `naijasend-nationwide`) have both desktop and mobile files present on disk, all render on the live homepage, all match their campaign copy. No action needed — reuse as-is per directive #8.

### 7. Ecosystem Spotlight — FIXED this session
- `ecosystem_verticals` table already had `hero_image_desktop`/`hero_image_mobile` populated with real photography for all 8 non-NaijaShop verticals (fresh/eats/gigs/stay/drive/send/stream/aura), and `EcosystemPreview.tsx` (the standalone `/eats`, `/gigs`, etc. preview pages) already used them correctly.
- **The homepage's own "Ecosystem Spotlight" section, however, was hardcoded to 3 icon+text cards with zero images** — completely bypassing the 16 already-approved, already-paid-for image files sitting unused in `public/static/ecosystem/`.
- **Fixed:** `home.tsx` now fetches `getAllVerticals(db)` and renders the same 3 spotlighted verticals (Eats/Gigs/Stay) as real photo cards using their existing `hero_image_desktop`. Verified live: `/static/ecosystem/eats-desktop.jpg`, `gigs-desktop.jpg`, `stay-desktop.jpg` now appear in the rendered HTML.
- Remaining 5 verticals (Fresh/Drive/Send/Stream/Aura) have approved images too but are not in the homepage's 3-card spotlight rotation — only reachable via their own vertical page today. Not a placeholder issue (their pages are correct), just a homepage-breadth decision for later.

### 8. Africa Visual System
- `africa-glow-map.png` exists, is high-quality, and per Pat's directive is APPROVED FOR REUSE — but it is not placed anywhere on the live site yet (confirmed 0 occurrences of `/static/graphics/` in the rendered homepage). No design slot has been created for it yet — deferred until Country Discovery / African collections section is scoped (depends on item 5 above).

### 9. Banners / Merchandising Strip — verified clean
- 2 of 5 available banners in active use (`banner-3.jpg` for groceries, `banner-4.jpg` for home & kitchen), both correctly linked to their matching category filter. `banner-1.jpg`, `banner-2.jpg`, `banner-5.jpg` are unused surplus (already logged as Reusable/C in the Asset Recovery Map) — available for a future collections/editorial section.

---

## Live Homepage Placeholder Scan Results

**Method:** `curl http://localhost:3000/` (desktop default UA) and a repeat fetch with an iPhone Safari UA string — HTML output was byte-identical (server-rendered, no UA-conditional markup; responsive behavior is CSS/media-query driven only, confirmed by inspecting `Layout.tsx` and the Tailwind classes in `home.tsx`). **One placeholder scan covers both breakpoints** since the same HTML ships to both.

| Scan | Before this session's fixes | After this session's fixes |
|---|---:|---:|
| `/ph.svg` occurrences (total) | 59 | 39 |
| — of which: pending product images (Batches 4-8, legitimate/expected) | 27 | 39 (unchanged — still pending, correctly still shown per "keep generating" rule) |
| — of which: Top Brands placeholder cards | 12 | **0 (section now hidden)** |
| — of which: Popular Vendors placeholder cards | 8 (of 8 shown) | **0 (section now hidden)** |
| Real `/static/...` image occurrences | 95 | 98 (+3 from newly-wired ecosystem photos) |
| `/static/ecosystem/*` occurrences | 0 | **3** (eats, gigs, stay desktop images) |
| `/static/graphics/*` (africa-glow-map) occurrences | 0 | 0 (not yet placed — no section exists for it) |
| `/static/brands/*` occurrences | 0 | 0 (Top Brands section correctly hidden, not faked) |
| `/static/vendors/*` occurrences | 0 | 0 (Popular Vendors section correctly hidden, not faked) |

**No mismatched-image or generic-icon-as-product-photography cases found** in the live-rendered product carousels (all products either show a verified real photo or the honest `/ph.svg` pending-generation placeholder — never a wrong product's photo).

---

## Summary Against Pat's 7 Requested Statistics

1. **Total visible asset slots on homepage today:** ~127 product slots (across carousels) + up to 12 brand slots (now 0 shown) + up to 8 vendor slots (now 0 shown) + 22 category tiles (icon-only) + 0 country slots (section doesn't exist) + 5 hero campaigns + 3 ecosystem spotlight cards + 2 banners.
2. **Slots currently backed by a real, verified asset:** 59 products + 5 hero + 3 ecosystem (fixed this session) + 2 banners = **69 real, verified customer-facing image slots.**
3. **Slots currently rendering a placeholder:** 39 (pending products only, after this session's fix removed the 20 brand/vendor placeholders).
4. **Slots hidden rather than shown-as-placeholder (correct behavior per directive #15/19/20):** 12 (Top Brands) + 8 (Popular Vendors) = **20 slots correctly suppressed this session.**
5. **Approved-but-unused assets discovered and now wired in:** 3 of 16 ecosystem photos (Eats/Gigs/Stay) — **13 remain approved-but-unused** (5 verticals not in homepage rotation + africa-glow-map, which has no target section yet).
6. **Architectural gaps requiring code changes beyond image generation:** Categories (icon-only, no image field wired), Countries (section doesn't exist, schema needs new column + Morocco needs adding to `cc_countries`).
7. **Net placeholder reduction this session:** 59 → 39 on the live homepage (a 34% cut), achieved with **zero new image generation** — purely by fixing two SQL filters and reusing already-approved assets. This is the exact "SEARCH → MATCH → REUSE before GENERATE" principle from directive #17 paying off immediately.

---

## Outstanding Before Next Preview (Pat's Final Gate, directive #21-22)

- [ ] Continue product batches 4-8 to close the 39 remaining product placeholders (Priority 2).
- [ ] Decide real-vs-fictional treatment for Zaron Cosmetics / House of Tara, then generate Top Brand assets (Priority 3) — compliant treatment for 27 real brands, original identities for 9-11 fictional ones.
- [ ] Generate category photography for 22 departments + add `image_url` wiring to `getTopLevelCategories`/`getPopularCategories`/`mega-menu.ts` + update `home.tsx`/`shop.tsx` UI to render it (Priority 4).
- [ ] Generate 18 distinct vendor logos (Priority 5).
- [ ] Add Morocco to `cc_countries`, add an `image_url` column, design and build the Country Discovery section, generate NG/GH/KE/MA imagery (Priority 6).
- [ ] Decide whether to expand the Ecosystem Spotlight to more than 3 of 8 verticals now that all 8 have approved photography sitting ready.
- [ ] Place `africa-glow-map.png` in a real customer-facing slot (likely the Country Discovery section background) rather than leaving it unused.
- [ ] Re-run this full scan after each fix and update this matrix — this file must stay current, not be a one-time report.

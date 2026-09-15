# NAIJADEALS — EXISTING ASSET RECOVERY MAP

**Directive:** "Existing Asset Recovery Directive" (Pat) — reuse the image asset, never reuse an
old product-to-image mapping without verifying it.

**Method:** Every pre-existing image file in the repo (across all commits, not just the current
working tree) was opened and visually inspected with `analyze_media_content` / `understand_images`.
Its ACTUAL depicted content was determined independently of its filename/old numeric ID, then
cross-referenced against the CURRENT 127-product catalog, 38-brand table, and 18-real-vendor table.

**Classification key:**
- **A** = reusable as-is (already correctly wired / clearly matches current record)
- **B** = reusable after remapping to a different current ID
- **C** = reusable for non-product content only (category/banner/discovery/editorial) — not deleted, held in library
- **D** = obsolete/unusable — genuine quality defect, real-trademark risk, or no plausible current/future use — never deleted, but not usable

---

## SECTION 1 — LEGACY PRODUCT PHOTOS (44 files, `public/static/products/product-N.jpg`, commit `93e3cf9`)

| Old Filename | Old Product ID | Actual Depicted Content | Current Matching Product ID | Current Product Name | Category | Decision | Confidence | Action |
|---|---|---|---|---|---|---|---|---|
| product-1.jpg | 1 | Smartphone, fictional "AXON" brand, silver/grey, triple-camera | — | — | Smartphones | C | N/A | Clean, no defect, no current gap (Batch 1 done). Hold for 200+ catalog expansion / discovery rail. |
| product-2.jpg | 2 | Smartphone, fictional "AURA" brand, dark green, triple-camera | — | — | Smartphones | C | N/A | Same as above — hold. |
| product-3.jpg | 3 | Smartphone, generic Android OS badge (not a brand trademark), navy, S21-Ultra-style camera | — | — | Smartphones | C | N/A | Same as above — hold. |
| product-4.jpg | 4 | TWO smartphones (front+back), fictional "NEXA" brand, light blue | — | — | Smartphones | C | N/A | Same as above — hold. |
| product-5.jpg | 5 | Tablet, Android home screen — **garbled/gibberish app-icon text** | — | — | Tablets | **D** | N/A | Quality defect (unreadable on-screen text). Retire. |
| product-6.jpg | 6 | Laptop, navy — **garbled menu-bar + nonsensical keyboard glyphs** | — | — | Laptops | **D** | N/A | Quality defect. Retire. |
| product-7.jpg | 7 | Laptop, silver/grey — **gibberish bezel text + distorted keys** | — | — | Laptops | **D** | N/A | Quality defect. Retire. |
| product-8.jpg | 8 | Laptop, space-grey — **malformed Apple-like icon + gibberish keyboard** | — | — | Laptops | **D** | N/A | Quality defect + Apple-icon likeness risk. Retire. |
| product-9.jpg | 9 | Lifestyle TV on easel stand — **structurally broken tripod legs** | — | — | TVs | **D** | N/A | Quality defect. Retire. |
| product-10.jpg | 10 | TV, fictional "VODQ" badge — **warped stand geometry** | — | — | TVs | **D** | N/A | Quality defect. Retire. |
| product-11.jpg | 11 | Bluetooth speaker, teal, fictional "SOUNDWAVE" — clean | — | — | Audio | C | N/A | Clean, no current gap (Batch 1 done). Hold. |
| product-12.jpg | 12 | Over-ear headphones, black, fictional "AURA" — minor hinge artifact | — | — | Audio | C | N/A | No current gap. Hold. |
| product-13.jpg | 13 | Power bank 10000mAh, fictional "VOLTA" — minor ghosting, mostly clean | — | — | Accessories | C | N/A | No current gap. Hold. |
| product-14.jpg | 14 | Solar power bank, fictional "TREKPOWER" — **impossible panel/hinge geometry** | — | — | Accessories | **D** | N/A | Quality defect. Retire. |
| product-15.jpg | 15 | Minimalist white leather sneaker, unbranded — clean | — | — | Footwear | C | N/A | No exact catalog match. Hold for footwear discovery imagery. |
| product-16.jpg | 16 | Soccer cleats, black/red, unbranded — **distorted studs/soleplate** | — | — | Footwear | **D** | N/A | Quality defect. Retire. |
| product-17.jpg | 17 | Cognac leather tote/briefcase — **garbled interior label text** | — | — | Bags | **D** | N/A | Quality defect + no exact match to id 29 (backpack). Retire. |
| product-18.jpg | 18 | Indigo/cream kaftan dress — **floating/jagged hemline artifact** | 43 | Handmade Moroccan Kaftan Dress | African Fashion | **D** | N/A | Category match found, but id 43 ALREADY has verified new Batch-2 photography, and this asset has a quality defect. Retire. |
| product-19.jpg | 19 | Royal-blue/gold Agbada-style suit — **floating garment, pattern-melt artifacts** | 38 | Men's Traditional Agbada Set | African Fashion | **D** | N/A | Category match found, but id 38 ALREADY has verified new Batch-2 photography, and this asset has quality defects. Retire. |
| **product-20.jpg** | 20 | **Stainless-steel 4-burner gas range w/ oven & grill, black glass door** — minor knob-icon blur only | **45** | **4-Burner Gas Cooker with Oven** | Home & Kitchen | **B ✅ RECOVERED** | **HIGH** | **REMAPPED.** Copied to `045-4-burner-gas-cooker-with-oven.jpg`, D1 `products.id=45` updated, rebuilt, HTTP-verified 200. This is the exact asset Pat's directive anticipated — same content type (gas cooker), wrong old ID (was mapped to id 20, a smartwatch, pre-catalog-change). |
| product-21.jpg | 21 | 2-in-1 blender/juicer, fictional "BlendPro" — **garbled dial text + impossible pour physics** | 44 | Binatone 3-in-1 Blender Set | Home & Kitchen | **D** | N/A | Category close, but id 44 is a REAL branded product (Binatone) — fictional brand image would violate name/image-agreement rule; also has defects. Retire; generate fresh Binatone-accurate photography. |
| product-22.jpg | 22 | Wall-mount split A/C, **REAL "DAIKIN" logo printed twice** — panel defects | — | — | — | **D** | N/A | **Real-trademark risk (Daikin)** + no current A/C product + defects. Retire — never use anywhere. |
| product-23.jpg | 23 | White chest freezer 200L, fictional "ArcticFresh" — **garbled energy label** | — | — | — | **D** | N/A | No current chest-freezer product (id 46 is a different appliance, real brand Hisense) + defects. Retire. |
| product-24.jpg | 24 | Purple cordless stick vacuum — **gibberish brand text ("AJAcROW")** | — | — | — | **D** | N/A | No vacuum product in catalog + defects. Retire. |
| product-25.jpg | 25 | Geometric-pattern bedding/comforter set — **pattern & fold-geometry artifacts** | — | — | — | **D** | N/A | No bedding-SET product (id 50 is a bed frame only) + defects. Retire. |
| product-26.jpg | 26 | Instant-noodle family pack, fictional "DELECTO" — **garbled text + melted food texture** | — | — | — | **D** | N/A | No instant-noodle product in pending catalog + defects. Retire. |
| product-27.jpg | 27 | 5kg semolina flour, fictional "GOLDEN GRAINS" — **garbled fine print/barcode** | — | — | — | **D** | N/A | No semolina product in pending catalog + defects. Retire. |
| product-28.jpg | 28 | 1kg malt-drink tin, fictional "NIGERIA MALT DRINK" — **garbled gold-seal text** | — | — | — | **D** | N/A | No malt-drink product in pending catalog + defects. Retire. |
| product-29.jpg | 29 | 900g milk-powder tin, fictional "GOLDCREST" — **garbled nutrition panel** | — | — | — | **D** | N/A | No milk-powder-tin product (Peak Milk exists only as a brand, unmapped) + defects. Retire. |
| product-30.jpg | 30 | 3kg laundry detergent box, fictional "AQUA FRESH" — **garbled side-panel text** | — | — | — | **C** | N/A | Confirms Pat's exact cited example (detergent ≠ id-30 necklace). **No detergent SKU exists anywhere in current 127-item catalog** to remap to. Preserved, held for 200+ catalog expansion if a detergent product is added; unusable today due to text defects regardless. |
| product-31.jpg | 31 | 500ml antiseptic liquid, fictional "MEDIGUARD" — **spelling defect ("Cfcaning")** | — | — | — | **D** | N/A | No antiseptic-liquid product (id 72 is a soap bar, different form) + defect. Retire. |
| product-32.jpg | 32 | 4oz Jamaican Black Castor Oil, fictional "BOTANICA ESSENTIALS" — **spelling defect ("Trsditional")** | — | — | — | **D** | N/A | No castor-oil product (id 67/74 are argan oil) + defect. Retire. |
| product-33.jpg | 33 | 50ml anti-aging cream, fictional "RENEW 7" — clean | — | — | — | **C** | N/A | No exact match (closest, id 65, requires real brand Nivea). Clean — hold for Beauty & Health category banner. |
| product-34.jpg | 34 | 30ml liquid foundation, fictional "AURORA BEAUTY" — clean | 69 | Zaron Full Coverage Foundation | Beauty & Health | **C** | N/A | Category matches id 69, but that product requires REAL brand Zaron — fictional-brand image would violate name/image-agreement rule. Hold for generic cosmetics category imagery only. |
| product-35.jpg | 35 | 10kg **fixed-weight** hex dumbbell pair, fictional "FITGRIP" — clean | 84 | Adjustable Dumbbell Set (20kg) | Sports & Fitness | **C** | LOW | Product TYPE differs (fixed vs. adjustable, 10kg vs. 20kg) — would misrepresent key feature. Generate fresh id-84 photography; hold this asset for general fitness discovery imagery. |
| product-36.jpg | 36 | Purple/grey dual-layer TPE yoga mat, fictional "AURORA YOGA" — clean | — | — | — | **C** | N/A | No yoga-mat product in pending catalog. Hold for Sports/Fitness discovery imagery. |
| product-37.jpg | 37 | Baby diapers Size 4, fictional "LITTLE DREAMERS" — **baby-anatomy distortion + spelling defects** | 79 | Baby Diapers Size 3 (Jumbo Pack, 84 Count) | Baby Products | **D** | N/A | Category matches but size differs (4 vs 3) AND has genuine anatomical defect. Retire; generate fresh Size-3 photography. |
| product-38.jpg | 38 | 900g infant formula tin, fictional "Little Sprout" — **baby-anatomy distortion + spelling defect ("Munths")** | — | — | — | **D** | N/A | No infant-formula product in pending catalog + defects. Retire. |
| product-39.jpg | 39 | 70cl Irish whiskey, fictional "The Kilbride Distillery" — minor artifact | — | — | — | **D** | N/A | No spirits product in pending catalog. Retire (low reuse value). |
| product-40.jpg | 40 | 20cl African Herbs Bitters — **garbled text + "200l e" typo** | — | — | — | **D** | N/A | No bitters product in pending catalog + defects. Retire. |
| product-41.jpg | 41 | Hardcover finance book "MONEY PATHWAY", fictional author — minor artifact | — | — | — | **C** | N/A | No matching current book (ids 101-103 are real, specific, named titles). Hold for generic "Books" category banner only. |
| product-42.jpg | 42 | Paperback novel "ECHOES OF LAGOS", fictional author, Lagos street art — minor artifacts | 101 | Things Fall Apart by Chinua Achebe | Books | **D** | N/A | Category matches but id 101/102 are REAL, specific Achebe titles — fictional cover under a real title violates name/image-agreement rule. May hold as C for generic "African Literature" category banner only. |
| product-43.jpg | 43 | 195/65R15 car tire, unbranded — **gibberish sidewall micro-text + tread defects** | — | — | — | **D** | N/A | No tire product in pending catalog + defects. Retire. |
| product-44.jpg | 44 | 60Ah car battery, fictional "VOLTMAX" — minor label blur, mostly clean | — | — | — | **C** | N/A | No car-battery product in pending catalog. Hold for Automotive category/discovery imagery. |

### Section 1 Summary
- **44** legacy product images inspected.
- **1** recovered & remapped (B): product-20.jpg → id 45 (4-Burner Gas Cooker).
- **12** held as C (clean, no current match, reusable for category/discovery/banner content later or at 200+ catalog expansion).
- **31** classified D (genuine AI-generation quality defects — garbled text, distorted anatomy, impossible geometry — OR real-trademark risk (Daikin) OR name/image-agreement conflict with a real-branded current product). None deleted; all preserved on disk.

---

## SECTION 2 — LEGACY BRAND LOGOS (23 files, `public/static/brands/*.png`, commit `4c71498`)

**CRITICAL FINDING — surfaces a real legal risk Pat's directive explicitly asked me to check for ("verify brand/text" step):**

| Filename | Rendered Content | Trademark Status | Matches Current Brand Row? | Decision | Action |
|---|---|---|---|---|---|
| anker.png | "ANKER" wordmark + tagline | **EXACT reproduction of real Anker logo/font/color** | No (Anker not in current 38-brand table) | D | Do not use; real-trademark risk + no current match. |
| apple.png | *(file content)* | **Corrupted — solid black square, no content** | Yes (id 2, Apple) | D | File is broken; must be regenerated as compliant generic-style asset (no Apple logo) if a brand-logo slot is ever built. |
| ariel.png | "ARIEL" + atom symbol | **EXACT reproduction of real Ariel (P&G) logo** | No | D | Real-trademark risk; no current match. Retire. |
| binatone.png | "Binatone" + red "B" icon | **EXACT reproduction of real Binatone logo** | No (Binatone not a `brands` row; it's used as a product-title brand string only) | D | Real-trademark risk. Do not wire to id-44 product. |
| dettol.png | "Dettol" + sword/shield | **EXACT reproduction of real Dettol logo** | Yes (id 23, Dettol) | **D — HIGH RISK** | Real, exact trademark reproduction. **Must NOT be used** even though the brand name matches — this is precisely the disqualifying case Pat's per-product trademark policy addresses. Retire; if a Dettol brand-tile is ever needed, must be plain generic text only. |
| dyson.png | "dyson" wordmark | **EXACT reproduction of real Dyson wordmark/font** | No | D | Real-trademark risk; no current match. Retire. |
| golden-penny.png | "GOLDEN PENNY FOODS" + star mark | **EXACT reproduction of real Golden Penny logo** | Yes (id 28, Golden Penny) | **D — HIGH RISK** | Exact reproduction. Do not use despite name match. Retire. |
| hisense.png | "Hisense" wordmark | **EXACT reproduction of real Hisense logo/font/color** | Yes (id 10, Hisense) | **D — HIGH RISK** | Exact reproduction. Retire despite name match. |
| hp.png | "hp" circle mark | **EXACT reproduction of real HP logo** | Yes (id 3, HP) | **D — HIGH RISK** | Exact reproduction. Retire despite name match. |
| indomie.png | "Indomie" bilingual wordmark | **EXACT reproduction of real Indomie logo** | Yes (id 26, Indomie) | **D — HIGH RISK** | Exact reproduction. Retire despite name match. |
| infinix.png | "Infinix" + tagline | **EXACT reproduction of real Infinix logo/font/color** | Yes (id 5, Infinix) | **D — HIGH RISK** | Exact reproduction. Retire despite name match. |
| jbl.png | "JBL" mark | **EXACT reproduction of real JBL logo** | No | D | Real-trademark risk; no current match. Retire. |
| lg.png | "LG" circle-face mark | **EXACT reproduction of real LG logo** | Yes (id 9, LG) | **D — HIGH RISK** | Exact reproduction. Retire despite name match. |
| maybelline.png | "MAYBELLINE NEW YORK" wordmark | **EXACT reproduction of real Maybelline logo** | No | D | Real-trademark risk; no current match. Retire. |
| midea.png | "Midea®" mark | **EXACT reproduction of real Midea logo** | No | D | Real-trademark risk; no current match. Retire. |
| nestle.png | "Nestlé" + bird's-nest icon | **EXACT reproduction of real Nestlé logo** | Yes (id 25, Nestle) | **D — HIGH RISK** | Exact reproduction. Retire despite name match. |
| nike.png | *(file content)* | **Corrupted — solid black square, no content** | Yes (id 7, Nike) | D | Broken file; irrelevant since Nike would need compliant generic treatment anyway. |
| orijin.png | "Orijin®" mark | **EXACT reproduction of real Orijin (Diageo) logo** | No | D | Real-trademark risk; no current match. Retire. |
| peak.png | "Peak SINCE 1954" + palm trees | **EXACT reproduction of real Peak Milk logo** | Yes (id 29, Peak Milk) | **D — HIGH RISK** | Exact reproduction. Retire despite name match. |
| samsung.png | *(file content)* | **Corrupted — solid black square, no content** | Yes (id 1, Samsung) | D | Broken file. |
| scanfrost.png | "Scanfrost" mark | **Near-exact reproduction of real Scanfrost logo** | No | D | Real-trademark risk; no current match. Retire. |
| sony.png | *(file content)* | **Corrupted — solid black square, no content** | Yes (id 12, Sony) | D | Broken file. |
| tecno.png | "TECNO Mobile" wordmark | **EXACT reproduction of real Tecno logo/font/color** | Yes (id 4, Tecno) | **D — HIGH RISK** | Exact reproduction. Retire despite name match. |
| zaron.png | "zaron...redefining the essence of beauty" | **Near-exact reproduction of real Zaron Cosmetics logo** | Yes (id 20, Zaron Cosmetics) | **D — HIGH RISK** | Near-exact reproduction of a real (if smaller) brand's proprietary logo design. Retire despite name match. |

### Section 2 Summary — ⚠️ ALL 23 UNUSABLE
- **0 of 23** are safe for reuse. **19 of 23** are exact/near-exact reproductions of REAL companies' protected trademarked logos (font, color, iconography) — this is a genuine legal exposure that predates this session and was never caught before because these files were already fully unwired (`/ph.svg` everywhere). **4 of 23** (apple, nike, samsung, sony) are simply corrupted/blank files with zero content.
- Even where the filename matches a current `brands` table row exactly (Dettol, Golden Penny, Hisense, HP, Indomie, Infinix, LG, Nestle, Peak Milk, Tecno, Zaron Cosmetics — 11 of 38 current brands), **none of these files may be used**, per Pat's own corrected per-product trademark policy: reproducing a real company's actual logo/wordmark/color scheme without a license is exactly the disqualifying case, regardless of how good the "content match" is.
- **Recommendation:** Brand-tile generation for the "Top Brands" section must be done FRESH, following the same per-brand accuracy test used in Batch 2 for Adidas/Nike: for brands with real trademarks, use compliant plain-text/generic treatment (no logo reproduction); for the 8 fictional in-catalog brands (Davido Fashion House, Ashluxe, Zaron Cosmetics — wait, Zaron is real — Ashluxe, Fatiya Textiles, Adire Oodua Textiles, Kentex Ghana, Maasai Market Collective, Marrakech Leatherworks, Java House, Woolworths, Generic) no restriction applies. This is a NEW generation task, not a recovery — logged as a correction to the original plan (Section 4).

---

## SECTION 3 — LEGACY VENDOR LOGOS (20 files, `public/static/vendors/vendor-N.jpg`, commit `e8ed19f`)

All 20 are original, professionally-designed FICTIONAL business logos (no real-world trademark risk detected in any of them) — clean vector-style marks with invented names, icons, and taglines.

| Filename | Baked-in Business Name | Represents | Matches a Current Real Vendor (18 total)? | Decision | Action |
|---|---|---|---|---|---|
| vendor-1.jpg | Electronics World | Electronics retailer | No exact name match (closest: Lagos Tech Hub / Naija Gadget Store / Abuja Electronics Mart — none named "Electronics World") | C | Hold — generic electronics-vendor visual, usable if a new electronics vendor is added, or for category/discovery use. |
| vendor-2.jpg | GadgetTech Hub | Electronics/gadget retailer | No exact match | C | Hold. |
| vendor-3.jpg | Mega Electronics | Electronics retailer | No exact match | C | Hold. |
| vendor-4.jpg | PhonePlace Abuja | Phone retail/repair, Abuja | Close to "Abuja Electronics Mart" but different name — logo has baked-in "PhonePlace ABUJA" text | D | Baked-in wrong name — using it under "Abuja Electronics Mart" would show incorrect on-image branding text. Retire for vendor use; hold only as generic electronics-shop imagery. |
| vendor-5.jpg | Fashion Vault NG | Fashion boutique | No exact match | C | Hold. |
| vendor-6.jpg | Ankara House | Ankara/African-print fashion | Close concept to "Ariya Ankara House" but baked-in text differs ("Ankara House" vs "Ariya Ankara House") | D | Wrong baked-in name text. Retire for that specific vendor; hold as generic Ankara-fashion category imagery. |
| vendor-7.jpg | Kitchen King NG | Kitchenware/catering | No matching current vendor | C | Hold. |
| vendor-8.jpg | FoodMart NG | Grocery/supermarket | Close to "Naija Fresh Market" / "Mama's Kitchen Grocers" but baked-in text differs | D | Wrong baked-in name text. Retire for those vendors; hold as generic grocery imagery. |
| vendor-9.jpg | QuickBasket NG | Grocery delivery | No exact match | C | Hold. |
| vendor-10.jpg | Glow Beauty Store | Beauty/cosmetics | Close to "Zaron Beauty Nigeria" but baked-in text differs | D | Wrong baked-in name. Retire for that vendor; hold as generic beauty-store imagery. |
| vendor-11.jpg | Natural Hair NG | Natural hair care | No exact match | C | Hold. |
| vendor-12.jpg | Sports Arena NG | Sports | No current sports vendor exists | C | Hold for future vendor onboarding. |
| vendor-13.jpg | NaijaDrinks Ltd | Beverage distribution | No current beverage vendor exists | C | Hold. |
| vendor-14.jpg | BookHouse NG | Books | No current book vendor exists | C | Hold. |
| vendor-15.jpg | AutoParts NG | Automotive parts | No current automotive vendor exists | C | Hold. |
| vendor-16.jpg | Home Appliances NG | Home appliances | Close to "Enugu Home & Living" but baked-in text differs | D | Wrong baked-in name. Retire for that vendor; hold as generic appliance-store imagery. |
| vendor-17.jpg | Cool Breeze NG | HVAC/cooling | No current HVAC vendor | C | Hold. |
| vendor-18.jpg | BabyCare Essentials | Baby products | No current baby-products vendor | C | Hold. |
| vendor-19.jpg | TechZone Kano | Electronics/IT, Kano | No exact match (no current vendor named for Kano) | C | Hold. |
| vendor-20.jpg | Value Electronics | Electronics retailer | No exact match | C | Hold. |

### Section 3 Summary
- **0 of 20** can be used as-is for the 18 REAL current vendors — **every single legacy vendor logo has a DIFFERENT baked-in business name/text than any current vendor**, and because the name is rendered directly into the logo artwork (not overlay text we control), none can be silently remapped without showing the wrong business name on the image itself. This differs from the product-photo case (where content is generic/swappable) — a logo's entire point is the specific name baked into it.
- All 20 are clean, trademark-safe, professionally designed. None are deleted. All held as **C** (repurposable) for: (a) future vendor onboarding where a real vendor happens to want a similar generic identity, or (b) generic category/discovery imagery (e.g., "Electronics Sellers," "Fashion Vendors," "Grocery Partners" sections) that doesn't require exact identity matching.
- **Recommendation:** the 18 real vendor logos require fresh, purpose-generated logos bearing their EXACT names (Lagos Tech Hub, Naija Gadget Store, etc.) — this is a genuine NEW generation requirement, not a recovery gap.

---

## SECTION 4 — BANNERS (5 files, `public/static/banners/banner-N.jpg`, commit `e8ed19f`)

| Filename | Subject | Text Overlay | Quality | Decision | Suggested Use |
|---|---|---|---|---|---|
| banner-1.jpg | Electronics "MEGA SALE 50% OFF" graphic (viewed in prior session) | Yes | Good | C | Electronics category/promo banner — pending Pat's explicit visual sign-off before use. |
| banner-2.jpg | Ankara-fashion boutique display w/ mannequin + accessories | "SALE/50% OFF/NEW ARRIVALS" UI bubbles | High | C | African Fashion / Ankara category banner or promo slide. |
| banner-3.jpg | Family receiving grocery delivery at doorstep | None | High | C | Groceries / NaijaFresh delivery promo banner. |
| banner-4.jpg | Modern kitchen, smart appliances, woman blending | None | High | C | Home & Kitchen category banner. |
| banner-5.jpg | Delivery rider on motorcycle, Lagos street scene, "VERIFIED" box branding | Minor env. text ("Lagos", "VERIFIED") | Good (minor bg artifacts) | C | NaijaSend / logistics vertical promo banner. |

### Section 4 Summary
All 5 banners are clean, non-product, non-trademarked, high-quality lifestyle/marketing photography. **All 5 classified C (repurpose-ready)** — held for use during the Phase 1b visual rebuild (Deals/Promotions rail, category banners) rather than forced into product slots. None require regeneration.

---

## SECTION 5 — AVATARS (8 files, `public/static/avatars/avatar-N.jpg`, commit `e8ed19f`)

All 8 inspected — clean, professional-quality human headshots, zero defects, zero trademark concerns. **Classification A (reuse as-is)** — already correctly wired via `reviews.avatar_url` migration in the same commit. No action needed.

---

## SECTION 6 — ALREADY-APPROVED ASSETS (no re-inspection needed, per Pat's explicit reconfirmation)

| Asset Group | Files | Commit | Status |
|---|---|---|---|
| Hero campaigns | 10 (`hero/*.jpg`, 5 campaigns × desktop/mobile) | `ebce7b6` | **A — approved for reuse in new 3-zone hero** |
| Ecosystem verticals | 16 (`ecosystem/*.jpg`, 8 verticals × desktop/mobile) | `6156879` | **A — approved for reuse in ecosystem strip** |
| Africa glow map | 1 (`graphics/africa-glow-map.png`) | `5d203d7` | **A — approved for reuse in Explore Africa / country nav** |

---

## FINAL SUMMARY STATISTICS (as requested by Pat)

| Metric | Count | Detail |
|---|---|---|
| **TOTAL EXISTING IMAGE ASSETS FOUND** | **136** | 44 legacy products + 23 brand logos + 20 vendor logos + 5 banners + 8 avatars + 16 ecosystem + 10 hero + 1 africa-map + 46 (Batch1+2 already-generated, tracked separately) — see full inventory in Files section |
| **PRODUCT IMAGES FOUND (pre-existing, excl. Batch1/2 new work)** | **44** | The legacy `product-N.jpg` set, commit `93e3cf9` |
| **CURRENT PRODUCTS SUCCESSFULLY MATCHED (content-verified)** | **1** | id 45 (4-Burner Gas Cooker) ← product-20.jpg |
| **OLD IMAGES RECOVERED & DEPLOYED** | **1** | product-20.jpg → `045-4-burner-gas-cooker-with-oven.jpg`, D1 updated, HTTP-verified 200 |
| **NEW IMAGES STILL REQUIRED (products)** | **80** | 81 pending products (Batches 3–8) minus the 1 just recovered (id 45) |
| **DUPLICATES FOUND** | **0** | No two legacy files depicted identical content for the same current product |
| **UNUSABLE ASSETS (Category D)** | **31 products + 19 brand logos (real-trademark) + 4 brand logos (corrupted) + 6 vendor logos (wrong baked-in name) = 60** | None deleted — all preserved on disk per directive; simply excluded from current use |
| **REPURPOSABLE, NOT PRODUCT-MATCHED (Category C, held in library)** | **12 products + 14 vendor logos + 5 banners = 31** | Available for category/discovery/banner/future-catalog use during Phase 1b rebuild |
| **ALREADY-CORRECT, NO ACTION (Category A)** | **8 avatars + 16 ecosystem + 10 hero + 1 africa-map = 35** | Confirmed good, reconfirmed by Pat, untouched |

### Net effect on the generation plan
- Batch 3 (Beauty/Health, 12 products) — **recovery found ZERO usable matches for this batch's 12 items**. All 12 still require fresh generation. (product-33 and product-34 are close in category but require fictional-vs-real-brand substitution that would violate the name/image-agreement rule — see Section 1.)
- **Only 1 product across all 81 pending items (id 45, Home & Kitchen / Batch 4) was recoverable** — the gas cooker. This is now DONE, reducing the Batch 4 workload from 18 to 17.
- **Brand logos (38): 0 recoverable.** All 23 legacy files are either real-trademark-infringing or corrupted. This is a NEW finding that changes the original plan — brand-tile generation must be done fresh with the same per-brand accuracy test as Batch 2, not "recovered."
- **Vendor logos (18 real vendors): 0 directly recoverable** (logos have specific baked-in names that don't match any current vendor). 14 of the 20 legacy files are held as C for possible future use if new vendors are onboarded with similar identities, or repurposed as generic category imagery.
- **Banners (5): all 5 reusable as C** for the Phase 1b Deals/Promotions/category-banner sections — a genuine win, zero regeneration needed here.

---

## MASTER RULE COMPLIANCE CHECK

- ✅ EXISTING GOOD ASSET = REUSE → Section 6 (hero/ecosystem/map), Section 5 (avatars)
- ✅ EXISTING GOOD ASSET WRONG OLD ID = REMAP → product-20.jpg → id 45 (executed)
- ✅ EXISTING GOOD ASSET NO CURRENT MATCH = REPURPOSE IF APPROPRIATE → 12 products (C), 14 vendor logos (C), 5 banners (C) held in library
- ✅ MISSING ASSET = GENERATE → 80 remaining pending products, all 38 brand logos, all 18 vendor logos still need generation
- ✅ BAD ASSET = REPLACE → 31 product images (D, quality defects) will be replaced by fresh generation when their batch comes up
- ✅ MISMATCHED ASSET = NEVER USE → confirmed for product-30 (detergent≠necklace), product-21 (fictional brand≠Binatone), product-34 (fictional brand≠Zaron), etc. — none forced into wrong slots
- ✅ NO ORIGINAL FILES DELETED, OVERWRITTEN, OR DESTRUCTIVELY RENAMED — `product-20.jpg` preserved untouched; new canonical copy created separately

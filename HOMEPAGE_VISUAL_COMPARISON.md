# HOMEPAGE_VISUAL_COMPARISON.md

**Status: DIRECT SCREENSHOT COMPARISON — COMPLETED for the first time this checkpoint.**

Methodology: fresh Playwright screenshots captured from the actual running build
(`npm run build` + PM2 restart, commit `<pending>`, see `qa-screenshots/`), then
placed directly beside the reference image (`https://www.genspark.ai/api/files/s/yqRRTOdB`)
via `understand_images` side-by-side analysis. This is NOT a code-based or
curl-based judgment — every verdict below is from actually looking at the
rendered screenshot next to the reference.

Screenshots used:
- `qa-screenshots/home-desktop-1440-fold.png` (above-the-fold, 1440px)
- `qa-screenshots/home-desktop-1440-full.png` (full page, 1440px)
- `qa-screenshots/home-mobile-390-full.png` (full page, 390px)

---

## TOP-LINE VERDICT

**Checkpoint B is NOT approved.** The reference is a 14-section, richly
composed super-app homepage with sidebar-paired widgets, restaurant/food
discovery, country discovery, brand logos, and colorful promotional modules.
Our current homepage is a single-column stack of ~17 full-width horizontal
product/category carousels. The density and card-level fixes made this
session (container 1600→1280px, tighter cards, functional Add to Cart,
compact ecosystem pills) are real, measurable improvements — but they do not
close the gap, because **the gap is not primarily a density/CSS problem, it
is a missing-sections and missing-layout-pattern problem.**

---

## SECTION-BY-SECTION COMPARISON

### HEADER

**REFERENCE:** Dark green 3-tier header — (1) thin utility bar with
slogan/Sell/Business/Help/Track Order/Download App, (2) main bar with logo,
deliver-to-Lagos, search with dropdown, language, account, cart with ₦ total,
(3) sub-nav with "All Categories" dark button + 9 service links with small
colored icons.

**CURRENT:** Same 3-tier structure exists, same slogan bar, same search bar,
same sub-nav row with icons and "Soon" badges. Cart shows icon only (no ₦
running total visible in the icon itself, unclear if implemented).

**GAP:** Structurally very close. Visual difference is minor — "Soon" badge
styling and the yellow search button (reference doesn't have a filled yellow
search button, ours does).

**ACTION:** Low priority. Optionally verify cart shows live ₦ total like
reference. Not a blocker for Checkpoint B.

**Structure: MATCHED**
**Visual: PARTIAL**
**Overall: PARTIAL**

---

### HERO

**REFERENCE:** 65/20/15 three-zone layout: (1) large lifestyle photo banner
with bold headline + yellow CTA + arrows/dots, (2) app-download box with real
QR code + phone mockups, (3) **personalized "Good morning, Patrick" dashboard
card** showing order count, wishlist count, wallet balance, messages, and a
green "Continue Shopping" button.

**CURRENT:** Same 65/20/15 geometry (confirmed correct in Checkpoint A). Zone
1 shows "The Ankara Edit" campaign with photo + CTA — visually solid. Zone 2
("Get the NaijaDeals App") is a flat green box with QR code, no phone
mockups. Zone 3 shows a generic **"Join NaijaDeals / Create free account"**
card for a logged-out visitor — this is the correct behavior for a
logged-out user (not fabricated data), but it means the specific
"personalized dashboard" visual from the reference has not been screenshotted
in its logged-in state this session.

**GAP:** Zone 2 lacks phone mockup imagery (QR code alone, flatter than
reference). Zone 3's logged-in personalized state was not re-screenshotted
this session — Checkpoint A claimed this exists (`getPersonalizationSnapshot`)
but it needs a logged-in screenshot to visually confirm it matches the
reference's "Good morning, Patrick" card richness (avatar, 4 stat buttons).

**ACTION:** (1) Add phone mockup imagery to the app-download zone. (2) Capture
a LOGGED-IN screenshot next session and visually verify Zone 3 against the
reference's specific card layout — do not just trust the Checkpoint A code.

**Structure: MATCHED**
**Visual: PARTIAL**
**Overall: PARTIAL**

---

### ECOSYSTEM

**REFERENCE:** Row of 9 tinted rounded-rectangle cards with photographic
icons — description in the detailed decomposition calls these "circular
button" quick-links with secondary text (e.g. "Shop Everything", "Fresh
Groceries"), fairly compact (~80px row height per the earlier ruler pass).

**CURRENT:** 9 tinted circular pills (~104×84px each) with a small photo
roundel + icon overlay + name + status text. Renders correctly, all 9
present, real accent colors, real photography confirmed rendering (not
broken/blank — verified via direct image inspection this session).

**GAP:** Proportion and shape are close (compact pills vs. reference's
compact cards) but the AI comparison flagged this row as reading "bloated"
relative to reference at the OLD size; at the NEW compact size it is now
visually closer, but has not been re-compared frame-by-plausible-frame since
the rewrite — the honest state is "structurally and directionally correct,
fine-grained pixel match not re-verified after this session's tightening."

**ACTION:** Needs one more direct crop-comparison (ecosystem row only, both
images cropped to just this section) next session before calling this MATCHED.

**Structure: MATCHED**
**Visual: PARTIAL**
**Overall: PARTIAL**

---

### SHOP BY CATEGORY

**REFERENCE:** Not a standalone rail in the reference's actual section order —
the reference's closest equivalent is embedded contextually; per the fresh
decomposition, "Shop by Interest" (circular photo category row, 8 items) is
the section playing this role, positioned AFTER Today's Deals, not
immediately after Ecosystem.

**CURRENT:** "Shop by Category" rail sits directly after Ecosystem, uses
square-image cards in a MerchandisingRail (same chrome as New Arrivals per
directive item 2). Renders with real photography confirmed (furniture,
shoes, home interiors visible in the screenshot, not placeholders).

**GAP:** (1) Position: ours is 3rd section, reference's nearest equivalent is
~8th. (2) Shape: reference uses circular crops for "Shop by Interest" style
sections, ours uses square cards — this is a real card-shape mismatch, not
just an ordering one.

**ACTION:** Do not just declare this "matches New Arrivals" (that was the
old bar) — it must be re-evaluated against where the reference actually puts
this pattern, and whether square vs. circular cropping matters. Recommend
keeping square (matches our own New Arrivals/product-card visual language,
avoids two different crop shapes on one page) but flag the position mismatch
as a real page-order gap to resolve in the full rebuild.

**Structure: PARTIAL** (component exists, but is not the reference's
structural analog at this page position)
**Visual: PARTIAL**
**Overall: PARTIAL**

---

### POPULAR CATEGORIES

**REFERENCE:** No direct 1:1 equivalent identified in the fresh
decomposition as a distinct top-level section — closest concepts are "Shop by
Interest" (see above) and the general merchandising density of the whole
page.

**CURRENT:** Dedicated rail, 15 real cards (verified via live DOM parse:
`cards: 15` inside the actual rendered track), each with real photography,
ranked by live `product_count DESC`.

**GAP:** The 15-card fix is real and honest (verified against the DB: exactly
15 categories qualify). This is a genuine positive. The rail itself is
visually reasonable at the new compact card size, but as an entire
*section*, it may be one of the "extra" rails Pat's later message flags —
the reference does not appear to have a section literally named "Popular
Categories" as ours does.

**ACTION:** Keep the underlying honest-data fix (do not regress to 10). Revisit
whether this should remain a standalone section or be folded into a broader
"Shop by Interest"-style section once the full rebuild happens.

**Structure: MATCHED** (as its own intended feature)
**Visual: PARTIAL**
**Overall: PARTIAL**

---

## CROSS-CUTTING FINDINGS (from the full-page comparison)

1. **Missing sections confirmed absent, not just "not yet checked":**
   Recently Viewed sidebar, Back-to-School promo sidebar, Shop by Interest
   (as a distinct circular-card row), "Continue from where you left off",
   Popular on NaijaFresh, Top Restaurants on NaijaEats, Explore Africa by
   Country carousel + Made in Africa sidebar, Top Brands logo strip, the
   colorful multi-service promo banner row, and the trust-badges strip are
   **all absent** from the current homepage. This was independently confirmed
   by direct visual inspection of the full-page screenshot, not inferred from
   code.

2. **Layout pattern mismatch:** the reference repeatedly pairs a wide
   carousel with a narrower sidebar widget (Recommended + Recently Viewed;
   Today's Deals + Back to School banner; Africa carousel + Made in Africa
   banner). Our homepage uses zero sidebar-paired sections — every section is
   a single full-width carousel. This is why the page reads as "carousel →
   carousel → carousel" instead of the reference's denser, more varied
   grid.

3. **Mobile density (390px):** the mobile full-page screenshot shows a
   reasonably dense, legible stack — flash deals, today's deals, limited-time
   deals, recommended, popular categories, proudly nigerian, best sellers,
   trending, new arrivals, deals near you, promo banners, ecosystem CTA,
   newsletter/footer all visible and populated with real images and prices.
   Mobile is closer to "acceptable" than desktop, though it inherits the same
   missing-sections gap as desktop.

4. **Card-level anatomy is now close to the reference's intent**: yellow
   full-width Add to Cart, green Free Delivery line, restored seller-count,
   discount badges, ratings — this part of Pat's checklist (item 11, product
   cards) is in reasonably good shape at the CARD level. The problem is
   entirely at the PAGE COMPOSITION level.

---

## HONEST CONCLUSION

The density/proportion work done this session was real and is now visible in
the actual screenshots (tighter cards, 1280px container, functional cart
button, honest 15-card Popular Categories, compact Ecosystem pills, and zero
regressions found on Seller/Ecosystem/Admin pages). But per Pat's own
standard — the screenshot is the judge, not the code — **the homepage as a
whole does not look like the reference**, because roughly half of the
reference's named sections do not exist yet, and none of the reference's
sidebar-paired layout pattern has been built. Checkpoint B, understood as
"the rendered page visually matches the reference," is **not complete**, and
the outstanding work is now correctly understood to be a page-composition
rebuild, not further tuning of the rails that already exist.

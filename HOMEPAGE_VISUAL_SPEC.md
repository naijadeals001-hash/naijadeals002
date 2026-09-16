# NaijaShop Homepage — Visual Specification (Reference-Derived)

**Status: SOURCE OF TRUTH.** This document is the literal build ruler for the homepage
visual rebuild. It was produced by a full section-by-section decomposition of Pat's
supplied reference screenshot (desktop, full-page). Every future implementation
checkpoint is graded against THIS document, not against memory or prior text
descriptions.

Reference image: `https://www.genspark.ai/api/files/s/yqRRTOdB`
Spec authored: 2026-09-15, via `understand_images` full decomposition pass.

---

## 0. Global Page Settings

| Property | Spec |
|---|---|
| Max content width | ~1280px, centered, light-grey (`#F5F6F8`) gutters outside |
| Primary brand color | Deep forest green `#0A5C36` / `#094F2E` |
| Secondary accent | Gold/yellow `#FBC02D` / `#FFC107` |
| Density | **Extremely high** — tight vertical rhythm (~20px between sections), dense card composition, minimal whitespace |
| Typography | Clean sans-serif, strict weight hierarchy (section titles bold ~18-20px, card text small/dense) |

**Critical density note**: sections are separated by ~20px gaps, not the 24-32px
(`py-6 md:py-8`) currently used across our homepage. This alone materially changes
the "commercial density" feel Pat is calling out.

---

## 1. Top Utility Bar
- Height: ~2.5% of page
- Background: dark green `#094F2E`
- Left: "One Africa. More Possibilities." + divider + "Sell on NaijaDeals" | "Business" | "Help Center" | "Track Order" (white, ~11-12px)
- Right: "Download App" + mini Google Play / App Store badges

**Current state**: NOT PRESENT. Our header has no separate utility bar row.

---

## 2. Main Header
- Height: ~6% of page
- Background: solid brand green
- Logo: far left, dual-leaf icon + "NaijaDeals" wordmark
- Search bar: ~45% of header width, white bg, integrated "All" category dropdown on
  left, placeholder "Search products, services, restaurants, hotels, flights, and
  more...", solid green search button with white magnifier icon on right
- Right side: "Deliver to Lagos, Nigeria" (pin icon) → "NGN (₦)" flag dropdown →
  "English" dropdown → Help icon → Account dropdown ("Hello Patrick") → Cart icon
  (red badge + "₦124,200" running total)

**Current state**: needs verification against live screenshot (Step 2 below).

---

## 3. Category/Vertical Navigation Bar
- Height: ~3% of page
- Background: light grey/white, bordered
- Far left: solid green "All Categories" pill with burger icon
- Horizontal tabs, each with a small colored icon: NaijaShop (bag), NaijaFresh
  (apple), NaijaEats (bowl), NaijaGigs (handshake), NaijaStay (bed), NaijaDrive
  (car/keys), NaijaSend (paper plane), NaijaStream (play), Aura AI (sparkle)

---

## 4. Hero — TRIPLE PANEL, NOT a single carousel, NOT 10 panels shown at once
**This is the single biggest structural gap versus our current build.**

- Height: ~12% of page
- **3 panels, width ratio 65% / 20% / 15%** (NOT one full-width carousel)
  1. **Primary (65%)**: dark-green themed campaign slide — large white headline,
     tagline, secondary "Africa Thrives Together" badge, gold pill CTA "Start
     Shopping". This is where the 10+ rotating campaigns live (rotates ONE at a
     time — the 10 campaigns are rotating CONTENT for this ONE panel, not 10
     simultaneous panels).
  2. **App promo (20%)**: green bg, "Download the NaijaDeals App", QR code, store
     badges, floating phone mockup. STATIC, not campaign-driven.
  3. **Personalization card (15%)**: white bg, grey border, user avatar + "Good
     morning, Patrick!", 2x2 stat grid (My Orders / My Wishlist / NaijaWallet / My
     Messages), full-width green "Continue Shopping" CTA button. STATIC per-user
     widget, not a campaign.

**Current implementation reality check**: our `HeroCarousel` renders 1 primary + 4
supporting DB campaign panels (a 5-panel campaign mosaic) with NO app-promo panel
and NO personalization card. This is a structural mismatch, not a styling one —
confirmed as Pat's #1 flagged issue.

---

## 5. Ecosystem Shortcut Strip (directly under hero)
- Row of **9 rounded-corner card buttons**, each with a distinct **tinted
  background color** (light green / pale red / sky blue / purple / yellow / teal /
  pink / dark violet — one hue per vertical, not uniform white cards)
- Each card: icon + bold title + micro-subtext (e.g. "NaijaShop / Shop Everything")

**Current state**: our Ecosystem Spotlight uses uniform white cards with photo
imagery — different visual treatment (photo-hero cards vs. tinted icon-pills).
Needs reconciliation: Pat's reference uses flat-color icon pills here, distinct
from the photo-card treatment we built in Part B. Flag for discussion — may keep
our richer photo treatment if Pat confirms, since reference literalism must not
regress the "real photography over icons" rule Pat also insists on elsewhere.

---

## 6. Merchandising Rails — general card anatomy
Every product card in the reference has (80:20 image:text ratio):
- White card, thin grey border + subtle shadow
- Top-right outline heart icon (wishlist)
- Center: product photo on plain white bg
- Bottom block: name, grey subtext, star rating, **bold black price**, green
  "Free Delivery" micro-badge, **full-width gold "Add to Cart" button**

**Current gap**: our `ProductCard` has no wishlist-icon-in-corner treatment tuned
this precisely, no gold full-width Add to Cart button (we link straight to PDP,
no in-card cart action), rating placement differs. This is the "cards are
visually weak" complaint — concrete, fixable list.

### Rail-by-rail inventory in reference:
| Rail | Cards visible | Special elements |
|---|---|---|
| Recommended for You, Patrick | 6 + sidebar | "Recently Viewed" vertical sidebar (3 rows) docked to the right of the rail |
| Today's Deals | 6 + promo card | Red countdown timer in header, red "-X%" badges, crossed-out original price, promo card ("Back to School") docked right |
| Shop by Interest | 8 image tiles | Real photography tiles (not icons), label below |
| 3-column widget row | 3 columns | "Continue where you left off" (2x2 thumbnails) / "Popular on NaijaFresh" (ingredient rows + Add btn) / "Top Restaurants on NaijaEats" (restaurant rows w/ rating+ETA) |
| Explore Africa by Country | 8 cards | Landscape photo + floating flag chip bottom-left + name + "Shop Now" link |
| Top Brands | 12 logos | Clean monochrome logo tiles, white rectangles |
| Ecosystem banner strip | 6 cards | Colored thematic promo cards per vertical (NaijaStream/Stay/Drive/Gigs/Send/Aura AI) |

**Key structural insight**: rails routinely dock a promo card or sidebar widget
on the right edge (Recently Viewed, Back-to-School promo) — this is a a
consistent pattern we do NOT currently replicate anywhere.

---

## 7. Footer
- Dark green newsletter band above footer: email field + gold "Subscribe" + social
  circle icons
- 5 columns: "Get to Know Us" / "Make Money with Us" / "Let Us Help You" / "Our
  Services" / "Legal"
- Bottom: app badges + copyright bar

---

## 8. Density & Rhythm Verdict
- **Verdict: tight, commercial, Amazon-scale.** Section gaps ~20px, not ~32-48px.
- Content spans near-edge-to-edge within the 1280px container — small gutters, not
  large side margins.
- Single reference screenshot contains **~12 distinct sections/rails** stacked with
  minimal breathing room between them.

---

## 9. What this means for build priority (Steps A-L, per Pat's directive)
The three highest-leverage structural gaps, in order of visual impact:
1. **Hero must become a 3-panel composition** (65/20/15), not a single N-panel
   campaign mosaic — this is the most visually dominant mismatch.
2. **Section vertical rhythm must tighten** from `py-6 md:py-8` (~24-32px) toward
   ~20px — a global CSS/Tailwind-scale change affecting every section.
3. **Product cards need a gold full-width "Add to Cart" button + corner wishlist
   icon + green delivery micro-badge** — the current card is a bare link, not a
   commerce-action card.

This document does not yet cover the mobile reference (not supplied) — mobile
spec will be inferred from responsive-scaling of these same proportions unless
Pat supplies a mobile reference screenshot separately.

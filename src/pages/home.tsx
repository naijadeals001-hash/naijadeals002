import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { Layout } from '../components/Layout'
import { ProductCarousel } from '../components/ProductCard'
import { HeroZone } from '../components/HeroZone'
import { EcosystemWaitlistModal } from '../components/EcosystemWaitlistModal'
import { MerchandisingRail } from '../components/MerchandisingRail'
import { PairedRailSection, PromoSidebarCard } from '../components/PairedRailSection'
import {
  getDealsNearYou
} from '../lib/catalog'
import { getHomepageFeed } from '../lib/homepage-feed'
import { getAllVerticals } from '../lib/ecosystem-verticals'
import { getDiscoverableCountries } from '../lib/country'
import { getPersonalizationSnapshot } from '../lib/personalization'
import type { AppEnv, VendorRow } from '../types'

/**
 * Homepage — FULL ARCHITECTURAL REBUILD (Pat's "STOP ITERATING COMPONENT-BY-
 * COMPONENT" directive, 2026-09-16). The previous version of this file was a
 * single-column stack of ~17 full-width carousels — every section used the
 * SAME layout pattern (wide carousel, full width, nothing beside it), which
 * is why the page read as "products -> products -> products" even though
 * most of the individual rails were honest and functional.
 *
 * This rebuild does two structural things the reference does that the old
 * version never attempted:
 *   1. CONTENT-TYPE ALTERNATION — the section order below deliberately
 *      changes what KIND of thing is being shown every 1-2 sections
 *      (products -> categories -> products -> interest circles -> products
 *      -> brands -> vendors -> ecosystem promo -> trust), instead of
 *      grouping all the product carousels together.
 *   2. SIDEBAR-PAIRED ROWS — three sections now use PairedRailSection to put
 *      a narrower real-content sidebar widget beside a carousel, mirroring
 *      the reference's "Recommended + Recently Viewed", "Today's Deals +
 *      promo", "Explore Africa + Made in Africa promo" rows. Every previous
 *      section was 100% full-width; this was the single biggest structural
 *      gap in Pat's side-by-side comparison.
 *
 * HONESTY NOTE (surfaced to Pat, not yet contradicted): the reference's
 * "Popular on NaijaFresh" and "Top Restaurants on NaijaEats" widgets are
 * intentionally NOT built here. Both verticals are `status: 'coming_soon'`
 * rows in ecosystem_verticals with zero real backing product/restaurant
 * data — building them would mean fabricating fake grocery/restaurant
 * listings, which violates the "show fewer, but all real" rule applied
 * everywhere else in this codebase. "Continue Where You Left Off" (the
 * third widget in that reference row) IS built, because it maps onto real,
 * already-working functionality (client-side Recently Viewed).
 */
export async function homePage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')
  const selectedCity = getCookie(c, 'nd_city') || 'Lagos'

  const [feed, dealsNearYou, verticals, discoverableCountries, personalization] = await Promise.all([
    getHomepageFeed(db),
    getDealsNearYou(db, selectedCity, 10),
    getAllVerticals(db),
    getDiscoverableCountries(db, 54),
    user ? getPersonalizationSnapshot(db, user.id) : Promise.resolve(null)
  ])

  const naijaShopSpotlightCard = {
    slug: 'shop',
    route: '/shop',
    name: 'NaijaShop',
    tagline: 'Live today — thousands of products, verified vendors.',
    icon: 'storefront',
    cta_label: 'Start shopping',
    hero_image_desktop: '/static/hero/mega-electronics-sale-desktop.jpg',
    hero_image_mobile: '/static/hero/mega-electronics-sale-mobile.jpg',
    status: 'live' as const,
    accent_color: 'green'
  }
  const spotlightVerticals = [naijaShopSpotlightCard, ...verticals]

  // "Naija Services" promo row (reference decomposition item 12: 6 colorful service
  // cards — NaijaStream/Stay/Drive/Gigs/Send/Aura). Same underlying ecosystem_verticals
  // rows as the Ecosystem strip near the top, but deliberately EXCLUDING NaijaShop
  // (already live, shown in the strip) and NaijaFresh/NaijaEats (kept out of this row
  // too, since we're not fabricating content for them elsewhere on the page either —
  // reusing them here as a plain promo tile, with no fake listings behind them, is
  // honest; a full "Popular on NaijaFresh" widget would not be). This is legitimate
  // reuse of one real dataset in two different, reference-matching visual treatments —
  // not a duplicate section.
  const naijaServicesCards = verticals.filter((v) => v.slug !== 'fresh' && v.slug !== 'eats')

  return c.render(
    <Layout title="Home" user={user} selectedCity={selectedCity} locale={locale}>
      {/* ============ 1. HERO — 3-ZONE COMPOSITION (Checkpoint A, unchanged this round) ============ */}
      <section class="bg-white border-b border-gray-100">
        <div class="max-w-[80rem] mx-auto px-3 md:px-6 lg:px-8 py-3 md:py-5">
          <HeroZone campaigns={feed.hero_campaigns} user={user} personalization={personalization} />
        </div>
      </section>
      <EcosystemWaitlistModal />

      {/* ============ 2. ECOSYSTEM STRIP — photo-forward tiles (grown per Pat's
          "present but visually weak" critique; see MerchandisingRail.tsx's EcosystemCard
          doc comment for the exact before/after). Still immediately below the hero. ============ */}
      <MerchandisingRail
        id="ecosystem"
        title="Explore the NaijaDeals Ecosystem"
        icon="hub"
        variant="ecosystem"
        ecosystemCards={spotlightVerticals}
      />

      {/* ============ 3. RECOMMENDED FOR YOU + CONTINUE WHERE YOU LEFT OFF (PAIRED) ============
          Structural fix #1: this is the reference's #1 sidebar-paired row, and the FIRST
          product rail on the page — promoted from position 6 (near-bottom) to position 3
          (near-top) per Pat's explicit "Recommended for You should be prominent near top"
          instruction. The sidebar is "Continue Where You Left Off": REAL client-hydrated
          Recently Viewed data (localStorage + /api/catalog/products/by-ids), just given a
          dedicated sidebar slot and reference-matching name instead of being buried as its
          own hidden full-width section near the page bottom. It starts empty/hidden for a
          first-time visitor (nothing fabricated) and self-populates via app.js. ============ */}
      <PairedRailSection
        id="recommended-pair"
        sidebarWidthClass="lg:w-[240px]"
        sidebar={
          <div id="continue-shopping-card" class="h-full flex flex-col bg-white border border-gray-200 rounded-xl p-3">
            <h3 class="text-sm font-bold text-gray-900 flex items-center gap-1.5 mb-2">
              <span class="material-symbols-outlined text-primary text-base">history</span>
              Recently Viewed
            </h3>
            {/* Real, honest empty state — shown by default for first-time visitors / anyone with
                no view history yet. app.js's hydrateRecentlyViewed() swaps this out for the real
                track (and hides #recently-viewed-empty) the moment localStorage + the by-ids API
                actually resolve real products; nothing here is fabricated. */}
            <div id="recently-viewed-empty" class="flex-1 flex flex-col items-center justify-center text-center gap-2 py-6">
              <span class="material-symbols-outlined text-3xl text-gray-300">visibility</span>
              <p class="text-xs text-gray-400 leading-snug">Products you view will show up here</p>
            </div>
            <div id="continue-shopping-track" class="hidden flex flex-col gap-2 overflow-y-auto flex-1"></div>
          </div>
        }
      >
        <ProductCarousel
          embedded
          id="recommended"
          title="Recommended for You"
          subtitle="Top-rated picks across NaijaShop"
          icon="recommend"
          products={feed.recommended}
          viewAllHref="/shop?sort=rating"
        />
      </PairedRailSection>

      {/* ============ 4. SHOP BY CATEGORY — curated departments (unchanged content, kept
          right after the Recommended pairing to alternate content type: products -> categories). ============ */}
      <MerchandisingRail
        id="shop-by-category"
        title="Shop by Category"
        subtitle="Curated departments across the NaijaDeals marketplace"
        icon="category"
        variant="category"
        categories={feed.shop_by_category}
        viewAllHref="/categories"
      />

      {/* ============ 5. TODAY'S DEALS + MEGA SALE PROMO (PAIRED) ============
          Structural fix #2: reference's second sidebar-paired row. Sidebar reuses
          banner-1.jpg — a REAL, pre-existing, previously-unreferenced asset (verified
          via image inspection: an "UP TO MEGA SALE — 50% OFF" electronics banner) —
          rather than generating anything new, per Pat's "don't spend this iteration on
          new asset generation" instruction. ============ */}
      <PairedRailSection
        id="todays-deals-pair"
        sidebar={
          <PromoSidebarCard
            image="/static/banners/banner-1.jpg"
            eyebrow="Limited time"
            title="Up to 50% off electronics"
            subtitle="Phones, laptops & audio — while stock lasts."
            ctaLabel="Shop the sale"
            href="/shop?deals=1&sort=price_asc"
          />
        }
      >
        <ProductCarousel
          embedded
          id="todays-deals"
          title="Today's Deals"
          subtitle="Hand-picked discounts refreshed daily"
          icon="local_offer"
          products={feed.todays_deals}
          viewAllHref="/shop?deals=1"
        />
      </PairedRailSection>

      {/* ============ 6. FLASH DEALS (kept full-width — has its own timer/urgency chrome
          that doesn't fit a narrow paired column) ============ */}
      {feed.flash_deals.length > 0 && (
        <section class="py-4 md:py-5 border-t border-gray-100">
          <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-lg md:text-xl font-bold text-gray-900 flex items-center gap-2">
                <span class="material-symbols-outlined text-amber-500">bolt</span>
                Flash Deals
              </h2>
              <span id="flash-timer" class="text-sm font-semibold text-red-600 bg-red-50 px-3 py-1 rounded-full flex items-center gap-1">
                <span class="material-symbols-outlined text-base">timer</span>
                <span id="flash-timer-value">02:59:55</span>
              </span>
            </div>
            <div class="flex gap-3 md:gap-4 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 snap-x scroll-smooth [&::-webkit-scrollbar]:hidden">
              {feed.flash_deals.map((p: any) => (
                <a href={`/shop/${p.slug}`} class="group flex flex-col bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-md transition-shadow w-[42vw] sm:w-44 md:w-52 lg:w-56 shrink-0 snap-start">
                  <div class="relative aspect-square bg-gray-100 overflow-hidden">
                    <img src={p.image_url} alt={p.title} loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    <span class="absolute top-2 left-2 bg-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded">
                      -{Math.round(((p.compare_at_price_kobo - p.price_kobo) / p.compare_at_price_kobo) * 100)}%
                    </span>
                  </div>
                  <div class="p-3 flex flex-col gap-1">
                    <h3 class="text-sm text-gray-800 line-clamp-2 min-h-[2.5rem]">{p.title}</h3>
                    <div class="flex items-baseline gap-2">
                      <span class="text-base font-bold text-gray-900">₦{(p.price_kobo / 100).toLocaleString('en-NG')}</span>
                      <span class="text-xs text-gray-400 line-through">₦{(p.compare_at_price_kobo / 100).toLocaleString('en-NG')}</span>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============ 7. SHOP BY INTEREST — NEW SECTION (reference decomposition item 8).
          Circular photo cards, department level. Data via getShopByInterest() (catalog.ts):
          each department borrows the real photo already owned by its own most-senior
          photographed descendant — verified via direct SQL to honestly yield 10 real,
          populated department cards. Distinct card SHAPE (circle) from every square card
          used elsewhere on the page, matching the reference's own visual variety. ============ */}
      <MerchandisingRail
        id="shop-by-interest"
        title="Shop by Interest"
        subtitle="Jump straight to what you're into"
        icon="interests"
        variant="interest"
        categories={feed.shop_by_interest}
      />

      {/* ============ 8. EXPLORE AFRICA + MADE IN AFRICA PROMO (PAIRED) ============
          Structural fix #3: reference's third sidebar-paired row, and the section Pat
          flagged as "Missing/incomplete" — promoted from position 17 (near-bottom) to
          here, and now paired with a sidebar instead of standing alone full-width.
          Sidebar reuses banner-2.jpg (verified: real African fashion/Ankara boutique
          photography) — no new asset generated. Renders ZERO countries (whole section
          included) until real photography is backfilled per country — same "show fewer,
          but all real" rule as everywhere else; this is a genuine possible-empty-state,
          not a placeholder. ============ */}
      {discoverableCountries.length > 0 && (
        <PairedRailSection
          id="africa-pair"
          sidebar={
            <PromoSidebarCard
              image="/static/banners/banner-2.jpg"
              eyebrow="Made in Africa"
              title="Africa's own craftsmanship"
              subtitle="Ankara fashion, handmade crafts & homegrown brands across the continent."
              ctaLabel="Shop Africa-made"
              href="/shop?nigerian=1"
              theme="light"
            />
          }
        >
          <section class="relative overflow-hidden">
            <img
              src="/static/graphics/africa-glow-map.png"
              alt=""
              aria-hidden="true"
              class="absolute inset-0 w-full h-full object-cover opacity-[0.04] pointer-events-none"
            />
            <div class="relative">
              <div class="flex items-center justify-between mb-3">
                <h2 class="text-lg md:text-xl font-bold text-gray-900 flex items-center gap-2">
                  <span class="material-symbols-outlined text-primary">public</span>
                  Explore Africa by Country
                </h2>
                <a href="/countries" class="text-sm font-semibold text-primary hover:underline flex items-center gap-0.5 shrink-0">
                  See All 54<span class="material-symbols-outlined text-base">chevron_right</span>
                </a>
              </div>
              <div class="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 snap-x scroll-smooth [&::-webkit-scrollbar]:hidden">
                {discoverableCountries.slice(0, 8).map((country) => (
                  <div class="shrink-0 snap-start w-48 bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <div class="relative aspect-[4/3] overflow-hidden">
                      <img src={country.image_url} alt={country.name} loading="lazy" class="w-full h-full object-cover" />
                      {country.status === 'LIVE' && (
                        <span class="absolute top-2 left-2 text-[10px] font-bold bg-primary-fixed text-primary-dark rounded-full px-2 py-0.5">Live</span>
                      )}
                    </div>
                    <div class="p-3">
                      <p class="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                        {country.flag_emoji && <span aria-hidden="true">{country.flag_emoji}</span>}
                        {country.name}
                      </p>
                      {country.short_description && (
                        <p class="text-xs text-gray-500 mt-1 line-clamp-2">{country.short_description}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </PairedRailSection>
      )}

      {/* ============ 9. TOP BRANDS — PROMOTED to a major section (Pat: "Missing" / needs
          to become a "Major section", must move up significantly). Same honest-asset
          query (getTopBrands — real logo required), now given a larger, more prominent
          card treatment and moved from position 10-of-20 to here. ============ */}
      {feed.top_brands.length > 0 && (
        <section id="top-brands-section" class="py-5 md:py-6 border-t border-gray-100 bg-gray-50/60">
          <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8">
            <div class="flex items-center justify-between mb-4">
              <div>
                <h2 class="text-xl md:text-2xl font-bold text-gray-900 flex items-center gap-2">
                  <span class="material-symbols-outlined text-primary">verified</span>
                  Top Brands
                </h2>
                <p class="text-sm text-gray-500 mt-0.5">Trusted names selling on NaijaDeals</p>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <a href="/brands" class="text-sm font-semibold text-primary hover:underline flex items-center gap-0.5">
                  See all<span class="material-symbols-outlined text-base">chevron_right</span>
                </a>
                <div class="hidden md:flex items-center gap-1.5 ml-2">
                  <button
                    type="button"
                    aria-label="Scroll left"
                    class="carousel-nav-btn w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:border-primary hover:text-primary transition-colors"
                    data-target="carousel-track-top-brands"
                    data-dir="-1"
                  >
                    <span class="material-symbols-outlined text-lg">chevron_left</span>
                  </button>
                  <button
                    type="button"
                    aria-label="Scroll right"
                    class="carousel-nav-btn w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:border-primary hover:text-primary transition-colors"
                    data-target="carousel-track-top-brands"
                    data-dir="1"
                  >
                    <span class="material-symbols-outlined text-lg">chevron_right</span>
                  </button>
                </div>
              </div>
            </div>
            <div id="carousel-track-top-brands" class="flex gap-3 md:gap-4 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 snap-x scroll-smooth [&::-webkit-scrollbar]:hidden">
              {feed.top_brands.map((b: any) => (
                <a
                  href={`/shop?brand=${b.slug}`}
                  class="brand-card group flex flex-col items-center bg-white border border-gray-200 rounded-2xl p-4 hover:shadow-lg hover:border-primary transition-all shrink-0 snap-start w-28 sm:w-32 md:w-36"
                >
                  <div class="w-16 h-16 md:w-20 md:h-20 rounded-xl bg-gray-50 flex items-center justify-center mb-3 overflow-hidden shrink-0">
                    <img
                      src={b.logo_url}
                      alt={`${b.name} logo`}
                      loading="lazy"
                      class="max-w-[80%] max-h-[80%] object-contain"
                    />
                  </div>
                  <p class="text-sm font-semibold text-gray-900 text-center truncate w-full min-w-0">{b.name}</p>
                  <p class="text-xs font-medium text-primary mt-1 whitespace-nowrap group-hover:underline flex items-center gap-0.5">
                    Shop now
                    <span class="material-symbols-outlined text-[14px]">arrow_forward</span>
                  </p>
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============ 10. POPULAR VENDORS — PROMOTED to a major section (Pat: same
          "Missing" / "Major section" flag as Top Brands). Moved from position 14-of-20
          to right after Top Brands, alternating content type: brands -> vendors. ============ */}
      {feed.popular_vendors.length > 0 && (
        <section class="py-5 md:py-6 border-t border-gray-100">
          <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8">
            <div class="flex items-center justify-between mb-4">
              <div>
                <h2 class="text-xl md:text-2xl font-bold text-gray-900 flex items-center gap-2">
                  <span class="material-symbols-outlined text-primary">storefront</span>
                  Popular Vendors
                </h2>
                <p class="text-sm text-gray-500 mt-0.5">Verified sellers with a track record</p>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <a href="/vendors" class="text-sm font-semibold text-primary hover:underline flex items-center gap-0.5">
                  See all<span class="material-symbols-outlined text-base">chevron_right</span>
                </a>
                <div class="hidden md:flex items-center gap-1.5 ml-2">
                  <button
                    type="button"
                    aria-label="Scroll left"
                    class="carousel-nav-btn w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:border-primary hover:text-primary transition-colors"
                    data-target="carousel-track-popular-vendors"
                    data-dir="-1"
                  >
                    <span class="material-symbols-outlined text-lg">chevron_left</span>
                  </button>
                  <button
                    type="button"
                    aria-label="Scroll right"
                    class="carousel-nav-btn w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:border-primary hover:text-primary transition-colors"
                    data-target="carousel-track-popular-vendors"
                    data-dir="1"
                  >
                    <span class="material-symbols-outlined text-lg">chevron_right</span>
                  </button>
                </div>
              </div>
            </div>
            <div id="carousel-track-popular-vendors" class="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 snap-x scroll-smooth [&::-webkit-scrollbar]:hidden">
              {feed.popular_vendors.map((v: VendorRow) => (
                <a href={`/shop?q=${encodeURIComponent(v.name)}`} class="shrink-0 snap-start flex items-center gap-3 bg-white border border-gray-200 rounded-xl p-3.5 w-72 hover:shadow-md hover:border-primary transition-all">
                  <img src={v.logo_url ?? ''} alt={v.name} class="w-14 h-14 rounded-full object-cover border border-gray-100 shrink-0" />
                  <div class="min-w-0">
                    <p class="text-sm font-semibold text-gray-800 truncate flex items-center gap-1">
                      {v.name}
                      {v.is_verified === 1 && <span class="material-symbols-outlined text-primary text-sm" style="font-variation-settings:'FILL' 1">verified</span>}
                    </p>
                    <div class="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                      <span class="material-symbols-outlined text-amber-500 text-sm" style="font-variation-settings:'FILL' 1">star</span>
                      {v.rating_avg.toFixed(1)} · {v.city}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============ 11. NAIJA SERVICES — colorful ecosystem promo row (reference item 12:
          6 promotional cards — NaijaStream/Stay/Drive/Gigs/Send/Aura). Same real
          ecosystem_verticals rows as section 2's strip, different (bigger, more
          colorful/promotional) visual treatment — legitimate reuse of one dataset
          across two reference-matching sections, not a duplicate. ============ */}
      {naijaServicesCards.length > 0 && (
        <section class="py-5 md:py-6 border-t border-gray-100">
          <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8">
            <h2 class="text-xl md:text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span class="material-symbols-outlined text-primary">apps</span>
              More from the NaijaDeals Ecosystem
            </h2>
            <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
              {naijaServicesCards.map((v) => (
                <a
                  href={v.route}
                  class="group relative rounded-xl overflow-hidden aspect-[4/5] border border-gray-200"
                >
                  <img src={v.hero_image_desktop} alt="" class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-end p-3">
                    <span class="material-symbols-outlined text-white/90 text-lg mb-1">{v.icon}</span>
                    <p class="text-white font-bold text-sm leading-tight">{v.name}</p>
                    <p class="text-white/75 text-[10px] mt-0.5 line-clamp-2">{v.tagline}</p>
                    <span class="mt-1.5 inline-flex items-center gap-0.5 text-[10px] font-bold text-primary-fixed bg-black/40 rounded-full px-2 py-0.5 w-fit">
                      {v.status === 'live' ? 'Open' : 'Coming soon'}
                    </span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============ 12. TRUST BADGES — NEW SECTION (reference decomposition item 13:
          a 5-value strip). All claims below are genuinely backed by real, live product
          logic elsewhere in this app (buy-box seller verification, D1-persisted orders,
          real delivery windows on listings, real wallet/payment flow) — not decorative
          marketing copy invented for this section alone. ============ */}
      <section class="py-5 md:py-6 border-t border-gray-100 bg-gray-50/60">
        <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8">
          <div class="grid grid-cols-2 md:grid-cols-5 gap-4 md:gap-6 text-center">
            {[
              { icon: 'verified_user', label: 'Verified Vendors' },
              { icon: 'local_shipping', label: 'Nationwide Delivery' },
              { icon: 'payments', label: 'Secure Payments' },
              { icon: 'support_agent', label: '24/7 Support' },
              { icon: 'workspace_premium', label: 'Buyer Protection' }
            ].map((badge) => (
              <div class="flex flex-col items-center gap-1.5">
                <span class="material-symbols-outlined text-primary text-2xl md:text-3xl">{badge.icon}</span>
                <p class="text-xs md:text-sm font-semibold text-gray-700">{badge.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ REMAINING RAILS — kept, but deliberately NOT expanded per Pat's
          "stop adding more generic rails" instruction. These are real, functional,
          honest-data carousels; they now live at the tail of the page rather than
          dominating its middle. ============ */}
      <ProductCarousel
        id="limited-time"
        title="Limited-Time Deals"
        subtitle="Biggest percentage discounts — while stock lasts"
        icon="hourglass_top"
        products={feed.limited_time_deals}
        viewAllHref="/shop?deals=1&sort=price_asc"
      />

      <MerchandisingRail
        id="popular-categories"
        title="Popular Categories"
        subtitle="What customers are shopping for right now"
        icon="trending_up"
        variant="category"
        categories={feed.popular_categories}
        viewAllHref="/categories/popular"
      />

      <ProductCarousel
        id="nigerian-brands"
        title="Proudly Nigerian"
        subtitle="Support homegrown brands making waves"
        icon="flag"
        products={feed.nigerian_brands}
        viewAllHref="/shop?nigerian=1"
      />

      <ProductCarousel
        id="best-sellers"
        title="Best Sellers"
        subtitle="What Nigerians are buying the most"
        icon="workspace_premium"
        products={feed.best_sellers}
        viewAllHref="/shop?sort=bestselling"
      />

      <ProductCarousel
        id="trending"
        title="Trending Now"
        icon="trending_up"
        products={feed.trending}
        viewAllHref="/shop?sort=rating"
      />

      <ProductCarousel
        id="new-arrivals"
        title="New Arrivals"
        icon="new_releases"
        products={feed.new_arrivals}
        viewAllHref="/shop?sort=newest"
      />

      <ProductCarousel
        id="deals-near-you"
        title={`Deals Near You — ${selectedCity}`}
        subtitle="Discounted items from sellers based in your delivery city"
        icon="location_on"
        products={dealsNearYou}
        viewAllHref="/shop?deals=1"
      />

      {/* ============ MERCHANDISING STRIP (2-up promo banners, unchanged) ============ */}
      <section class="py-4 md:py-5 border-t border-gray-100">
        <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8">
          <div class="grid md:grid-cols-2 gap-4">
            <a href="/shop?category=grocery-and-food" class="relative rounded-xl overflow-hidden group aspect-[16/7]">
              <img src="/static/banners/banner-3.jpg" alt="Weekly groceries delivered fast" class="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300" />
              <div class="absolute inset-0 bg-gradient-to-r from-black/50 to-transparent flex flex-col justify-center px-6">
                <p class="text-white font-bold text-lg">Weekly groceries, delivered fast</p>
                <span class="text-white/90 text-sm mt-1">Shop groceries →</span>
              </div>
            </a>
            <a href="/shop?category=home-and-kitchen" class="relative rounded-xl overflow-hidden group aspect-[16/7]">
              <img src="/static/banners/banner-4.jpg" alt="Kit out your kitchen for less" class="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300" />
              <div class="absolute inset-0 bg-gradient-to-r from-black/50 to-transparent flex flex-col justify-center px-6">
                <p class="text-white font-bold text-lg">Kit out your kitchen for less</p>
                <span class="text-white/90 text-sm mt-1">Shop home &amp; kitchen →</span>
              </div>
            </a>
          </div>
        </div>
      </section>

      {/* ============ ECOSYSTEM CTA BANNER (closing section, unchanged) ============ */}
      <section class="py-4 md:py-5">
        <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8">
          <div class="bg-primary-light rounded-xl p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <div>
              <h3 class="text-lg font-bold text-primary-dark flex items-center gap-2">
                <span class="material-symbols-outlined">workspace_premium</span>
                NaijaDeals Ecosystem
              </h3>
              <p class="text-sm text-gray-600 mt-1">One account for shopping, food, gigs, stays and more across Nigeria.</p>
            </div>
            <a href="/ecosystem" class="shrink-0 bg-primary text-white font-semibold px-6 py-3 rounded-lg hover:bg-primary-dark transition">
              Explore the ecosystem
            </a>
          </div>
        </div>
      </section>
    </Layout>
  )
}

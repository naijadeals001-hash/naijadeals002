import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { Layout } from '../components/Layout'
import { ProductCarousel } from '../components/ProductCard'
import { HeroZone } from '../components/HeroZone'
import { EcosystemWaitlistModal } from '../components/EcosystemWaitlistModal'
import { MerchandisingRail } from '../components/MerchandisingRail'
import {
  getDealsNearYou
} from '../lib/catalog'
import { getHomepageFeed } from '../lib/homepage-feed'
import { getAllVerticals } from '../lib/ecosystem-verticals'
import { getDiscoverableCountries } from '../lib/country'
import { getPersonalizationSnapshot } from '../lib/personalization'
import type { AppEnv, VendorRow } from '../types'

/**
 * Homepage — full long-form Amazon/Jumia-style marketplace feed.
 * All catalog sections are buy-box aware (each card shows the PRIMARY listing's
 * price/seller via ProductWithListingRow — see src/lib/catalog.ts). The 11 same-for-
 * everyone sections come from the TTL cache (getHomepageFeed); "Deals Near You" is
 * visitor-specific (depends on the chosen delivery city) so it's queried live here,
 * outside the cache, per the rule documented in homepage-feed.ts.
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
    // Checkpoint A (hero rebuild): real account data for the hero's Zone 3
    // personalization card — reuses the SAME wallet/wishlist/orders
    // primitives every other authenticated page already reads (see
    // src/lib/personalization.ts). Logged-out visitors get null (HeroZone
    // renders the non-personalized "Join NaijaDeals" card instead) — never
    // a guessed/fabricated snapshot.
    user ? getPersonalizationSnapshot(db, user.id) : Promise.resolve(null)
  ])

  // Ecosystem Spotlight (section 17 below) is now ARCHITECTED for the full ecosystem,
  // not a curated 3-of-8 subset (Pat's directive, 2026-09-15): NaijaShop (the one LIVE
  // vertical — not a DB row, see ecosystem.tsx's identical precedent) is synthesized as
  // card #1, followed by ALL rows from ecosystem_verticals (currently 8, giving 9 cards
  // total). Adding a 10th+ vertical later is purely a new INSERT into ecosystem_verticals
  // (migration 0010) — zero code change here, because this reads the full table, not a
  // hardcoded slug allowlist like the previous version of this section did.
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

  return c.render(
    <Layout title="Home" user={user} selectedCity={selectedCity} locale={locale}>
      {/* ============ 1. HERO — 3-ZONE COMPOSITION (Checkpoint A rebuild) ============
          <HeroZone> replaces the old 5-panel HeroCarousel grid. Structural fix per Pat's
          "APPROVED DIRECTION" directive: primary rotating campaign (~65%) + static app-promo
          panel (~20%) + real-data personalization card (~15%), matching the reference's
          3-zone hero instead of a flat N-panel mosaic. Same feed.hero_campaigns DB-driven
          data (10+ campaigns rotate through the ONE primary slot — never padded to N panels).
          Mobile falls back to the same single-campaign swipeable carousel as before, plus a
          compact 2-up app/personalization strip so those zones aren't simply absent on mobile.
          <EcosystemWaitlistModal> is mounted once here so the hero's "Join the waitlist" CTA
          is a real, functional trigger — not a decorative dead link. */}
      <section class="bg-white border-b border-gray-100">
        <div class="max-w-[80rem] mx-auto px-3 md:px-6 lg:px-8 py-3 md:py-5">
          <HeroZone campaigns={feed.hero_campaigns} user={user} personalization={personalization} />
        </div>
      </section>
      <EcosystemWaitlistModal />

      {/* ============ 2. ECOSYSTEM STRIP — repositioned immediately below Hero, compact
          treatment (Checkpoint B item 6, Pat's "NO SHORTCUTS" directive). Was section 17
          (near page bottom) as a large 16:9 photo-card block; now uses the SAME
          MerchandisingRail chrome as every other rail (real photography retained per
          "the photography is our enhancement," but at rail-card scale — vertical name +
          one-line description + compact CTA — not plain icon pills, not the old large
          block). NaijaShop (the one LIVE vertical, synthesized since it isn't an
          ecosystem_verticals row) + all ecosystem_verticals rows = 9 cards today; adding
          a 10th+ vertical is a pure INSERT, zero code change here. ============ */}
      <MerchandisingRail
        id="ecosystem"
        title="Explore the NaijaDeals Ecosystem"
        icon="hub"
        variant="ecosystem"
        ecosystemCards={spotlightVerticals}
      />

      {/* ============ 3. SHOP BY CATEGORY — curated MerchandisingRail (Checkpoint B item 2).
          Replaces the old 10-column icon grid. Dataset: is_featured_home=1 categories,
          ordered by homepage_priority ASC (migration 0056), each with REAL premium
          photography (migration 0057) — no icons, no placeholders, no empty cards.
          Genuinely different dataset from Popular Categories below (curated vs. live
          product-count ranking) even though a few slugs may overlap. ============ */}
      <MerchandisingRail
        id="shop-by-category"
        title="Shop by Category"
        subtitle="Curated departments across the NaijaDeals marketplace"
        icon="category"
        variant="category"
        categories={feed.shop_by_category}
        viewAllHref="/categories"
      />

      {/* ============ 3. FLASH DEALS ============ */}
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

      {/* ============ 4. TODAY'S DEALS ============ */}
      <ProductCarousel
        id="todays-deals"
        title="Today's Deals"
        subtitle="Hand-picked discounts refreshed daily"
        icon="local_offer"
        products={feed.todays_deals}
        viewAllHref="/shop?deals=1"
      />

      {/* ============ 5. LIMITED-TIME DEALS ============ */}
      <ProductCarousel
        id="limited-time"
        title="Limited-Time Deals"
        subtitle="Biggest percentage discounts — while stock lasts"
        icon="hourglass_top"
        products={feed.limited_time_deals}
        viewAllHref="/shop?deals=1&sort=price_asc"
      />

      {/* ============ 6. RECOMMENDED FOR YOU ============ */}
      <ProductCarousel
        id="recommended"
        title="Recommended for You"
        subtitle="Top-rated picks across NaijaShop"
        icon="recommend"
        products={feed.recommended}
        viewAllHref="/shop?sort=rating"
      />

      {/* ============ 7. POPULAR CATEGORIES — MerchandisingRail (Checkpoint B item 3).
          Replaces the old icon+text grid. Dataset: getPopularCategories()'s existing
          product_count-DESC ranking (live activity signal, unchanged query logic) now
          with a real-image filter added (catalog.ts) so every card has dominant real
          photography — same rail chrome as Shop by Category, different dataset,
          verified NOT identical by default (only 6/22 curated slugs overlap with the
          top-by-count set). ============ */}
      <MerchandisingRail
        id="popular-categories"
        title="Popular Categories"
        subtitle="What customers are shopping for right now"
        icon="trending_up"
        variant="category"
        categories={feed.popular_categories}
        viewAllHref="/categories/popular"
      />

      {/* ============ 8. TOP BRANDS ============ */}
      {feed.top_brands.length > 0 && (
        <section id="top-brands-section" class="py-4 md:py-5 border-t border-gray-100">
          <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8">
            <h2 class="text-lg md:text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span class="material-symbols-outlined text-primary">verified</span>
              Top Brands
            </h2>
            <div class="grid grid-cols-3 sm:grid-cols-4 md:flex md:overflow-x-auto gap-3 md:gap-4 pb-2 md:-mx-4 md:px-4 lg:mx-0 lg:px-0 snap-x scroll-smooth [&::-webkit-scrollbar]:hidden">
              {feed.top_brands.map((b: any) => (
                <a
                  href={`/shop?brand=${b.slug}`}
                  class="brand-card group md:shrink-0 md:snap-start min-w-0 flex flex-col items-center bg-white border border-gray-200 rounded-2xl p-4 md:p-5 md:w-40 hover:shadow-lg hover:border-primary transition-all"
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

      {/* ============ 9. NIGERIAN BRANDS ============ */}
      <ProductCarousel
        id="nigerian-brands"
        title="Proudly Nigerian"
        subtitle="Support homegrown brands making waves"
        icon="flag"
        products={feed.nigerian_brands}
        viewAllHref="/shop?nigerian=1"
      />

      {/* ============ 10. BEST SELLERS ============ */}
      <ProductCarousel
        id="best-sellers"
        title="Best Sellers"
        subtitle="What Nigerians are buying the most"
        icon="workspace_premium"
        products={feed.best_sellers}
        viewAllHref="/shop?sort=bestselling"
      />

      {/* ============ 11. TRENDING NOW ============ */}
      <ProductCarousel
        id="trending"
        title="Trending Now"
        icon="trending_up"
        products={feed.trending}
        viewAllHref="/shop?sort=rating"
      />

      {/* ============ 12. NEW ARRIVALS ============ */}
      <ProductCarousel
        id="new-arrivals"
        title="New Arrivals"
        icon="new_releases"
        products={feed.new_arrivals}
        viewAllHref="/shop?sort=newest"
      />

      {/* ============ 13. DEALS NEAR YOU (live, city-aware) ============ */}
      <ProductCarousel
        id="deals-near-you"
        title={`Deals Near You — ${selectedCity}`}
        subtitle="Discounted items from sellers based in your delivery city"
        icon="location_on"
        products={dealsNearYou}
        viewAllHref="/shop?deals=1"
      />

      {/* ============ 14. POPULAR VENDORS ============ */}
      {feed.popular_vendors.length > 0 && (
        <section class="py-4 md:py-5 border-t border-gray-100">
          <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8">
            <h2 class="text-lg md:text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span class="material-symbols-outlined text-primary">storefront</span>
              Popular Vendors
            </h2>
            <div class="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 snap-x scroll-smooth [&::-webkit-scrollbar]:hidden">
              {feed.popular_vendors.map((v: VendorRow) => (
                <a href={`/shop?q=${encodeURIComponent(v.name)}`} class="shrink-0 snap-start flex items-center gap-3 bg-white border border-gray-200 rounded-xl p-3 w-64 hover:shadow-md hover:border-primary transition-all">
                  <img src={v.logo_url ?? ''} alt={v.name} class="w-12 h-12 rounded-full object-cover border border-gray-100 shrink-0" />
                  <div class="min-w-0">
                    <p class="text-sm font-semibold text-gray-800 truncate flex items-center gap-1">
                      {v.name}
                      {v.is_verified === 1 && <span class="material-symbols-outlined text-primary text-sm" style="font-variation-settings:'FILL' 1">verified</span>}
                    </p>
                    <div class="flex items-center gap-1 text-xs text-gray-500">
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

      {/* ============ 15. RECENTLY VIEWED (client-hydrated, hidden until populated) ============ */}
      <section id="recently-viewed-section" class="py-4 md:py-5 border-t border-gray-100 hidden">
        <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8">
          <h2 class="text-lg md:text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
            <span class="material-symbols-outlined text-primary">history</span>
            Recently Viewed
          </h2>
          <div class="rv-track flex gap-3 md:gap-4 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 snap-x scroll-smooth [&::-webkit-scrollbar]:hidden"></div>
        </div>
      </section>

      {/* ============ 16. MERCHANDISING STRIP ============ */}
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

      {/* ============ 17. COUNTRY DISCOVERY (Pat's "All 54 African Countries" directive, 2026-09-15) ============
          NOTE: the Ecosystem Spotlight that used to live here was REPOSITIONED to
          immediately below the Hero (section 2 above) per Checkpoint B item 6 — it is
          intentionally not duplicated in this location. 
          Database-driven, NOT 54 hardcoded cards — see getDiscoverableCountries() in
          src/lib/country.ts and migration 0054_country_discovery.sql. Renders ZERO
          countries until real photography is sourced/backfilled into cc_countries.image_url
          (never /ph.svg) — "show fewer, but all real," same pattern as every other section
          fixed in this audit. All 54 African UN-member states already have a DB row the
          moment migration 0054 runs; how many actually appear here is purely a function of
          how many have had a real image backfilled — zero code change needed as that count
          grows from 0 toward 54. The africa-glow-map.png backdrop is reused from its
          existing approved asset (public/static/graphics/), never regenerated. */}
      {discoverableCountries.length > 0 && (
        <section class="py-4 md:py-5 border-t border-gray-100 relative overflow-hidden">
          <img
            src="/static/graphics/africa-glow-map.png"
            alt=""
            aria-hidden="true"
            class="absolute inset-0 w-full h-full object-cover opacity-[0.04] pointer-events-none"
          />
          <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8 relative">
            <h2 class="text-lg md:text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span class="material-symbols-outlined text-primary">public</span>
              Discover Africa on NaijaDeals
            </h2>
            <div class="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 snap-x scroll-smooth [&::-webkit-scrollbar]:hidden">
              {discoverableCountries.map((country) => (
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
      )}

      {/* ============ 18. ECOSYSTEM CTA BANNER ============ */}
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

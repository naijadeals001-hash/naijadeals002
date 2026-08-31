import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { Layout } from '../components/Layout'
import { ProductCarousel } from '../components/ProductCard'
import {
  getTopLevelCategories,
  getDealsNearYou
} from '../lib/catalog'
import { getHomepageFeed } from '../lib/homepage-feed'
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
  const selectedCity = getCookie(c, 'nd_city') || 'Lagos'

  const [categories, feed, dealsNearYou] = await Promise.all([
    getTopLevelCategories(db),
    getHomepageFeed(db),
    getDealsNearYou(db, selectedCity, 10)
  ])

  return c.render(
    <Layout title="Home" user={user} selectedCity={selectedCity}>
      {/* ============ 1. HERO — 3-panel promo grid ============ */}
      <section class="bg-white border-b border-gray-100">
        <div class="max-w-[100rem] mx-auto px-3 md:px-6 lg:px-8 py-3 md:py-5">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
            <a href="/shop?category=electronics&deals=1" class="col-span-2 md:col-span-2 row-span-2 relative rounded-xl overflow-hidden group aspect-[16/9] md:aspect-auto md:h-full">
              <img src="/static/banners/banner-1.jpg" alt="Electronics mega sale, up to 50% off laptops and phones" class="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300" />
            </a>
            <a href="/shop?category=fashion" class="relative rounded-xl overflow-hidden group aspect-square">
              <img src="/static/banners/banner-2.jpg" alt="Fashion collection, Ankara prints and accessories" class="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300" />
            </a>
            <a href="/shop?category=home-kitchen" class="relative rounded-xl overflow-hidden group aspect-square">
              <img src="/static/banners/banner-4.jpg" alt="Home and kitchen appliances" class="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300" />
            </a>
            <a href="/shop?category=groceries" class="relative rounded-xl overflow-hidden group aspect-square">
              <img src="/static/banners/banner-3.jpg" alt="Groceries delivered to your doorstep" class="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300" />
            </a>
            <a href="/ecosystem" class="relative rounded-xl overflow-hidden group aspect-square">
              <img src="/static/banners/banner-5.jpg" alt="NaijaSend nationwide delivery riders" class="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300" />
              <span class="absolute bottom-0 inset-x-0 bg-black/50 text-white text-xs font-semibold px-3 py-1.5">Explore the ecosystem →</span>
            </a>
          </div>
        </div>
      </section>

      {/* ============ 2. SHOP BY CATEGORY ============ */}
      <section class="py-6 md:py-8 border-t border-gray-100">
        <div class="max-w-[100rem] mx-auto px-4 md:px-6 lg:px-8">
          <h2 class="text-lg md:text-xl font-bold text-gray-900 mb-4">Shop by Category</h2>
          <div class="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-10 gap-3">
            {categories.map((cat) => (
              <a
                href={`/shop?category=${cat.slug}`}
                class="flex flex-col items-center justify-center gap-2 bg-white border border-gray-200 rounded-xl p-3 md:p-4 hover:shadow-md hover:border-primary transition-all"
              >
                <span class="material-symbols-outlined text-2xl md:text-3xl text-primary">{cat.icon}</span>
                <span class="text-[11px] md:text-xs font-medium text-gray-700 text-center leading-tight">{cat.name}</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ============ 3. FLASH DEALS ============ */}
      {feed.flash_deals.length > 0 && (
        <section class="py-6 md:py-8 border-t border-gray-100">
          <div class="max-w-[100rem] mx-auto px-4 md:px-6 lg:px-8">
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

      {/* ============ 7. POPULAR CATEGORIES ============ */}
      {feed.popular_categories.length > 0 && (
        <section class="py-6 md:py-8 border-t border-gray-100">
          <div class="max-w-[100rem] mx-auto px-4 md:px-6 lg:px-8">
            <h2 class="text-lg md:text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span class="material-symbols-outlined text-primary">grid_view</span>
              Popular Categories
            </h2>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {feed.popular_categories.map((cat: any) => (
                <a href={`/shop?category=${cat.slug}`} class="flex items-center gap-3 bg-white border border-gray-200 rounded-xl p-3 hover:shadow-md hover:border-primary transition-all">
                  <span class="material-symbols-outlined text-2xl text-primary shrink-0">{cat.icon}</span>
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-gray-800 truncate">{cat.name}</p>
                    <p class="text-xs text-gray-500">{cat.product_count} products</p>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============ 8. TOP BRANDS ============ */}
      {feed.top_brands.length > 0 && (
        <section id="top-brands-section" class="py-6 md:py-8 border-t border-gray-100">
          <div class="max-w-[100rem] mx-auto px-4 md:px-6 lg:px-8">
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
        <section class="py-6 md:py-8 border-t border-gray-100">
          <div class="max-w-[100rem] mx-auto px-4 md:px-6 lg:px-8">
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
      <section id="recently-viewed-section" class="py-6 md:py-8 border-t border-gray-100 hidden">
        <div class="max-w-[100rem] mx-auto px-4 md:px-6 lg:px-8">
          <h2 class="text-lg md:text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
            <span class="material-symbols-outlined text-primary">history</span>
            Recently Viewed
          </h2>
          <div class="rv-track flex gap-3 md:gap-4 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 snap-x scroll-smooth [&::-webkit-scrollbar]:hidden"></div>
        </div>
      </section>

      {/* ============ 16. MERCHANDISING STRIP ============ */}
      <section class="py-6 md:py-8 border-t border-gray-100">
        <div class="max-w-[100rem] mx-auto px-4 md:px-6 lg:px-8">
          <div class="grid md:grid-cols-2 gap-4">
            <a href="/shop?category=groceries" class="relative rounded-xl overflow-hidden group aspect-[16/7]">
              <img src="/static/banners/banner-3.jpg" alt="Weekly groceries delivered fast" class="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300" />
              <div class="absolute inset-0 bg-gradient-to-r from-black/50 to-transparent flex flex-col justify-center px-6">
                <p class="text-white font-bold text-lg">Weekly groceries, delivered fast</p>
                <span class="text-white/90 text-sm mt-1">Shop groceries →</span>
              </div>
            </a>
            <a href="/shop?category=home-kitchen" class="relative rounded-xl overflow-hidden group aspect-[16/7]">
              <img src="/static/banners/banner-4.jpg" alt="Kit out your kitchen for less" class="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300" />
              <div class="absolute inset-0 bg-gradient-to-r from-black/50 to-transparent flex flex-col justify-center px-6">
                <p class="text-white font-bold text-lg">Kit out your kitchen for less</p>
                <span class="text-white/90 text-sm mt-1">Shop home &amp; kitchen →</span>
              </div>
            </a>
          </div>
        </div>
      </section>

      {/* ============ 17. ECOSYSTEM SPOTLIGHT ============ */}
      <section class="py-6 md:py-8 border-t border-gray-100">
        <div class="max-w-[100rem] mx-auto px-4 md:px-6 lg:px-8">
          <h2 class="text-lg md:text-xl font-bold text-gray-900 mb-4">Explore More of the NaijaDeals Ecosystem</h2>
          <div class="grid md:grid-cols-3 gap-4">
            {[
              { name: 'NaijaEats', desc: 'Order from local restaurants and get hot meals delivered straight to your door.', cta: 'Order food', icon: 'restaurant' },
              { name: 'NaijaGigs', desc: 'Book trusted local professionals for home repairs, design work, tutoring and more.', cta: 'Book a service', icon: 'engineering' },
              { name: 'NaijaStay', desc: 'Find and book apartments, rooms and short-let stays anywhere in the country.', cta: 'Find a stay', icon: 'apartment' }
            ].map((item) => (
              <div class="bg-white border border-gray-200 rounded-xl p-6 flex flex-col">
                <span class="material-symbols-outlined text-4xl text-primary mb-3">{item.icon}</span>
                <h3 class="font-bold text-gray-800 mb-1">{item.name}</h3>
                <p class="text-sm text-gray-500 mb-4 flex-1">{item.desc}</p>
                <a href="/ecosystem" class="text-sm font-semibold text-primary hover:underline">{item.cta} →</a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ 18. ECOSYSTEM CTA BANNER ============ */}
      <section class="py-6 md:py-8">
        <div class="max-w-[100rem] mx-auto px-4 md:px-6 lg:px-8">
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

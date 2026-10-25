/**
 * NaijaEats — customer-facing pages for the food-delivery vertical
 * (migrations 0078-0081 foundation). This is the FIRST real UI wired to
 * the restaurants/cuisines/dishes/menus schema — before this file, `/eats`
 * only rendered the static ecosystem-preview "coming soon" placeholder
 * (src/pages/ecosystem-preview.tsx), exactly like /fresh and /gigs did
 * before their own real-UI passes.
 *
 * ARCHITECTURE — modeled on fresh.tsx (homepage+browse-in-one-handler,
 * category/cuisine rail) and gigs.tsx (provider-profile-style restaurant
 * page, order-detail status pill + timeline), but NOT a copy-paste of
 * either — NaijaEats has its own dedicated schema and its own dedicated
 * cart/order tables (eats_carts/eats_orders, NOT the product cart/orders
 * tables), so the data layer (src/lib/eats.ts, src/lib/eats-cart.ts) is
 * genuinely new code built in the same style as the proven patterns.
 *
 * Scope lock (Pat's Phase 1 authorization): exactly 8 routes — homepage,
 * restaurants discovery, restaurant profile, item detail, cart, checkout,
 * order detail, account orders — plus loading/empty/error states and a
 * responsive pass. Vendor dashboard, reservations, catering, admin, Aura
 * AI are explicitly NOT built here.
 *
 * `ecosystem_verticals.eats.status` is promoted to 'live' now that this
 * customer ordering surface and its supporting order workflows are functional.
 * The navigation and ecosystem overview therefore present NaijaEats as live.
 */
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { Layout } from '../components/Layout'
import type { AppEnv, RestaurantRow, MenuItemRow } from '../types'
import { formatMoney } from '../lib/money'
import { getOrSetGuestToken } from '../lib/guest'
import { getAddressesForUser, getRegionsForCountry, ADDRESS_SUPPORTED_COUNTRIES } from '../lib/addresses'
import { getWalletBalance } from '../lib/wallet'
import {
  getCuisines,
  getCuisineBySlug,
  getRestaurantBySlug,
  getFeaturedRestaurants,
  browseRestaurants,
  getMenuForRestaurant,
  getMenuItem,
  getOptionGroupsForMenuItem,
  EATS_ORDER_STATUS_LABEL,
} from '../lib/eats'
import {
  getOrCreateEatsCartId,
  getEatsCartItems,
  eatsCartItemLineTotalKobo,
  getOwnedEatsOrder,
  getEatsOrderItems,
  getEatsOrderStatusEvents,
  getEatsOrdersForCustomer,
} from '../lib/eats-cart'

const PER_PAGE = 24

/** A restaurant tile — the shape reused across the homepage rail and the discovery grid. */
function RestaurantCard({ restaurant }: { restaurant: RestaurantRow }) {
  return (
    <a
      href={`/eats/restaurants/${restaurant.slug}`}
      class="bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-md hover:border-primary transition-all block"
      data-restaurant-card
      data-restaurant-slug={restaurant.slug}
    >
      <div class="aspect-[16/9] bg-gray-100 overflow-hidden relative">
        {restaurant.cover_image_url ? (
          <img src={restaurant.cover_image_url} alt={restaurant.name} class="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div class="w-full h-full flex items-center justify-center text-gray-300">
            <span class="material-symbols-outlined text-4xl">restaurant</span>
          </div>
        )}
        {restaurant.verification_status === 'verified' && (
          <span class="absolute top-2 right-2 flex items-center gap-1 text-[10px] font-semibold text-white bg-primary-dark/90 px-2 py-1 rounded-full">
            <span class="material-symbols-outlined text-xs" style="font-variation-settings:'FILL' 1">verified</span>Verified
          </span>
        )}
      </div>
      <div class="p-3">
        <div class="flex items-center gap-2">
          {restaurant.logo_url ? (
            <img src={restaurant.logo_url} alt="" class="w-8 h-8 rounded-full object-cover shrink-0 border border-gray-100" />
          ) : (
            <div class="w-8 h-8 rounded-full bg-primary-light text-primary-dark font-bold text-xs flex items-center justify-center shrink-0">
              {restaurant.name.charAt(0)}
            </div>
          )}
          <p class="text-sm font-semibold text-gray-800 line-clamp-1 flex-1 min-w-0">{restaurant.name}</p>
        </div>
        <p class="text-xs text-gray-500 mt-1.5">{restaurant.cuisine_name} &middot; {restaurant.city}</p>
        <div class="flex items-center justify-between mt-2">
          {restaurant.rating_count > 0 ? (
            <span class="flex items-center gap-1 text-xs text-gray-600">
              <span class="material-symbols-outlined text-amber-500 text-sm" style="font-variation-settings:'FILL' 1">star</span>
              <span class="font-semibold">{restaurant.rating_avg.toFixed(1)}</span>
              <span class="text-gray-400">({restaurant.rating_count})</span>
            </span>
          ) : (
            <span class="text-xs text-gray-400">New</span>
          )}
          <span class="text-xs text-gray-500">{restaurant.avg_prep_minutes} min</span>
        </div>
        <p class="text-[11px] text-gray-400 mt-1">Delivery {formatMoney(restaurant.delivery_fee_kobo, 'NGN')} &middot; Min. order {formatMoney(restaurant.min_order_kobo, 'NGN')}</p>
      </div>
    </a>
  )
}

// ============================================================
// GET /eats — homepage + browse/search-in-one-handler (same convention as
// fresh.tsx / shop.tsx: presence of ?cuisine= or ?q= switches from
// "homepage" mode to "results" mode without a separate route).
// ============================================================
export async function eatsHomePage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')
  const selectedCity = getCookie(c, 'nd_city') || 'Lagos'

  const cuisine = c.req.query('cuisine')
  const q = c.req.query('q')
  const city = c.req.query('city')
  const sort = c.req.query('sort') || undefined
  const page = Math.max(1, Number(c.req.query('page') || '1'))

  const isBrowseMode = !!(cuisine || q || city)
  const cuisines = await getCuisines(db)

  if (isBrowseMode) {
    const result = await browseRestaurants(db, { cuisine, q, city, sort, page, perPage: PER_PAGE })
    const activeCuisineObj = cuisines.find((cu) => cu.slug === cuisine)
    const pageTitle = q ? `Search NaijaEats: ${q}` : activeCuisineObj ? `${activeCuisineObj.name} restaurants` : 'All restaurants'

    function buildQuery(overrides: Record<string, string | undefined>): string {
      const params = new URLSearchParams()
      const current: Record<string, string | undefined> = { cuisine, q, city, sort, page: String(page) }
      const merged = { ...current, ...overrides }
      for (const [k, v] of Object.entries(merged)) {
        if (v !== undefined && v !== '' && !(k === 'page' && v === '1')) params.set(k, v)
      }
      const str = params.toString()
      return str ? `/eats?${str}` : '/eats'
    }

    return c.render(
      <Layout title={`${pageTitle} — NaijaEats`} description="Order food from real restaurants across Nigeria and Africa on NaijaDeals." user={user} locale={locale} selectedCity={selectedCity}>
        <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8 py-6 flex gap-6" id="eats-restaurants-page">
          <aside class="hidden md:block w-56 shrink-0 space-y-6">
            <div>
              <h3 class="font-semibold text-gray-800 mb-3">Cuisines</h3>
              <nav class="flex flex-col gap-1">
                <a href={buildQuery({ cuisine: undefined, page: undefined })} class={`text-sm px-3 py-2 rounded-lg ${!cuisine ? 'bg-primary-light text-primary-dark font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}>
                  All Cuisines
                </a>
                {cuisines.map((cu) => (
                  <a href={buildQuery({ cuisine: cu.slug, page: undefined })} class={`text-sm px-3 py-2 rounded-lg ${cuisine === cu.slug ? 'bg-primary-light text-primary-dark font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}>
                    {cu.name}
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <div>
                <h1 class="text-xl font-bold text-gray-800">{pageTitle}</h1>
                <p class="text-sm text-gray-500">{result.total.toLocaleString('en-NG')} result{result.total === 1 ? '' : 's'}</p>
              </div>
              <form method="get" class="flex items-center gap-2 shrink-0">
                {cuisine && <input type="hidden" name="cuisine" value={cuisine} />}
                {q && <input type="hidden" name="q" value={q} />}
              {city && <input type="hidden" name="city" value={city} />}
                <label class="text-sm text-gray-500 hidden sm:inline">Sort by</label>
                <select name="sort" onchange="this.form.submit()" class="text-sm border border-gray-300 rounded-lg px-3 py-1.5">
                  <option value="rating" selected={sort === 'rating' || !sort}>Top Rated</option>
                  <option value="delivery_fee_asc" selected={sort === 'delivery_fee_asc'}>Lowest Delivery Fee</option>
                  <option value="prep_time" selected={sort === 'prep_time'}>Fastest Prep Time</option>
                </select>
              </form>
            </div>

            <div class="md:hidden flex gap-2 overflow-x-auto pb-3 mb-2 -mx-1 px-1">
              <a href={buildQuery({ cuisine: undefined, page: undefined })} class={`shrink-0 text-xs px-3 py-1.5 rounded-full border ${!cuisine ? 'bg-primary text-white border-primary' : 'border-gray-300 text-gray-600'}`}>All</a>
              {cuisines.map((cu) => (
                <a href={buildQuery({ cuisine: cu.slug, page: undefined })} class={`shrink-0 text-xs px-3 py-1.5 rounded-full border ${cuisine === cu.slug ? 'bg-primary text-white border-primary' : 'border-gray-300 text-gray-600'}`}>{cu.name}</a>
              ))}
            </div>

            <form method="get" class="relative mb-5" id="eats-search-form">
              {cuisine && <input type="hidden" name="cuisine" value={cuisine} />}
              <input type="text" name="q" value={q ?? ''} placeholder="Search restaurants or cuisines..." class="w-full border border-gray-300 rounded-lg pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
              <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg">search</span>
            </form>

            {result.cuisineLookupFailed ? (
              <div class="text-center py-16 bg-white border border-gray-200 rounded-xl text-gray-400" id="eats-empty-state">
                <span class="material-symbols-outlined text-4xl mb-2">search_off</span>
                <p>That cuisine doesn't exist.</p>
                <a href="/eats" class="text-primary font-semibold hover:underline mt-2 inline-block text-sm">Back to NaijaEats</a>
              </div>
            ) : result.restaurants.length === 0 ? (
              <div class="text-center py-16 bg-white border border-gray-200 rounded-xl text-gray-400" id="eats-empty-state">
                <span class="material-symbols-outlined text-4xl mb-2">restaurant</span>
                <p>No restaurants found{q ? ` for "${q}"` : ''}.</p>
                <a href="/eats" class="text-primary font-semibold hover:underline mt-2 inline-block text-sm">Browse all restaurants</a>
              </div>
            ) : (
              <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4" id="eats-restaurants-grid">
                {result.restaurants.map((restaurant) => <RestaurantCard restaurant={restaurant} />)}
              </div>
            )}

            {result.totalPages > 1 && (
              <div class="flex items-center justify-center gap-2 mt-8">
                {page > 1 && <a href={buildQuery({ page: String(page - 1) })} class="text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-300 hover:border-primary">Previous</a>}
                <span class="text-sm text-gray-500">Page {page} of {result.totalPages}</span>
                {page < result.totalPages && <a href={buildQuery({ page: String(page + 1) })} class="text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-300 hover:border-primary">Next</a>}
              </div>
            )}
          </div>
        </div>
      </Layout>
    )
  }

  // ---------- Homepage mode ----------
  const featured = await getFeaturedRestaurants(db, 12)

  return c.render(
    <Layout title="NaijaEats — Order food from real restaurants near you" description="Order food from real restaurants across Nigeria and Africa — Nigerian, Ghanaian, Senegalese, Ivorian and Moroccan cuisine, delivered on NaijaDeals." user={user} locale={locale} selectedCity={selectedCity}>
      <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8 py-6" id="eats-home-page">
        {/* Hero */}
        <section id="eats-hero" class="bg-primary-dark text-white rounded-2xl px-6 py-8 md:px-10 md:py-12 mb-8">
          <span class="inline-flex items-center gap-1.5 text-xs font-semibold bg-white/10 px-2.5 py-1 rounded-full mb-3">
            <span class="material-symbols-outlined text-sm">restaurant</span>NaijaEats
          </span>
          <h1 class="text-2xl md:text-3xl font-bold max-w-xl">Real food, real restaurants, delivered fast.</h1>
          <p class="text-white/70 text-sm mt-2 max-w-lg">Nigerian, Ghanaian, Senegalese, Ivorian and Moroccan kitchens near you — escrow-protected payment, order tracking from kitchen to your door.</p>
          <form method="get" action="/eats" class="mt-5 max-w-md space-y-2" id="eats-destination-search">
            <label class="sr-only" for="eats-city">Delivery destination</label>
            <input id="eats-city" type="text" name="city" value={selectedCity} placeholder="Enter delivery city" class="w-full border-0 rounded-lg px-4 py-3 text-sm text-gray-800 outline-none" />
            <div class="relative">
              <label class="sr-only" for="eats-query">Restaurant or dish</label>
              <input id="eats-query" type="text" name="q" placeholder="Search restaurants or dishes..." class="w-full border-0 rounded-lg pl-10 pr-4 py-3 text-sm text-gray-800 outline-none" />
              <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg">search</span>
            </div>
            <button type="submit" class="w-full rounded-lg bg-white/15 border border-white/20 py-2.5 text-sm font-semibold hover:bg-white/20">Find food near me</button>
          </form>
        </section>

        {/* Cuisine rail */}
        <section id="eats-cuisines" class="mb-10">
          <h2 class="text-lg font-bold text-gray-900 mb-4">Browse by cuisine</h2>
          <div class="grid grid-cols-3 sm:grid-cols-5 gap-3">
            {cuisines.map((cu) => (
              <a href={`/eats?cuisine=${cu.slug}`} class="flex flex-col items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-5 hover:shadow-md hover:border-primary transition-all text-center">
                <span class="w-12 h-12 rounded-full bg-primary-light flex items-center justify-center">
                  <span class="material-symbols-outlined text-primary text-2xl">{cu.icon ?? 'restaurant'}</span>
                </span>
                <span class="text-sm font-semibold text-gray-800">{cu.name}</span>
              </a>
            ))}
          </div>
        </section>

        {/* Featured restaurants */}
        <section id="eats-featured">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-bold text-gray-900">Restaurants near you</h2>
            <a href="/eats/restaurants" class="text-sm text-primary font-semibold hover:underline">See all</a>
          </div>
          {featured.length === 0 ? (
            <div class="text-center py-16 bg-white border border-gray-200 rounded-xl text-gray-400" id="eats-empty-state">
              <span class="material-symbols-outlined text-4xl mb-2">restaurant</span>
              <p>No restaurants available yet.</p>
            </div>
          ) : (
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {featured.map((restaurant) => <RestaurantCard restaurant={restaurant} />)}
            </div>
          )}
        </section>
      </div>
    </Layout>
  )
}

// ============================================================
// GET /eats/restaurants — dedicated discovery/search route (locked scope
// item #2). Reuses the EXACT same browse engine as /eats?cuisine=/?q= —
// no second query path — this route just always starts in browse mode
// (no homepage rails) even with zero query params, matching the "See all"
// link above.
// ============================================================
export async function eatsRestaurantsPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')
  const selectedCity = getCookie(c, 'nd_city') || 'Lagos'

  const cuisine = c.req.query('cuisine')
  const q = c.req.query('q')
  const city = c.req.query('city')
  const sort = c.req.query('sort') || undefined
  const page = Math.max(1, Number(c.req.query('page') || '1'))

  const cuisines = await getCuisines(db)
  const result = await browseRestaurants(db, { cuisine, q, city, sort, page, perPage: PER_PAGE })
  const activeCuisineObj = cuisines.find((cu) => cu.slug === cuisine)
  const pageTitle = q ? `Search NaijaEats: ${q}` : activeCuisineObj ? `${activeCuisineObj.name} restaurants` : 'All restaurants'

  function buildQuery(overrides: Record<string, string | undefined>): string {
    const params = new URLSearchParams()
    const current: Record<string, string | undefined> = { cuisine, q, city, sort, page: String(page) }
    const merged = { ...current, ...overrides }
    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined && v !== '' && !(k === 'page' && v === '1')) params.set(k, v)
    }
    const str = params.toString()
    return str ? `/eats/restaurants?${str}` : '/eats/restaurants'
  }

  return c.render(
    <Layout title={`${pageTitle} — NaijaEats`} description="Browse and search every restaurant available on NaijaEats." user={user} locale={locale} selectedCity={selectedCity}>
      <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8 py-6 flex gap-6" id="eats-restaurants-page">
        <aside class="hidden md:block w-56 shrink-0 space-y-6">
          <div>
            <h3 class="font-semibold text-gray-800 mb-3">Cuisines</h3>
            <nav class="flex flex-col gap-1">
              <a href={buildQuery({ cuisine: undefined, page: undefined })} class={`text-sm px-3 py-2 rounded-lg ${!cuisine ? 'bg-primary-light text-primary-dark font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}>
                All Cuisines
              </a>
              {cuisines.map((cu) => (
                <a href={buildQuery({ cuisine: cu.slug, page: undefined })} class={`text-sm px-3 py-2 rounded-lg ${cuisine === cu.slug ? 'bg-primary-light text-primary-dark font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}>
                  {cu.name}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <div class="flex-1 min-w-0">
          <a href="/eats" class="text-sm text-primary font-medium hover:underline flex items-center gap-1 mb-4">
            <span class="material-symbols-outlined text-base">arrow_back</span>NaijaEats
          </a>
          <div class="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <div>
              <h1 class="text-xl font-bold text-gray-800">{pageTitle}</h1>
              <p class="text-sm text-gray-500">{result.total.toLocaleString('en-NG')} result{result.total === 1 ? '' : 's'}</p>
            </div>
            <form method="get" class="flex items-center gap-2 shrink-0">
              {cuisine && <input type="hidden" name="cuisine" value={cuisine} />}
              {q && <input type="hidden" name="q" value={q} />}
              {city && <input type="hidden" name="city" value={city} />}
              <label class="text-sm text-gray-500 hidden sm:inline">Sort by</label>
              <select name="sort" onchange="this.form.submit()" class="text-sm border border-gray-300 rounded-lg px-3 py-1.5">
                <option value="rating" selected={sort === 'rating' || !sort}>Top Rated</option>
                <option value="delivery_fee_asc" selected={sort === 'delivery_fee_asc'}>Lowest Delivery Fee</option>
                <option value="prep_time" selected={sort === 'prep_time'}>Fastest Prep Time</option>
              </select>
            </form>
          </div>

          <div class="md:hidden flex gap-2 overflow-x-auto pb-3 mb-2 -mx-1 px-1">
            <a href={buildQuery({ cuisine: undefined, page: undefined })} class={`shrink-0 text-xs px-3 py-1.5 rounded-full border ${!cuisine ? 'bg-primary text-white border-primary' : 'border-gray-300 text-gray-600'}`}>All</a>
            {cuisines.map((cu) => (
              <a href={buildQuery({ cuisine: cu.slug, page: undefined })} class={`shrink-0 text-xs px-3 py-1.5 rounded-full border ${cuisine === cu.slug ? 'bg-primary text-white border-primary' : 'border-gray-300 text-gray-600'}`}>{cu.name}</a>
            ))}
          </div>

          <form method="get" class="relative mb-5" id="eats-search-form">
            {cuisine && <input type="hidden" name="cuisine" value={cuisine} />}
            <input type="text" name="q" value={q ?? ''} placeholder="Search restaurants or cuisines..." class="w-full border border-gray-300 rounded-lg pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg">search</span>
          </form>

          {result.cuisineLookupFailed ? (
            <div class="text-center py-16 bg-white border border-gray-200 rounded-xl text-gray-400" id="eats-empty-state">
              <span class="material-symbols-outlined text-4xl mb-2">search_off</span>
              <p>That cuisine doesn't exist.</p>
              <a href="/eats/restaurants" class="text-primary font-semibold hover:underline mt-2 inline-block text-sm">Browse all restaurants</a>
            </div>
          ) : result.restaurants.length === 0 ? (
            <div class="text-center py-16 bg-white border border-gray-200 rounded-xl text-gray-400" id="eats-empty-state">
              <span class="material-symbols-outlined text-4xl mb-2">restaurant</span>
              <p>No restaurants found{q ? ` for "${q}"` : ''}.</p>
              <a href="/eats/restaurants" class="text-primary font-semibold hover:underline mt-2 inline-block text-sm">Browse all restaurants</a>
            </div>
          ) : (
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4" id="eats-restaurants-grid">
              {result.restaurants.map((restaurant) => <RestaurantCard restaurant={restaurant} />)}
            </div>
          )}

          {result.totalPages > 1 && (
            <div class="flex items-center justify-center gap-2 mt-8">
              {page > 1 && <a href={buildQuery({ page: String(page - 1) })} class="text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-300 hover:border-primary">Previous</a>}
              <span class="text-sm text-gray-500">Page {page} of {result.totalPages}</span>
              {page < result.totalPages && <a href={buildQuery({ page: String(page + 1) })} class="text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-300 hover:border-primary">Next</a>}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}

// ============================================================
// GET /eats/restaurants/:slug — restaurant profile (menu grouped by
// section). Modeled on gigs.tsx's gigsProviderPage (avatar/rating/bio +
// listings block, 404-via-closure pattern).
// ============================================================
export async function eatsRestaurantProfilePage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')
  const slug = c.req.param('slug') ?? ''

  const notFound = () => {
    c.status(404)
    return c.render(
      <Layout title="Restaurant not found" user={user} locale={locale}>
        <div class="max-w-2xl mx-auto text-center py-20">
          <span class="material-symbols-outlined text-5xl text-gray-300">restaurant</span>
          <h1 class="text-xl font-bold mt-4">Restaurant not found</h1>
          <a href="/eats" class="text-primary font-semibold hover:underline mt-2 inline-block">Back to NaijaEats</a>
        </div>
      </Layout>
    )
  }

  const restaurant = await getRestaurantBySlug(db, slug)
  if (!restaurant) return notFound()

  const menuGroups = await getMenuForRestaurant(db, restaurant.id)
  const isOpen = isRestaurantOpenNow(restaurant.opening_time, restaurant.closing_time)

  return c.render(
    <Layout title={`${restaurant.name} — NaijaEats`} description={restaurant.description} user={user} locale={locale}>
      <div class="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-6" id="eats-restaurant-page" data-restaurant-id={restaurant.id} data-restaurant-slug={restaurant.slug}>
        <a href="/eats" class="text-sm text-primary font-medium hover:underline flex items-center gap-1 mb-4">
          <span class="material-symbols-outlined text-base">arrow_back</span>NaijaEats
        </a>

        {/* Cover + identity block */}
        <div class="rounded-xl overflow-hidden border border-gray-200 bg-white">
          <div class="aspect-[16/6] bg-gray-100 overflow-hidden">
            {restaurant.cover_image_url ? (
              <img src={restaurant.cover_image_url} alt={restaurant.name} class="w-full h-full object-cover" />
            ) : (
              <div class="w-full h-full flex items-center justify-center text-gray-300">
                <span class="material-symbols-outlined text-5xl">restaurant</span>
              </div>
            )}
          </div>
          <div class="p-5 flex items-start gap-4 flex-wrap">
            {restaurant.logo_url ? (
              <img src={restaurant.logo_url} alt="" class="w-16 h-16 rounded-full object-cover shrink-0 border-2 border-white shadow -mt-10" />
            ) : (
              <div class="w-16 h-16 rounded-full bg-primary-light text-primary-dark font-bold text-2xl flex items-center justify-center shrink-0 -mt-10">
                {restaurant.name.charAt(0)}
              </div>
            )}
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <h1 class="text-xl font-bold text-gray-900">{restaurant.name}</h1>
                {restaurant.verification_status === 'verified' && (
                  <span class="flex items-center gap-1 text-xs font-semibold text-primary bg-primary-light px-2 py-0.5 rounded-full">
                    <span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1">verified</span>Verified
                  </span>
                )}
                <span class={`flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${isOpen ? 'text-primary-dark bg-primary-light' : 'text-red-700 bg-red-100'}`}>
                  <span class="w-1.5 h-1.5 rounded-full bg-current"></span>{isOpen ? 'Open now' : 'Closed'}
                </span>
              </div>
              <p class="text-sm text-gray-500 mt-0.5">{restaurant.cuisine_name} &middot; {restaurant.city}</p>
              {restaurant.rating_count > 0 ? (
                <div class="flex items-center gap-1 text-sm text-gray-600 mt-1.5">
                  <span class="material-symbols-outlined text-amber-500 text-base" style="font-variation-settings:'FILL' 1">star</span>
                  <span class="font-semibold">{restaurant.rating_avg.toFixed(1)}</span>
                  <span class="text-gray-400">({restaurant.rating_count} reviews)</span>
                </div>
              ) : (
                <p class="text-sm text-gray-400 mt-1.5">New on NaijaEats</p>
              )}
              <p class="text-sm text-gray-600 mt-3 leading-relaxed">{restaurant.description}</p>
              <div class="flex items-center gap-4 mt-3 text-xs text-gray-500 flex-wrap">
                <span class="flex items-center gap-1"><span class="material-symbols-outlined text-sm">schedule</span>{restaurant.avg_prep_minutes} min prep</span>
                <span class="flex items-center gap-1"><span class="material-symbols-outlined text-sm">local_shipping</span>{formatMoney(restaurant.delivery_fee_kobo, 'NGN')} delivery</span>
                <span class="flex items-center gap-1"><span class="material-symbols-outlined text-sm">shopping_basket</span>Min. order {formatMoney(restaurant.min_order_kobo, 'NGN')}</span>
                {restaurant.opening_time && restaurant.closing_time && (
                  <span class="flex items-center gap-1"><span class="material-symbols-outlined text-sm">access_time</span>{restaurant.opening_time} – {restaurant.closing_time}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Menu */}
        <section class="mt-8">
          {menuGroups.length === 0 ? (
            <div class="text-center py-16 bg-white border border-gray-200 rounded-xl text-gray-400" id="eats-empty-state">
              <span class="material-symbols-outlined text-4xl mb-2">menu_book</span>
              <p>This restaurant hasn't published a menu yet.</p>
            </div>
          ) : (
            <div class="space-y-8">
              {menuGroups.map(({ section, items }) => (
                <div>
                  <h2 class="text-lg font-bold text-gray-900 mb-3">{section.name}</h2>
                  <div class="grid sm:grid-cols-2 gap-3">
                    {items.map((item) => <MenuItemCard item={item} restaurantSlug={restaurant.slug} />)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <script src="/static/eats.js"></script>
    </Layout>
  )
}

function MenuItemCard({ item, restaurantSlug }: { item: MenuItemRow; restaurantSlug: string }) {
  return (
    <a
      href={`/eats/restaurants/${restaurantSlug}/item/${item.id}`}
      class="flex gap-3 bg-white border border-gray-200 rounded-xl p-3 hover:border-primary hover:shadow-sm transition-all"
    >
      <div class="w-20 h-20 rounded-lg bg-gray-100 overflow-hidden shrink-0">
        {item.resolved_image_url ? (
          <img src={item.resolved_image_url} alt={item.name} class="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div class="w-full h-full flex items-center justify-center text-gray-300">
            <span class="material-symbols-outlined text-2xl">restaurant</span>
          </div>
        )}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5">
          <p class="text-sm font-semibold text-gray-800 line-clamp-1">{item.name}</p>
          {item.is_spicy === 1 && <span class="material-symbols-outlined text-red-500 text-sm shrink-0">local_fire_department</span>}
          {item.is_vegetarian === 1 && <span class="material-symbols-outlined text-primary text-sm shrink-0">eco</span>}
        </div>
        <p class="text-xs text-gray-500 mt-0.5 line-clamp-2">{item.description}</p>
        <p class="text-sm font-bold text-gray-900 mt-1.5">{formatMoney(item.base_price_kobo, 'NGN')}</p>
      </div>
    </a>
  )
}

/** Naive HH:MM string compare against the server's current UTC time-of-day — Phase 1 scope, no timezone-aware "restaurant's local time" resolution (all seed restaurants are NG/city-based; a real timezone engine is a documented future gap, not fabricated here). Restaurants without opening/closing times are always treated as open (never falsely shown closed for missing data). */
function isRestaurantOpenNow(openingTime: string | null, closingTime: string | null): boolean {
  if (!openingTime || !closingTime) return true
  const now = new Date()
  const hhmm = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`
  if (openingTime <= closingTime) return hhmm >= openingTime && hhmm <= closingTime
  return hhmm >= openingTime || hhmm <= closingTime // overnight window (e.g. 18:00-02:00)
}

// ============================================================
// GET /eats/restaurants/:slug/item/:itemId — item detail + customization
// ============================================================
export async function eatsItemPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')
  const slug = c.req.param('slug') ?? ''
  const itemId = Number(c.req.param('itemId'))

  const notFound = (title: string, backHref: string, backLabel: string) => {
    c.status(404)
    return c.render(
      <Layout title={title} user={user} locale={locale}>
        <div class="max-w-2xl mx-auto text-center py-20">
          <span class="material-symbols-outlined text-5xl text-gray-300">restaurant_menu</span>
          <h1 class="text-xl font-bold mt-4">{title}</h1>
          <a href={backHref} class="text-primary font-semibold hover:underline mt-2 inline-block">{backLabel}</a>
        </div>
      </Layout>
    )
  }

  const restaurant = await getRestaurantBySlug(db, slug)
  if (!restaurant) return notFound('Restaurant not found', '/eats', 'Back to NaijaEats')
  if (Number.isNaN(itemId)) return notFound('Item not found', `/eats/restaurants/${slug}`, `Back to ${restaurant.name}`)

  const item = await getMenuItem(db, restaurant.id, itemId)
  if (!item) return notFound('Item not found', `/eats/restaurants/${slug}`, `Back to ${restaurant.name}`)

  const optionGroups = await getOptionGroupsForMenuItem(db, item.id)

  return c.render(
    <Layout title={`${item.name} — ${restaurant.name} — NaijaEats`} description={item.description} user={user} locale={locale}>
      <div class="max-w-3xl mx-auto px-4 md:px-6 lg:px-8 py-6" id="eats-item-page" data-menu-item-id={item.id} data-restaurant-id={restaurant.id} data-restaurant-slug={restaurant.slug} data-base-price-kobo={item.base_price_kobo}>
        <a href={`/eats/restaurants/${slug}`} class="text-sm text-primary font-medium hover:underline flex items-center gap-1 mb-4">
          <span class="material-symbols-outlined text-base">arrow_back</span>{restaurant.name}
        </a>

        <div class="grid md:grid-cols-2 gap-6">
          <div class="aspect-square rounded-xl bg-gray-100 overflow-hidden">
            {item.resolved_image_url ? (
              <img src={item.resolved_image_url} alt={item.name} class="w-full h-full object-cover" />
            ) : (
              <div class="w-full h-full flex items-center justify-center text-gray-300">
                <span class="material-symbols-outlined text-6xl">restaurant</span>
              </div>
            )}
          </div>

          <div>
            <div class="flex items-center gap-1.5 flex-wrap">
              <h1 class="text-xl font-bold text-gray-900">{item.name}</h1>
              {item.is_spicy === 1 && <span class="flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full"><span class="material-symbols-outlined text-sm">local_fire_department</span>Spicy</span>}
              {item.is_vegetarian === 1 && <span class="flex items-center gap-1 text-xs font-semibold text-primary bg-primary-light px-2 py-0.5 rounded-full"><span class="material-symbols-outlined text-sm">eco</span>Vegetarian</span>}
            </div>
            <p class="text-sm text-gray-600 mt-2 leading-relaxed">{item.description}</p>
            <p class="text-2xl font-bold text-gray-900 mt-3" id="eats-item-unit-price">{formatMoney(item.base_price_kobo, 'NGN')}</p>
            {item.prep_minutes && <p class="text-xs text-gray-500 mt-1 flex items-center gap-1"><span class="material-symbols-outlined text-sm">schedule</span>~{item.prep_minutes} min</p>}

            {optionGroups.length > 0 && (
              <div class="mt-6 space-y-5" id="eats-option-groups">
                {optionGroups.map(({ group, options }) => (
                  <div class="border-t border-gray-100 pt-4" data-option-group data-option-group-id={group.id} data-group-name={group.name} data-required={group.is_required} data-min-select={group.min_select} data-max-select={group.max_select}>
                    <div class="flex items-center justify-between mb-2">
                      <h3 class="text-sm font-bold text-gray-800">{group.name}</h3>
                      <span class="text-xs text-gray-400">{group.is_required ? `Required${group.max_select > 1 ? ` — choose up to ${group.max_select}` : ''}` : 'Optional'}</span>
                    </div>
                    <div class="space-y-1.5">
                      {options.map((opt) => (
                        <label class="flex items-center justify-between gap-3 border border-gray-200 rounded-lg px-3 py-2 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary-light">
                          <span class="flex items-center gap-2 text-sm text-gray-700">
                            <input
                              type={group.max_select === 1 ? 'radio' : 'checkbox'}
                              name={`option-group-${group.id}`}
                              class="eats-option-input"
                              data-option-id={opt.id}
                              data-option-name={opt.name}
                              data-price-delta-kobo={opt.price_delta_kobo}
                            />
                            {opt.name}
                          </span>
                          <span class="text-xs text-gray-500 shrink-0">{opt.price_delta_kobo > 0 ? `+${formatMoney(opt.price_delta_kobo, 'NGN')}` : opt.price_delta_kobo < 0 ? formatMoney(opt.price_delta_kobo, 'NGN') : 'Free'}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div class="mt-6">
              <label class="block text-sm font-medium text-gray-700 mb-1.5">Special instructions (optional)</label>
              <textarea id="eats-item-special-instructions" rows={2} placeholder="e.g. less spicy, no onions..." class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"></textarea>
            </div>

            <div id="eats-add-to-cart-error" class="hidden bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg mt-4"></div>

            <div class="flex items-center gap-3 mt-6">
              <div class="flex items-center border border-gray-300 rounded-lg">
                <button type="button" id="eats-qty-minus" class="w-10 h-10 flex items-center justify-center text-gray-600 hover:bg-gray-100">-</button>
                <span id="eats-qty-value" class="w-10 text-center text-sm font-semibold">1</span>
                <button type="button" id="eats-qty-plus" class="w-10 h-10 flex items-center justify-center text-gray-600 hover:bg-gray-100">+</button>
              </div>
              <button type="button" id="eats-add-to-cart-btn" class="flex-1 bg-primary text-white font-semibold py-3 rounded-lg hover:bg-primary-dark transition">
                Add to cart — <span id="eats-add-to-cart-total">{formatMoney(item.base_price_kobo, 'NGN')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <script src="/static/eats.js"></script>
    </Layout>
  )
}

// ============================================================
// GET /eats/cart
// ============================================================
export async function eatsCartPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')
  const guestToken = user ? null : getOrSetGuestToken(c)
  const cartId = await getOrCreateEatsCartId(db, user?.id ?? null, guestToken)
  const items = await getEatsCartItems(db, cartId)

  const subtotalKobo = items.reduce((sum, i) => sum + eatsCartItemLineTotalKobo(i), 0)
  const cartCount = items.reduce((s, i) => s + i.quantity, 0)
  const restaurant = items[0] ? { name: items[0].restaurant_name, slug: items[0].restaurant_slug, deliveryFeeKobo: items[0].restaurant_delivery_fee_kobo, minOrderKobo: items[0].restaurant_min_order_kobo } : null
  const meetsMinimum = !restaurant || subtotalKobo >= restaurant.minOrderKobo

  return c.render(
    <Layout title="Your NaijaEats Cart" user={user} cartCount={cartCount} locale={locale}>
      <div class="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-6" id="eats-cart-page" data-cart-id={cartId}>
        <h1 class="text-2xl font-bold text-gray-800 mb-6">Your NaijaEats Cart</h1>

        {items.length === 0 ? (
          <div class="text-center py-20" id="eats-empty-state">
            <span class="material-symbols-outlined text-5xl text-gray-300">shopping_cart</span>
            <p class="text-gray-500 mt-3">Your NaijaEats cart is empty.</p>
            <a href="/eats" class="inline-block mt-4 bg-primary text-white font-semibold px-6 py-2.5 rounded-lg hover:bg-primary-dark transition">
              Browse restaurants
            </a>
          </div>
        ) : (
          <div class="grid md:grid-cols-3 gap-8">
            <div class="md:col-span-2 space-y-3" id="eats-cart-items-list">
              {restaurant && (
                <div class="flex items-center gap-2 pb-1 border-b border-gray-200">
                  <span class="material-symbols-outlined text-primary text-base">restaurant</span>
                  <a href={`/eats/restaurants/${restaurant.slug}`} class="text-sm font-bold text-gray-800 hover:text-primary">{restaurant.name}</a>
                </div>
              )}
              {items.map((item) => {
                const options = JSON.parse(item.selected_options_json || '[]') as { name: string; price_delta_kobo: number }[]
                return (
                  <div class="flex gap-4 bg-white border border-gray-200 rounded-xl p-4" data-eats-cart-item data-cart-item-id={item.id}>
                    <div class="w-20 h-20 shrink-0 rounded-lg bg-gray-100 overflow-hidden">
                      {item.image_url ? <img src={item.image_url} alt={item.name} class="w-full h-full object-cover" /> : (
                        <div class="w-full h-full flex items-center justify-center text-gray-300"><span class="material-symbols-outlined">restaurant</span></div>
                      )}
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-medium text-gray-800">{item.name}</p>
                      {options.length > 0 && <p class="text-xs text-gray-500 mt-0.5">{options.map((o) => o.name).join(', ')}</p>}
                      {item.special_instructions && <p class="text-xs text-gray-400 mt-0.5 italic">"{item.special_instructions}"</p>}
                      {item.is_available !== 1 && <p class="text-xs text-red-600 mt-1 font-medium">No longer available — please remove</p>}
                      <div class="flex items-center gap-3 mt-2 flex-wrap">
                        <div class="flex items-center border border-gray-300 rounded-lg">
                          <button type="button" class="eats-cart-qty-minus w-8 h-8 flex items-center justify-center text-gray-600 hover:bg-gray-100" data-cart-item-id={item.id}>-</button>
                          <span class="eats-cart-qty-value w-10 text-center text-sm">{item.quantity}</span>
                          <button type="button" class="eats-cart-qty-plus w-8 h-8 flex items-center justify-center text-gray-600 hover:bg-gray-100" data-cart-item-id={item.id}>+</button>
                        </div>
                        <button type="button" class="eats-cart-remove-btn text-xs text-red-600 font-medium hover:underline" data-cart-item-id={item.id}>Remove</button>
                      </div>
                    </div>
                    <div class="text-right shrink-0">
                      <p class="eats-cart-line-total text-sm font-bold text-gray-900">{formatMoney(eatsCartItemLineTotalKobo(item), 'NGN')}</p>
                    </div>
                  </div>
                )
              })}
            </div>

            <div class="bg-white border border-gray-200 rounded-xl p-5 h-fit sticky top-20">
              <h2 class="font-bold text-gray-800 mb-3">Order Summary</h2>
              <div class="flex justify-between text-sm text-gray-600 mb-1.5">
                <span>Subtotal (<span id="eats-cart-summary-count">{cartCount}</span> items)</span>
                <span id="eats-cart-summary-subtotal">{formatMoney(subtotalKobo, 'NGN')}</span>
              </div>
              {restaurant && (
                <div class="flex justify-between text-sm text-gray-600 mb-1.5">
                  <span>Delivery fee</span>
                  <span>{formatMoney(restaurant.deliveryFeeKobo, 'NGN')}</span>
                </div>
              )}
              {restaurant && !meetsMinimum && (
                <p class="text-xs text-amber-600 font-medium mb-2">Add {formatMoney(restaurant.minOrderKobo - subtotalKobo, 'NGN')} more to meet this restaurant's minimum order.</p>
              )}
              <div class="flex justify-between text-base font-bold text-gray-900 pt-2 mt-1.5 border-t border-gray-100">
                <span>Total</span>
                <span>{formatMoney(subtotalKobo + (restaurant?.deliveryFeeKobo ?? 0), 'NGN')}</span>
              </div>
              <div class="border-t border-gray-100 pt-3 mt-3">
                {!meetsMinimum ? (
                  <button disabled class="block w-full text-center bg-gray-200 text-gray-400 font-semibold py-3 rounded-lg cursor-not-allowed">Minimum order not met</button>
                ) : user ? (
                  <a href="/eats/checkout" class="block text-center bg-primary text-white font-semibold py-3 rounded-lg hover:bg-primary-dark transition">Proceed to Checkout</a>
                ) : (
                  <a href="/login?next=/eats/checkout" class="block text-center bg-primary text-white font-semibold py-3 rounded-lg hover:bg-primary-dark transition">Sign in to Checkout</a>
                )}
              </div>
              <div class="flex items-center gap-1.5 text-xs text-gray-500 mt-3">
                <span class="material-symbols-outlined text-base">verified_user</span>
                Escrow protected — pay in, confirm delivery before release
              </div>
            </div>
          </div>
        )}
      </div>
      <script src="/static/eats.js"></script>
    </Layout>
  )
}

// ============================================================
// GET /eats/checkout — single-step checkout (requireAuthPage). Simpler than
// the product checkout.tsx multi-step flow deliberately: a NaijaEats cart
// is always exactly ONE restaurant (see eats-cart.ts's module header), so
// there is no seller-grouping/multi-currency/coupon complexity to render —
// address + payment method + place order, one screen, matching how a
// food-delivery checkout actually behaves.
// ============================================================
export async function eatsCheckoutPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')!
  const locale = c.get('locale')

  const cartId = await getOrCreateEatsCartId(db, user.id, null)
  const items = await getEatsCartItems(db, cartId)

  if (items.length === 0) {
    return c.render(
      <Layout title="Checkout — NaijaEats" user={user} locale={locale}>
        <div class="max-w-2xl mx-auto text-center py-20">
          <span class="material-symbols-outlined text-5xl text-gray-300">shopping_cart</span>
          <h1 class="text-xl font-bold mt-4">Your NaijaEats cart is empty</h1>
          <a href="/eats" class="text-primary font-semibold hover:underline mt-2 inline-block">Browse restaurants</a>
        </div>
      </Layout>
    )
  }

  const unavailable = items.find((i) => i.is_available !== 1)
  const subtotalKobo = items.reduce((sum, i) => sum + eatsCartItemLineTotalKobo(i), 0)
  const cartCount = items.reduce((s, i) => s + i.quantity, 0)
  const restaurantName = items[0].restaurant_name
  const restaurantSlug = items[0].restaurant_slug
  const deliveryFeeKobo = items[0].restaurant_delivery_fee_kobo
  const minOrderKobo = items[0].restaurant_min_order_kobo
  const meetsMinimum = subtotalKobo >= minOrderKobo
  const totalKobo = subtotalKobo + deliveryFeeKobo

  const [addresses, walletBalance, regions] = await Promise.all([
    getAddressesForUser(db, user.id),
    getWalletBalance(db, user.id),
    getRegionsForCountry(db, 'NG'),
  ])

  const initState = {
    subtotalKobo,
    deliveryFeeKobo,
    totalKobo,
    walletBalanceKobo: walletBalance,
    defaultAddressId: addresses.find((a) => a.is_default === 1)?.id ?? addresses[0]?.id ?? null,
  }

  return c.render(
    <Layout title="Checkout — NaijaEats" user={user} cartCount={cartCount} locale={locale}>
      <div class="max-w-4xl mx-auto px-4 md:px-6 lg:px-8 py-6" id="eats-checkout-page">
        <h1 class="text-2xl font-bold text-gray-800 mb-1">Checkout</h1>
        <p class="text-sm text-gray-500 mb-6">Ordering from <a href={`/eats/restaurants/${restaurantSlug}`} class="text-primary font-semibold hover:underline">{restaurantName}</a></p>

        {(!meetsMinimum || unavailable) && (
          <div class="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">
            {!meetsMinimum && <p>This restaurant requires a minimum order of {formatMoney(minOrderKobo, 'NGN')} — <a href="/eats/cart" class="underline font-semibold">go back to your cart</a> to add more items.</p>}
            {unavailable && <p>"{unavailable.name}" is no longer available — <a href="/eats/cart" class="underline font-semibold">please remove it from your cart</a>.</p>}
          </div>
        )}

        <div class="grid lg:grid-cols-3 gap-8">
          <div class="lg:col-span-2 space-y-6 min-w-0">
            <section class="bg-white border border-gray-200 rounded-xl p-5">
              <h2 class="font-bold text-gray-800 mb-4 flex items-center gap-2">
                <span class="material-symbols-outlined text-primary">location_on</span>Delivery address
              </h2>
              <div id="eats-address-list" class="space-y-2">
                {addresses.length === 0 && <p class="text-sm text-gray-500 mb-2">You don't have any saved addresses yet — add one below.</p>}
                {addresses.map((addr) => (
                  <label class="flex items-start gap-3 border border-gray-300 rounded-lg px-4 py-3 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary-light" data-address-option data-address-id={addr.id}>
                    <input type="radio" name="address_id" value={addr.id} checked={addr.id === initState.defaultAddressId} class="mt-1" />
                    <div class="flex-1">
                      <div class="flex items-center gap-2">
                        <span class="text-sm font-semibold text-gray-800">{addr.label}</span>
                        {addr.is_default === 1 && <span class="text-[10px] bg-primary text-white px-1.5 py-0.5 rounded font-semibold">DEFAULT</span>}
                      </div>
                      <p class="text-sm text-gray-600 mt-0.5">{addr.recipient_name} &middot; {addr.phone}</p>
                      <p class="text-sm text-gray-600">{addr.line1}, {addr.city}, {addr.state}</p>
                    </div>
                  </label>
                ))}
              </div>

              <button type="button" id="eats-show-new-address-btn" class="text-sm text-primary font-semibold hover:underline mt-3 flex items-center gap-1">
                <span class="material-symbols-outlined text-base">add</span>Add a new address
              </button>

              <div id="eats-new-address-form" class="hidden mt-4 border-t border-gray-100 pt-4 grid sm:grid-cols-2 gap-3">
                <div class="sm:col-span-2">
                  <label class="block text-xs font-medium text-gray-700 mb-1">Address label</label>
                  <input id="eats-na-label" placeholder="e.g. Home, Office" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-700 mb-1">Recipient name</label>
                  <input id="eats-na-recipient" value={user.name} class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-700 mb-1">Phone number</label>
                  <input id="eats-na-phone" value={user.phone ?? ''} placeholder="080XXXXXXXX" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div class="sm:col-span-2">
                  <label class="block text-xs font-medium text-gray-700 mb-1">Street address</label>
                  <input id="eats-na-line1" placeholder="Street address, house number" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-700 mb-1">City</label>
                  <input id="eats-na-city" placeholder="e.g. Ikeja" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-700 mb-1">State</label>
                  <select id="eats-na-state" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 bg-white">
                    <option value="">Select a state</option>
                    {regions.map((r) => <option value={r.name}>{r.name}</option>)}
                  </select>
                </div>
                <div id="eats-new-address-error" class="hidden sm:col-span-2 text-red-600 text-xs"></div>
                <div class="sm:col-span-2 flex gap-2">
                  <button type="button" id="eats-save-new-address-btn" class="bg-primary text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-primary-dark transition">Save address</button>
                  <button type="button" id="eats-cancel-new-address-btn" class="text-gray-500 text-sm font-medium px-4 py-2 hover:bg-gray-50 rounded-lg">Cancel</button>
                </div>
              </div>
            </section>

            <section class="bg-white border border-gray-200 rounded-xl p-5">
              <h2 class="font-bold text-gray-800 mb-4 flex items-center gap-2">
                <span class="material-symbols-outlined text-primary">note_alt</span>Delivery instructions (optional)
              </h2>
              <textarea id="eats-order-special-instructions" rows={2} placeholder="e.g. gate code, landmark..." class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"></textarea>
            </section>

            <section class="bg-white border border-gray-200 rounded-xl p-5">
              <h2 class="font-bold text-gray-800 mb-4 flex items-center gap-2">
                <span class="material-symbols-outlined text-primary">payments</span>Payment method
              </h2>
              <div class="space-y-2">
                <label class="flex items-center gap-3 border border-gray-300 rounded-lg px-4 py-3 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary-light">
                  <input type="radio" name="payment_method" value="wallet" id="eats-payment-wallet-radio" checked={walletBalance >= totalKobo} disabled={walletBalance < totalKobo} />
                  <span class="material-symbols-outlined text-primary">account_balance_wallet</span>
                  <div class="flex-1">
                    <p class="text-sm font-medium text-gray-800">Pay from NaijaDeals Wallet</p>
                    <p class="text-xs text-gray-500">Balance: {formatMoney(walletBalance, 'NGN')}{walletBalance < totalKobo ? ' — insufficient, top up or pay by card' : ''}</p>
                  </div>
                </label>
                <label class="flex items-center gap-3 border border-gray-300 rounded-lg px-4 py-3 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary-light">
                  <input type="radio" name="payment_method" value="paystack" id="eats-payment-paystack-radio" checked={walletBalance < totalKobo} />
                  <span class="material-symbols-outlined text-primary">credit_card</span>
                  <div class="flex-1">
                    <p class="text-sm font-medium text-gray-800">Pay by card / bank transfer</p>
                    <p class="text-xs text-gray-500">Powered by Paystack — secure hosted checkout</p>
                  </div>
                </label>
              </div>
              <div id="eats-checkout-error" class="hidden bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg mt-4"></div>
              <button type="button" id="eats-place-order-btn" disabled={!meetsMinimum || !!unavailable} class="w-full mt-5 bg-primary text-white font-semibold py-2.5 rounded-lg hover:bg-primary-dark transition disabled:bg-gray-300 disabled:cursor-not-allowed">
                Place order — {formatMoney(totalKobo, 'NGN')}
              </button>
              <div class="flex items-center gap-1.5 text-xs text-gray-500 mt-3">
                <span class="material-symbols-outlined text-base">verified_user</span>
                Escrow protected — funds are only released to the restaurant after you confirm delivery
              </div>
            </section>
          </div>

          <div class="bg-white border border-gray-200 rounded-xl p-5 h-fit lg:sticky lg:top-20">
            <h2 class="font-bold text-gray-800 mb-3">Order Summary</h2>
            <div class="space-y-2 mb-3">
              {items.map((item) => (
                <div class="flex justify-between text-sm text-gray-600">
                  <span class="line-clamp-1">{item.quantity}&times; {item.name}</span>
                  <span class="shrink-0 ml-2">{formatMoney(eatsCartItemLineTotalKobo(item), 'NGN')}</span>
                </div>
              ))}
            </div>
            <div class="space-y-1.5 text-sm border-t border-gray-100 pt-3">
              <div class="flex justify-between text-gray-600"><span>Subtotal</span><span>{formatMoney(subtotalKobo, 'NGN')}</span></div>
              <div class="flex justify-between text-gray-600"><span>Delivery fee</span><span>{formatMoney(deliveryFeeKobo, 'NGN')}</span></div>
              <div class="flex justify-between text-base font-bold text-gray-900 pt-2 mt-1 border-t border-gray-100">
                <span>Total</span><span>{formatMoney(totalKobo, 'NGN')}</span>
              </div>
            </div>
          </div>
        </div>

        <script id="eats-checkout-init-data" type="application/json" dangerouslySetInnerHTML={{ __html: JSON.stringify(initState) }}></script>
      </div>
      <script src="/static/eats.js"></script>
    </Layout>
  )
}

// ============================================================
// GET /eats/orders/:orderNumber — order detail (requireAuthPage)
// ============================================================
export async function eatsOrderDetailPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')!
  const locale = c.get('locale')
  const orderNumber = c.req.param('orderNumber') ?? ''

  const order = await getOwnedEatsOrder(db, user.id, orderNumber)
  if (!order) {
    c.status(404)
    return c.render(
      <Layout title="Order not found" user={user} locale={locale}>
        <div class="max-w-2xl mx-auto text-center py-20">
          <span class="material-symbols-outlined text-5xl text-gray-300">search_off</span>
          <h1 class="text-xl font-bold mt-4">Order not found</h1>
          <a href="/eats/account/orders" class="text-primary font-semibold hover:underline mt-2 inline-block">Back to My NaijaEats Orders</a>
        </div>
      </Layout>
    )
  }

  const [items, events] = await Promise.all([
    getEatsOrderItems(db, order.id),
    getEatsOrderStatusEvents(db, order.id),
  ])

  const statusInfo = EATS_ORDER_STATUS_LABEL[order.status] ?? { label: order.status, icon: 'help', color: 'bg-gray-200 text-gray-700' }
  const canCancel = order.status === 'new'

  return c.render(
    <Layout title={`Order ${order.order_number} — NaijaEats`} user={user} locale={locale}>
      <div class="max-w-2xl mx-auto px-4 md:px-6 lg:px-8 py-6" id="eats-order-detail-page" data-order-id={order.id}>
        <a href="/eats/account/orders" class="text-sm text-primary font-medium hover:underline flex items-center gap-1 mb-4">
          <span class="material-symbols-outlined text-base">arrow_back</span>My NaijaEats Orders
        </a>

        <div id="eats-order-action-error" class="hidden bg-red-50 text-red-600 text-sm rounded-lg px-4 py-3 mb-4"></div>

        <div class="flex items-center justify-between flex-wrap gap-2 mb-4">
          <h1 class="text-xl font-bold text-gray-900">{order.order_number}</h1>
          <span class={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full ${statusInfo.color}`}>
            <span class="material-symbols-outlined text-sm">{statusInfo.icon}</span>{statusInfo.label}
          </span>
        </div>

        <a href={`/eats/restaurants/${order.restaurant_slug}`} class="flex items-center gap-3 bg-white border border-gray-200 rounded-xl p-4 mb-4 hover:border-primary transition-colors">
          {order.restaurant_logo_url ? (
            <img src={order.restaurant_logo_url} alt={order.restaurant_name} class="w-10 h-10 rounded-full object-cover shrink-0" />
          ) : (
            <div class="w-10 h-10 rounded-full bg-primary-light text-primary-dark font-bold flex items-center justify-center shrink-0">{order.restaurant_name.charAt(0)}</div>
          )}
          <p class="text-sm font-semibold text-gray-800">{order.restaurant_name}</p>
        </a>

        <div class="bg-white border border-gray-200 rounded-xl p-4 mb-4">
          <h2 class="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Items</h2>
          <div class="space-y-3">
            {items.map((item: any) => (
              <div class="flex gap-3">
                <div class="w-14 h-14 rounded-lg bg-gray-100 overflow-hidden shrink-0">
                  {item.image_snapshot ? <img src={item.image_snapshot} alt={item.name_snapshot} class="w-full h-full object-cover" /> : (
                    <div class="w-full h-full flex items-center justify-center text-gray-300"><span class="material-symbols-outlined text-lg">restaurant</span></div>
                  )}
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-gray-800">{item.name_snapshot}</p>
                  {item.options.length > 0 && <p class="text-xs text-gray-500">{item.options.map((o: any) => o.option_name_snapshot).join(', ')}</p>}
                  <p class="text-xs text-gray-500">Qty {item.quantity} &times; {formatMoney(item.unit_price_kobo, order.currency)}</p>
                </div>
                <p class="text-sm font-semibold text-gray-900 shrink-0">{formatMoney(item.line_total_kobo, order.currency)}</p>
              </div>
            ))}
          </div>
        </div>

        <div class="bg-white border border-gray-200 rounded-xl p-4 mb-4">
          <h2 class="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Payment summary</h2>
          <div class="flex justify-between text-sm text-gray-600 mb-1"><span>Subtotal</span><span>{formatMoney(order.subtotal_kobo, order.currency)}</span></div>
          <div class="flex justify-between text-sm text-gray-600 mb-1"><span>Delivery fee</span><span>{formatMoney(order.delivery_fee_kobo, order.currency)}</span></div>
          <div class="flex justify-between text-sm font-bold text-gray-900 pt-1.5 border-t border-gray-100"><span>Total</span><span>{formatMoney(order.total_kobo, order.currency)}</span></div>
          <p class="text-xs text-gray-400 mt-2">Payment status: {order.payment_status.replace('_', ' ')}</p>
        </div>

        <div class="bg-white border border-gray-200 rounded-xl p-4 mb-4">
          <h2 class="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Delivery address</h2>
          <p class="text-sm text-gray-700">{order.shipping_name} &middot; {order.shipping_phone}</p>
          <p class="text-sm text-gray-600">{order.shipping_address}, {order.shipping_city}, {order.shipping_state}</p>
        </div>

        {canCancel && (
          <div class="flex items-center gap-2 mb-6">
            <button type="button" id="eats-order-cancel-btn" class="text-sm font-semibold text-red-600 border border-red-200 px-4 py-2 rounded-lg hover:bg-red-50 transition">Cancel order</button>
          </div>
        )}

        <section>
          <h2 class="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Order history</h2>
          <div class="space-y-3">
            {events.map((ev: any) => (
              <div class="flex items-start gap-3">
                <span class="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0"></span>
                <div>
                  <p class="text-sm text-gray-700">{(EATS_ORDER_STATUS_LABEL[ev.status]?.label) ?? ev.status}</p>
                  {ev.note && <p class="text-xs text-gray-500">{ev.note}</p>}
                  <p class="text-xs text-gray-400">{new Date(ev.created_at).toLocaleString('en-NG')}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
      <script src="/static/eats.js"></script>
    </Layout>
  )
}

// ============================================================
// GET /eats/account/orders — order history list (requireAuthPage)
// ============================================================
export async function eatsAccountOrdersPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')!
  const locale = c.get('locale')

  const orders = await getEatsOrdersForCustomer(db, user.id)

  return c.render(
    <Layout title="My NaijaEats Orders" user={user} locale={locale}>
      <div class="max-w-3xl mx-auto px-4 md:px-6 lg:px-8 py-6">
        <h1 class="text-2xl font-bold text-gray-800 mb-6">My NaijaEats Orders</h1>

        {orders.length === 0 ? (
          <div class="text-center py-20" id="eats-empty-state">
            <span class="material-symbols-outlined text-5xl text-gray-300">receipt_long</span>
            <p class="text-gray-500 mt-3">You haven't placed any NaijaEats orders yet.</p>
            <a href="/eats" class="inline-block mt-4 bg-primary text-white font-semibold px-6 py-2.5 rounded-lg hover:bg-primary-dark transition">Browse restaurants</a>
          </div>
        ) : (
          <div class="space-y-3">
            {orders.map((order: any) => {
              const statusInfo = EATS_ORDER_STATUS_LABEL[order.status] ?? { label: order.status, icon: 'help', color: 'bg-gray-200 text-gray-700' }
              return (
                <a href={`/eats/orders/${order.order_number}`} class="flex items-center gap-3 bg-white border border-gray-200 rounded-xl p-4 hover:border-primary transition-colors">
                  {order.restaurant_logo_url ? (
                    <img src={order.restaurant_logo_url} alt={order.restaurant_name} class="w-12 h-12 rounded-full object-cover shrink-0" />
                  ) : (
                    <div class="w-12 h-12 rounded-full bg-primary-light text-primary-dark font-bold flex items-center justify-center shrink-0">{order.restaurant_name.charAt(0)}</div>
                  )}
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-semibold text-gray-800">{order.restaurant_name}</p>
                    <p class="text-xs text-gray-500">{order.order_number} &middot; {new Date(order.created_at).toLocaleDateString('en-NG')}</p>
                  </div>
                  <div class="text-right shrink-0">
                    <p class="text-sm font-bold text-gray-900">{formatMoney(order.total_kobo, order.currency)}</p>
                    <span class={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full mt-1 ${statusInfo.color}`}>{statusInfo.label}</span>
                  </div>
                </a>
              )
            })}
          </div>
        )}
      </div>
    </Layout>
  )
}

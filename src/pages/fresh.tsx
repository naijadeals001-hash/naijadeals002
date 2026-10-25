/**
 * NaijaFresh — customer-facing pages for the fresh-food marketplace vertical
 * (migration 0077 foundation). This is the FIRST real UI wired to the
 * existing fresh-food(100) category tree — before this file, `/fresh` only
 * rendered the static ecosystem-preview "coming soon" placeholder
 * (src/pages/ecosystem-preview.tsx).
 *
 * ARCHITECTURE — 100% reuse, zero parallel systems (Pat's §26 "reuse rule"):
 *   - Buy-box join: same shape as catalog.ts's PRODUCT_CARD_SELECT, extended
 *     in src/lib/fresh.ts with the Fresh-only listing columns. Not a second
 *     query engine — a thin, explicit variant scoped to cat.path LIKE '100/%'.
 *   - Cart: the exact same product_listings-keyed cart_items table +
 *     app.js's existing `.add-to-cart-card-btn` / `.wishlist-toggle-btn`
 *     delegated handlers. Zero new cart code.
 *   - Checkout: unmodified — Fresh listings behave as ordinary listings.
 *   - Wholesale pricing: reuses product_pricing_tiers / pricing.ts exactly
 *     (one proof-of-concept tier set on listing 621, per Pat's §9).
 *   - Collections: reuses collections.ts / product_collections exactly
 *     (farm-direct/market-fresh/wholesale/bulk/imported, ids 8/9/14/15/10).
 *   - Search: its own in-page `<form method="get">` scoped to `/fresh`
 *     (Layout's global header search always posts to `/shop` — see
 *     Layout.tsx's search form; NaijaGigs/NaijaStay don't hijack it either,
 *     this follows that exact precedent rather than inventing a second
 *     global search).
 *
 * `ecosystem_verticals.fresh.status` remains 'coming_soon' — this vertical is
 * reachable at /fresh directly and is fully functional, but is intentionally
 * NOT yet promoted in the header/footer ecosystem nav pill strip (Pat's §31
 * absolute deployment gate: do not flip vertical status this session).
 */
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { Layout } from '../components/Layout'
import { FreshProductCard, FreshProductCarousel } from '../components/FreshProductCard'
import type { AppEnv, ProductWithListingRow, ReviewRow, QuestionRow } from '../types'
import { formatMoney, discountPercent, formatRatingCount } from '../lib/money'
import { getListingsForProduct, getVariantsForListing } from '../lib/catalog'
import { getPricingTiersForListing } from '../lib/pricing'
import { recordBehaviorEvent } from '../lib/behavior-events'
import {
  FRESH_ROOT_CATEGORY_ID,
  FRESHNESS_LABEL,
  COLLECTION_BADGE_LABEL,
  getFreshCategories,
  getFreshToday,
  getFreshCollection,
  getFreshAfricanFoods,
  browseFreshProducts
} from '../lib/fresh'

const PER_PAGE = 24

/**
 * /fresh — homepage + category browsing + search, combined in ONE handler
 * (same query-param convention as shop.tsx: presence of `?category=` or
 * `?q=` switches the page from "homepage" mode into "results" mode without
 * a separate route). This mirrors shop.tsx's own pattern deliberately —
 * Fresh is a scoped view of the same marketplace engine, not a rebuilt one.
 */
export async function freshHomePage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')
  const selectedCity = getCookie(c, 'nd_city') || 'Lagos'

  const category = c.req.query('category')
  const q = c.req.query('q')
  const minPrice = c.req.query('min_price')
  const maxPrice = c.req.query('max_price')
  const sort = c.req.query('sort') || 'newest'
  const variableWeight = c.req.query('variable_weight')
  const wholesale = c.req.query('wholesale')
  const collectionFilter = c.req.query('collection')
  const page = Math.max(1, Number(c.req.query('page') || '1'))

  const isBrowseMode = !!(category || q || minPrice || maxPrice || variableWeight === '1' || wholesale === '1' || collectionFilter)

  const categories = await getFreshCategories(db)

  if (isBrowseMode) {
    const result = await browseFreshProducts(db, {
      category, q, minPrice, maxPrice, sort, variableWeight, wholesale, collection: collectionFilter, page, perPage: PER_PAGE
    })

    if (page === 1) {
      if (result.activeCategory) {
        await recordBehaviorEvent(c, { eventType: 'category_view', categoryId: result.activeCategory.id, source: 'fresh_grid' })
      }
      if (q) {
        await recordBehaviorEvent(c, { eventType: 'search', searchQuery: q, source: 'fresh_grid' })
      }
    }

    function buildQuery(overrides: Record<string, string | undefined>): string {
      const params = new URLSearchParams()
      const current: Record<string, string | undefined> = {
        category, q, min_price: minPrice, max_price: maxPrice, sort,
        variable_weight: variableWeight, wholesale, collection: collectionFilter, page: String(page)
      }
      const merged = { ...current, ...overrides }
      for (const [k, v] of Object.entries(merged)) {
        if (v !== undefined && v !== '' && !(k === 'page' && v === '1')) params.set(k, v)
      }
      const str = params.toString()
      return str ? `/fresh?${str}` : '/fresh'
    }

    const activeCategoryObj = categories.find((cat) => cat.slug === category)
    const pageTitle = q ? `Search Fresh: ${q}` : activeCategoryObj ? activeCategoryObj.name : 'Browse Fresh Food'

    return c.render(
      <Layout title={pageTitle} user={user} locale={locale} selectedCity={selectedCity}>
        <FreshSubheader selectedCity={selectedCity} />
        <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8 py-6 flex gap-6">
          {/* ============ Sidebar filters (desktop) ============ */}
          <aside class="hidden md:block w-60 shrink-0 space-y-6">
            <div>
              <h3 class="font-semibold text-gray-800 mb-3">Fresh Categories</h3>
              <nav class="flex flex-col gap-1">
                <a href={buildQuery({ category: undefined, page: undefined })} class={`text-sm px-3 py-2 rounded-lg ${!category ? 'bg-primary-light text-primary-dark font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}>
                  All Fresh Food
                </a>
                {categories.map((cat) => (
                  <a href={buildQuery({ category: cat.slug, page: undefined })} class={`text-sm px-3 py-2 rounded-lg flex items-center gap-2 ${category === cat.slug ? 'bg-primary-light text-primary-dark font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}>
                    <span class="material-symbols-outlined text-base">{cat.icon}</span>
                    {cat.name}
                  </a>
                ))}
              </nav>
            </div>

            <form method="get" class="border-t border-gray-200 pt-4">
              {category && <input type="hidden" name="category" value={category} />}
              {q && <input type="hidden" name="q" value={q} />}
              {sort && <input type="hidden" name="sort" value={sort} />}
              <h3 class="font-semibold text-gray-800 mb-3">Price Range</h3>
              <div class="flex items-center gap-2 mb-4">
                <input type="number" name="min_price" value={minPrice ?? ''} placeholder="Min" class="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 outline-none" />
                <span class="text-gray-400">–</span>
                <input type="number" name="max_price" value={maxPrice ?? ''} placeholder="Max" class="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 outline-none" />
              </div>

              <h3 class="font-semibold text-gray-800 mb-3">Product Type</h3>
              <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer mb-2">
                <input type="checkbox" name="variable_weight" value="1" checked={variableWeight === '1'} />
                Variable-weight items
              </label>
              <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer mb-4">
                <input type="checkbox" name="wholesale" value="1" checked={wholesale === '1'} />
                Wholesale / bulk pricing available
              </label>

              <button type="submit" class="w-full bg-primary text-white text-sm font-semibold py-2 rounded-lg hover:bg-primary-dark transition">Apply filters</button>
            </form>
          </aside>

          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between mb-4 gap-3">
              <div>
                <h1 class="text-xl font-bold text-gray-800">{pageTitle}</h1>
                <p class="text-sm text-gray-500">{result.total.toLocaleString('en-NG')} results</p>
              </div>
              <form method="get" class="flex items-center gap-2 shrink-0">
                {category && <input type="hidden" name="category" value={category} />}
                {q && <input type="hidden" name="q" value={q} />}
                {minPrice && <input type="hidden" name="min_price" value={minPrice} />}
                {maxPrice && <input type="hidden" name="max_price" value={maxPrice} />}
                {variableWeight && <input type="hidden" name="variable_weight" value={variableWeight} />}
                {wholesale && <input type="hidden" name="wholesale" value={wholesale} />}
                <label class="text-sm text-gray-500 hidden sm:inline">Sort by</label>
                <select name="sort" onchange="this.form.submit()" class="text-sm border border-gray-300 rounded-lg px-3 py-1.5">
                  <option value="newest" selected={sort === 'newest'}>Newest</option>
                  <option value="price_asc" selected={sort === 'price_asc'}>Price: Low to High</option>
                  <option value="price_desc" selected={sort === 'price_desc'}>Price: High to Low</option>
                  <option value="rating" selected={sort === 'rating'}>Top Rated</option>
                  <option value="bestselling" selected={sort === 'bestselling'}>Best Selling</option>
                </select>
              </form>
            </div>

            {/* ============ Mobile category chips ============ */}
            <div class="md:hidden flex gap-2 overflow-x-auto pb-3 mb-2 -mx-1 px-1">
              <a href={buildQuery({ category: undefined, page: undefined })} class={`shrink-0 text-xs px-3 py-1.5 rounded-full border ${!category ? 'bg-primary text-white border-primary' : 'border-gray-300 text-gray-600'}`}>All</a>
              {categories.map((cat) => (
                <a href={buildQuery({ category: cat.slug, page: undefined })} class={`shrink-0 text-xs px-3 py-1.5 rounded-full border ${category === cat.slug ? 'bg-primary text-white border-primary' : 'border-gray-300 text-gray-600'}`}>
                  {cat.name}
                </a>
              ))}
            </div>

            {result.categoryLookupFailed ? (
              <div class="text-center py-20 text-gray-400">
                <span class="material-symbols-outlined text-5xl mb-2">error_outline</span>
                <p>That Fresh category doesn't exist.</p>
                <a href="/fresh" class="text-primary font-semibold hover:underline mt-2 inline-block">Back to NaijaFresh</a>
              </div>
            ) : result.products.length === 0 ? (
              <div class="text-center py-20 text-gray-400">
                <span class="material-symbols-outlined text-5xl mb-2">search_off</span>
                <p>No Fresh products found. Try a different search, category or filter.</p>
              </div>
            ) : (
              <>
                <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {result.products.map((p) => <FreshProductCard product={p} />)}
                </div>
                {result.totalPages > 1 && (
                  <nav class="flex items-center justify-center gap-1.5 mt-8">
                    <a href={page > 1 ? buildQuery({ page: String(page - 1) }) : '#'} class={`w-9 h-9 flex items-center justify-center rounded-lg border text-sm ${page > 1 ? 'border-gray-300 text-gray-600 hover:border-primary hover:text-primary' : 'border-gray-100 text-gray-300 pointer-events-none'}`}>
                      <span class="material-symbols-outlined text-lg">chevron_left</span>
                    </a>
                    {Array.from({ length: result.totalPages }, (_, i) => i + 1)
                      .filter((n) => n === 1 || n === result.totalPages || Math.abs(n - page) <= 2)
                      .map((n, i, arr) => (
                        <>
                          {i > 0 && arr[i - 1] !== n - 1 && <span class="px-1 text-gray-400 text-sm">…</span>}
                          <a href={buildQuery({ page: String(n) })} class={`w-9 h-9 flex items-center justify-center rounded-lg border text-sm font-medium ${n === page ? 'bg-primary text-white border-primary' : 'border-gray-300 text-gray-600 hover:border-primary hover:text-primary'}`}>{n}</a>
                        </>
                      ))}
                    <a href={page < result.totalPages ? buildQuery({ page: String(page + 1) }) : '#'} class={`w-9 h-9 flex items-center justify-center rounded-lg border text-sm ${page < result.totalPages ? 'border-gray-300 text-gray-600 hover:border-primary hover:text-primary' : 'border-gray-100 text-gray-300 pointer-events-none'}`}>
                      <span class="material-symbols-outlined text-lg">chevron_right</span>
                    </a>
                  </nav>
                )}
              </>
            )}
          </div>
        </div>
      </Layout>
    )
  }

  // ============ Homepage mode ============
  const [freshToday, farmDirect, marketFresh, africanFoods, wholesaleBulk, imported] = await Promise.all([
    getFreshToday(db, 12),
    getFreshCollection(db, 'farm-direct', 12),
    getFreshCollection(db, 'market-fresh', 12),
    getFreshAfricanFoods(db, 12),
    getFreshCollection(db, 'wholesale', 12).then(async (wRows) => {
      const bulk = await getFreshCollection(db, 'bulk', 12)
      const seen = new Set(wRows.map((r) => r.id))
      return [...wRows, ...bulk.filter((r) => !seen.has(r.id))]
    }),
    getFreshCollection(db, 'imported', 12)
  ])

  return c.render(
    <Layout title="NaijaFresh" user={user} locale={locale} selectedCity={selectedCity}>
      {/* ============ Hero ============ */}
      <section class="relative bg-primary-dark text-white overflow-hidden">
        <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8 py-10 md:py-16 relative z-10">
          <div class="max-w-xl">
            <span class="inline-flex items-center gap-1.5 bg-white/10 text-primary-fixed text-xs font-semibold px-3 py-1 rounded-full mb-4">
              <span class="material-symbols-outlined text-sm">eco</span>NaijaFresh
            </span>
            <h1 class="text-3xl md:text-4xl lg:text-5xl font-bold leading-tight">Fresh food. Trusted sellers. Delivered to your door.</h1>
            <p class="text-white/80 mt-4 text-sm md:text-base leading-relaxed">
              Shop farm-fresh produce, groceries, meat, seafood, African foods and everyday essentials from trusted sellers near you.
            </p>
            <div class="flex flex-wrap items-center gap-3 mt-6">
              <a href="/fresh?sort=newest" class="bg-primary-fixed text-primary-dark font-semibold px-6 py-3 rounded-lg hover:brightness-95 transition flex items-center gap-2">
                <span class="material-symbols-outlined">shopping_basket</span>Shop Fresh Food
              </a>
              <a href={`/fresh?sort=newest`} id="shop-near-me-btn" class="bg-white/10 border border-white/30 text-white font-semibold px-6 py-3 rounded-lg hover:bg-white/20 transition flex items-center gap-2">
                <span class="material-symbols-outlined">near_me</span>Shop Near Me
              </a>
            </div>
            <p class="text-xs text-white/60 mt-3 flex items-center gap-1">
              <span class="material-symbols-outlined text-sm">location_on</span>Delivering to {selectedCity}, Nigeria
            </p>
          </div>
        </div>
        <div class="absolute inset-0 opacity-20 pointer-events-none" style="background: radial-gradient(circle at 80% 20%, rgba(255,199,44,0.4), transparent 60%);"></div>
      </section>

      {/* ============ In-page search (Fresh-scoped, separate from global /shop header search) ============ */}
      <section class="bg-white border-b border-gray-100">
        <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8 py-4">
          <form action="/fresh" method="get" class="flex items-stretch rounded-lg overflow-hidden border border-gray-300 max-w-xl">
            <input type="text" name="q" placeholder="Search fresh produce, meat, seafood, African foods..." class="flex-1 px-4 py-2.5 text-sm text-gray-800 outline-none min-w-0" />
            <button type="submit" class="flex items-center justify-center px-4 bg-primary text-white shrink-0">
              <span class="material-symbols-outlined">search</span>
            </button>
          </form>
        </div>
      </section>

      {/* ============ Category discovery — DB-driven ============ */}
      <section class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8 py-6">
        <h2 class="text-lg md:text-xl font-bold text-gray-900 mb-4">Shop by Category</h2>
        <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-10 gap-3">
          {categories.map((cat) => (
            <a href={`/fresh?category=${cat.slug}`} class="flex flex-col items-center gap-2 group">
              <span class="w-14 h-14 md:w-16 md:h-16 rounded-full bg-primary-light flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-colors text-primary-dark">
                <span class="material-symbols-outlined text-2xl">{cat.icon}</span>
              </span>
              <span class="text-[11px] md:text-xs text-center text-gray-700 leading-tight">{cat.name}</span>
            </a>
          ))}
        </div>
      </section>

      {/* ============ Product rails — real DB queries ============ */}
      <FreshProductCarousel title="Fresh Today" subtitle="Newest arrivals from NaijaFresh sellers" icon="today" products={freshToday} viewAllHref="/fresh?sort=newest" id="today" />
      <FreshProductCarousel title="Farm Direct" subtitle="Straight from the farm, no middlemen" icon="agriculture" products={farmDirect} viewAllHref="/fresh?collection=farm-direct" id="farm-direct" />
      <FreshProductCarousel title="Market Fresh" subtitle="Handpicked from local markets" icon="storefront" products={marketFresh} viewAllHref="/fresh?collection=market-fresh" id="market-fresh" />
      <FreshProductCarousel title="African Foods" subtitle="Traditional African staples and delicacies" icon="public" products={africanFoods} viewAllHref="/fresh?category=fresh-african-traditional-foods" id="african-foods" />
      <FreshProductCarousel title="Wholesale & Bulk" subtitle="Volume pricing for bulk buyers" icon="inventory_2" products={wholesaleBulk} viewAllHref="/fresh?wholesale=1" id="wholesale-bulk" />
      <FreshProductCarousel title="Imported Groceries" subtitle="International pantry favorites" icon="flight" products={imported} viewAllHref="/fresh?category=fresh-imported-groceries" id="imported" />

      {/* ============ Trust strip ============ */}
      <section class="bg-primary-light border-t border-gray-100">
        <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8 py-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs md:text-sm text-primary-dark">
          <span class="flex items-center gap-2"><span class="material-symbols-outlined">verified_user</span>Verified sellers</span>
          <span class="flex items-center gap-2"><span class="material-symbols-outlined">local_shipping</span>Fast local delivery</span>
          <span class="flex items-center gap-2"><span class="material-symbols-outlined">payments</span>Pay in Naira</span>
          <span class="flex items-center gap-2"><span class="material-symbols-outlined">eco</span>Real freshness data</span>
        </div>
      </section>
    </Layout>
  )
}

/** Sticky sub-header shown on Fresh browse/category pages — a lightweight, mobile-friendly "back to Fresh home" + city context strip, per §22's "mobile header, sticky search" requirement. */
function FreshSubheader({ selectedCity }: { selectedCity: string }) {
  return (
    <div class="bg-primary-dark text-white sticky top-[52px] md:top-[104px] z-40">
      <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8 py-2 flex items-center justify-between">
        <a href="/fresh" class="flex items-center gap-1.5 text-sm font-semibold">
          <span class="material-symbols-outlined text-lg">eco</span>NaijaFresh
        </a>
        <span class="text-[11px] text-white/70 flex items-center gap-1">
          <span class="material-symbols-outlined text-sm">location_on</span>{selectedCity}
        </span>
      </div>
    </div>
  )
}

/**
 * /fresh/:slug — Fresh product detail page. This is NOT a separate PDP
 * system (Pat's §19): it extends the exact same buy-box query shape and
 * layout structure as src/pages/product.tsx (breadcrumb, gallery, info
 * column, sticky buy box, compare-sellers table, reviews, Q&A, related
 * products), ADDING Fresh-specific facts (freshness badge, harvest date,
 * unit/weight, variable-weight notice, wholesale tier table) that the base
 * PDP has no columns for. Cart/wishlist/checkout actions are 100% identical
 * markup+JS hooks to product.tsx — zero new write paths.
 */
export async function freshProductPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')
  const slug = c.req.param('slug')

  const product = await db
    .prepare(
      `SELECT p.*,
              cat.name as category_name, cat.slug as category_slug,
              b.name as brand_name, b.slug as brand_slug,
              l.id as listing_id, l.vendor_id, v.name as vendor_name, v.slug as vendor_slug,
              v.city as vendor_city, v.state as vendor_state,
              l.price_kobo, l.compare_at_price_kobo, l.currency, l.stock,
              l.delivery_days_min, l.delivery_days_max, l.is_plus, l.warranty_months, l.condition,
              l.unit_of_measure, l.unit_quantity, l.is_variable_weight, l.variable_weight_tolerance_pct,
              (SELECT COUNT(*) FROM product_listings l2 WHERE l2.product_id = p.id AND l2.is_active = 1) as seller_count
       FROM products p
       JOIN product_listings l ON l.product_id = p.id AND l.is_primary = 1 AND l.is_active = 1
       JOIN vendors v ON v.id = l.vendor_id
       JOIN categories cat ON cat.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE p.slug = ? AND p.is_active = 1
         AND (cat.id = ${FRESH_ROOT_CATEGORY_ID} OR cat.path LIKE '${FRESH_ROOT_CATEGORY_ID}/%')`
    )
    .bind(slug)
    .first<ProductWithListingRow & { warranty_months: number; condition: string }>()

  if (!product) {
    c.status(404)
    return c.render(
      <Layout title="Not found" user={user} locale={locale}>
        <div class="max-w-2xl mx-auto text-center py-20">
          <span class="material-symbols-outlined text-5xl text-gray-300">search_off</span>
          <h1 class="text-xl font-bold mt-4">Fresh product not found</h1>
          <a href="/fresh" class="text-primary font-semibold hover:underline mt-2 inline-block">Back to NaijaFresh</a>
        </div>
      </Layout>
    )
  }

  await recordBehaviorEvent(c, { eventType: 'product_view', productId: product.id, categoryId: product.category_id, source: 'fresh_pdp' })

  const [listingsResult, reviews, questions, related, pricingTiers, collectionRows] = await Promise.all([
    getListingsForProduct(db, product.id),
    db.prepare('SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC LIMIT 20').bind(product.id).all<ReviewRow>(),
    db.prepare('SELECT * FROM product_questions WHERE product_id = ? ORDER BY created_at DESC LIMIT 10').bind(product.id).all<QuestionRow>(),
    db
      .prepare(
        `SELECT p.*, cat.name as category_name, cat.slug as category_slug,
                l.id as listing_id, l.vendor_id, v.name as vendor_name, v.slug as vendor_slug,
                v.city as vendor_city, v.state as vendor_state,
                l.price_kobo, l.compare_at_price_kobo, l.currency, l.stock, l.delivery_days_min, l.delivery_days_max, l.is_plus,
                l.unit_of_measure, l.unit_quantity, l.is_variable_weight,
                (SELECT COUNT(*) FROM product_listings l2 WHERE l2.product_id = p.id AND l2.is_active = 1) as seller_count
         FROM products p
         JOIN product_listings l ON l.product_id = p.id AND l.is_primary = 1 AND l.is_active = 1
         JOIN vendors v ON v.id = l.vendor_id
         JOIN categories cat ON cat.id = p.category_id
         WHERE p.category_id = ? AND p.id != ? AND p.is_active = 1
           AND p.image_url IS NOT NULL AND p.image_url NOT LIKE '/ph.svg%'
         ORDER BY p.rating_count DESC LIMIT 10`
      )
      .bind(product.category_id, product.id)
      .all<ProductWithListingRow>(),
    getPricingTiersForListing(db, product.listing_id),
    db
      .prepare(`SELECT col.slug FROM collections col JOIN product_collections pc ON pc.collection_id = col.id WHERE pc.product_id = ?`)
      .bind(product.id)
      .all<{ slug: string }>()
  ])

  const listings = listingsResult as any[]
  const primaryListing = listings.find((l) => l.is_primary === 1) ?? listings[0]
  const otherListings = listings.filter((l) => l.id !== primaryListing?.id)
  const variants = primaryListing ? (await getVariantsForListing(db, primaryListing.id)) as any[] : []

  const gallery: string[] = JSON.parse(product.gallery_json || '[]')
  const images = gallery.length > 0 ? gallery : [product.image_url]
  const specs: Record<string, string> = JSON.parse(product.specs_json || '{}')

  const discount = discountPercent(product.price_kobo, product.compare_at_price_kobo)
  const cheapestListing = listings.reduce((min: any, l: any) => (!min || l.price_kobo < min.price_kobo ? l : min), null as any)

  const ratingCounts = [5, 4, 3, 2, 1].map((star) => ({ star, count: reviews.results.filter((r) => r.rating === star).length }))
  const totalSampled = reviews.results.length

  const freshness = product.freshness_status ? FRESHNESS_LABEL[product.freshness_status] : null
  const collectionBadges = collectionRows.results.map((r) => COLLECTION_BADGE_LABEL[r.slug]).filter(Boolean) as string[]
  const unitLabel = product.unit_of_measure
    ? `${product.unit_quantity && product.unit_quantity !== 1 ? product.unit_quantity : ''} ${product.unit_of_measure}`.trim()
    : null

  return c.render(
    <Layout title={product.title} user={user} locale={locale}>
      <div id="pdp-root" class="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 py-6" data-product-id={product.id}>
        {/* ============ Breadcrumb ============ */}
        <nav class="text-xs text-gray-500 mb-4 flex items-center gap-1.5 flex-wrap">
          <a href="/fresh" class="hover:text-primary">NaijaFresh</a>
          <span class="material-symbols-outlined text-sm">chevron_right</span>
          <a href={`/fresh?category=${product.category_slug}`} class="hover:text-primary">{product.category_name}</a>
        </nav>

        <div class="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_320px] gap-6 lg:gap-8">
          {/* ============ Gallery ============ */}
          <div>
            <div class="relative bg-gray-100 rounded-xl overflow-hidden aspect-square mb-3" id="pdp-main-image-wrap">
              <img id="pdp-main-image" src={images[0]} alt={product.title} class="w-full h-full object-cover" />
              {freshness && (
                <span class={`absolute top-3 left-3 ${freshness.color} text-xs font-bold px-2.5 py-1.5 rounded-full flex items-center gap-1.5`}>
                  <span class="material-symbols-outlined text-sm">{freshness.icon}</span>{freshness.label}
                </span>
              )}
            </div>
            {images.length > 1 && (
              <div class="flex gap-2 overflow-x-auto pb-1">
                {images.map((img, i) => (
                  <button type="button" class={`pdp-thumb shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 ${i === 0 ? 'border-primary' : 'border-gray-200'}`} data-image={img}>
                    <img src={img} alt={`${product.title} thumbnail ${i + 1}`} class="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ============ Info column ============ */}
          <div>
            <div class="flex items-center gap-1.5 flex-wrap mb-1">
              {collectionBadges.map((label) => (
                <span class="text-[10px] font-semibold text-primary-dark bg-primary-light px-2 py-0.5 rounded">{label}</span>
              ))}
            </div>
            <h1 class="text-2xl font-bold text-gray-900">{product.title}</h1>

            <div class="flex items-center gap-3 mt-2 flex-wrap">
              {product.rating_count > 0 && (
                <a href="#reviews" class="flex items-center gap-1 text-sm text-gray-600 hover:text-primary">
                  <span class="flex text-amber-500">
                    {[1, 2, 3, 4, 5].map((i) => <span class="material-symbols-outlined text-base" style={`font-variation-settings:'FILL' ${i <= Math.round(product.rating_avg) ? 1 : 0}`}>star</span>)}
                  </span>
                  <span class="font-semibold">{product.rating_avg.toFixed(1)}</span>
                  <span class="underline">({formatRatingCount(product.rating_count)} ratings)</span>
                </a>
              )}
              <span class="text-sm text-gray-500">{product.sales_count > 0 ? `${formatRatingCount(product.sales_count)} sold` : 'New listing'}</span>
            </div>

            <div class="flex items-baseline gap-3 mt-4 border-t border-gray-100 pt-4">
              <span class="text-3xl font-bold text-gray-900">{formatMoney(product.price_kobo, product.currency)}</span>
              {unitLabel && <span class="text-sm text-gray-500">/ {unitLabel}</span>}
              {product.compare_at_price_kobo && (
                <>
                  <span class="text-lg text-gray-400 line-through">{formatMoney(product.compare_at_price_kobo, product.currency)}</span>
                  <span class="text-sm font-semibold text-red-600">-{discount}%</span>
                </>
              )}
            </div>
            {product.is_variable_weight === 1 && (
              <p class="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3 flex items-start gap-2">
                <span class="material-symbols-outlined text-base shrink-0">info</span>
                Estimated price based on selected weight. Final price may vary according to fulfilled weight (±{product.variable_weight_tolerance_pct}%).
              </p>
            )}
            {product.harvested_date && (
              <p class="text-sm text-gray-600 mt-3 flex items-center gap-2">
                <span class="material-symbols-outlined text-primary text-lg">calendar_today</span>
                Harvested: {new Date(product.harvested_date).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' })}
              </p>
            )}
            {(product.seller_count ?? 0) > 1 && (
              <a href="#compare-sellers" class="text-sm text-primary font-semibold hover:underline mt-1 inline-block">
                {product.seller_count ?? 0} sellers from {formatMoney(cheapestListing.price_kobo, cheapestListing.currency)}
              </a>
            )}

            <p class="text-gray-600 mt-4 text-sm leading-relaxed">{product.description}</p>

            <ul class="mt-4 space-y-1.5 text-sm text-gray-600">
              <li class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-lg">local_shipping</span>
                {product.delivery_days_min === product.delivery_days_max
                  ? `Delivered in ${product.delivery_days_min} day${product.delivery_days_min > 1 ? 's' : ''}`
                  : `Delivered in ${product.delivery_days_min}-${product.delivery_days_max} days`} to your address
              </li>
              <li class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-lg">verified_user</span>Covered by NaijaDeals Buyer Protection — pay into escrow, confirm before release</li>
              <li class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-lg">replay</span>{product.return_policy}</li>
            </ul>
          </div>

          {/* ============ Buy box ============ */}
          <div class="lg:sticky lg:top-20 h-fit bg-white border border-gray-200 rounded-xl p-5">
            <div class="flex items-baseline gap-2">
              <span class="text-2xl font-bold text-gray-900">{formatMoney(product.price_kobo, product.currency)}</span>
              {unitLabel && <span class="text-sm text-gray-500">/ {unitLabel}</span>}
              {product.compare_at_price_kobo && <span class="text-sm text-gray-400 line-through">{formatMoney(product.compare_at_price_kobo, product.currency)}</span>}
            </div>
            {product.stock > 0 ? (
              <p class="text-sm text-green-700 font-medium mt-1 flex items-center gap-1">
                <span class="material-symbols-outlined text-base">check_circle</span>In Stock
                {product.stock <= 5 && <span class="text-orange-600">— only {product.stock} left</span>}
              </p>
            ) : (
              <p class="text-sm text-red-600 font-medium mt-1">Out of stock</p>
            )}

            <div class="flex items-center gap-2 mt-2 text-sm text-gray-600">
              <span class="material-symbols-outlined text-base">storefront</span>
              Sold by <a href={`/fresh?q=${encodeURIComponent(product.vendor_name)}`} class="text-primary font-medium hover:underline">{product.vendor_name}</a>
              <span class="material-symbols-outlined text-primary text-base" style="font-variation-settings:'FILL' 1">verified</span>
            </div>
            {(product.vendor_city || product.vendor_state) && (
              <p class="text-xs text-gray-500 mt-1 flex items-center gap-1">
                <span class="material-symbols-outlined text-sm">location_on</span>{[product.vendor_city, product.vendor_state].filter(Boolean).join(', ')}
              </p>
            )}

            {pricingTiers.length > 0 && (
              <div class="mt-4 border-t border-gray-100 pt-3">
                <p class="text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-1">
                  <span class="material-symbols-outlined text-sm">inventory_2</span>Wholesale pricing
                </p>
                <table class="w-full text-xs">
                  <tbody>
                    <tr class="text-gray-500 border-b border-gray-100">
                      <td class="py-1">1-{pricingTiers[0].min_quantity - 1} {product.unit_of_measure}</td>
                      <td class="py-1 text-right font-medium text-gray-800">{formatMoney(product.price_kobo, product.currency)} each</td>
                    </tr>
                    {pricingTiers.map((t) => (
                      <tr class="text-gray-500 border-b border-gray-100 last:border-0">
                        <td class="py-1">{t.tier_label || `${t.min_quantity}${t.max_quantity ? `-${t.max_quantity}` : '+'} ${product.unit_of_measure}`}</td>
                        <td class="py-1 text-right font-medium text-gray-800">{formatMoney(t.unit_price_kobo, product.currency)} each</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {product.stock > 0 && (
              <>
                <div class="flex items-center gap-3 mt-4">
                  <label class="text-sm font-medium text-gray-700">Qty {unitLabel && <span class="text-gray-400">({unitLabel} each)</span>}</label>
                  <div class="flex items-center border border-gray-300 rounded-lg">
                    <button type="button" id="qty-minus" class="w-9 h-9 flex items-center justify-center text-gray-600 hover:bg-gray-100">-</button>
                    <input id="qty-input" type="number" value="1" min="1" max={product.stock} class="w-12 text-center border-x border-gray-300 py-1.5 outline-none" />
                    <button type="button" id="qty-plus" class="w-9 h-9 flex items-center justify-center text-gray-600 hover:bg-gray-100">+</button>
                  </div>
                </div>

                <button id="add-to-cart-btn" data-listing-id={product.listing_id} class="w-full mt-4 bg-primary-fixed text-primary-dark font-semibold py-3 rounded-lg hover:brightness-95 transition flex items-center justify-center gap-2">
                  <span class="material-symbols-outlined">add_shopping_cart</span>Add to cart
                </button>
                <a href={`/checkout?buy_now_listing=${product.listing_id}`} class="w-full mt-2 bg-primary text-white font-semibold py-3 rounded-lg hover:bg-primary-dark transition text-center block">
                  Buy now
                </a>
              </>
            )}

            <div class="flex flex-col gap-2 mt-4 pt-4 border-t border-gray-100 text-xs text-gray-500">
              <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-base">local_shipping</span>Ships in {product.delivery_days_min}-{product.delivery_days_max} days</span>
              <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-base">verified_user</span>Escrow buyer protection</span>
              <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-base">replay</span>{product.return_policy}</span>
            </div>
          </div>
        </div>

        {/* ============ Compare Sellers ============ */}
        {listings.length > 1 && (
          <section id="compare-sellers" class="mt-10 border-t border-gray-200 pt-6">
            <h2 class="text-lg font-bold text-gray-800 mb-4">Compare Sellers ({listings.length})</h2>
            <div class="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
              <table class="w-full text-sm border-collapse min-w-[640px]">
                <thead>
                  <tr class="text-left text-gray-500 border-b border-gray-200">
                    <th class="py-2 pr-4 font-medium">Seller</th>
                    <th class="py-2 pr-4 font-medium">Price</th>
                    <th class="py-2 pr-4 font-medium">Delivery</th>
                    <th class="py-2 pr-4 font-medium">Rating</th>
                    <th class="py-2 pr-4 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {listings.map((l: any) => (
                    <tr class={`border-b border-gray-100 ${l.id === primaryListing?.id ? 'bg-primary-light/40' : ''}`}>
                      <td class="py-3 pr-4">
                        <div class="flex items-center gap-2">
                          <span class="font-medium text-gray-800">{l.vendor_name}</span>
                          {l.is_verified === 1 && <span class="material-symbols-outlined text-primary text-base" style="font-variation-settings:'FILL' 1">verified</span>}
                          {l.id === primaryListing?.id && <span class="text-[10px] bg-primary text-white px-1.5 py-0.5 rounded font-semibold">BUY BOX</span>}
                        </div>
                        <p class="text-xs text-gray-500">{l.vendor_city}, {l.vendor_state} · {l.positive_feedback_percent}% positive</p>
                      </td>
                      <td class="py-3 pr-4 font-semibold text-gray-900">{formatMoney(l.price_kobo, l.currency)}</td>
                      <td class="py-3 pr-4 text-gray-600">{l.delivery_days_min}-{l.delivery_days_max} days</td>
                      <td class="py-3 pr-4 text-gray-600">
                        <span class="flex items-center gap-0.5">
                          <span class="material-symbols-outlined text-amber-500 text-sm" style="font-variation-settings:'FILL' 1">star</span>{l.vendor_rating.toFixed(1)}
                        </span>
                      </td>
                      <td class="py-3 pr-4">
                        {l.stock > 0 ? (
                          <button type="button" class="add-listing-btn text-xs font-semibold text-white bg-primary px-3 py-1.5 rounded-lg hover:bg-primary-dark transition" data-listing-id={l.id}>Add to cart</button>
                        ) : (
                          <span class="text-xs text-red-500 font-medium">Out of stock</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ============ Specs & Description ============ */}
        <section class="mt-10 border-t border-gray-200 pt-6 grid md:grid-cols-2 gap-8">
          <div>
            <h2 class="text-lg font-bold text-gray-800 mb-4">Product Details</h2>
            <dl class="space-y-2 text-sm">
              {product.unit_of_measure && (
                <div class="flex gap-2 py-1.5 border-b border-gray-100">
                  <dt class="text-gray-500 w-36 shrink-0">Unit</dt>
                  <dd class="text-gray-800">{unitLabel}</dd>
                </div>
              )}
              {freshness && (
                <div class="flex gap-2 py-1.5 border-b border-gray-100">
                  <dt class="text-gray-500 w-36 shrink-0">Freshness</dt>
                  <dd class="text-gray-800">{freshness.label}</dd>
                </div>
              )}
              {product.is_variable_weight === 1 && (
                <div class="flex gap-2 py-1.5 border-b border-gray-100">
                  <dt class="text-gray-500 w-36 shrink-0">Weight tolerance</dt>
                  <dd class="text-gray-800">±{product.variable_weight_tolerance_pct}%</dd>
                </div>
              )}
              {Object.entries(specs).map(([k, v]) => (
                <div class="flex gap-2 py-1.5 border-b border-gray-100">
                  <dt class="text-gray-500 w-36 shrink-0">{k}</dt>
                  <dd class="text-gray-800">{v}</dd>
                </div>
              ))}
              <div class="flex gap-2 py-1.5 border-b border-gray-100">
                <dt class="text-gray-500 w-36 shrink-0">Sold by</dt>
                <dd class="text-gray-800">{product.vendor_name}</dd>
              </div>
              <div class="flex gap-2 py-1.5 border-b border-gray-100">
                <dt class="text-gray-500 w-36 shrink-0">Product ID</dt>
                <dd class="text-gray-800">FRESH-{product.id}</dd>
              </div>
            </dl>
          </div>
          <div>
            <h2 class="text-lg font-bold text-gray-800 mb-4">About this item</h2>
            <p class="text-sm text-gray-600 leading-relaxed">{product.long_description || product.description}</p>
          </div>
        </section>

        {/* ============ Reviews ============ */}
        <section id="reviews" class="mt-10 border-t border-gray-200 pt-6">
          <h2 class="text-lg font-bold text-gray-800 mb-4">Customer Reviews</h2>
          {product.rating_count > 0 ? (
            <div class="flex flex-col sm:flex-row items-start gap-6 mb-6">
              <div class="text-center shrink-0">
                <div class="text-3xl font-bold text-gray-900">{product.rating_avg.toFixed(1)}</div>
                <div class="flex text-amber-500 justify-center">
                  {[1, 2, 3, 4, 5].map((i) => <span class="material-symbols-outlined text-lg" style={`font-variation-settings:'FILL' ${i <= Math.round(product.rating_avg) ? 1 : 0}`}>star</span>)}
                </div>
                <div class="text-xs text-gray-500 mt-1">{formatRatingCount(product.rating_count)} global ratings</div>
              </div>
              <div class="flex-1 space-y-1 max-w-xs w-full">
                {ratingCounts.map((r) => (
                  <a href="#reviews" class="flex items-center gap-2 text-xs text-gray-500 hover:text-primary">
                    <span class="w-10">{r.star} star</span>
                    <div class="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div class="h-full bg-amber-400" style={`width: ${totalSampled ? (r.count / totalSampled) * 100 : 0}%`}></div>
                    </div>
                    <span class="w-6 text-right">{r.count}</span>
                  </a>
                ))}
              </div>
            </div>
          ) : (
            <p class="text-sm text-gray-400 mb-6">No reviews yet — be the first to review this product.</p>
          )}
        </section>

        {/* ============ Similar Fresh products ============ */}
        {related.results.length > 0 && (
          <section class="mt-10 border-t border-gray-200 pt-6">
            <h2 class="text-lg font-bold text-gray-800 mb-4">Similar Fresh Products</h2>
            <div class="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 snap-x scroll-smooth [&::-webkit-scrollbar]:hidden">
              {related.results.map((p) => <FreshProductCard product={p} carousel />)}
            </div>
          </section>
        )}
      </div>
    </Layout>
  )
}

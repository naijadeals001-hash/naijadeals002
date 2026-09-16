import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import { ProductCard } from '../components/ProductCard'
import type { AppEnv, CategoryRow, ProductWithListingRow } from '../types'
import { recordBehaviorEvent } from '../lib/behavior-events'

const PER_PAGE = 24

export async function shopPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')
  const category = c.req.query('category')
  const q = c.req.query('q')
  const deals = c.req.query('deals')
  const brand = c.req.query('brand')
  const nigerianOnly = c.req.query('nigerian')
  const minPrice = c.req.query('min_price')
  const maxPrice = c.req.query('max_price')
  const minRating = c.req.query('min_rating')
  const sort = c.req.query('sort') || 'newest'
  const page = Math.max(1, Number(c.req.query('page') || '1'))
  const offset = (page - 1) * PER_PAGE

  const [categories, brands] = await Promise.all([
    // Phase 1a bug fix: scope to category_type='product' so NaijaGigs' service
    // categories (Home Services, Beauty Services, ...) never appear as a
    // marketplace filter option. Departments (level=1) power the sidebar list;
    // deeper levels are still reachable via getByCategory's descendant match below.
    db.prepare(`SELECT * FROM categories WHERE parent_id IS NULL AND category_type = 'product' ORDER BY sort_order ASC`).all<CategoryRow>(),
    db.prepare('SELECT slug, name FROM brands ORDER BY name ASC').all<{ slug: string; name: string }>()
  ])

  // Buy-box aware query: join each product to its PRIMARY active listing (see catalog.ts
  // PRODUCT_CARD_SELECT for the canonical version of this join — duplicated here because this
  // page needs dynamic WHERE clauses for the filter sidebar, which a fixed helper can't express).
  //
  // VISUAL AUDIT FIX (Pat's "Full Visual Asset Audit" directive, 2026-09-15): kept in sync with
  // catalog.ts's PRODUCT_CARD_SELECT real-asset filter — a product without a verified photo
  // (image_url still the /ph.svg placeholder-generator route) must never render on the
  // customer-facing /shop grid either, not just be excluded from homepage carousels.
  let sql = `
    SELECT p.*,
           cat.name as category_name, cat.slug as category_slug,
           b.name as brand_name, b.slug as brand_slug,
           l.id as listing_id, l.vendor_id, v.name as vendor_name, v.slug as vendor_slug,
           l.price_kobo, l.compare_at_price_kobo, l.stock,
           l.delivery_days_min, l.delivery_days_max, l.is_plus,
           (SELECT COUNT(*) FROM product_listings l2 WHERE l2.product_id = p.id AND l2.is_active = 1) as seller_count
    FROM products p
    JOIN product_listings l ON l.product_id = p.id AND l.is_primary = 1 AND l.is_active = 1
    JOIN vendors v ON v.id = l.vendor_id
    JOIN categories cat ON cat.id = p.category_id
    LEFT JOIN brands b ON b.id = p.brand_id
    WHERE p.is_active = 1 AND p.image_url IS NOT NULL AND p.image_url NOT LIKE '/ph.svg%'
  `
  const binds: any[] = []
  let categoryRoot: { id: number; path: string | null } | null = null
  if (category) {
    // Match the category itself OR any descendant at any depth (department -> group
    // -> subcategory -> leaf) via the materialized path (migration 0053), not just
    // direct children — a "Fashion" filter must also surface "Ankara Fabric" products.
    categoryRoot = await db.prepare('SELECT id, path FROM categories WHERE slug = ?').bind(category).first<{ id: number; path: string | null }>()
    if (categoryRoot) {
      sql += ' AND (cat.id = ? OR cat.path LIKE ?)'
      binds.push(categoryRoot.id, `${categoryRoot.path ?? categoryRoot.id}/%`)
    } else {
      sql += ' AND 1 = 0' // unknown category slug — honest zero results, not a silent full-catalog fallback
    }
  }
  if (q) {
    sql += ' AND (p.title LIKE ? OR p.description LIKE ? OR v.name LIKE ?)'
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`)
  }
  if (deals === '1') sql += ' AND l.compare_at_price_kobo IS NOT NULL'
  if (brand) {
    sql += ' AND b.slug = ?'
    binds.push(brand)
  }
  if (nigerianOnly === '1') sql += ' AND b.is_nigerian = 1'
  if (minPrice) {
    sql += ' AND l.price_kobo >= ?'
    binds.push(Number(minPrice) * 100)
  }
  if (maxPrice) {
    sql += ' AND l.price_kobo <= ?'
    binds.push(Number(maxPrice) * 100)
  }
  if (minRating) {
    sql += ' AND p.rating_avg >= ?'
    binds.push(Number(minRating))
  }

  // Phase 3A — record category_view / search behavior events. Best-effort,
  // never blocks rendering. Only fires on page 1 of a given filter combo's
  // natural entry point (category browse or a search query) — pagination
  // clicks and pure sort/price/rating refinements on an already-logged view
  // are not separately re-logged, avoiding one visit inflating the signal.
  if (page === 1) {
    if (categoryRoot) {
      await recordBehaviorEvent(c, { eventType: 'category_view', categoryId: categoryRoot.id, source: 'shop_grid' })
    }
    if (q) {
      await recordBehaviorEvent(c, { eventType: 'search', searchQuery: q, source: 'shop_grid' })
    }
  }

  const countSql = sql.replace(/SELECT p\.\*[\s\S]*?FROM products p/, 'SELECT COUNT(*) as total FROM products p')
  const countRow = await db.prepare(countSql).bind(...binds).first<{ total: number }>()
  const total = countRow?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  switch (sort) {
    case 'price_asc': sql += ' ORDER BY l.price_kobo ASC'; break
    case 'price_desc': sql += ' ORDER BY l.price_kobo DESC'; break
    case 'rating': sql += ' ORDER BY p.rating_avg DESC, p.rating_count DESC'; break
    case 'bestselling': sql += ' ORDER BY p.sales_count DESC'; break
    default: sql += ' ORDER BY p.id DESC'
  }
  sql += ' LIMIT ? OFFSET ?'
  binds.push(PER_PAGE, offset)

  const products = await db.prepare(sql).bind(...binds).all<ProductWithListingRow>()

  const activeCategory = categories.results.find((cat) => cat.slug === category)
  const activeBrand = brands.results.find((b) => b.slug === brand)
  const pageTitle = q
    ? `Search: ${q}`
    : deals === '1'
    ? "Today's Deals"
    : nigerianOnly === '1'
    ? 'Proudly Nigerian'
    : activeBrand
    ? activeBrand.name
    : activeCategory
    ? activeCategory.name
    : 'All Products'

  // Preserves every active filter/sort param when building a link that only changes ONE of them
  // (pagination, sort dropdown, filter checkboxes) — avoids losing the rest of the query string.
  function buildQuery(overrides: Record<string, string | undefined>): string {
    const params = new URLSearchParams()
    const current: Record<string, string | undefined> = { category, q, deals, brand, nigerian: nigerianOnly, min_price: minPrice, max_price: maxPrice, min_rating: minRating, sort, page: String(page) }
    const merged = { ...current, ...overrides }
    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined && v !== '' && !(k === 'page' && v === '1')) params.set(k, v)
    }
    const str = params.toString()
    return str ? `/shop?${str}` : '/shop'
  }

  return c.render(
    <Layout title={pageTitle} user={user} locale={locale}>
      <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8 py-6 flex gap-6">
        {/* ============ Sidebar filters (desktop) ============ */}
        <aside class="hidden md:block w-60 shrink-0 space-y-6">
          <div>
            <h3 class="font-semibold text-gray-800 mb-3">Categories</h3>
            <nav class="flex flex-col gap-1">
              <a href={buildQuery({ category: undefined, page: undefined })} class={`text-sm px-3 py-2 rounded-lg ${!category ? 'bg-primary-light text-primary-dark font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}>
                All categories
              </a>
              {categories.results.map((cat) => (
                <a
                  href={buildQuery({ category: cat.slug, page: undefined })}
                  class={`text-sm px-3 py-2 rounded-lg ${category === cat.slug ? 'bg-primary-light text-primary-dark font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  {cat.name}
                </a>
              ))}
            </nav>
          </div>

          <div class="border-t border-gray-200 pt-4">
            <h3 class="font-semibold text-gray-800 mb-3">Brand</h3>
            <select
              onchange="location.href = this.value"
              class="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 outline-none"
            >
              <option value={buildQuery({ brand: undefined, page: undefined })}>All brands</option>
              {brands.results.map((b) => (
                <option value={buildQuery({ brand: b.slug, page: undefined })} selected={brand === b.slug}>{b.name}</option>
              ))}
            </select>
          </div>

          <form method="get" class="border-t border-gray-200 pt-4">
            {category && <input type="hidden" name="category" value={category} />}
            {q && <input type="hidden" name="q" value={q} />}
            {deals && <input type="hidden" name="deals" value={deals} />}
            {brand && <input type="hidden" name="brand" value={brand} />}
            {sort && <input type="hidden" name="sort" value={sort} />}
            <h3 class="font-semibold text-gray-800 mb-3">Price Range (₦)</h3>
            <div class="flex items-center gap-2 mb-4">
              <input type="number" name="min_price" value={minPrice ?? ''} placeholder="Min" class="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 outline-none" />
              <span class="text-gray-400">–</span>
              <input type="number" name="max_price" value={maxPrice ?? ''} placeholder="Max" class="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 outline-none" />
            </div>

            <h3 class="font-semibold text-gray-800 mb-3">Customer Rating</h3>
            <div class="flex flex-col gap-1.5 mb-4">
              {[4, 3, 2, 1].map((r) => (
                <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input type="radio" name="min_rating" value={String(r)} checked={minRating === String(r)} />
                  <span class="flex items-center gap-0.5 text-amber-500">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <span class="material-symbols-outlined text-sm" style={`font-variation-settings:'FILL' ${i <= r ? 1 : 0}`}>star</span>
                    ))}
                  </span>
                  <span>&amp; up</span>
                </label>
              ))}
            </div>

            <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer mb-4">
              <input type="checkbox" name="nigerian" value="1" checked={nigerianOnly === '1'} />
              Proudly Nigerian brands only
            </label>

            <button type="submit" class="w-full bg-primary text-white text-sm font-semibold py-2 rounded-lg hover:bg-primary-dark transition">Apply filters</button>
          </form>
        </aside>

        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between mb-4 gap-3">
            <div>
              <h1 class="text-xl font-bold text-gray-800">{pageTitle}</h1>
              <p class="text-sm text-gray-500">{total.toLocaleString('en-NG')} results</p>
            </div>
            <form method="get" class="flex items-center gap-2 shrink-0">
              {category && <input type="hidden" name="category" value={category} />}
              {q && <input type="hidden" name="q" value={q} />}
              {deals && <input type="hidden" name="deals" value={deals} />}
              {brand && <input type="hidden" name="brand" value={brand} />}
              {nigerianOnly && <input type="hidden" name="nigerian" value={nigerianOnly} />}
              {minPrice && <input type="hidden" name="min_price" value={minPrice} />}
              {maxPrice && <input type="hidden" name="max_price" value={maxPrice} />}
              {minRating && <input type="hidden" name="min_rating" value={minRating} />}
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
            {categories.results.map((cat) => (
              <a href={buildQuery({ category: cat.slug, page: undefined })} class={`shrink-0 text-xs px-3 py-1.5 rounded-full border ${category === cat.slug ? 'bg-primary text-white border-primary' : 'border-gray-300 text-gray-600'}`}>
                {cat.name}
              </a>
            ))}
          </div>

          {products.results.length === 0 ? (
            <div class="text-center py-20 text-gray-400">
              <span class="material-symbols-outlined text-5xl mb-2">search_off</span>
              <p>No products found. Try a different search, category or filter.</p>
            </div>
          ) : (
            <>
              <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {products.results.map((p) => <ProductCard product={p} />)}
              </div>

              {/* ============ Pagination ============ */}
              {totalPages > 1 && (
                <nav class="flex items-center justify-center gap-1.5 mt-8">
                  <a
                    href={page > 1 ? buildQuery({ page: String(page - 1) }) : '#'}
                    class={`w-9 h-9 flex items-center justify-center rounded-lg border text-sm ${page > 1 ? 'border-gray-300 text-gray-600 hover:border-primary hover:text-primary' : 'border-gray-100 text-gray-300 pointer-events-none'}`}
                  >
                    <span class="material-symbols-outlined text-lg">chevron_left</span>
                  </a>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((n) => n === 1 || n === totalPages || Math.abs(n - page) <= 2)
                    .map((n, i, arr) => (
                      <>
                        {i > 0 && arr[i - 1] !== n - 1 && <span class="px-1 text-gray-400 text-sm">…</span>}
                        <a
                          href={buildQuery({ page: String(n) })}
                          class={`w-9 h-9 flex items-center justify-center rounded-lg border text-sm font-medium ${n === page ? 'bg-primary text-white border-primary' : 'border-gray-300 text-gray-600 hover:border-primary hover:text-primary'}`}
                        >
                          {n}
                        </a>
                      </>
                    ))}
                  <a
                    href={page < totalPages ? buildQuery({ page: String(page + 1) }) : '#'}
                    class={`w-9 h-9 flex items-center justify-center rounded-lg border text-sm ${page < totalPages ? 'border-gray-300 text-gray-600 hover:border-primary hover:text-primary' : 'border-gray-100 text-gray-300 pointer-events-none'}`}
                  >
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

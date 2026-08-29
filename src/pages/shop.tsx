import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import { ProductCard } from '../components/ProductCard'
import type { AppEnv, CategoryRow, ProductRow } from '../types'

export async function shopPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const category = c.req.query('category')
  const q = c.req.query('q')
  const deals = c.req.query('deals')
  const sort = c.req.query('sort') || 'newest'

  const categories = await db.prepare('SELECT * FROM categories ORDER BY sort_order ASC').all<CategoryRow>()

  let sql = `
    SELECT p.*, v.name as vendor_name, v.slug as vendor_slug, cat.name as category_name, cat.slug as category_slug
    FROM products p
    JOIN vendors v ON v.id = p.vendor_id
    JOIN categories cat ON cat.id = p.category_id
    WHERE p.is_active = 1
  `
  const binds: any[] = []
  if (category) {
    sql += ' AND cat.slug = ?'
    binds.push(category)
  }
  if (q) {
    sql += ' AND (p.title LIKE ? OR p.description LIKE ?)'
    binds.push(`%${q}%`, `%${q}%`)
  }
  if (deals === '1') sql += ' AND p.compare_at_price_kobo IS NOT NULL'

  switch (sort) {
    case 'price_asc': sql += ' ORDER BY p.price_kobo ASC'; break
    case 'price_desc': sql += ' ORDER BY p.price_kobo DESC'; break
    case 'rating': sql += ' ORDER BY p.rating_avg DESC'; break
    default: sql += ' ORDER BY p.id DESC'
  }

  const products = await db.prepare(sql).bind(...binds).all<ProductRow>()

  const activeCategory = categories.results.find((c) => c.slug === category)
  const pageTitle = q ? `Search: ${q}` : deals === '1' ? "Today's Deals" : activeCategory ? activeCategory.name : 'All Products'

  return c.render(
    <Layout title={pageTitle} user={user}>
      <div class="max-w-[100rem] mx-auto px-6 lg:px-8 py-6 flex gap-6">
        {/* Sidebar filters (desktop) */}
        <aside class="hidden md:block w-56 shrink-0">
          <h3 class="font-semibold text-gray-800 mb-3">Categories</h3>
          <nav class="flex flex-col gap-1">
            <a href="/shop" class={`text-sm px-3 py-2 rounded-lg ${!category ? 'bg-primary-light text-primary-dark font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}>
              All categories
            </a>
            {categories.results.map((cat) => (
              <a
                href={`/shop?category=${cat.slug}`}
                class={`text-sm px-3 py-2 rounded-lg ${category === cat.slug ? 'bg-primary-light text-primary-dark font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                {cat.name}
              </a>
            ))}
          </nav>
        </aside>

        <div class="flex-1">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h1 class="text-xl font-bold text-gray-800">{pageTitle}</h1>
              <p class="text-sm text-gray-500">{products.results.length} results</p>
            </div>
            <form method="get" class="flex items-center gap-2">
              {category && <input type="hidden" name="category" value={category} />}
              {q && <input type="hidden" name="q" value={q} />}
              {deals && <input type="hidden" name="deals" value={deals} />}
              <label class="text-sm text-gray-500 hidden sm:inline">Sort by</label>
              <select name="sort" onchange="this.form.submit()" class="text-sm border border-gray-300 rounded-lg px-3 py-1.5">
                <option value="newest" selected={sort === 'newest'}>Newest</option>
                <option value="price_asc" selected={sort === 'price_asc'}>Price: Low to High</option>
                <option value="price_desc" selected={sort === 'price_desc'}>Price: High to Low</option>
                <option value="rating" selected={sort === 'rating'}>Top Rated</option>
              </select>
            </form>
          </div>

          {/* Mobile category chips */}
          <div class="md:hidden flex gap-2 overflow-x-auto pb-3 mb-2 -mx-1 px-1">
            <a href="/shop" class={`shrink-0 text-xs px-3 py-1.5 rounded-full border ${!category ? 'bg-primary text-white border-primary' : 'border-gray-300 text-gray-600'}`}>All</a>
            {categories.results.map((cat) => (
              <a href={`/shop?category=${cat.slug}`} class={`shrink-0 text-xs px-3 py-1.5 rounded-full border ${category === cat.slug ? 'bg-primary text-white border-primary' : 'border-gray-300 text-gray-600'}`}>
                {cat.name}
              </a>
            ))}
          </div>

          {products.results.length === 0 ? (
            <div class="text-center py-20 text-gray-400">
              <span class="material-symbols-outlined text-5xl mb-2">search_off</span>
              <p>No products found. Try a different search or category.</p>
            </div>
          ) : (
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {products.results.map((p) => <ProductCard product={p} />)}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}

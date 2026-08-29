import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import { ProductCard } from '../components/ProductCard'
import type { AppEnv, CategoryRow, ProductRow } from '../types'

const CATEGORY_EMOJI: Record<string, string> = {
  electronics: 'devices',
  fashion: 'checkroom',
  'home-kitchen': 'kitchen',
  groceries: 'local_grocery_store',
  'beauty-health': 'spa',
  'sports-outdoors': 'sports_soccer',
  'baby-products': 'child_care',
  drinks: 'liquor',
  books: 'menu_book',
  automotive: 'directions_car'
}

export async function homePage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')

  const [categories, flashDeals, recommended] = await Promise.all([
    db.prepare('SELECT * FROM categories ORDER BY sort_order ASC').all<CategoryRow>(),
    db
      .prepare(
        `SELECT p.*, v.name as vendor_name FROM products p JOIN vendors v ON v.id = p.vendor_id
         WHERE p.is_flash_deal = 1 AND p.is_active = 1 ORDER BY p.id ASC LIMIT 6`
      )
      .all<ProductRow>(),
    db
      .prepare(
        `SELECT p.*, v.name as vendor_name FROM products p JOIN vendors v ON v.id = p.vendor_id
         WHERE p.is_active = 1 ORDER BY p.rating_count DESC LIMIT 10`
      )
      .all<ProductRow>()
  ])

  return c.render(
    <Layout title="Home" user={user}>
      {/* Hero */}
      <section class="bg-gradient-to-br from-primary-dark to-primary text-white">
        <div class="max-w-[100rem] mx-auto px-6 lg:px-8 py-10 lg:py-16 flex flex-col lg:flex-row items-center gap-8">
          <div class="flex-1 text-center lg:text-left">
            <h1 class="text-3xl lg:text-5xl font-bold leading-tight mb-4">
              Shop, Eat, Hire, Stay.<br />
              <span class="text-primary-fixed">Built for Nigeria.</span>
            </h1>
            <p class="text-white/80 text-lg mb-6 max-w-xl mx-auto lg:mx-0">
              Nigeria's escrow-protected marketplace. Verified vendors, nationwide delivery, pay in Naira.
            </p>
            <a href="/shop" class="inline-flex items-center gap-2 bg-primary-fixed text-primary-dark font-semibold px-6 py-3 rounded-lg hover:brightness-95 transition">
              Start shopping <span class="material-symbols-outlined">arrow_forward</span>
            </a>
          </div>
          <div class="flex-1 grid grid-cols-2 gap-3 max-w-md w-full">
            <div class="bg-white/10 rounded-xl p-4 backdrop-blur-sm">
              <span class="material-symbols-outlined text-3xl text-primary-fixed">verified_user</span>
              <p class="text-sm mt-2 font-medium">Escrow protected payments</p>
            </div>
            <div class="bg-white/10 rounded-xl p-4 backdrop-blur-sm">
              <span class="material-symbols-outlined text-3xl text-primary-fixed">local_shipping</span>
              <p class="text-sm mt-2 font-medium">Nationwide delivery</p>
            </div>
            <div class="bg-white/10 rounded-xl p-4 backdrop-blur-sm">
              <span class="material-symbols-outlined text-3xl text-primary-fixed">storefront</span>
              <p class="text-sm mt-2 font-medium">Verified Nigerian vendors</p>
            </div>
            <div class="bg-white/10 rounded-xl p-4 backdrop-blur-sm">
              <span class="material-symbols-outlined text-3xl text-primary-fixed">payments</span>
              <p class="text-sm mt-2 font-medium">Pay in Naira, your way</p>
            </div>
          </div>
        </div>
      </section>

      <div class="max-w-[100rem] mx-auto px-6 lg:px-8 py-8 space-y-10">
        {/* Category grid */}
        <section>
          <h2 class="text-xl font-bold text-gray-800 mb-4">Shop by Category</h2>
          <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-3">
            {categories.results.map((cat) => (
              <a
                href={`/shop?category=${cat.slug}`}
                class="flex flex-col items-center justify-center gap-2 bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md hover:border-primary transition-all"
              >
                <span class="material-symbols-outlined text-3xl text-primary">{CATEGORY_EMOJI[cat.slug] || 'category'}</span>
                <span class="text-xs font-medium text-gray-700 text-center">{cat.name}</span>
              </a>
            ))}
          </div>
        </section>

        {/* Flash deals */}
        {flashDeals.results.length > 0 && (
          <section>
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-xl font-bold text-gray-800 flex items-center gap-2">
                <span class="material-symbols-outlined text-amber-500">bolt</span>
                Flash Deals
              </h2>
              <span id="flash-timer" class="text-sm font-semibold text-red-600 bg-red-50 px-3 py-1 rounded-full flex items-center gap-1">
                <span class="material-symbols-outlined text-base">timer</span>
                <span id="flash-timer-value">02:59:55</span>
              </span>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
              {flashDeals.results.map((p) => <ProductCard product={p} />)}
            </div>
          </section>
        )}

        {/* Recommended */}
        <section>
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold text-gray-800 flex items-center gap-2">
              <span class="material-symbols-outlined text-primary">recommend</span>
              Recommended for You
            </h2>
            <a href="/shop" class="text-sm font-semibold text-primary hover:underline">See all</a>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
            {recommended.results.map((p) => <ProductCard product={p} />)}
          </div>
        </section>

        {/* Ecosystem teaser */}
        <section>
          <h2 class="text-xl font-bold text-gray-800 mb-4">Explore More</h2>
          <div class="grid md:grid-cols-3 gap-4">
            {[
              { name: 'NaijaEats Spotlight', desc: 'Order from local restaurants and get hot meals delivered straight to your door.', cta: 'Order food now', icon: 'restaurant' },
              { name: 'NaijaGigs Spotlight', desc: 'Book trusted local professionals for home repairs, design work, tutoring and more.', cta: 'Book a service', icon: 'engineering' },
              { name: 'NaijaStay Spotlight', desc: 'Find and book apartments, rooms and short-let stays anywhere in the country.', cta: 'Find a stay', icon: 'apartment' }
            ].map((item) => (
              <div class="bg-white border border-gray-200 rounded-xl p-6 flex flex-col">
                <span class="material-symbols-outlined text-4xl text-primary mb-3">{item.icon}</span>
                <h3 class="font-bold text-gray-800 mb-1">{item.name}</h3>
                <p class="text-sm text-gray-500 mb-4 flex-1">{item.desc}</p>
                <a href="/ecosystem" class="text-sm font-semibold text-primary hover:underline">{item.cta} →</a>
              </div>
            ))}
          </div>
        </section>

        {/* Ecosystem CTA banner */}
        <section class="bg-primary-light rounded-xl p-8 flex flex-col md:flex-row items-center justify-between gap-4">
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
        </section>
      </div>
    </Layout>
  )
}

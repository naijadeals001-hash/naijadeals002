import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import { getCategoryDirectory, getPopularCategories } from '../lib/catalog'
import type { AppEnv } from '../types'

/**
 * /categories — genuine category DISCOVERY page (Checkpoint B "IS NOT
 * APPROVED YET" directive, item 7). This is the real "See All" destination
 * for the homepage's "Shop by Category" MerchandisingRail.
 *
 * Pat's explicit rejection: "/shop [...] is not the final architecture
 * [...] Do not simply disguise the same Shop page behind a different URL."
 * This page is therefore NOT a /shop wrapper — it renders the full category
 * DIRECTORY (all 22 departments x their ~71 direct groups, via
 * getCategoryDirectory in catalog.ts), a browse experience for the taxonomy
 * itself. Clicking a leaf category still lands on /shop?category=slug
 * (that's the correct destination for "show me products in this category" —
 * only the ORIGIN of that click is required to be a real discovery surface,
 * not the destination).
 */
export async function categoriesPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')
  const directory = await getCategoryDirectory(db)

  return c.render(
    <Layout title="All Categories" user={user} locale={locale} description="Browse every department and category across the NaijaDeals marketplace.">
      <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8 py-6">
        <div class="flex items-center justify-between mb-1">
          <h1 class="text-xl md:text-2xl font-bold text-gray-900">All Categories</h1>
          <a href="/categories/popular" class="text-sm font-semibold text-primary hover:underline flex items-center gap-0.5">
            Popular categories<span class="material-symbols-outlined text-base">chevron_right</span>
          </a>
        </div>
        <p class="text-sm text-gray-500 mb-6">{directory.length} departments across the NaijaDeals marketplace</p>

        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {directory.map((dept) => (
            <section class="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <a href={`/shop?category=${dept.slug}`} class="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-200 hover:bg-gray-100 transition-colors">
                {dept.image_url ? (
                  <img src={dept.image_url} alt="" loading="lazy" class="w-9 h-9 rounded-lg object-cover shrink-0" />
                ) : (
                  <span class="material-symbols-outlined text-primary shrink-0">{dept.icon}</span>
                )}
                <h2 class="text-sm font-bold text-gray-800 flex-1">{dept.name}</h2>
                <span class="material-symbols-outlined text-gray-400 text-lg">chevron_right</span>
              </a>
              {dept.children.length > 0 ? (
                <ul class="p-2">
                  {dept.children.map((child) => (
                    <li>
                      <a href={`/shop?category=${child.slug}`} class="block px-2 py-1.5 text-sm text-gray-600 rounded hover:bg-gray-50 hover:text-primary-dark transition-colors">
                        {child.name}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <div class="p-3">
                  <a href={`/shop?category=${dept.slug}`} class="block px-2 py-1.5 text-sm text-gray-500 rounded hover:bg-gray-50">
                    Shop all {dept.name}
                  </a>
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </Layout>
  )
}

/**
 * /categories/popular — real "See All" destination for the homepage's
 * "Popular Categories" MerchandisingRail. Reuses the EXACT same
 * getPopularCategories() ranking already backing the homepage rail (live
 * product_count DESC, homepage_priority tie-break only — see catalog.ts's
 * header comment) so the rail and this page can never disagree, but shows
 * the FULL ranked list rather than the homepage's rail-sized slice.
 */
export async function popularCategoriesPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')
  const categories = await getPopularCategories(db, 100)

  return c.render(
    <Layout title="Popular Categories" user={user} locale={locale} description="What NaijaDeals customers are shopping for right now, ranked by real live product activity.">
      <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8 py-6">
        <div class="flex items-center justify-between mb-1">
          <h1 class="text-xl md:text-2xl font-bold text-gray-900">Popular Categories</h1>
          <a href="/categories" class="text-sm font-semibold text-primary hover:underline flex items-center gap-0.5">
            All categories<span class="material-symbols-outlined text-base">chevron_right</span>
          </a>
        </div>
        <p class="text-sm text-gray-500 mb-6">Ranked by live product activity across the marketplace</p>

        {categories.length === 0 ? (
          <div class="text-center py-20 text-gray-400">
            <span class="material-symbols-outlined text-5xl mb-2">search_off</span>
            <p>No popular categories to show yet.</p>
          </div>
        ) : (
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {categories.map((cat: any, i: number) => (
              <a href={`/shop?category=${cat.slug}`} class="group flex flex-col rounded-lg overflow-hidden border border-gray-200 bg-white hover:shadow-md transition-shadow relative">
                <span class="absolute top-1.5 left-1.5 z-10 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                <div class="relative aspect-square bg-gray-100 overflow-hidden">
                  <img src={cat.image_url} alt={cat.name} loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                </div>
                <div class="px-2 py-2 text-center">
                  <h3 class="text-sm font-semibold text-gray-800 line-clamp-1">{cat.name}</h3>
                  <p class="text-xs text-gray-400">{cat.product_count} product{cat.product_count === 1 ? '' : 's'}</p>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}

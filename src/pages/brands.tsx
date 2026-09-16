import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import { getTopBrands } from '../lib/catalog'
import type { AppEnv } from '../types'

/**
 * /brands — the full "Top Brands" discovery page (same precedent as
 * /vendors and /countries). The homepage rail shows the current qualifying
 * set (currently 12, via getTopBrands(db, 12) in homepage-feed.ts) and
 * links here for the complete list. Same "show fewer, but all real" rule —
 * a brand only appears here once it has a real logo (logo_url set, not
 * /ph.svg), is active, and has at least one active product, via the SAME
 * getTopBrands() query the homepage rail uses, just with a high limit.
 */
export async function brandsPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')
  const brands = await getTopBrands(db, 200)

  return c.render(
    <Layout title="Top Brands" user={user} locale={locale} description="Trusted names selling on NaijaDeals.">
      <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8 py-6">
        <div class="flex items-center justify-between mb-1">
          <h1 class="text-xl md:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span class="material-symbols-outlined text-primary">verified</span>
            Top Brands
          </h1>
        </div>
        <p class="text-sm text-gray-500 mb-6">{brands.length} trusted brands selling on NaijaDeals</p>

        <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 md:gap-4">
          {brands.map((b: any) => (
            <a
              href={`/shop?brand=${b.slug}`}
              class="brand-card group flex flex-col items-center bg-white border border-gray-200 rounded-2xl p-4 hover:shadow-lg hover:border-primary transition-all"
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

        {brands.length === 0 && (
          <p class="text-sm text-gray-500 py-12 text-center">
            No brands with real logos and active products yet — check back shortly.
          </p>
        )}
      </div>
    </Layout>
  )
}

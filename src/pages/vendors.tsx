import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import { getPopularVendors } from '../lib/catalog'
import type { AppEnv, VendorRow } from '../types'

/**
 * /vendors — the full "Popular Vendors" discovery page (Pat: "Popular
 * Vendors should have See all"). Same precedent as /categories and
 * /countries: the homepage rail shows a small subset (8, via
 * getPopularVendors(db, 8) in homepage-feed.ts) and links here for the
 * complete list. Same "show fewer, but all real" rule — a vendor only
 * appears here once it has a real photo (logo_url set, not /ph.svg) AND
 * is_verified = 1, via the SAME getPopularVendors() query the homepage
 * rail uses, just with a high limit instead of 8.
 */
export async function vendorsPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')
  const vendors = await getPopularVendors(db, 100)

  return c.render(
    <Layout title="Popular Vendors" user={user} locale={locale} description="Verified sellers with a track record across the NaijaDeals marketplace.">
      <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8 py-6">
        <div class="flex items-center justify-between mb-1">
          <h1 class="text-xl md:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span class="material-symbols-outlined text-primary">storefront</span>
            Popular Vendors
          </h1>
        </div>
        <p class="text-sm text-gray-500 mb-6">{vendors.length} verified sellers with a track record on NaijaDeals</p>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {vendors.map((v: VendorRow) => (
            <a href={`/shop?q=${encodeURIComponent(v.name)}`} class="flex items-center gap-3 bg-white border border-gray-200 rounded-xl p-3.5 hover:shadow-md hover:border-primary transition-all">
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

        {vendors.length === 0 && (
          <p class="text-sm text-gray-500 py-12 text-center">
            No verified vendors with real photography yet — check back shortly.
          </p>
        )}
      </div>
    </Layout>
  )
}

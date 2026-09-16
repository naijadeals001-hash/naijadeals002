import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import { getDiscoverableCountries } from '../lib/country'
import type { AppEnv } from '../types'

/**
 * /countries — the full "Explore Africa" discovery page (Pat's Section 5
 * directive, 2026-09-16 fix pass): "54 countries in the system does NOT
 * mean 54 huge cards on the homepage [...] See All 54 -> opens the
 * complete country discovery experience."
 *
 * Mirrors the existing /categories precedent (categories.tsx) exactly: the
 * homepage rail shows a small curated subset and links here for the real,
 * complete browse surface. Same "show fewer, but all real" rule as
 * everywhere else — a country only ever appears here once it has a real,
 * verified photo (image_url set, not /ph.svg) AND display_on_homepage = 1,
 * via the SAME getDiscoverableCountries() query the homepage rail uses, just
 * with the full limit of 54 instead of a curated slice.
 */
export async function countriesPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')
  const countries = await getDiscoverableCountries(db, 54)

  return c.render(
    <Layout title="Explore Africa by Country" user={user} locale={locale} description="Discover NaijaDeals across every African market — real vendors, real products, real communities in all 54 nations.">
      <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8 py-6">
        <div class="flex items-center justify-between mb-1">
          <h1 class="text-xl md:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span class="material-symbols-outlined text-primary">public</span>
            Explore Africa by Country
          </h1>
        </div>
        <p class="text-sm text-gray-500 mb-6">
          {countries.length} of 54 African nations live on NaijaDeals so far — every market shown here has real, verified photography.
        </p>

        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {countries.map((country) => (
            <div class="bg-white border border-gray-200 rounded-xl overflow-hidden">
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
                <p class="text-[11px] text-gray-400 mt-1">{country.region}</p>
              </div>
            </div>
          ))}
        </div>

        {countries.length === 0 && (
          <p class="text-sm text-gray-500 py-12 text-center">
            Country photography is being sourced right now — check back shortly.
          </p>
        )}
      </div>
    </Layout>
  )
}

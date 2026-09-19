import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import { ProductCard } from '../components/ProductCard'
import { getVendorsBasedInCountry, getBrandsAssociatedWithCountry, getProductsAvailableInCountry, getProductsOriginatingFromCountry } from '../lib/country'
import { assembleCountryProfile, type CountryFactType } from '../lib/country-profile'
import { getOrComputePageSection } from '../lib/page-cache'
import type { AppEnv, ProductWithListingRow, VendorRow } from '../types'

/**
 * Stage 2A — /countries/:iso — the real marketplace surface the Stage 2
 * discovery audit found missing (the old /countries was a photo gallery
 * with no product/vendor/brand feed at all). Every section below is
 * independently sourced from its OWN sanctioned relationship function —
 * never a shared/conflated query — per the design doc's "never conflate"
 * rule, and every section is hidden (not rendered as an empty placeholder
 * card) when its data is empty, matching this codebase's established
 * "show fewer, but all real" convention used everywhere else.
 */
export async function countryDetailPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')
  const iso = (c.req.param('iso') ?? '').toUpperCase()

  const profile = await getOrComputePageSection(db, `country_profile:${iso}`, 600, () => assembleCountryProfile(db, iso))
  if (!profile) return c.notFound()

  const [productsAvailable, productsOrigin, vendors, brands] = await Promise.all([
    getOrComputePageSection<ProductWithListingRow[]>(db, `country_products_available:${iso}:12:0`, 120, () => getProductsAvailableInCountry(db, iso, 12, 0)),
    getOrComputePageSection<ProductWithListingRow[]>(db, `country_products_origin:${iso}:12:0`, 120, () => getProductsOriginatingFromCountry(db, iso, 12, 0)),
    getOrComputePageSection<VendorRow[]>(db, `country_vendors:${iso}:12`, 120, () => getVendorsBasedInCountry(db, iso, 12)),
    getOrComputePageSection<any[]>(db, `country_brands:${iso}:12`, 120, () => getBrandsAssociatedWithCountry(db, iso, 12)),
  ])

  const { country, facts } = profile
  const FACT_SECTION_TITLES: Record<CountryFactType, string> = {
    major_city: 'Major Cities',
    history: 'History',
    culture: 'Culture',
    industry: 'Industries',
    government_leadership: 'Government & Leadership',
  }

  return c.render(
    <Layout title={`${country.name} — NaijaDeals`} user={user} locale={locale} description={`Explore ${country.name} on NaijaDeals — products available here, products from here, and local vendors.`}>
      <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8 py-6" id="country-detail-root" data-country-iso={country.iso_code}>
        {/* ---------- Hero ---------- */}
        <section id="country-hero" class="flex items-center gap-4 mb-6">
          <div>
            <h1 class="text-2xl md:text-3xl font-bold text-gray-900">{country.name}</h1>
            <p class="text-sm text-gray-500 mt-1">
              {country.region} · {country.currency_code}
              {country.status === 'LIVE' && <span class="ml-2 text-[10px] font-bold bg-primary-fixed text-primary-dark rounded-full px-2 py-0.5 align-middle">Live on NaijaDeals</span>}
            </p>
          </div>
        </section>

        {/* ---------- Verified editorial facts (major cities / history / culture / industries / leadership) ---------- */}
        {(Object.keys(FACT_SECTION_TITLES) as CountryFactType[]).map((type) =>
          facts[type].length > 0 ? (
            <section id={`country-fact-${type}`} class="mb-6">
              <h2 class="text-lg font-bold text-gray-900 mb-2">{FACT_SECTION_TITLES[type]}</h2>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {facts[type].map((f) => (
                  <div class="bg-white border border-gray-200 rounded-xl p-3.5">
                    <p class="text-sm font-semibold text-gray-800">{f.label}</p>
                    <p class="text-sm text-gray-600 mt-1">{f.value}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null
        )}

        {/* ---------- Products Available in this country (listing_country_availability relationship) ---------- */}
        {productsAvailable.length > 0 && (
          <section id="country-products-available" class="mb-8">
            <div class="flex items-center justify-between mb-2">
              <h2 class="text-lg font-bold text-gray-900">Products Available in {country.name}</h2>
              <a href={`/shop?country=${country.iso_code}`} class="text-sm font-medium text-primary hover:underline">See all</a>
            </div>
            <p class="text-xs text-gray-500 mb-3">Products a customer here can actually buy — not necessarily made in {country.name}.</p>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {productsAvailable.map((p) => <ProductCard product={p} />)}
            </div>
          </section>
        )}

        {/* ---------- Products FROM this country (product_country_origins relationship, VERIFIED only) ---------- */}
        {productsOrigin.length > 0 && (
          <section id="country-products-origin" class="mb-8">
            <div class="flex items-center justify-between mb-2">
              <h2 class="text-lg font-bold text-gray-900">Products From {country.name}</h2>
              <a href={`/shop?origin_country=${country.iso_code}`} class="text-sm font-medium text-primary hover:underline">See all</a>
            </div>
            <p class="text-xs text-gray-500 mb-3">Verified country-of-origin — every product here has confirmed provenance evidence on file.</p>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {productsOrigin.map((p) => <ProductCard product={p} />)}
            </div>
          </section>
        )}

        {/* ---------- Vendors based here (vendors.country_iso relationship) ---------- */}
        {vendors.length > 0 && (
          <section id="country-vendors" class="mb-8">
            <h2 class="text-lg font-bold text-gray-900 mb-2">Vendors Based in {country.name}</h2>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {vendors.map((v) => (
                <a href={`/shop?q=${encodeURIComponent(v.name)}`} class="flex items-center gap-3 bg-white border border-gray-200 rounded-xl p-3.5 hover:shadow-md hover:border-primary transition-all">
                  <img src={v.logo_url ?? ''} alt={v.name} class="w-12 h-12 rounded-full object-cover border border-gray-100 shrink-0" />
                  <div class="min-w-0">
                    <p class="text-sm font-semibold text-gray-800 truncate">{v.name}</p>
                    <p class="text-xs text-gray-500">{v.city}</p>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* ---------- Verified country-associated brands ---------- */}
        {brands.length > 0 && (
          <section id="country-brands" class="mb-8">
            <h2 class="text-lg font-bold text-gray-900 mb-2">Brands Associated with {country.name}</h2>
            <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {brands.map((b: any) => (
                <a href={`/shop?brand=${b.slug}`} class="flex flex-col items-center bg-white border border-gray-200 rounded-xl p-3 hover:shadow-md hover:border-primary transition-all">
                  <img src={b.logo_url} alt={b.name} class="w-12 h-12 object-contain mb-1.5" />
                  <p class="text-xs font-medium text-gray-800 text-center truncate w-full">{b.name}</p>
                </a>
              ))}
            </div>
          </section>
        )}

        {productsAvailable.length === 0 && productsOrigin.length === 0 && vendors.length === 0 && brands.length === 0 && Object.values(facts).every((f) => f.length === 0) && (
          <p class="text-sm text-gray-500 py-16 text-center">
            NaijaDeals doesn't have verified content for {country.name} yet — check back as our Africa-wide catalog grows.
          </p>
        )}
      </div>
    </Layout>
  )
}

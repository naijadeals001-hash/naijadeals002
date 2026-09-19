/**
 * NaijaGigs — customer-facing pages for the Service Engine 2.0 (migrations
 * 0024, 0025, 0039, seed migration 0072). This is the FIRST real UI wired to
 * that engine — before this file, the engine had full schema + lib + API
 * but zero customer-facing pages (`/gigs` only rendered the static
 * ecosystem-preview placeholder).
 *
 * Every write path (request a quote, accept/reject a quote, cancel/confirm
 * an order) goes through the EXISTING authenticated API
 * (src/routes/api-service-requests.ts) via public/static/gigs.js — no new
 * write logic is duplicated here, only real reads for SSR + real links to
 * the real API for actions (spec section 33AG: no fake completion).
 */
import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import type { AppEnv, ServiceListingRow, ServiceQuoteRow, ServiceOrderRow, CategoryRow } from '../types'
import { formatMoney } from '../lib/money'
import {
  getTopLevelServiceCategories,
  getServiceSubcategories,
  getServiceCategoryBySlug,
  getPublicServiceListings,
  getPublicServiceListingById,
  getPackagesForListing,
  getAreasForProvider
} from '../lib/services'
import {
  getRequestsForCustomer,
  getOwnedServiceRequest,
  getRequirementsForRequest,
  getAttachmentsForRequest,
  getQuotesForRequest,
  expireQuoteIfNeeded
} from '../lib/service-requests'
import { getOrdersForCustomer, getOwnedOrderForCustomer, getEventsForOrder } from '../lib/service-orders'

const URGENCY_LABEL: Record<string, { label: string; color: string }> = {
  normal: { label: 'Normal', color: 'text-gray-600 bg-gray-100' },
  urgent: { label: 'Urgent', color: 'text-orange-600 bg-orange-50' },
  emergency: { label: 'Emergency', color: 'text-red-600 bg-red-50' }
}

const REQUEST_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'text-gray-500 bg-gray-100' },
  submitted: { label: 'Submitted', color: 'text-blue-600 bg-blue-50' },
  matching: { label: 'Matching providers', color: 'text-blue-600 bg-blue-50' },
  quoted: { label: 'Quotes received', color: 'text-primary bg-primary-light' },
  accepted: { label: 'Quote accepted', color: 'text-primary bg-primary-light' },
  scheduled: { label: 'Scheduled', color: 'text-indigo-600 bg-indigo-50' },
  in_progress: { label: 'In progress', color: 'text-indigo-600 bg-indigo-50' },
  completed: { label: 'Completed', color: 'text-primary bg-primary-light' },
  cancelled: { label: 'Cancelled', color: 'text-gray-500 bg-gray-100' },
  disputed: { label: 'Disputed', color: 'text-red-600 bg-red-50' }
}

const ORDER_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  accepted: { label: 'Accepted', color: 'text-blue-600 bg-blue-50' },
  scheduled: { label: 'Scheduled', color: 'text-indigo-600 bg-indigo-50' },
  provider_arriving: { label: 'Provider arriving', color: 'text-indigo-600 bg-indigo-50' },
  in_progress: { label: 'In progress', color: 'text-indigo-600 bg-indigo-50' },
  completed: { label: 'Awaiting your confirmation', color: 'text-amber-600 bg-amber-50' },
  customer_confirmed: { label: 'Confirmed', color: 'text-primary bg-primary-light' },
  paid: { label: 'Paid', color: 'text-primary bg-primary-light' },
  cancelled: { label: 'Cancelled', color: 'text-gray-500 bg-gray-100' },
  declined: { label: 'Declined by provider', color: 'text-red-600 bg-red-50' },
  expired: { label: 'Expired', color: 'text-gray-500 bg-gray-100' },
  disputed: { label: 'Disputed', color: 'text-red-600 bg-red-50' },
  refunded: { label: 'Refunded', color: 'text-red-600 bg-red-50' },
  no_show: { label: 'No-show', color: 'text-red-600 bg-red-50' }
}

function statusPill(map: Record<string, { label: string; color: string }>, status: string) {
  const s = map[status] || { label: status, color: 'text-gray-500 bg-gray-100' }
  return <span class={`text-xs font-semibold px-2.5 py-1 rounded-full ${s.color}`}>{s.label}</span>
}

/** Small reusable card for a service listing — mirrors ProductCard.tsx's anatomy for the Service Engine. */
function ServiceListingCard({ listing }: { listing: ServiceListingRow }) {
  const priceLabel =
    listing.pricing_model === 'custom_quote' || listing.pricing_model === 'negotiable'
      ? 'Request a quote'
      : listing.pricing_model === 'starting_price'
      ? `From ${formatMoney(listing.base_price_kobo ?? 0, listing.currency)}`
      : listing.pricing_model === 'hourly'
      ? `${formatMoney(listing.base_price_kobo ?? 0, listing.currency)}/hr`
      : formatMoney(listing.base_price_kobo ?? 0, listing.currency)

  return (
    <a href={`/gigs/listings/${listing.id}`} class="group flex flex-col bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
      <div class="p-4 flex-1">
        <span class="inline-flex items-center gap-1 text-[10px] font-semibold text-primary-dark bg-primary-light px-2 py-0.5 rounded">
          {listing.category_name}
        </span>
        <h3 class="text-sm font-semibold text-gray-800 mt-2 line-clamp-2 min-h-[2.4rem]">{listing.title}</h3>
        <div class="flex items-center gap-1.5 mt-2 text-xs text-gray-500">
          <span class="material-symbols-outlined text-sm text-gray-400">storefront</span>
          <span class="truncate">{listing.provider_display_name}</span>
          {listing.provider_verification_status === 'verified' && (
            <span class="material-symbols-outlined text-primary text-sm shrink-0" style="font-variation-settings:'FILL' 1">verified</span>
          )}
        </div>
        {listing.rating_count > 0 && (
          <div class="flex items-center gap-1 text-xs text-gray-500 mt-1">
            <span class="material-symbols-outlined text-amber-500 text-sm" style="font-variation-settings:'FILL' 1">star</span>
            <span class="font-medium">{listing.rating_avg.toFixed(1)}</span>
            <span>({listing.rating_count})</span>
          </div>
        )}
      </div>
      <div class="px-4 py-2.5 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
        <span class="text-sm font-bold text-gray-900">{priceLabel}</span>
        <span class="text-xs text-primary font-semibold flex items-center gap-0.5">
          View<span class="material-symbols-outlined text-sm">chevron_right</span>
        </span>
      </div>
    </a>
  )
}

// ============================================================
// GET /gigs — browse home: category grid + featured listings
// ============================================================
export async function gigsHomePage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')

  const [categories, featured, countRows] = await Promise.all([
    getTopLevelServiceCategories(db),
    getPublicServiceListings(db, { countryIso: 'NG', limit: 12 }),
    db
      .prepare(
        `SELECT COALESCE(parent.id, c.id) AS root_id, COUNT(sl.id) AS cnt
         FROM service_listings sl
         JOIN categories c ON c.id = sl.category_id
         LEFT JOIN categories parent ON parent.id = c.parent_id
         WHERE sl.status = 'active' AND sl.is_active = 1
         GROUP BY root_id`
      )
      .all<{ root_id: number; cnt: number }>()
  ])
  const countByCategory = new Map(countRows.results.map((r) => [r.root_id, r.cnt]))

  return c.render(
    <Layout
      title="NaijaGigs — Hire trusted professionals near you"
      description="Book verified plumbers, electricians, cleaners, mechanics, tutors, photographers and more — with escrow-protected quotes on NaijaDeals."
      user={user}
      locale={locale}
    >
      <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8 py-6">
        {/* Hero */}
        <section id="gigs-hero" class="bg-primary-dark text-white rounded-2xl px-6 py-8 md:px-10 md:py-12 mb-8">
          <span class="inline-flex items-center gap-1.5 text-xs font-semibold bg-white/10 px-2.5 py-1 rounded-full mb-3">
            <span class="material-symbols-outlined text-sm">handyman</span>NaijaGigs
          </span>
          <h1 class="text-2xl md:text-3xl font-bold max-w-xl">Hire trusted professionals for any job, anywhere in Nigeria.</h1>
          <p class="text-white/70 text-sm mt-2 max-w-lg">Plumbers, electricians, cleaners, mechanics, tutors, makeup artists and more — verified providers, transparent quotes, escrow-protected payment.</p>
          <a href="/gigs/request" class="inline-flex items-center gap-1.5 mt-5 bg-primary-fixed text-primary-dark font-semibold px-5 py-2.5 rounded-lg hover:brightness-95 transition">
            <span class="material-symbols-outlined text-lg">post_add</span>Post a job &amp; get quotes
          </a>
        </section>

        {/* Category grid */}
        <section id="gigs-categories" class="mb-10">
          <h2 class="text-lg font-bold text-gray-900 mb-4">Browse by category</h2>
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {categories.map((cat) => (
              <a href={`/gigs/category/${cat.slug}`} class="flex flex-col items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-5 hover:shadow-md hover:border-primary transition-all text-center">
                <span class="w-12 h-12 rounded-full bg-primary-light flex items-center justify-center">
                  <span class="material-symbols-outlined text-primary text-2xl">{cat.icon}</span>
                </span>
                <span class="text-sm font-semibold text-gray-800">{cat.name}</span>
                <span class="text-[11px] text-gray-400">{countByCategory.get(cat.id) ?? 0} provider{(countByCategory.get(cat.id) ?? 0) === 1 ? '' : 's'}</span>
              </a>
            ))}
          </div>
        </section>

        {/* Featured listings */}
        <section id="gigs-featured">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-bold text-gray-900">Top-rated professionals</h2>
          </div>
          {featured.length === 0 ? (
            <div class="text-center py-16 bg-white border border-gray-200 rounded-xl text-gray-400">
              <span class="material-symbols-outlined text-4xl mb-2">search_off</span>
              <p>No active service listings yet.</p>
            </div>
          ) : (
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {featured.map((listing) => <ServiceListingCard listing={listing} />)}
            </div>
          )}
        </section>
      </div>
    </Layout>
  )
}

// ============================================================
// GET /gigs/category/:slug — listings within one service category
// ============================================================
export async function gigsCategoryPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')
  const slug = c.req.param('slug') ?? ''

  const category = await getServiceCategoryBySlug(db, slug)
  if (!category) {
    c.status(404)
    return c.render(
      <Layout title="Category not found" user={user} locale={locale}>
        <div class="max-w-2xl mx-auto text-center py-20">
          <span class="material-symbols-outlined text-5xl text-gray-300">search_off</span>
          <h1 class="text-xl font-bold mt-4">Service category not found</h1>
          <a href="/gigs" class="text-primary font-semibold hover:underline mt-2 inline-block">Back to NaijaGigs</a>
        </div>
      </Layout>
    )
  }

  const [parent, subcategories, listings] = await Promise.all([
    category.parent_id
      ? db.prepare('SELECT * FROM categories WHERE id = ?').bind(category.parent_id).first<CategoryRow>()
      : Promise.resolve(null),
    category.parent_id ? Promise.resolve([]) : getServiceSubcategories(db, slug),
    getPublicServiceListings(db, { categorySlug: slug, countryIso: 'NG', limit: 40 })
  ])

  return c.render(
    <Layout title={`${category.name} — NaijaGigs`} description={`Hire verified ${category.name} providers on NaijaDeals.`} user={user} locale={locale}>
      <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8 py-6">
        <nav class="text-xs text-gray-500 mb-4 flex items-center gap-1.5 flex-wrap">
          <a href="/gigs" class="hover:text-primary">NaijaGigs</a>
          {parent && (
            <>
              <span class="material-symbols-outlined text-sm">chevron_right</span>
              <a href={`/gigs/category/${parent.slug}`} class="hover:text-primary">{parent.name}</a>
            </>
          )}
          <span class="material-symbols-outlined text-sm">chevron_right</span>
          <span class="text-gray-700">{category.name}</span>
        </nav>

        <div class="flex items-center gap-3 mb-4">
          <span class="w-10 h-10 rounded-full bg-primary-light flex items-center justify-center shrink-0">
            <span class="material-symbols-outlined text-primary text-xl">{category.icon}</span>
          </span>
          <h1 class="text-xl md:text-2xl font-bold text-gray-900">{category.name}</h1>
        </div>

        {subcategories.length > 0 && (
          <div class="flex items-center gap-2 flex-wrap mb-6">
            {subcategories.map((sub) => (
              <a href={`/gigs/category/${sub.slug}`} class="text-xs font-medium px-3 py-1.5 rounded-full border border-gray-300 text-gray-600 hover:border-primary hover:text-primary transition-colors">
                {sub.name}
              </a>
            ))}
          </div>
        )}

        {listings.length === 0 ? (
          <div class="text-center py-16 bg-white border border-gray-200 rounded-xl text-gray-400">
            <span class="material-symbols-outlined text-4xl mb-2">search_off</span>
            <p>No providers listed in this category yet.</p>
            <a href="/gigs/request" class="inline-block mt-3 text-primary font-semibold hover:underline">Post a job instead &rarr;</a>
          </div>
        ) : (
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {listings.map((listing) => <ServiceListingCard listing={listing} />)}
          </div>
        )}
      </div>
    </Layout>
  )
}

// ============================================================
// GET /gigs/providers/:id — public provider profile
// ============================================================
export async function gigsProviderPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')
  const id = Number(c.req.param('id'))

  const notFound = () => {
    c.status(404)
    return c.render(
      <Layout title="Provider not found" user={user} locale={locale}>
        <div class="max-w-2xl mx-auto text-center py-20">
          <span class="material-symbols-outlined text-5xl text-gray-300">person_off</span>
          <h1 class="text-xl font-bold mt-4">Provider not found</h1>
          <a href="/gigs" class="text-primary font-semibold hover:underline mt-2 inline-block">Back to NaijaGigs</a>
        </div>
      </Layout>
    )
  }
  if (Number.isNaN(id)) return notFound()

  const provider = await db
    .prepare(
      `SELECT pp.id, pp.display_name, pp.bio, pp.avatar_url, pp.rating_avg, pp.rating_count, pp.verification_status,
              pp.country_iso, cat.name AS primary_category_name, cat.slug AS primary_category_slug
       FROM provider_profiles pp
       LEFT JOIN categories cat ON cat.id = pp.primary_category_id
       WHERE pp.id = ? AND pp.operational_status = 'active'`
    )
    .bind(id)
    .first<{
      id: number; display_name: string; bio: string; avatar_url: string | null; rating_avg: number
      rating_count: number; verification_status: string; country_iso: string
      primary_category_name: string | null; primary_category_slug: string | null
    }>()
  if (!provider) return notFound()

  const [listingRows, areas, reviews] = await Promise.all([
    db
      .prepare(
        `SELECT sl.*, c.name AS category_name, c.slug AS category_slug
         FROM service_listings sl JOIN categories c ON c.id = sl.category_id
         WHERE sl.provider_profile_id = ? AND sl.status = 'active' AND sl.is_active = 1
         ORDER BY sl.rating_count DESC`
      )
      .bind(id)
      .all<ServiceListingRow>(),
    getAreasForProvider(db, id),
    db
      .prepare(
        `SELECT r.id, r.rating, r.title, r.comment, r.created_at, r.author_name
         FROM reviews r
         WHERE r.reviewable_type = 'provider_profile' AND r.reviewable_id = ? AND r.status = 'published'
         ORDER BY r.created_at DESC LIMIT 20`
      )
      .bind(id)
      .all<{ id: number; rating: number; title: string | null; comment: string; created_at: string; author_name: string }>()
      .catch(() => ({ results: [] as any[] }))
  ])
  const listings = listingRows.results

  return c.render(
    <Layout title={`${provider.display_name} — NaijaGigs`} description={provider.bio} user={user} locale={locale}>
      <div class="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-6">
        <a href="/gigs" class="text-sm text-primary font-medium hover:underline flex items-center gap-1 mb-4">
          <span class="material-symbols-outlined text-base">arrow_back</span>NaijaGigs
        </a>

        <div class="bg-white border border-gray-200 rounded-xl p-5 flex items-start gap-4 flex-wrap">
          {provider.avatar_url ? (
            <img src={provider.avatar_url} alt={provider.display_name} class="w-16 h-16 rounded-full object-cover shrink-0" />
          ) : (
            <div class="w-16 h-16 rounded-full bg-primary-light text-primary-dark font-bold text-2xl flex items-center justify-center shrink-0">
              {provider.display_name.charAt(0)}
            </div>
          )}
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h1 class="text-xl font-bold text-gray-900">{provider.display_name}</h1>
              {provider.verification_status === 'verified' && (
                <span class="flex items-center gap-1 text-xs font-semibold text-primary bg-primary-light px-2 py-0.5 rounded-full">
                  <span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1">verified</span>Verified
                </span>
              )}
            </div>
            {provider.primary_category_name && <p class="text-sm text-gray-500 mt-0.5">{provider.primary_category_name}</p>}
            {provider.rating_count > 0 && (
              <div class="flex items-center gap-1 text-sm text-gray-600 mt-1.5">
                <span class="material-symbols-outlined text-amber-500 text-base" style="font-variation-settings:'FILL' 1">star</span>
                <span class="font-semibold">{provider.rating_avg.toFixed(1)}</span>
                <span class="text-gray-400">({provider.rating_count} reviews)</span>
              </div>
            )}
            <p class="text-sm text-gray-600 mt-3 leading-relaxed">{provider.bio}</p>
            {areas.length > 0 && (
              <p class="text-xs text-gray-500 mt-2 flex items-center gap-1">
                <span class="material-symbols-outlined text-sm">location_on</span>
                Serves {areas.map((a) => a.neighborhood || a.city).filter(Boolean).join(', ')}
              </p>
            )}
          </div>
        </div>

        <section class="mt-8">
          <h2 class="text-lg font-bold text-gray-900 mb-4">Services offered ({listings.length})</h2>
          {listings.length === 0 ? (
            <p class="text-sm text-gray-400">This provider has no active service listings right now.</p>
          ) : (
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {listings.map((listing) => <ServiceListingCard listing={listing} />)}
            </div>
          )}
        </section>

        <section class="mt-8">
          <h2 class="text-lg font-bold text-gray-900 mb-4">Reviews</h2>
          {reviews.results.length === 0 ? (
            <p class="text-sm text-gray-400">No reviews yet.</p>
          ) : (
            <div class="space-y-4">
              {reviews.results.map((r) => (
                <div class="border-b border-gray-100 pb-4">
                  <div class="flex items-center gap-2">
                    <span class="flex text-amber-500">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <span class="material-symbols-outlined text-sm" style={`font-variation-settings:'FILL' ${i <= r.rating ? 1 : 0}`}>star</span>
                      ))}
                    </span>
                    <span class="text-sm font-semibold text-gray-800">{r.author_name}</span>
                  </div>
                  {r.title && <p class="text-sm font-semibold text-gray-800 mt-1.5">{r.title}</p>}
                  <p class="text-sm text-gray-600 mt-1">{r.comment}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Layout>
  )
}

// ============================================================
// GET /gigs/listings/:id — service listing detail
// ============================================================
export async function gigsListingPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')
  const id = Number(c.req.param('id'))

  if (Number.isNaN(id)) return c.notFound()
  const listing = await getPublicServiceListingById(db, id)
  if (!listing) {
    c.status(404)
    return c.render(
      <Layout title="Service not found" user={user} locale={locale}>
        <div class="max-w-2xl mx-auto text-center py-20">
          <span class="material-symbols-outlined text-5xl text-gray-300">search_off</span>
          <h1 class="text-xl font-bold mt-4">Service listing not found</h1>
          <a href="/gigs" class="text-primary font-semibold hover:underline mt-2 inline-block">Back to NaijaGigs</a>
        </div>
      </Layout>
    )
  }

  const [packages, provider, areas] = await Promise.all([
    getPackagesForListing(db, id),
    db
      .prepare('SELECT id, display_name, bio, avatar_url, verification_status, rating_avg, rating_count FROM provider_profiles WHERE id = ?')
      .bind(listing.provider_profile_id)
      .first<{ id: number; display_name: string; bio: string; avatar_url: string | null; verification_status: string; rating_avg: number; rating_count: number }>(),
    getAreasForProvider(db, listing.provider_profile_id)
  ])

  const requirements: { label: string; type: string; required: boolean }[] = JSON.parse(listing.requirements_json || '[]')
  const priceLabel =
    listing.pricing_model === 'custom_quote' || listing.pricing_model === 'negotiable'
      ? 'Custom quote'
      : listing.pricing_model === 'starting_price'
      ? `From ${formatMoney(listing.base_price_kobo ?? 0, listing.currency)}`
      : listing.pricing_model === 'hourly'
      ? `${formatMoney(listing.base_price_kobo ?? 0, listing.currency)} / hour`
      : formatMoney(listing.base_price_kobo ?? 0, listing.currency)

  return c.render(
    <Layout title={listing.title} description={listing.description} user={user} locale={locale}>
      <div class="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-6">
        <nav class="text-xs text-gray-500 mb-4 flex items-center gap-1.5 flex-wrap">
          <a href="/gigs" class="hover:text-primary">NaijaGigs</a>
          <span class="material-symbols-outlined text-sm">chevron_right</span>
          <a href={`/gigs/category/${listing.category_slug}`} class="hover:text-primary">{listing.category_name}</a>
        </nav>

        <div class="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-8">
          <div>
            <span class="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-dark bg-primary-light px-2.5 py-1 rounded">
              {listing.category_name}
            </span>
            <h1 class="text-2xl font-bold text-gray-900 mt-2">{listing.title}</h1>
            {listing.rating_count > 0 && (
              <div class="flex items-center gap-1 text-sm text-gray-600 mt-2">
                <span class="material-symbols-outlined text-amber-500 text-base" style="font-variation-settings:'FILL' 1">star</span>
                <span class="font-semibold">{listing.rating_avg.toFixed(1)}</span>
                <span class="text-gray-400">({listing.rating_count} completed jobs)</span>
              </div>
            )}
            <p class="text-gray-600 mt-4 text-sm leading-relaxed">{listing.description}</p>

            {provider && (
              <a href={`/gigs/providers/${provider.id}`} class="flex items-center gap-3 mt-5 p-3 bg-white border border-gray-200 rounded-xl hover:border-primary transition-colors">
                {provider.avatar_url ? (
                  <img src={provider.avatar_url} alt={provider.display_name} class="w-12 h-12 rounded-full object-cover shrink-0" />
                ) : (
                  <div class="w-12 h-12 rounded-full bg-primary-light text-primary-dark font-bold flex items-center justify-center shrink-0">
                    {provider.display_name.charAt(0)}
                  </div>
                )}
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-1.5">
                    <span class="text-sm font-semibold text-gray-800">{provider.display_name}</span>
                    {provider.verification_status === 'verified' && (
                      <span class="material-symbols-outlined text-primary text-sm" style="font-variation-settings:'FILL' 1">verified</span>
                    )}
                  </div>
                  <p class="text-xs text-gray-500 line-clamp-1">{provider.bio}</p>
                </div>
                <span class="material-symbols-outlined text-gray-400">chevron_right</span>
              </a>
            )}

            {areas.length > 0 && (
              <p class="text-xs text-gray-500 mt-3 flex items-center gap-1">
                <span class="material-symbols-outlined text-sm">location_on</span>
                Available in {areas.map((a) => a.neighborhood || a.city).filter(Boolean).join(', ')}
              </p>
            )}

            {packages.length > 0 && (
              <section class="mt-8">
                <h2 class="text-lg font-bold text-gray-800 mb-3">Packages</h2>
                <div class="grid sm:grid-cols-2 gap-3">
                  {packages.map((pkg) => {
                    const included: string[] = JSON.parse(pkg.included_json || '[]')
                    return (
                      <div class="border border-gray-200 rounded-xl p-4">
                        <h3 class="font-semibold text-gray-800 text-sm">{pkg.title}</h3>
                        <p class="text-xs text-gray-500 mt-1">{pkg.description}</p>
                        <p class="text-lg font-bold text-gray-900 mt-2">{formatMoney(pkg.price_kobo, listing.currency)}</p>
                        {included.length > 0 && (
                          <ul class="mt-2 space-y-1 text-xs text-gray-600">
                            {included.map((item) => (
                              <li class="flex items-center gap-1.5"><span class="material-symbols-outlined text-primary text-sm">check</span>{item}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {requirements.length > 0 && (
              <section class="mt-8">
                <h2 class="text-lg font-bold text-gray-800 mb-3">What the provider will ask for</h2>
                <ul class="space-y-1.5 text-sm text-gray-600">
                  {requirements.map((r) => (
                    <li class="flex items-center gap-2">
                      <span class="material-symbols-outlined text-primary text-base">info</span>
                      {r.label}{r.required ? '' : ' (optional)'}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {(listing.terms || listing.cancellation_policy) && (
              <section class="mt-8 text-sm text-gray-600 space-y-2">
                {listing.terms && (
                  <p><span class="font-semibold text-gray-800">Terms: </span>{listing.terms}</p>
                )}
                {listing.cancellation_policy && (
                  <p><span class="font-semibold text-gray-800">Cancellation policy: </span>{listing.cancellation_policy}</p>
                )}
              </section>
            )}
          </div>

          {/* Sticky quote-request box */}
          <div class="lg:sticky lg:top-20 h-fit bg-white border border-gray-200 rounded-xl p-5">
            <p class="text-xs text-gray-500">Estimated price</p>
            <p class="text-2xl font-bold text-gray-900 mt-0.5">{priceLabel}</p>
            <p class="text-xs text-gray-500 mt-1">Final price confirmed in the provider's quote before you pay anything.</p>
            <a
              href={`/gigs/request?listing_id=${listing.id}`}
              class="w-full mt-4 bg-primary-fixed text-primary-dark font-semibold py-3 rounded-lg hover:brightness-95 transition flex items-center justify-center gap-2"
            >
              <span class="material-symbols-outlined">request_quote</span>Request a quote
            </a>
            <div class="flex flex-col gap-2 mt-4 pt-4 border-t border-gray-100 text-xs text-gray-500">
              <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-base">verified_user</span>Escrow-protected payment</span>
              <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-base">receipt_long</span>Written quote before any work starts</span>
              <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-base">replay</span>{listing.cancellation_policy || 'Cancellation terms confirmed with your quote'}</span>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}

// ============================================================
// GET /gigs/request — post a job / request a quote (requireAuthPage)
// ============================================================
export async function gigsRequestPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')!
  const locale = c.get('locale')
  const listingIdParam = c.req.query('listing_id')
  const listingId = listingIdParam ? Number(listingIdParam) : undefined

  const [categories, presetListing] = await Promise.all([
    getTopLevelServiceCategories(db),
    listingId && !Number.isNaN(listingId) ? getPublicServiceListingById(db, listingId) : Promise.resolve(null)
  ])
  // Subcategories for every top category, fetched up-front so the client-side
  // category select can populate a second-level select with zero extra round trips.
  const subcategoriesByParent: Record<number, CategoryRow[]> = {}
  for (const cat of categories) {
    subcategoriesByParent[cat.id] = await getServiceSubcategories(db, cat.slug)
  }

  return c.render(
    <Layout title="Post a job — NaijaGigs" user={user} locale={locale}>
      <div class="max-w-2xl mx-auto px-4 md:px-6 lg:px-8 py-6">
        <a href={presetListing ? `/gigs/listings/${presetListing.id}` : '/gigs'} class="text-sm text-primary font-medium hover:underline flex items-center gap-1 mb-4">
          <span class="material-symbols-outlined text-base">arrow_back</span>Back
        </a>
        <h1 class="text-xl font-bold text-gray-900 mb-1">{presetListing ? `Request a quote — ${presetListing.title}` : 'Post a job & get quotes'}</h1>
        <p class="text-sm text-gray-500 mb-6">Describe what you need done. Verified providers will send you written quotes — you only pay once you accept one.</p>

        <div id="gigs-request-error" class="hidden bg-red-50 text-red-600 text-sm rounded-lg px-4 py-3 mb-4"></div>

        <form id="gigs-request-form" class="space-y-4 bg-white border border-gray-200 rounded-xl p-5">
          <input type="hidden" name="service_listing_id" value={presetListing?.id ?? ''} />
          <div class="grid sm:grid-cols-2 gap-4">
            <div>
              <label class="text-sm font-medium text-gray-700 block mb-1">Category</label>
              <select
                name="category_id"
                id="gigs-category-select"
                required
                class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
              >
                <option value="">Select a category</option>
                {categories.map((cat) => (
                  <>
                    <option value={cat.id} selected={presetListing?.category_id === cat.id}>{cat.name}</option>
                    {subcategoriesByParent[cat.id]?.map((sub) => (
                      <option value={sub.id} selected={presetListing?.category_id === sub.id}>&nbsp;&nbsp;— {sub.name}</option>
                    ))}
                  </>
                ))}
              </select>
            </div>
            <div>
              <label class="text-sm font-medium text-gray-700 block mb-1">Urgency</label>
              <select name="urgency" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary">
                <option value="normal">Normal</option>
                <option value="urgent">Urgent</option>
                <option value="emergency">Emergency</option>
              </select>
            </div>
          </div>

          <div>
            <label class="text-sm font-medium text-gray-700 block mb-1">Job title</label>
            <input
              type="text" name="title" required maxlength={140}
              value={presetListing ? `Quote request: ${presetListing.title}` : ''}
              placeholder="e.g. Fix leaking kitchen tap"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <div>
            <label class="text-sm font-medium text-gray-700 block mb-1">Describe what you need</label>
            <textarea
              name="description" required rows={4}
              placeholder="Give as much detail as you can — what's the problem, what have you tried, any preferences?"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary resize-none"
            ></textarea>
          </div>

          <div class="grid sm:grid-cols-2 gap-4">
            <div>
              <label class="text-sm font-medium text-gray-700 block mb-1">City</label>
              <input type="text" name="city" value="Lagos" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <div>
              <label class="text-sm font-medium text-gray-700 block mb-1">Address / neighborhood</label>
              <input type="text" name="address_line1" placeholder="e.g. Lekki Phase 1" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
          </div>

          <div class="grid sm:grid-cols-3 gap-4">
            <div>
              <label class="text-sm font-medium text-gray-700 block mb-1">Preferred date</label>
              <input type="date" name="preferred_date" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <div>
              <label class="text-sm font-medium text-gray-700 block mb-1">Preferred time</label>
              <input type="time" name="preferred_time" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <div>
              <label class="text-sm font-medium text-gray-700 block mb-1">Budget (₦, optional)</label>
              <input type="number" name="budget_naira" min="0" placeholder="e.g. 15000" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
          </div>

          <button type="submit" id="gigs-request-submit-btn" class="w-full bg-primary text-white font-semibold py-3 rounded-lg hover:bg-primary-dark transition flex items-center justify-center gap-2">
            <span class="material-symbols-outlined">send</span>Submit request
          </button>
          <p class="text-xs text-gray-400 text-center">No payment is taken now — you'll review and accept a quote first.</p>
        </form>
      </div>
      <script src="/static/gigs.js"></script>
    </Layout>
  )
}

// ============================================================
// GET /gigs/dashboard — customer's requests & orders (requireAuthPage)
// ============================================================
export async function gigsDashboardPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')!
  const locale = c.get('locale')

  const [requests, orders] = await Promise.all([
    getRequestsForCustomer(db, user.id) as unknown as Promise<any[]>,
    getOrdersForCustomer(db, user.id) as unknown as Promise<any[]>
  ])

  return c.render(
    <Layout title="My NaijaGigs — Requests & Orders" user={user} locale={locale}>
      <div class="max-w-4xl mx-auto px-4 md:px-6 lg:px-8 py-6">
        <div class="flex items-center justify-between flex-wrap gap-2 mb-6">
          <h1 class="text-xl md:text-2xl font-bold text-gray-900">My NaijaGigs</h1>
          <a href="/gigs/request" class="text-sm font-semibold text-primary hover:underline flex items-center gap-1">
            <span class="material-symbols-outlined text-base">add</span>New request
          </a>
        </div>

        <section class="mb-10">
          <h2 class="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Service requests ({requests.length})</h2>
          {requests.length === 0 ? (
            <div class="text-center py-10 bg-white border border-gray-200 rounded-xl text-gray-400">
              <p>You haven't posted any jobs yet.</p>
              <a href="/gigs/request" class="inline-block mt-2 text-primary font-semibold hover:underline">Post your first job &rarr;</a>
            </div>
          ) : (
            <div class="space-y-2">
              {requests.map((r: any) => (
                <a href={`/gigs/dashboard/requests/${r.id}`} class="block bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition">
                  <div class="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <p class="text-sm font-semibold text-gray-800">{r.title}</p>
                      <p class="text-xs text-gray-500 mt-0.5">{r.category_name} · {r.request_number} · {new Date(r.created_at).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' })}</p>
                    </div>
                    {statusPill(REQUEST_STATUS_LABEL, r.status)}
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 class="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Service orders ({orders.length})</h2>
          {orders.length === 0 ? (
            <div class="text-center py-10 bg-white border border-gray-200 rounded-xl text-gray-400">
              <p>No confirmed service orders yet — orders appear here once you accept a quote.</p>
            </div>
          ) : (
            <div class="space-y-2">
              {orders.map((o: any) => (
                <a href={`/gigs/dashboard/orders/${o.id}`} class="block bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition">
                  <div class="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <p class="text-sm font-semibold text-gray-800">{o.request_title}</p>
                      <p class="text-xs text-gray-500 mt-0.5">{o.provider_display_name} · {o.order_number}</p>
                    </div>
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-bold text-gray-900">{formatMoney(o.total_kobo, o.currency)}</span>
                      {statusPill(ORDER_STATUS_LABEL, o.status)}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>
      </div>
    </Layout>
  )
}

// ============================================================
// GET /gigs/dashboard/requests/:id — request detail + quote comparison (requireAuthPage)
// ============================================================
export async function gigsRequestDetailPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')!
  const locale = c.get('locale')
  const id = Number(c.req.param('id'))

  const request = Number.isNaN(id) ? null : await getOwnedServiceRequest(db, user.id, id)
  if (!request) {
    c.status(404)
    return c.render(
      <Layout title="Request not found" user={user} locale={locale}>
        <div class="max-w-2xl mx-auto text-center py-20">
          <span class="material-symbols-outlined text-5xl text-gray-300">search_off</span>
          <h1 class="text-xl font-bold mt-4">Service request not found</h1>
          <a href="/gigs/dashboard" class="text-primary font-semibold hover:underline mt-2 inline-block">Back to My NaijaGigs</a>
        </div>
      </Layout>
    )
  }

  const [requirements, attachments, quotesRaw] = await Promise.all([
    getRequirementsForRequest(db, id) as unknown as Promise<any[]>,
    getAttachmentsForRequest(db, id) as unknown as Promise<any[]>,
    getQuotesForRequest(db, id)
  ])
  const quotes = await Promise.all(quotesRaw.map((q) => expireQuoteIfNeeded(db, q)))
  const category = await db.prepare('SELECT name FROM categories WHERE id = ?').bind(request.category_id).first<{ name: string }>()

  return c.render(
    <Layout title={`${request.title} — NaijaGigs`} user={user} locale={locale}>
      <div class="max-w-3xl mx-auto px-4 md:px-6 lg:px-8 py-6">
        <a href="/gigs/dashboard" class="text-sm text-primary font-medium hover:underline flex items-center gap-1 mb-4">
          <span class="material-symbols-outlined text-base">arrow_back</span>My NaijaGigs
        </a>

        <div id="gigs-request-action-error" class="hidden bg-red-50 text-red-600 text-sm rounded-lg px-4 py-3 mb-4"></div>

        <div class="flex items-center justify-between flex-wrap gap-2 mb-2">
          <h1 class="text-xl font-bold text-gray-900">{request.title}</h1>
          {statusPill(REQUEST_STATUS_LABEL, request.status)}
        </div>
        <p class="text-sm text-gray-500 mb-1">{request.request_number} · {category?.name}</p>
        <p class="text-sm text-gray-600 mt-3 bg-white border border-gray-200 rounded-xl p-4 leading-relaxed">{request.description}</p>

        <div class="grid sm:grid-cols-2 gap-3 mt-4 text-sm">
          {request.city && (
            <div class="flex items-center gap-1.5 text-gray-600"><span class="material-symbols-outlined text-base text-gray-400">location_on</span>{request.address_line1 ? `${request.address_line1}, ` : ''}{request.city}</div>
          )}
          {request.preferred_date && (
            <div class="flex items-center gap-1.5 text-gray-600"><span class="material-symbols-outlined text-base text-gray-400">event</span>{request.preferred_date}{request.preferred_time ? ` at ${request.preferred_time}` : ''}</div>
          )}
          {request.budget_kobo != null && (
            <div class="flex items-center gap-1.5 text-gray-600"><span class="material-symbols-outlined text-base text-gray-400">payments</span>Budget: {formatMoney(request.budget_kobo, 'NGN')}</div>
          )}
          <div class="flex items-center gap-1.5 text-gray-600"><span class="material-symbols-outlined text-base text-gray-400">priority_high</span>{URGENCY_LABEL[request.urgency]?.label ?? request.urgency}</div>
        </div>

        {requirements.length > 0 && (
          <div class="mt-4 text-sm text-gray-600 space-y-1">
            {requirements.map((r: any) => (
              <p><span class="font-medium text-gray-700">{r.label}: </span>{r.value || '—'}</p>
            ))}
          </div>
        )}

        <section class="mt-8">
          <h2 class="text-lg font-bold text-gray-900 mb-4">Quotes ({quotes.length})</h2>
          {quotes.length === 0 ? (
            <div class="text-center py-10 bg-white border border-gray-200 rounded-xl text-gray-400">
              <p>No quotes yet — verified providers matching your job will send quotes here.</p>
            </div>
          ) : (
            <div class="space-y-3">
              {quotes.map((q: any) => (
                <div class="bg-white border border-gray-200 rounded-xl p-4" data-quote-id={q.id}>
                  <div class="flex items-center justify-between flex-wrap gap-2">
                    <div class="flex items-center gap-2">
                      <span class="font-semibold text-gray-800 text-sm">{q.provider_display_name}</span>
                      {q.provider_rating_avg > 0 && (
                        <span class="flex items-center gap-0.5 text-xs text-gray-500">
                          <span class="material-symbols-outlined text-amber-500 text-sm" style="font-variation-settings:'FILL' 1">star</span>
                          {q.provider_rating_avg.toFixed(1)}
                        </span>
                      )}
                    </div>
                    <span class="text-lg font-bold text-gray-900">{formatMoney(q.price_kobo, q.currency)}</span>
                  </div>
                  {q.scope && <p class="text-sm text-gray-600 mt-2">{q.scope}</p>}
                  <div class="flex items-center gap-3 text-xs text-gray-500 mt-2 flex-wrap">
                    {q.proposed_date && <span class="flex items-center gap-1"><span class="material-symbols-outlined text-sm">event</span>{q.proposed_date} {q.proposed_time}</span>}
                    {q.travel_fee_kobo > 0 && <span>+ {formatMoney(q.travel_fee_kobo, q.currency)} travel fee</span>}
                    {q.materials_included ? <span>Materials included</span> : null}
                  </div>
                  <div class="flex items-center justify-between mt-3">
                    <span class={`text-xs font-semibold px-2 py-0.5 rounded-full ${q.status === 'accepted' ? 'text-primary bg-primary-light' : q.status === 'rejected' || q.status === 'expired' ? 'text-gray-400 bg-gray-100' : 'text-blue-600 bg-blue-50'}`}>
                      {q.status.charAt(0).toUpperCase() + q.status.slice(1)}
                    </span>
                    {(q.status === 'sent' || q.status === 'viewed') && request.status !== 'accepted' && (
                      <div class="flex items-center gap-2">
                        <button type="button" class="gigs-quote-reject-btn text-xs font-semibold text-gray-500 hover:text-red-600 px-3 py-1.5" data-quote-id={q.id}>Decline</button>
                        <button type="button" class="gigs-quote-accept-btn text-xs font-semibold text-white bg-primary px-4 py-1.5 rounded-lg hover:bg-primary-dark transition" data-quote-id={q.id}>Accept quote</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <script src="/static/gigs.js"></script>
    </Layout>
  )
}

// ============================================================
// GET /gigs/dashboard/orders/:id — service order detail (requireAuthPage)
// ============================================================
export async function gigsOrderDetailPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')!
  const locale = c.get('locale')
  const id = Number(c.req.param('id'))

  const order = Number.isNaN(id) ? null : await getOwnedOrderForCustomer(db, user.id, id)
  if (!order) {
    c.status(404)
    return c.render(
      <Layout title="Order not found" user={user} locale={locale}>
        <div class="max-w-2xl mx-auto text-center py-20">
          <span class="material-symbols-outlined text-5xl text-gray-300">search_off</span>
          <h1 class="text-xl font-bold mt-4">Service order not found</h1>
          <a href="/gigs/dashboard" class="text-primary font-semibold hover:underline mt-2 inline-block">Back to My NaijaGigs</a>
        </div>
      </Layout>
    )
  }

  const [events, provider] = await Promise.all([
    getEventsForOrder(db, id) as unknown as Promise<any[]>,
    db.prepare('SELECT display_name, contact_phone, avatar_url FROM provider_profiles WHERE id = ?').bind(order.provider_profile_id).first<{ display_name: string; contact_phone: string | null; avatar_url: string | null }>()
  ])

  const canCancel = order.status === 'accepted' || order.status === 'scheduled'
  const canConfirmOrDispute = order.status === 'completed'

  return c.render(
    <Layout title={`Order ${order.order_number} — NaijaGigs`} user={user} locale={locale}>
      <div class="max-w-2xl mx-auto px-4 md:px-6 lg:px-8 py-6">
        <a href="/gigs/dashboard" class="text-sm text-primary font-medium hover:underline flex items-center gap-1 mb-4">
          <span class="material-symbols-outlined text-base">arrow_back</span>My NaijaGigs
        </a>

        <div id="gigs-order-action-error" class="hidden bg-red-50 text-red-600 text-sm rounded-lg px-4 py-3 mb-4"></div>

        <div class="flex items-center justify-between flex-wrap gap-2 mb-4" data-order-id={order.id}>
          <h1 class="text-xl font-bold text-gray-900">{order.order_number}</h1>
          {statusPill(ORDER_STATUS_LABEL, order.status)}
        </div>

        {provider && (
          <div class="flex items-center gap-3 bg-white border border-gray-200 rounded-xl p-4 mb-4">
            {provider.avatar_url ? (
              <img src={provider.avatar_url} alt={provider.display_name} class="w-10 h-10 rounded-full object-cover shrink-0" />
            ) : (
              <div class="w-10 h-10 rounded-full bg-primary-light text-primary-dark font-bold flex items-center justify-center shrink-0">{provider.display_name.charAt(0)}</div>
            )}
            <div>
              <p class="text-sm font-semibold text-gray-800">{provider.display_name}</p>
              {provider.contact_phone && <p class="text-xs text-gray-500">{provider.contact_phone}</p>}
            </div>
          </div>
        )}

        <div class="bg-white border border-gray-200 rounded-xl p-4 mb-4">
          <h2 class="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Payment summary</h2>
          <div class="flex justify-between text-sm text-gray-600 mb-1"><span>Service price</span><span>{formatMoney(order.price_kobo, order.currency)}</span></div>
          {order.travel_fee_kobo > 0 && <div class="flex justify-between text-sm text-gray-600 mb-1"><span>Travel fee</span><span>{formatMoney(order.travel_fee_kobo, order.currency)}</span></div>}
          {order.additional_charges_kobo > 0 && <div class="flex justify-between text-sm text-gray-600 mb-1"><span>Additional charges</span><span>{formatMoney(order.additional_charges_kobo, order.currency)}</span></div>}
          <div class="flex justify-between text-sm text-gray-600 mb-1"><span>Platform fee</span><span>{formatMoney(order.platform_fee_kobo, order.currency)}</span></div>
          <div class="flex justify-between text-sm font-bold text-gray-900 pt-1.5 border-t border-gray-100"><span>Total</span><span>{formatMoney(order.total_kobo, order.currency)}</span></div>
          <p class="text-xs text-gray-400 mt-2">Payment status: {order.payment_status.replace('_', ' ')}</p>
        </div>

        {(canCancel || canConfirmOrDispute) && (
          <div class="flex items-center gap-2 mb-6 flex-wrap">
            {canCancel && (
              <button type="button" id="gigs-order-cancel-btn" class="text-sm font-semibold text-red-600 border border-red-200 px-4 py-2 rounded-lg hover:bg-red-50 transition">Cancel order</button>
            )}
            {canConfirmOrDispute && (
              <>
                <button type="button" id="gigs-order-confirm-btn" class="text-sm font-semibold text-white bg-primary px-4 py-2 rounded-lg hover:bg-primary-dark transition">Confirm job complete</button>
                <button type="button" id="gigs-order-dispute-btn" class="text-sm font-semibold text-red-600 border border-red-200 px-4 py-2 rounded-lg hover:bg-red-50 transition">Raise a dispute</button>
              </>
            )}
          </div>
        )}

        <section>
          <h2 class="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Order history</h2>
          <div class="space-y-3">
            {events.map((ev: any) => (
              <div class="flex items-start gap-3">
                <span class="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0"></span>
                <div>
                  <p class="text-sm text-gray-700">{(ORDER_STATUS_LABEL[ev.new_status]?.label) ?? ev.new_status}</p>
                  <p class="text-xs text-gray-400">{new Date(ev.created_at).toLocaleString('en-NG')}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
      <script src="/static/gigs.js"></script>
    </Layout>
  )
}

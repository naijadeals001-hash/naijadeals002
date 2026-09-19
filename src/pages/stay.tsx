/**
 * NaijaStay — customer-facing pages for the Booking Engine 2.0
 * (migrations 0024/0028/0034/0041/0043) + Stay domain seed (migration
 * 0073). This is the FIRST real UI wired to the Stay side of that
 * engine — before this file, /stay only rendered the static
 * ecosystem-preview placeholder (src/pages/ecosystem-preview.tsx).
 *
 * Every write path (hold a unit, confirm a booking, pay, cancel) goes
 * through the EXISTING generic, vertical-agnostic Booking Engine API
 * (src/routes/api-bookings.ts) via public/static/stay.js — no new write
 * logic is duplicated here, only real reads for SSR + real links to the
 * real API for actions (spec section 33AG: no fake completion).
 *
 * SCOPE THIS PHASE: Nigeria-only demo inventory (Lagos + Abuja). Nothing
 * in this file hardcodes that scope beyond the /stay home page's default
 * countryIso='NG' query — the browse/search functions in src/lib/stay.ts
 * take countryIso/city as plain parameters, so adding a second country
 * later is a seed-data change, never a rebuild of these pages.
 */
import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import type { AppEnv } from '../types'
import { formatMoney } from '../lib/money'
import {
  searchStayProperties,
  getStayPropertyBySlug,
  getUnitsForProperty,
  getStayUnitById,
  getStayDestinationCities,
  getMinPriceForProperty,
  type StayPropertyRow,
} from '../lib/stay'
import { getResourcesForListing } from '../lib/booking-availability'
import { getBookingsForCustomer } from '../lib/booking-lifecycle'

const PROPERTY_TYPE_META: Record<string, { label: string; icon: string }> = {
  hotel: { label: 'Hotels', icon: 'hotel' },
  apartment: { label: 'Apartments', icon: 'apartment' },
  resort: { label: 'Resorts', icon: 'beach_access' },
  villa: { label: 'Villas', icon: 'villa' },
  vacation_home: { label: 'Vacation Homes', icon: 'cottage' },
  guesthouse: { label: 'Guesthouses', icon: 'holiday_village' },
  hostel: { label: 'Hostels', icon: 'night_shelter' },
  unique_stay: { label: 'Unique Stays', icon: 'auto_awesome' },
}
const ALL_PROPERTY_TYPES = ['hotel', 'apartment', 'resort', 'villa', 'vacation_home', 'guesthouse', 'hostel', 'unique_stay']

const BADGE_BY_RATING = (rating: number, count: number): { label: string; color: string } | null => {
  if (count === 0) return null
  if (rating >= 4.8) return { label: 'Guest Favorite', color: 'bg-white text-gray-800' }
  if (count >= 100) return { label: 'Verified Property', color: 'bg-white text-gray-800' }
  return { label: 'Top Rated', color: 'bg-white text-gray-800' }
}

/** Featured-stays card — mirrors the reference screenshot's card anatomy: image, badge, heart, rating, title, location, amenity icons, price/night + total, "View stay" CTA. */
function StayPropertyCard({ property, minPriceKobo }: { property: StayPropertyRow; minPriceKobo: number | null }) {
  const amenities: string[] = JSON.parse(property.amenities_json || '[]')
  const badge = BADGE_BY_RATING(property.rating_avg, property.rating_count)
  const nights = 5 // illustrative total-stay multiplier shown under nightly price, mirrors reference screenshot's "total" line
  return (
    <a href={`/stay/property/${property.slug}`} class="group flex flex-col bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow">
      <div class="relative">
        <img src={property.cover_image_url ?? ''} alt={property.name} class="w-full h-44 object-cover" />
        {badge && (
          <span class={`absolute top-3 left-3 text-[11px] font-semibold px-2.5 py-1 rounded-full shadow-sm ${badge.color}`}>{badge.label}</span>
        )}
        <span class="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/90 flex items-center justify-center shadow-sm">
          <span class="material-symbols-outlined text-gray-600 text-lg">favorite_border</span>
        </span>
      </div>
      <div class="p-4 flex-1 flex flex-col">
        <h3 class="text-sm font-bold text-gray-900 line-clamp-1">{property.name}</h3>
        <p class="text-xs text-gray-500 mt-1 flex items-center gap-1">
          <span class="material-symbols-outlined text-sm">location_on</span>
          {property.neighborhood ? `${property.neighborhood}, ` : ''}{property.city}
        </p>
        {property.rating_count > 0 && (
          <div class="flex items-center gap-1 text-xs text-gray-600 mt-2">
            <span class="material-symbols-outlined text-amber-500 text-sm" style="font-variation-settings:'FILL' 1">star</span>
            <span class="font-semibold">{property.rating_avg.toFixed(1)}</span>
            <span class="text-gray-400">({property.rating_count} reviews)</span>
          </div>
        )}
        {amenities.length > 0 && (
          <div class="flex items-center gap-2 text-[11px] text-gray-500 mt-2 flex-wrap">
            {amenities.slice(0, 3).map((a) => (
              <span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">check_circle</span>{a}</span>
            ))}
          </div>
        )}
        <div class="mt-3 pt-3 border-t border-gray-100 flex items-end justify-between">
          <div>
            {minPriceKobo != null ? (
              <>
                <p class="text-base font-bold text-gray-900">{formatMoney(minPriceKobo, 'NGN')} <span class="text-xs font-normal text-gray-500">/ night</span></p>
                <p class="text-[11px] text-gray-400">{formatMoney(minPriceKobo * nights, 'NGN')} total</p>
              </>
            ) : (
              <p class="text-sm text-gray-400">Price on request</p>
            )}
          </div>
          <span class="text-xs font-semibold text-primary border border-primary rounded-lg px-3 py-1.5 group-hover:bg-primary group-hover:text-white transition-colors">
            View stay
          </span>
        </div>
      </div>
    </a>
  )
}

// ============================================================
// GET /stay — home/browse page: hero search + property types + popular
// destinations + featured stays + trust row + ecosystem cross-sell.
// ============================================================
export async function stayHomePage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')
  const cityFilter = c.req.query('city') || undefined
  const typeFilter = c.req.query('type') || undefined

  const [properties, cities, typeCounts] = await Promise.all([
    searchStayProperties(db, { countryIso: 'NG', city: cityFilter, propertyType: typeFilter, limit: 24 }),
    getStayDestinationCities(db, 'NG'),
    db.prepare(`SELECT property_type, COUNT(*) AS count FROM stay_properties WHERE is_active = 1 GROUP BY property_type`).all<{ property_type: string; count: number }>(),
  ])
  const typeCountMap = new Map(typeCounts.results.map((r) => [r.property_type, r.count]))
  const minPrices = await Promise.all(properties.map((p) => getMinPriceForProperty(db, p.id)))

  const cityImages: Record<string, string> = { Lagos: '/static/stay/destinations/lagos.jpg', Abuja: '/static/stay/destinations/abuja.jpg' }

  return c.render(
    <Layout
      title="NaijaStay — Stay somewhere worth remembering"
      description="Discover hotels, apartments, resorts, vacation homes and unique stays across Nigeria — verified properties, secure payments, real guest reviews."
      user={user}
      locale={locale}
    >
      <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8 py-6">
        {/* Hero */}
        <section id="stay-hero" class="relative bg-primary-dark text-white rounded-2xl overflow-hidden mb-8">
          <img src="/static/stay/lekki-beach-resort-cover.jpg" alt="" class="absolute inset-0 w-full h-full object-cover opacity-40" />
          <div class="relative px-6 py-10 md:px-10 md:py-14">
            <span class="inline-flex items-center gap-1.5 text-xs font-semibold bg-white/15 px-2.5 py-1 rounded-full mb-3">
              <span class="material-symbols-outlined text-sm">bed</span>Hotels, Homes, Short Stays.
            </span>
            <h1 class="text-2xl md:text-4xl font-bold max-w-xl leading-tight">Stay somewhere worth remembering.</h1>
            <p class="text-white/80 text-sm mt-2 max-w-lg">Discover hotels, apartments, resorts, vacation homes and unique stays across Nigeria — with verified properties and secure payments.</p>

            {/* Search bar */}
            <form id="stay-search-form" class="mt-6 bg-white rounded-xl p-2 flex flex-col md:flex-row items-stretch gap-2 shadow-lg max-w-4xl">
              <div class="flex-1 flex items-center gap-2 px-3 py-2 md:border-r border-gray-200">
                <span class="material-symbols-outlined text-gray-400">location_on</span>
                <div class="flex-1">
                  <label class="text-[10px] font-semibold text-gray-500 block">Where are you going?</label>
                  <input type="text" name="city" list="stay-city-options" placeholder="Search city, neighborhood" value={cityFilter ?? ''} class="w-full text-sm outline-none text-gray-800" />
                  <datalist id="stay-city-options">
                    {cities.map((ct) => <option value={ct.city} />)}
                  </datalist>
                </div>
              </div>
              <div class="flex-1 flex items-center gap-2 px-3 py-2 md:border-r border-gray-200">
                <span class="material-symbols-outlined text-gray-400">calendar_month</span>
                <div class="flex-1">
                  <label class="text-[10px] font-semibold text-gray-500 block">Check-in</label>
                  <input type="date" name="check_in" class="w-full text-sm outline-none text-gray-800" />
                </div>
              </div>
              <div class="flex-1 flex items-center gap-2 px-3 py-2 md:border-r border-gray-200">
                <span class="material-symbols-outlined text-gray-400">calendar_month</span>
                <div class="flex-1">
                  <label class="text-[10px] font-semibold text-gray-500 block">Check-out</label>
                  <input type="date" name="check_out" class="w-full text-sm outline-none text-gray-800" />
                </div>
              </div>
              <div class="flex-1 flex items-center gap-2 px-3 py-2">
                <span class="material-symbols-outlined text-gray-400">group</span>
                <div class="flex-1">
                  <label class="text-[10px] font-semibold text-gray-500 block">Guests</label>
                  <input type="number" name="guests" min="1" value="2" class="w-full text-sm outline-none text-gray-800" />
                </div>
              </div>
              <button type="submit" class="bg-primary text-white font-semibold px-6 py-3 rounded-lg hover:bg-primary-dark transition flex items-center justify-center gap-2 shrink-0">
                <span class="material-symbols-outlined">search</span>Search
              </button>
            </form>
          </div>
        </section>

        {/* Property-type icon row */}
        <section id="stay-property-types" class="mb-10">
          <div class="grid grid-cols-4 sm:grid-cols-8 gap-3">
            {ALL_PROPERTY_TYPES.map((pt) => {
              const meta = PROPERTY_TYPE_META[pt]
              const active = typeFilter === pt
              return (
                <a
                  href={`/stay?type=${pt}${cityFilter ? `&city=${cityFilter}` : ''}`}
                  class={`flex flex-col items-center gap-1.5 text-center px-2 py-3 rounded-xl border transition-colors ${active ? 'border-primary bg-primary-light' : 'border-gray-200 hover:border-primary'}`}
                >
                  <span class={`w-10 h-10 rounded-full flex items-center justify-center ${active ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}>
                    <span class="material-symbols-outlined text-lg">{meta.icon}</span>
                  </span>
                  <span class="text-[11px] font-medium text-gray-700">{meta.label}</span>
                  <span class="text-[10px] text-gray-400">{typeCountMap.get(pt) ?? 0}</span>
                </a>
              )
            })}
          </div>
        </section>

        {/* Popular destinations */}
        {cities.length > 0 && (
          <section id="stay-destinations" class="mb-10">
            <div class="flex items-center justify-between mb-4">
              <div>
                <h2 class="text-lg font-bold text-gray-900">Popular destinations</h2>
                <p class="text-xs text-gray-500 mt-0.5">Explore top cities and discover amazing stays across Nigeria.</p>
              </div>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
              {cities.map((ct) => (
                <a href={`/stay?city=${ct.city}`} class="group relative rounded-xl overflow-hidden h-32">
                  <img src={cityImages[ct.city] ?? '/static/ecosystem/stay-desktop.jpg'} alt={ct.city} class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  <div class="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
                  <div class="absolute bottom-3 left-3 text-white">
                    <p class="font-bold text-sm">{ct.city}</p>
                    <p class="text-[11px] text-white/80">{ct.property_count} propert{ct.property_count === 1 ? 'y' : 'ies'}</p>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Featured stays */}
        <section id="stay-featured">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h2 class="text-lg font-bold text-gray-900">Featured stays</h2>
              <p class="text-xs text-gray-500 mt-0.5">Handpicked stays for your next trip.</p>
            </div>
          </div>
          {properties.length === 0 ? (
            <div class="text-center py-16 bg-white border border-gray-200 rounded-xl text-gray-400">
              <span class="material-symbols-outlined text-4xl mb-2">search_off</span>
              <p>No stays match your search yet.</p>
              <a href="/stay" class="inline-block mt-2 text-primary font-semibold hover:underline">Clear filters</a>
            </div>
          ) : (
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              {properties.map((p, i) => <StayPropertyCard property={p} minPriceKobo={minPrices[i]} />)}
            </div>
          )}
        </section>

        {/* Why book with NaijaStay */}
        <section id="stay-trust" class="mt-12 bg-white border border-gray-200 rounded-2xl p-6 md:p-8">
          <h2 class="text-lg font-bold text-gray-900 mb-5">Why book with NaijaStay?</h2>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { icon: 'verified', title: 'Verified properties', body: 'Real stays, real hosts' },
              { icon: 'lock', title: 'Secure payments', body: 'Your money is protected' },
              { icon: 'replay', title: 'Flexible options', body: 'Free cancellation on many stays' },
              { icon: 'support_agent', title: '24/7 support', body: "We're here when you need us" },
            ].map((f) => (
              <div class="flex flex-col items-center text-center gap-2">
                <span class="w-11 h-11 rounded-full bg-primary-light flex items-center justify-center">
                  <span class="material-symbols-outlined text-primary text-xl">{f.icon}</span>
                </span>
                <p class="text-sm font-semibold text-gray-800">{f.title}</p>
                <p class="text-xs text-gray-500">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Ecosystem cross-sell footer */}
        <section id="stay-ecosystem-crosssell" class="mt-8 bg-primary-light rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 class="font-bold text-gray-900">Part of the NaijaDeals family</h3>
            <p class="text-sm text-gray-600 mt-1">Make the most of your trip with our all-in-one ecosystem.</p>
          </div>
          <div class="flex items-center gap-3 flex-wrap">
            <a href="/drive" class="flex items-center gap-1.5 text-xs font-semibold bg-white px-3 py-2 rounded-lg hover:shadow transition"><span class="material-symbols-outlined text-sm text-primary">directions_car</span>NaijaDrive</a>
            <a href="/eats" class="flex items-center gap-1.5 text-xs font-semibold bg-white px-3 py-2 rounded-lg hover:shadow transition"><span class="material-symbols-outlined text-sm text-primary">restaurant</span>NaijaEats</a>
            <a href="/gigs" class="flex items-center gap-1.5 text-xs font-semibold bg-white px-3 py-2 rounded-lg hover:shadow transition"><span class="material-symbols-outlined text-sm text-primary">handyman</span>NaijaGigs</a>
            <a href="/shop" class="flex items-center gap-1.5 text-xs font-semibold bg-white px-3 py-2 rounded-lg hover:shadow transition"><span class="material-symbols-outlined text-sm text-primary">storefront</span>NaijaShop</a>
          </div>
        </section>
      </div>
      <script src="/static/stay.js"></script>
    </Layout>
  )
}

// ============================================================
// GET /stay/property/:slug — property detail: gallery, amenities, house
// rules, unit list with availability CTA.
// ============================================================
export async function stayPropertyPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')
  const slug = c.req.param('slug') ?? ''

  const property = await getStayPropertyBySlug(db, slug)
  if (!property) {
    c.status(404)
    return c.render(
      <Layout title="Stay not found" user={user} locale={locale}>
        <div class="max-w-2xl mx-auto text-center py-20">
          <span class="material-symbols-outlined text-5xl text-gray-300">search_off</span>
          <h1 class="text-xl font-bold mt-4">Property not found</h1>
          <a href="/stay" class="text-primary font-semibold hover:underline mt-2 inline-block">Back to NaijaStay</a>
        </div>
      </Layout>
    )
  }

  const units = await getUnitsForProperty(db, property.id)
  const gallery: string[] = JSON.parse(property.gallery_json || '[]')
  const amenities: string[] = JSON.parse(property.amenities_json || '[]')
  const minPrice = await getMinPriceForProperty(db, property.id)

  return c.render(
    <Layout title={`${property.name} — NaijaStay`} description={property.description} user={user} locale={locale}>
      <div class="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-6">
        <a href="/stay" class="text-sm text-primary font-medium hover:underline flex items-center gap-1 mb-4">
          <span class="material-symbols-outlined text-base">arrow_back</span>NaijaStay
        </a>

        {/* Gallery */}
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 rounded-xl overflow-hidden mb-6">
          <img src={property.cover_image_url ?? gallery[0]} alt={property.name} class="col-span-2 row-span-2 w-full h-full object-cover min-h-[220px]" />
          {gallery.slice(0, 2).map((g) => <img src={g} alt="" class="w-full h-full object-cover min-h-[108px]" />)}
        </div>

        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <span class="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-dark bg-primary-light px-2.5 py-1 rounded capitalize">
              {PROPERTY_TYPE_META[property.property_type]?.label ?? property.property_type}
            </span>
            <h1 class="text-2xl font-bold text-gray-900 mt-2">{property.name}</h1>
            <p class="text-sm text-gray-500 mt-1 flex items-center gap-1">
              <span class="material-symbols-outlined text-sm">location_on</span>
              {property.address_line1 ? `${property.address_line1}, ` : ''}{property.neighborhood ? `${property.neighborhood}, ` : ''}{property.city}
            </p>
            {property.rating_count > 0 && (
              <div class="flex items-center gap-1 text-sm text-gray-600 mt-2">
                <span class="material-symbols-outlined text-amber-500 text-base" style="font-variation-settings:'FILL' 1">star</span>
                <span class="font-semibold">{property.rating_avg.toFixed(1)}</span>
                <span class="text-gray-400">({property.rating_count} reviews)</span>
                {property.verification_status === 'verified' && (
                  <span class="flex items-center gap-1 text-xs font-semibold text-primary bg-primary-light px-2 py-0.5 rounded-full ml-2">
                    <span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1">verified</span>Verified
                  </span>
                )}
              </div>
            )}
          </div>
          {minPrice != null && (
            <div class="text-right">
              <p class="text-xs text-gray-500">From</p>
              <p class="text-2xl font-bold text-gray-900">{formatMoney(minPrice, 'NGN')}<span class="text-sm font-normal text-gray-500"> /night</span></p>
            </div>
          )}
        </div>

        <p class="text-gray-600 mt-5 text-sm leading-relaxed">{property.description}</p>

        {amenities.length > 0 && (
          <section class="mt-8">
            <h2 class="text-lg font-bold text-gray-800 mb-3">Amenities</h2>
            <div class="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm text-gray-600">
              {amenities.map((a) => (
                <span class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-base">check_circle</span>{a}</span>
              ))}
            </div>
          </section>
        )}

        {/* Unit list */}
        <section class="mt-8">
          <h2 class="text-lg font-bold text-gray-800 mb-4">Choose your room / unit</h2>
          <div class="space-y-4">
            {units.map((unit) => (
              <div class="border border-gray-200 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap" data-unit-id={unit.id} data-resource-id={unit.resource_id}>
                <div class="flex-1 min-w-[200px]">
                  <h3 class="font-semibold text-gray-800">{unit.title}</h3>
                  <p class="text-xs text-gray-500 mt-1 flex items-center gap-3">
                    <span class="flex items-center gap-1"><span class="material-symbols-outlined text-sm">group</span>Up to {unit.max_guests} guests</span>
                    <span class="flex items-center gap-1"><span class="material-symbols-outlined text-sm">meeting_room</span>{unit.unit_type}</span>
                  </p>
                  <p class="text-xs text-gray-400 mt-1">{unit.capacity_units} unit{unit.capacity_units === 1 ? '' : 's'} available</p>
                </div>
                <div class="text-right">
                  <p class="text-lg font-bold text-gray-900">{formatMoney(unit.base_price_kobo, unit.currency)}<span class="text-xs font-normal text-gray-500"> /night</span></p>
                  <a
                    href={`/stay/book/${unit.id}`}
                    class="inline-flex items-center gap-1.5 mt-2 bg-primary text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-primary-dark transition"
                  >
                    Check availability
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>

        {(property.house_rules || property.check_in_info || property.check_out_info) && (
          <section class="mt-8 text-sm text-gray-600 space-y-2">
            {property.check_in_info && <p><span class="font-semibold text-gray-800">Check-in: </span>{property.check_in_info}</p>}
            {property.check_out_info && <p><span class="font-semibold text-gray-800">Check-out: </span>{property.check_out_info}</p>}
            {property.house_rules && <p><span class="font-semibold text-gray-800">House rules: </span>{property.house_rules}</p>}
            {property.cancellation_policy && <p><span class="font-semibold text-gray-800">Cancellation policy: </span>{property.cancellation_policy}</p>}
          </section>
        )}
      </div>
    </Layout>
  )
}

// ============================================================
// GET /stay/book/:listingId — booking/checkout flow (date picker ->
// hold -> confirm -> pay). Real reads only; every write happens client-side
// via public/static/stay.js against the existing bookingsApi.
// ============================================================
export async function stayBookPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')!
  const locale = c.get('locale')
  const id = Number(c.req.param('listingId'))

  if (Number.isNaN(id)) return c.notFound()
  const unit = await getStayUnitById(db, id)
  if (!unit) {
    c.status(404)
    return c.render(
      <Layout title="Stay not found" user={user} locale={locale}>
        <div class="max-w-2xl mx-auto text-center py-20">
          <span class="material-symbols-outlined text-5xl text-gray-300">search_off</span>
          <h1 class="text-xl font-bold mt-4">Unit not found</h1>
          <a href="/stay" class="text-primary font-semibold hover:underline mt-2 inline-block">Back to NaijaStay</a>
        </div>
      </Layout>
    )
  }
  const resources = await getResourcesForListing(db, id)
  const resource = resources[0]

  return c.render(
    <Layout title={`Book — ${unit.title} — NaijaStay`} user={user} locale={locale}>
      <div class="max-w-2xl mx-auto px-4 md:px-6 lg:px-8 py-6">
        <a href={`/stay/property/${unit.property_slug}`} class="text-sm text-primary font-medium hover:underline flex items-center gap-1 mb-4">
          <span class="material-symbols-outlined text-base">arrow_back</span>{unit.property_name}
        </a>

        <div id="stay-book-error" class="hidden bg-red-50 text-red-600 text-sm rounded-lg px-4 py-3 mb-4"></div>

        <div class="bg-white border border-gray-200 rounded-xl p-5 mb-5 flex items-center gap-4">
          <img src={unit.property_cover_image_url ?? ''} alt="" class="w-16 h-16 rounded-lg object-cover shrink-0" />
          <div>
            <p class="text-sm font-semibold text-gray-800">{unit.title}</p>
            <p class="text-xs text-gray-500">{unit.property_name} · {unit.property_city}</p>
            <p class="text-sm font-bold text-gray-900 mt-1">{formatMoney(unit.base_price_kobo, unit.currency)} <span class="text-xs font-normal text-gray-500">/ night</span></p>
          </div>
        </div>

        <div
          id="stay-book-form-root"
          data-listing-id={unit.id}
          data-resource-id={resource?.id ?? ''}
          data-price-kobo={unit.base_price_kobo}
          data-currency={unit.currency}
          data-max-guests={unit.max_guests}
        >
          <div class="bg-white border border-gray-200 rounded-xl p-5">
            <h2 class="text-sm font-bold text-gray-500 uppercase tracking-wide mb-4">1. Choose your dates</h2>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="text-sm font-medium text-gray-700 block mb-1">Check-in</label>
                <input type="date" id="stay-book-checkin" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label class="text-sm font-medium text-gray-700 block mb-1">Check-out</label>
                <input type="date" id="stay-book-checkout" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
              </div>
            </div>
            <div class="mt-4">
              <label class="text-sm font-medium text-gray-700 block mb-1">Guests (max {unit.max_guests})</label>
              <input type="number" id="stay-book-guests" min="1" max={unit.max_guests} value="1" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <button type="button" id="stay-book-check-availability-btn" class="w-full mt-5 bg-gray-800 text-white font-semibold py-3 rounded-lg hover:bg-gray-700 transition flex items-center justify-center gap-2">
              <span class="material-symbols-outlined">event_available</span>Check availability
            </button>
          </div>

          <div id="stay-book-summary" class="hidden bg-white border border-gray-200 rounded-xl p-5 mt-5">
            <h2 class="text-sm font-bold text-gray-500 uppercase tracking-wide mb-4">2. Confirm &amp; hold this unit</h2>
            <div id="stay-book-price-breakdown" class="text-sm text-gray-600 space-y-1 mb-4"></div>
            <button type="button" id="stay-book-hold-btn" class="w-full bg-primary text-white font-semibold py-3 rounded-lg hover:bg-primary-dark transition flex items-center justify-center gap-2">
              <span class="material-symbols-outlined">lock_clock</span>Hold this unit (10 min)
            </button>
          </div>

          <div id="stay-book-confirm" class="hidden bg-white border border-gray-200 rounded-xl p-5 mt-5">
            <h2 class="text-sm font-bold text-gray-500 uppercase tracking-wide mb-4">3. Confirm booking</h2>
            <p class="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-4 flex items-center gap-1.5">
              <span class="material-symbols-outlined text-sm">timer</span>
              <span id="stay-book-hold-timer">Held for 10 minutes</span>
            </p>
            <button type="button" id="stay-book-confirm-btn" class="w-full bg-primary text-white font-semibold py-3 rounded-lg hover:bg-primary-dark transition flex items-center justify-center gap-2">
              <span class="material-symbols-outlined">check_circle</span>Confirm booking
            </button>
          </div>

          <div id="stay-book-pay" class="hidden bg-white border border-gray-200 rounded-xl p-5 mt-5">
            <h2 class="text-sm font-bold text-gray-500 uppercase tracking-wide mb-4">4. Pay deposit</h2>
            <p id="stay-book-pay-summary" class="text-sm text-gray-600 mb-4"></p>
            <button type="button" id="stay-book-pay-btn" class="w-full bg-primary text-white font-semibold py-3 rounded-lg hover:bg-primary-dark transition flex items-center justify-center gap-2">
              <span class="material-symbols-outlined">payments</span>Pay now
            </button>
          </div>
        </div>
      </div>
      <script src="/static/stay.js"></script>
    </Layout>
  )
}

// ============================================================
// GET /stay/dashboard — customer's stay bookings (requireAuthPage)
// ============================================================
const STAY_BOOKING_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'text-gray-500 bg-gray-100' },
  held: { label: 'Held', color: 'text-amber-600 bg-amber-50' },
  pending_payment: { label: 'Awaiting payment', color: 'text-amber-600 bg-amber-50' },
  confirmed: { label: 'Confirmed', color: 'text-primary bg-primary-light' },
  checked_in: { label: 'Checked in', color: 'text-indigo-600 bg-indigo-50' },
  in_progress: { label: 'In progress', color: 'text-indigo-600 bg-indigo-50' },
  completed: { label: 'Completed', color: 'text-primary bg-primary-light' },
  cancelled: { label: 'Cancelled', color: 'text-gray-500 bg-gray-100' },
  expired: { label: 'Expired', color: 'text-gray-500 bg-gray-100' },
  no_show: { label: 'No-show', color: 'text-red-600 bg-red-50' },
  refunded: { label: 'Refunded', color: 'text-red-600 bg-red-50' },
  disputed: { label: 'Disputed', color: 'text-red-600 bg-red-50' },
  declined: { label: 'Declined', color: 'text-red-600 bg-red-50' },
}

export async function stayDashboardPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')!
  const locale = c.get('locale')

  const allBookings = await getBookingsForCustomer(db, user.id)
  const bookings = (allBookings as any[]).filter((b) => b.listing_type_snapshot === 'stay_unit')

  return c.render(
    <Layout title="My NaijaStay bookings" user={user} locale={locale}>
      <div class="max-w-3xl mx-auto px-4 md:px-6 lg:px-8 py-6">
        <div class="flex items-center justify-between flex-wrap gap-2 mb-6">
          <h1 class="text-xl md:text-2xl font-bold text-gray-900">My NaijaStay bookings</h1>
          <a href="/stay" class="text-sm font-semibold text-primary hover:underline flex items-center gap-1">
            <span class="material-symbols-outlined text-base">add</span>Book a stay
          </a>
        </div>

        {bookings.length === 0 ? (
          <div class="text-center py-16 bg-white border border-gray-200 rounded-xl text-gray-400">
            <p>You haven't booked any stays yet.</p>
            <a href="/stay" class="inline-block mt-2 text-primary font-semibold hover:underline">Browse stays &rarr;</a>
          </div>
        ) : (
          <div class="space-y-3">
            {bookings.map((b: any) => (
              <a href={`/stay/dashboard/bookings/${b.id}`} class="block bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition">
                <div class="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <p class="text-sm font-semibold text-gray-800">{b.booking_number}</p>
                    <p class="text-xs text-gray-500 mt-0.5">{new Date(b.starts_at).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' })} &rarr; {new Date(b.ends_at).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' })}</p>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-bold text-gray-900">{formatMoney(b.total_price_kobo, b.currency)}</span>
                    <span class={`text-xs font-semibold px-2.5 py-1 rounded-full ${(STAY_BOOKING_STATUS_LABEL[b.status] || { color: 'text-gray-500 bg-gray-100' }).color}`}>
                      {(STAY_BOOKING_STATUS_LABEL[b.status] || { label: b.status }).label}
                    </span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}

// ============================================================
// GET /stay/dashboard/bookings/:id — booking detail (requireAuthPage)
// ============================================================
export async function stayBookingDetailPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')!
  const locale = c.get('locale')
  const id = Number(c.req.param('id'))

  const notFound = () => {
    c.status(404)
    return c.render(
      <Layout title="Booking not found" user={user} locale={locale}>
        <div class="max-w-2xl mx-auto text-center py-20">
          <span class="material-symbols-outlined text-5xl text-gray-300">search_off</span>
          <h1 class="text-xl font-bold mt-4">Booking not found</h1>
          <a href="/stay/dashboard" class="text-primary font-semibold hover:underline mt-2 inline-block">Back to My NaijaStay bookings</a>
        </div>
      </Layout>
    )
  }
  if (Number.isNaN(id)) return notFound()

  const booking = await db.prepare('SELECT * FROM bookings WHERE id = ? AND customer_user_id = ?').bind(id, user.id).first<any>()
  if (!booking) return notFound()

  const [listing, events] = await Promise.all([
    db.prepare('SELECT bl.title, bl.currency, sp.name AS property_name, sp.city AS property_city, sp.cover_image_url FROM bookable_listings bl LEFT JOIN stay_properties sp ON sp.id = bl.stay_property_id WHERE bl.id = ?').bind(booking.listing_id).first<any>(),
    db.prepare('SELECT * FROM booking_status_events WHERE booking_id = ? ORDER BY created_at ASC').bind(id).all<any>(),
  ])

  const canCancel = ['held', 'pending_payment', 'confirmed'].includes(booking.status)
  const canPay = booking.status === 'pending_payment' || (booking.status === 'held' && booking.payment_status === 'unpaid')

  return c.render(
    <Layout title={`${booking.booking_number} — NaijaStay`} user={user} locale={locale}>
      <div class="max-w-2xl mx-auto px-4 md:px-6 lg:px-8 py-6">
        <a href="/stay/dashboard" class="text-sm text-primary font-medium hover:underline flex items-center gap-1 mb-4">
          <span class="material-symbols-outlined text-base">arrow_back</span>My NaijaStay bookings
        </a>

        <div id="stay-booking-action-error" class="hidden bg-red-50 text-red-600 text-sm rounded-lg px-4 py-3 mb-4"></div>

        <div class="flex items-center justify-between flex-wrap gap-2 mb-4" data-booking-id={booking.id}>
          <h1 class="text-xl font-bold text-gray-900">{booking.booking_number}</h1>
          <span class={`text-xs font-semibold px-2.5 py-1 rounded-full ${(STAY_BOOKING_STATUS_LABEL[booking.status] || { color: 'text-gray-500 bg-gray-100' }).color}`}>
            {(STAY_BOOKING_STATUS_LABEL[booking.status] || { label: booking.status }).label}
          </span>
        </div>

        {listing && (
          <div class="flex items-center gap-3 bg-white border border-gray-200 rounded-xl p-4 mb-4">
            <img src={listing.cover_image_url ?? ''} alt="" class="w-14 h-14 rounded-lg object-cover shrink-0" />
            <div>
              <p class="text-sm font-semibold text-gray-800">{listing.title}</p>
              <p class="text-xs text-gray-500">{listing.property_name} · {listing.property_city}</p>
            </div>
          </div>
        )}

        <div class="bg-white border border-gray-200 rounded-xl p-4 mb-4 text-sm text-gray-600 space-y-1.5">
          <div class="flex justify-between"><span>Check-in</span><span class="font-medium text-gray-800">{new Date(booking.starts_at).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' })}</span></div>
          <div class="flex justify-between"><span>Check-out</span><span class="font-medium text-gray-800">{new Date(booking.ends_at).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' })}</span></div>
          <div class="flex justify-between"><span>Guests</span><span class="font-medium text-gray-800">{booking.guests_count ?? '—'}</span></div>
          <div class="flex justify-between pt-1.5 border-t border-gray-100 font-bold text-gray-900"><span>Total</span><span>{formatMoney(booking.total_price_kobo, booking.currency)}</span></div>
          <p class="text-xs text-gray-400 pt-1">Payment status: {String(booking.payment_status).replace('_', ' ')}</p>
        </div>

        {(canCancel || canPay) && (
          <div class="flex items-center gap-2 mb-6 flex-wrap">
            {canPay && (
              <button type="button" id="stay-booking-pay-btn" class="text-sm font-semibold text-white bg-primary px-4 py-2 rounded-lg hover:bg-primary-dark transition">Pay deposit</button>
            )}
            {canCancel && (
              <button type="button" id="stay-booking-cancel-btn" class="text-sm font-semibold text-red-600 border border-red-200 px-4 py-2 rounded-lg hover:bg-red-50 transition">Cancel booking</button>
            )}
          </div>
        )}

        <section>
          <h2 class="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Booking history</h2>
          <div class="space-y-3">
            {events.results.map((ev: any) => (
              <div class="flex items-start gap-3">
                <span class="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0"></span>
                <div>
                  <p class="text-sm text-gray-700">{(STAY_BOOKING_STATUS_LABEL[ev.status]?.label) ?? ev.status}</p>
                  <p class="text-xs text-gray-400">{new Date(ev.created_at).toLocaleString('en-NG')}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
      <script src="/static/stay.js"></script>
    </Layout>
  )
}

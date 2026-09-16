import type { FC } from 'hono/jsx'
import type { EcosystemVerticalRow, EcosystemVerticalFeatureRow } from '../types'
import { EcosystemWaitlistModal } from './EcosystemWaitlistModal'

/**
 * EcosystemPreview — the ONE reusable component that renders every planned
 * NaijaDeals vertical (/fresh, /eats, /gigs, /stay, /drive, /send, /stream,
 * /aura). Driven entirely by an EcosystemVerticalRow + its feature rows
 * (migration 0010) — there is deliberately no per-vertical TSX file. Adding
 * a 9th vertical, or flipping one from coming_soon -> live, is a data change
 * in ecosystem_verticals, never a new component.
 *
 * This is rendered INSIDE <Layout> by src/pages/ecosystem-preview.tsx, so it
 * automatically gets the real NaijaDeals header (incl. the ecosystem nav
 * strip that already links here) and mega footer — no separate chrome.
 *
 * Honesty rules enforced here (per Pat's directive):
 *   - No fabricated stats/listings/reviews/counts anywhere in this markup.
 *   - The only numbers on the page are literal feature counts driven by the
 *     `features` array length — never an invented "10,000+ users" etc.
 *   - The status badge always reflects `vertical.status` from the DB, never
 *     a hardcoded "Coming Soon" string baked into this component.
 */

interface EcosystemPreviewProps {
  vertical: EcosystemVerticalRow
  features: EcosystemVerticalFeatureRow[]
}

/** Maps accent_color (a plain Tailwind color name from the DB) to the small set of utility classes this component needs. Tailwind CDN's JIT compiler resolves standard color names like `bg-amber-500` at runtime from class *strings* it can see in the page — so these must be literal, static class names below, never string-concatenated (`bg-${color}-500` would not be picked up by the CDN JIT scanner). */
const ACCENT_CLASSES: Record<string, { badge: string; iconBg: string; heroFrom: string; heroTo: string; button: string; buttonHover: string }> = {
  green: { badge: 'bg-green-100 text-green-700', iconBg: 'bg-green-500', heroFrom: 'from-green-900', heroTo: 'to-green-700', button: 'bg-green-500', buttonHover: 'hover:bg-green-600' },
  amber: { badge: 'bg-amber-100 text-amber-700', iconBg: 'bg-amber-500', heroFrom: 'from-amber-900', heroTo: 'to-amber-700', button: 'bg-amber-500', buttonHover: 'hover:bg-amber-600' },
  blue: { badge: 'bg-blue-100 text-blue-700', iconBg: 'bg-blue-500', heroFrom: 'from-blue-900', heroTo: 'to-blue-700', button: 'bg-blue-500', buttonHover: 'hover:bg-blue-600' },
  purple: { badge: 'bg-purple-100 text-purple-700', iconBg: 'bg-purple-500', heroFrom: 'from-purple-900', heroTo: 'to-purple-700', button: 'bg-purple-500', buttonHover: 'hover:bg-purple-600' },
  slate: { badge: 'bg-slate-100 text-slate-700', iconBg: 'bg-slate-500', heroFrom: 'from-slate-900', heroTo: 'to-slate-700', button: 'bg-slate-500', buttonHover: 'hover:bg-slate-600' },
  orange: { badge: 'bg-orange-100 text-orange-700', iconBg: 'bg-orange-500', heroFrom: 'from-orange-900', heroTo: 'to-orange-700', button: 'bg-orange-500', buttonHover: 'hover:bg-orange-600' },
  red: { badge: 'bg-red-100 text-red-700', iconBg: 'bg-red-500', heroFrom: 'from-red-900', heroTo: 'to-red-700', button: 'bg-red-500', buttonHover: 'hover:bg-red-600' },
  indigo: { badge: 'bg-indigo-100 text-indigo-700', iconBg: 'bg-indigo-500', heroFrom: 'from-indigo-900', heroTo: 'to-indigo-700', button: 'bg-indigo-500', buttonHover: 'hover:bg-indigo-600' }
}

const STATUS_LABEL: Record<string, string> = {
  coming_soon: 'Coming Soon',
  in_development: 'In Development',
  beta: 'Beta',
  live: 'Live'
}

// Maps a vertical's slug to the service checkbox the waitlist modal should
// preselect. Only 3 of the 8 verticals have a dedicated checkbox
// (NaijaEats/NaijaGigs/NaijaStay per Pat's explicit field list) — for the
// other 5 (fresh/drive/send/stream/aura) the modal preselects "Notify me
// about all upcoming NaijaDeals services" instead of leaving nothing
// checked, since a visitor arriving at any of those 5 pages has still shown
// clear ecosystem-wide intent. Documented product decision, not an
// oversight — the visitor can always change the selection in the modal.
const SERVICE_PRESELECT: Record<string, string> = {
  eats: 'naijaEats',
  gigs: 'naijaGigs',
  stay: 'naijaStay'
}

export const EcosystemPreview: FC<EcosystemPreviewProps> = ({ vertical, features }) => {
  const accent = ACCENT_CLASSES[vertical.accent_color] || ACCENT_CLASSES.green
  const statusLabel = STATUS_LABEL[vertical.status] || 'Coming Soon'
  const waitlistFormId = `waitlist-form-${vertical.slug}`
  const preselectService = SERVICE_PRESELECT[vertical.slug] || 'allServices'

  return (
    <>
      {/* ============ Hero ============ */}
      <section class={`relative overflow-hidden bg-gradient-to-br ${accent.heroFrom} ${accent.heroTo} text-white`}>
        <div class="absolute inset-0">
          <picture>
            <source media="(max-width: 767px)" srcset={vertical.hero_image_mobile} />
            <img src={vertical.hero_image_desktop} alt="" class="w-full h-full object-cover opacity-35" />
          </picture>
          <div class={`absolute inset-0 bg-gradient-to-r ${accent.heroFrom} via-black/40 to-transparent`}></div>
        </div>
        <div class="relative max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8 py-16 md:py-24">
          <div class="max-w-2xl">
            <span class="inline-flex items-center gap-1.5 text-xs font-bold bg-white text-gray-900 rounded-full px-3 py-1.5 mb-5 shadow-sm">
              <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
              {statusLabel}
            </span>
            <h1 class="text-3xl md:text-5xl font-bold leading-tight">{vertical.name}</h1>
            <p class="text-lg md:text-xl font-medium text-white/90 mt-3">{vertical.tagline}</p>
            <p class="text-white/80 text-sm md:text-base mt-5 max-w-xl leading-relaxed">{vertical.description}</p>
            <div class="flex flex-col sm:flex-row gap-3 mt-8">
              <button
                type="button"
                data-open-waitlist-modal
                data-preselect-service={preselectService}
                class={`inline-flex items-center justify-center gap-2 ${accent.button} ${accent.buttonHover} text-white font-semibold px-6 py-3.5 rounded-lg transition shadow-lg min-h-[44px]`}
              >
                <span class="material-symbols-outlined text-lg">notifications_active</span>
                Join the waitlist
              </button>
              <a href="/shop" class="inline-flex items-center justify-center gap-2 bg-white/10 border border-white/30 text-white font-semibold px-6 py-3.5 rounded-lg hover:bg-white/20 transition backdrop-blur-sm min-h-[44px]">
                <span class="material-symbols-outlined text-lg">storefront</span>
                Shop NaijaDeals
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ============ What's coming: feature cards ============ */}
      <section class="py-14 md:py-20 border-b border-gray-100">
        <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8">
          <div class="text-center max-w-2xl mx-auto mb-10">
            <h2 class="text-xl md:text-2xl font-bold text-gray-900">What {vertical.name} will bring</h2>
            <p class="text-sm text-gray-500 mt-2">
              We're building this carefully rather than rushing it out. Here's what's planned — none of it is live yet.
            </p>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {features.map((f) => (
              <div class="bg-white border border-gray-200 rounded-xl p-6 flex flex-col">
                <span class={`material-symbols-outlined text-2xl text-white w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${accent.iconBg}`}>
                  {f.icon}
                </span>
                <h3 class="font-bold text-gray-900 mb-1.5 text-sm">{f.title}</h3>
                <p class="text-xs text-gray-500 leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ Waitlist CTA ============ */}
      <section class="py-14 md:py-20 bg-gray-50" id={waitlistFormId}>
        <div class="max-w-lg mx-auto px-4 md:px-6 text-center">
          <span class={`material-symbols-outlined text-3xl text-white w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5 ${accent.iconBg}`}>
            {vertical.icon}
          </span>
          <h2 class="text-xl md:text-2xl font-bold text-gray-900">Be the first to know when {vertical.name} launches</h2>
          <p class="text-sm text-gray-500 mt-2">
            Tell us a little about yourself and we'll notify you the moment {vertical.name} is ready — no spam, and you can unsubscribe any time.
          </p>
          <button
            type="button"
            data-open-waitlist-modal
            data-preselect-service={preselectService}
            class={`inline-flex items-center justify-center gap-2 ${accent.button} ${accent.buttonHover} text-white font-semibold px-7 py-3.5 rounded-lg transition mt-6 min-h-[44px]`}
          >
            <span class="material-symbols-outlined text-lg">how_to_reg</span>
            Join the waitlist
          </button>
        </div>
      </section>

      {/* ============ Explore the rest of the ecosystem ============ */}
      <section class="py-12 md:py-16">
        <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8 text-center">
          <h2 class="text-lg md:text-xl font-bold text-gray-900 mb-2">While you wait, explore NaijaShop</h2>
          <p class="text-sm text-gray-500 mb-6 max-w-lg mx-auto">
            NaijaShop is live today — thousands of products from verified Nigerian vendors, escrow-protected and delivered nationwide.
          </p>
          <a href="/shop" class="inline-flex items-center justify-center gap-2 bg-primary text-white font-semibold px-7 py-3.5 rounded-lg hover:bg-primary-dark transition">
            <span class="material-symbols-outlined text-lg">storefront</span>
            Start shopping on NaijaShop
          </a>
          <div class="mt-3">
            <a href="/ecosystem" class="inline-flex items-center justify-center gap-1.5 text-sm text-gray-500 hover:text-primary font-medium mt-4">
              <span class="material-symbols-outlined text-base">apps</span>
              See the full NaijaDeals ecosystem
            </a>
          </div>
        </div>
      </section>

      <EcosystemWaitlistModal />
    </>
  )
}

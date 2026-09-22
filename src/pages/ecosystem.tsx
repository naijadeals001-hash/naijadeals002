import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import type { AppEnv } from '../types'
import { getAllVerticals } from '../lib/ecosystem-verticals'
import { EcosystemWaitlistModal } from '../components/EcosystemWaitlistModal'

/**
 * /ecosystem — the "whole ecosystem at a glance" overview page. NaijaShop is
 * hardcoded here (it's not a "preview", it's the one live vertical and isn't
 * a row in ecosystem_verticals — see migration 0010's header comment). The
 * other 8 cards are read straight from ecosystem_verticals (migration 0010),
 * so this page and the individual /fresh, /eats, etc. preview pages can never
 * drift out of sync with each other — same source of truth, same routes.
 */
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  coming_soon: { label: 'Coming soon', cls: 'bg-gray-100 text-gray-500' },
  in_development: { label: 'In development', cls: 'bg-blue-100 text-blue-600' },
  beta: { label: 'Beta', cls: 'bg-amber-100 text-amber-700' },
  live: { label: 'Live now', cls: 'bg-primary-light text-primary-dark' }
}

// Live verticals get an action-oriented CTA per Pat's explicit copy;
// everything still 'coming_soon'/'in_development'/'beta' keeps "Preview".
const LIVE_CTA_LABEL: Record<string, string> = {
  gigs: 'Explore NaijaGigs',
  stay: 'Explore NaijaStay',
  aura: 'Open Aura',
}

const ICON_BG: Record<string, string> = {
  green: 'bg-green-500', amber: 'bg-amber-500', blue: 'bg-blue-500', purple: 'bg-purple-500',
  slate: 'bg-slate-500', orange: 'bg-orange-500', red: 'bg-red-500', indigo: 'bg-indigo-500'
}

export async function ecosystemPage(c: Context<AppEnv>) {
  const user = c.get('user')
  const locale = c.get('locale')
  const verticals = await getAllVerticals(c.env.DB)

  return c.render(
    <Layout title="Ecosystem" user={user} locale={locale} description="One NaijaDeals account for shopping, fresh food, eats, gigs, stays, mobility, delivery, entertainment and AI — across Nigeria.">
      <section class="bg-gradient-to-br from-primary-dark to-primary text-white">
        <div class="max-w-[80rem] mx-auto px-6 lg:px-8 py-12 text-center">
          <span class="material-symbols-outlined text-4xl text-primary-fixed">workspace_premium</span>
          <h1 class="text-3xl lg:text-4xl font-bold mt-3">One account. One ecosystem.</h1>
          <p class="text-white/80 mt-3 max-w-xl mx-auto">
            NaijaShop, NaijaGigs, NaijaStay and Aura AI are live today. Fresh food, eats, mobility and entertainment are coming next — all under the same NaijaDeals account and wallet.
          </p>
        </div>
      </section>

      <div class="max-w-6xl mx-auto px-6 lg:px-8 py-10">
        <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* NaijaShop — the one already-live vertical, not a DB row */}
          <div class="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col relative overflow-hidden">
            <span class={`absolute top-4 right-4 text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_BADGE.live.cls}`}>{STATUS_BADGE.live.label}</span>
            <span class="material-symbols-outlined text-3xl text-white w-14 h-14 rounded-xl flex items-center justify-center mb-4 bg-primary">storefront</span>
            <h2 class="text-lg font-bold text-gray-800 mb-1">NaijaShop</h2>
            <p class="text-sm text-gray-500 mb-5 flex-1">Nigeria's escrow-protected marketplace. Thousands of products from verified local vendors, delivered nationwide.</p>
            <a href="/shop" class="text-center bg-primary text-white font-semibold py-2.5 rounded-lg hover:bg-primary-dark transition">Start shopping</a>
          </div>

          {verticals.map((v) => {
            const badge = STATUS_BADGE[v.status] || STATUS_BADGE.coming_soon
            return (
              <div class="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col relative overflow-hidden">
                <span class={`absolute top-4 right-4 text-xs font-semibold px-2.5 py-1 rounded-full ${badge.cls}`}>{badge.label}</span>
                <span class={`material-symbols-outlined text-3xl text-white w-14 h-14 rounded-xl flex items-center justify-center mb-4 ${ICON_BG[v.accent_color] || 'bg-gray-400'}`}>
                  {v.icon}
                </span>
                <h2 class="text-lg font-bold text-gray-800 mb-1">{v.name}</h2>
                <p class="text-sm text-gray-500 mb-5 flex-1">{v.description}</p>
                {v.status === 'live' ? (
                  <a href={v.route} class="text-center bg-primary text-white font-semibold py-2.5 rounded-lg hover:bg-primary-dark transition">
                    {LIVE_CTA_LABEL[v.slug] || `Explore ${v.name}`}
                  </a>
                ) : (
                  <a href={v.route} class="text-center bg-white border border-gray-300 text-gray-700 font-semibold py-2.5 rounded-lg hover:bg-gray-50 transition">
                    Preview {v.name}
                  </a>
                )}
              </div>
            )
          })}
        </div>

        <div class="mt-10 bg-primary-light rounded-xl p-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <h3 class="font-bold text-primary-dark">Want early access to NaijaFresh, NaijaEats &amp; more?</h3>
            <p class="text-sm text-gray-600 mt-1">Join the waitlist below and we'll let you know the moment each service launches in your city.</p>
          </div>
          <button
            type="button"
            data-open-waitlist-modal
            data-preselect-service="allServices"
            class="shrink-0 bg-primary text-white font-semibold px-6 py-3 rounded-lg hover:bg-primary-dark transition min-h-[44px]"
          >
            Join the waitlist
          </button>
        </div>
      </div>

      <EcosystemWaitlistModal />
    </Layout>
  )
}

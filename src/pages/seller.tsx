import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import { SellerLayout } from '../components/SellerLayout'
import type { AppEnv } from '../types'
import { resolveSellerStatus } from '../lib/seller'

/**
 * /seller — the single gateway every "Sell on NaijaDeals" CTA in the app
 * (Layout.tsx utility bar + footer) points to. Three legitimate top-level
 * states, entirely derived server-side from the ownership resolver — never
 * a client-supplied flag, never a fabricated stat.
 *
 *   State A — Guest (no session)              -> seller landing page
 *   State B — Authenticated, NO_SELLER          -> onboarding invitation
 *   State C — Authenticated, has a vendor row   -> routed by actual DB state:
 *       ACTIVE_SELLER          -> /seller/dashboard
 *       ONBOARDING             -> /seller/onboarding (not yet built — Phase 3;
 *                                  Phase 2 renders an honest "continue onboarding"
 *                                  status screen in-place instead of a dead link)
 *       PENDING_VERIFICATION   -> in-place verification-pending status screen
 *       REJECTED               -> in-place rejection/review status screen
 *       SUSPENDED              -> in-place suspension status screen
 */
export async function sellerGatewayPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')

  // ---------- State A: Guest ----------
  if (!user) {
    return c.render(
      <Layout title="Sell on NaijaDeals" user={null} locale={locale} description="Create your own store on NaijaDeals and reach millions of Nigerian shoppers.">
        <SellerGuestLanding />
      </Layout>
    )
  }

  const { state, vendor } = await resolveSellerStatus(db, user.id)

  // ---------- State B: authenticated, no seller/vendor relationship yet ----------
  if (state === 'NO_SELLER') {
    return c.render(
      <Layout title="Sell on NaijaDeals" user={user} locale={locale}>
        <SellerOnboardingInvite name={user.name.split(' ')[0]} />
      </Layout>
    )
  }

  // ---------- State C: existing seller — route by actual DB state ----------
  if (state === 'ACTIVE_SELLER') {
    return c.redirect('/seller/dashboard')
  }

  // ONBOARDING / PENDING_VERIFICATION / REJECTED / SUSPENDED all render an
  // honest, state-specific status screen here in Phase 2 (the full onboarding
  // wizard and admin review flows are Phase 3+ — this is intentionally NOT a
  // fake page, it reflects the seller's real DB state, just without the wizard
  // UI built yet).
  return c.render(
    <SellerLayout title="Seller status" user={user} vendor={vendor!} active="overview" locale={locale}>
      <SellerStatusScreen state={state} />
    </SellerLayout>
  )
}

// ============================================================
// State A — Guest landing page
// ============================================================
function SellerGuestLanding() {
  const BENEFITS = [
    { icon: 'groups', title: 'Reach millions of Nigerian shoppers', desc: 'Your products appear alongside NaijaDeals’ full marketplace catalog, seen by shoppers across every state you deliver to.' },
    { icon: 'storefront', title: 'Create your own store', desc: 'A branded storefront with your logo, banner and story — not just a listing buried in someone else’s catalog.' },
    { icon: 'inventory_2', title: 'List products', desc: 'List as many products as you want, in the categories that fit your business, with your own pricing and stock.' },
    { icon: 'local_shipping', title: 'Manage orders', desc: 'See every order the moment it comes in, update fulfilment status, and keep customers informed automatically.' },
    { icon: 'payments', title: 'Track earnings', desc: 'A dedicated Seller Finance view shows exactly what you’ve earned — escrow-protected, never guessed.' },
    { icon: 'account_balance', title: 'Receive payouts', desc: 'Withdraw your available balance straight to a Nigerian bank account you control, with a full audit trail.' }
  ]
  const STEPS = [
    { n: 1, title: 'Create your account', desc: 'Sign up with your email or phone number — takes under a minute.' },
    { n: 2, title: 'Set up your store', desc: 'Tell us about your business and complete seller verification.' },
    { n: 3, title: 'Start selling', desc: 'List your first products and start receiving orders from Nigerian shoppers.' }
  ]

  return (
    <>
      {/* ============ Hero ============ */}
      <section class="bg-gradient-to-br from-primary-dark to-primary text-white">
        <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8 py-14 md:py-20">
          <div class="max-w-2xl">
            <span class="inline-flex items-center gap-1.5 text-xs font-semibold bg-white/10 rounded-full px-3 py-1 mb-5">
              <span class="material-symbols-outlined text-sm">storefront</span>
              For Nigerian businesses
            </span>
            <h1 class="text-3xl md:text-5xl font-bold leading-tight">Sell on NaijaDeals</h1>
            <p class="text-white/80 text-base md:text-lg mt-4 max-w-xl">
              Reach millions of Nigerian shoppers. Create your own store, list products, manage orders, track earnings and receive payouts — all from one dashboard, built for Nigeria.
            </p>
            <div class="flex flex-col sm:flex-row gap-3 mt-8">
              <a
                href="/register?intent=seller&next=%2Fseller"
                class="inline-flex items-center justify-center gap-2 bg-primary-fixed text-primary-dark font-semibold px-6 py-3.5 rounded-lg hover:brightness-95 transition"
              >
                Create a Seller Account
              </a>
              <a
                href="/login?next=%2Fseller"
                class="inline-flex items-center justify-center gap-2 bg-white/10 border border-white/30 text-white font-semibold px-6 py-3.5 rounded-lg hover:bg-white/20 transition"
              >
                Sign in to sell
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ============ Benefits grid ============ */}
      <section class="py-12 md:py-16 border-b border-gray-100">
        <div class="max-w-[80rem] mx-auto px-4 md:px-6 lg:px-8">
          <h2 class="text-xl md:text-2xl font-bold text-gray-900 text-center mb-2">Everything you need to grow your business</h2>
          <p class="text-sm text-gray-500 text-center mb-10 max-w-xl mx-auto">One dashboard for your entire store — from your first listing to your first payout.</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {BENEFITS.map((b) => (
              <div class="flex flex-col bg-white border border-gray-200 rounded-xl p-6">
                <span class="material-symbols-outlined text-2xl text-white bg-primary w-12 h-12 rounded-xl flex items-center justify-center mb-4">
                  {b.icon}
                </span>
                <h3 class="font-bold text-gray-900 mb-1.5">{b.title}</h3>
                <p class="text-sm text-gray-500">{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ How it works ============ */}
      <section class="py-12 md:py-16 border-b border-gray-100 bg-gray-50">
        <div class="max-w-4xl mx-auto px-4 md:px-6 lg:px-8">
          <h2 class="text-xl md:text-2xl font-bold text-gray-900 text-center mb-10">Get started in three steps</h2>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            {STEPS.map((s) => (
              <div class="flex flex-col items-center text-center">
                <span class="w-11 h-11 rounded-full bg-primary text-white font-bold flex items-center justify-center mb-3">{s.n}</span>
                <h3 class="font-semibold text-gray-900 mb-1">{s.title}</h3>
                <p class="text-sm text-gray-500">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ Final CTA ============ */}
      <section class="py-12 md:py-16">
        <div class="max-w-3xl mx-auto px-4 md:px-6 lg:px-8 text-center">
          <h2 class="text-xl md:text-2xl font-bold text-gray-900 mb-3">Ready to grow your business on NaijaDeals?</h2>
          <p class="text-sm text-gray-500 mb-6">Escrow-protected payments, nationwide delivery reach, and a dashboard built for the Nigerian market.</p>
          <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a href="/register?intent=seller&next=%2Fseller" class="inline-flex items-center justify-center gap-2 bg-primary text-white font-semibold px-6 py-3.5 rounded-lg hover:bg-primary-dark transition w-full sm:w-auto">
              Create a Seller Account
            </a>
            <a href="/login?next=%2Fseller" class="inline-flex items-center justify-center gap-2 border border-gray-300 text-gray-700 font-semibold px-6 py-3.5 rounded-lg hover:bg-gray-50 transition w-full sm:w-auto">
              Sign in to sell
            </a>
          </div>
        </div>
      </section>
    </>
  )
}

// ============================================================
// State B — Authenticated, no seller yet: onboarding invitation
// ============================================================
function SellerOnboardingInvite({ name }: { name: string }) {
  return (
    <section class="max-w-2xl mx-auto px-4 md:px-6 lg:px-8 py-14 md:py-20 text-center">
      <span class="material-symbols-outlined text-4xl text-primary bg-primary-light w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5">
        storefront
      </span>
      <h1 class="text-2xl md:text-3xl font-bold text-gray-900">Hi {name}, ready to start selling?</h1>
      <p class="text-gray-500 mt-3">
        Setting up your store takes just a few minutes. You'll need to verify your business details and accept our Seller Terms before your store goes live — nothing is published until you complete every step.
      </p>
      <a
        href="/seller/onboarding"
        class="inline-flex items-center justify-center gap-2 bg-primary text-white font-semibold px-7 py-3.5 rounded-lg hover:bg-primary-dark transition mt-7"
      >
        Start selling
      </a>
      <p class="text-xs text-gray-400 mt-4">By starting, you agree to review NaijaDeals' Seller Terms during setup.</p>
    </section>
  )
}

/**
 * /seller/onboarding — destination of the "Start selling" CTA for a NO_SELLER
 * user. The actual multi-step onboarding wizard (business details, bank
 * account, terms acceptance) is Phase 3+ work and explicitly out of scope here
 * — this route exists purely so "Start selling" resolves to a real, honest,
 * authenticated page instead of a dead link or a 404, without prematurely
 * creating a vendor row (per the Phase 2 spec: "Do not create the vendor
 * relationship prematurely unless the architecture specifically requires it").
 */
export async function sellerOnboardingPage(c: Context<AppEnv>) {
  const user = c.get('user')!
  const locale = c.get('locale')
  return c.render(
    <Layout title="Start selling" user={user} locale={locale}>
      <div class="max-w-lg mx-auto px-4 md:px-6 py-14 md:py-20 text-center">
        <span class="material-symbols-outlined text-4xl text-primary bg-primary-light w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5">
          rocket_launch
        </span>
        <h1 class="text-xl md:text-2xl font-bold text-gray-900">Seller onboarding is almost ready</h1>
        <p class="text-gray-500 mt-3 text-sm">
          We're putting the finishing touches on store setup and seller verification. When it launches, you'll be able to complete your business details, set up your payout account, and go live in minutes.
        </p>
        <a href="/seller" class="inline-flex items-center justify-center gap-1.5 text-primary font-semibold mt-6 hover:underline">
          <span class="material-symbols-outlined text-base">arrow_back</span>
          Back to Seller Center
        </a>
      </div>
    </Layout>
  )
}

// ============================================================
// State C sub-states — honest in-place status screens (no wizard yet, Phase 3)
// ============================================================
const STATUS_COPY: Record<string, { icon: string; iconClass: string; title: string; desc: string }> = {
  ONBOARDING: {
    icon: 'pending_actions',
    iconClass: 'text-amber-600 bg-amber-50',
    title: 'Your store setup is in progress',
    desc: 'You started setting up your NaijaDeals store but haven’t finished yet. The full setup wizard is arriving in the next release — our team will notify you the moment you can pick up right where you left off.'
  },
  PENDING_VERIFICATION: {
    icon: 'hourglass_top',
    iconClass: 'text-amber-600 bg-amber-50',
    title: 'Your store is awaiting verification',
    desc: 'Thanks for completing your store setup. Our team is reviewing your business details — this usually takes 1-2 business days. We’ll notify you as soon as your store is verified and live.'
  },
  REJECTED: {
    icon: 'error',
    iconClass: 'text-red-600 bg-red-50',
    title: 'Your seller application needs attention',
    desc: 'We were unable to verify your store with the details provided. Please contact our seller support team so we can help you resolve this and resubmit.'
  },
  SUSPENDED: {
    icon: 'block',
    iconClass: 'text-red-600 bg-red-50',
    title: 'Your store is currently suspended',
    desc: 'Your seller account has been temporarily suspended. Please contact our seller support team for details and next steps to restore your store.'
  }
}

function SellerStatusScreen({ state }: { state: string }) {
  const copy = STATUS_COPY[state] || STATUS_COPY.PENDING_VERIFICATION
  return (
    <div class="max-w-lg mx-auto px-4 md:px-6 py-14 md:py-20 text-center">
      <span class={`material-symbols-outlined text-4xl w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 ${copy.iconClass}`}>
        {copy.icon}
      </span>
      <h1 class="text-xl md:text-2xl font-bold text-gray-900">{copy.title}</h1>
      <p class="text-gray-500 mt-3 text-sm">{copy.desc}</p>
      <a href="/help" class="inline-flex items-center justify-center gap-1.5 text-primary font-semibold mt-6 hover:underline">
        <span class="material-symbols-outlined text-base">support_agent</span>
        Contact seller support
      </a>
    </div>
  )
}

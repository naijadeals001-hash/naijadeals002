import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import type { AppEnv } from '../types'

const SERVICES = [
  {
    key: 'shop',
    name: 'NaijaShop',
    tagline: 'Live now',
    icon: 'storefront',
    color: 'bg-primary',
    desc: 'Nigeria\'s escrow-protected marketplace. Thousands of products from verified local vendors, delivered nationwide.',
    cta: 'Start shopping',
    href: '/shop',
    live: true
  },
  {
    key: 'eats',
    name: 'NaijaEats',
    tagline: 'Coming soon',
    icon: 'restaurant',
    color: 'bg-amber-500',
    desc: 'Order from your favourite local restaurants and get hot meals delivered straight to your door.',
    cta: 'Notify me',
    href: '#',
    live: false
  },
  {
    key: 'gigs',
    name: 'NaijaGigs',
    tagline: 'Coming soon',
    icon: 'engineering',
    color: 'bg-blue-500',
    desc: 'Book trusted, vetted local professionals for home repairs, design work, tutoring, events and more.',
    cta: 'Notify me',
    href: '#',
    live: false
  },
  {
    key: 'stay',
    name: 'NaijaStay',
    tagline: 'Coming soon',
    icon: 'apartment',
    color: 'bg-purple-500',
    desc: 'Find and book apartments, rooms and short-let stays anywhere in the country — verified hosts only.',
    cta: 'Notify me',
    href: '#',
    live: false
  }
]

export async function ecosystemPage(c: Context<AppEnv>) {
  const user = c.get('user')

  return c.render(
    <Layout title="Ecosystem" user={user} description="One NaijaDeals account for shopping, food, gigs and stays across Nigeria.">
      <section class="bg-gradient-to-br from-primary-dark to-primary text-white">
        <div class="max-w-[100rem] mx-auto px-6 lg:px-8 py-12 text-center">
          <span class="material-symbols-outlined text-4xl text-primary-fixed">workspace_premium</span>
          <h1 class="text-3xl lg:text-4xl font-bold mt-3">One account. One ecosystem.</h1>
          <p class="text-white/80 mt-3 max-w-xl mx-auto">
            Shopping today. Food, gigs and stays coming soon — all under one NaijaDeals account and wallet.
          </p>
        </div>
      </section>

      <div class="max-w-5xl mx-auto px-6 lg:px-8 py-10">
        <div class="grid md:grid-cols-2 gap-5">
          {SERVICES.map((s) => (
            <div class="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col relative overflow-hidden">
              <span class={`absolute top-4 right-4 text-xs font-semibold px-2.5 py-1 rounded-full ${s.live ? 'bg-primary-light text-primary-dark' : 'bg-gray-100 text-gray-500'}`}>
                {s.tagline}
              </span>
              <span class={`material-symbols-outlined text-3xl text-white w-14 h-14 rounded-xl flex items-center justify-center mb-4 ${s.color}`}>
                {s.icon}
              </span>
              <h2 class="text-lg font-bold text-gray-800 mb-1">{s.name}</h2>
              <p class="text-sm text-gray-500 mb-5 flex-1">{s.desc}</p>
              {s.live ? (
                <a href={s.href} class="text-center bg-primary text-white font-semibold py-2.5 rounded-lg hover:bg-primary-dark transition">
                  {s.cta}
                </a>
              ) : (
                <button type="button" disabled class="text-center bg-gray-100 text-gray-400 font-semibold py-2.5 rounded-lg cursor-not-allowed">
                  {s.cta}
                </button>
              )}
            </div>
          ))}
        </div>

        <div class="mt-10 bg-primary-light rounded-xl p-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <h3 class="font-bold text-primary-dark">Want early access to NaijaEats, NaijaGigs & NaijaStay?</h3>
            <p class="text-sm text-gray-600 mt-1">Subscribe below and we'll let you know the moment each service launches in your city.</p>
          </div>
          <a href="/#footer" class="shrink-0 bg-primary text-white font-semibold px-6 py-3 rounded-lg hover:bg-primary-dark transition">
            Join the waitlist
          </a>
        </div>
      </div>
    </Layout>
  )
}

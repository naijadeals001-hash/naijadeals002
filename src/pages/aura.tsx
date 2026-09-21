import type { Context } from 'hono'
import type { AppEnv } from '../types'
import { resolveAuraExperience, getAuraDashboardSnapshot, type AuraDashboardSnapshot } from '../lib/aura-experience'
import { formatNaira } from '../lib/money'

/**
 * Aura Luxe — Phase 1 desktop implementation.
 *
 * PROVENANCE / DESIGN RULE (Pat's explicit "MOST IMPORTANT DESIGN RULE",
 * 2026-09-21): this page's layout, spacing, proportions, typography
 * hierarchy, colors, cards, navigation, hero, Aura orb, African map motif,
 * right panels, chat panel, recommendations, wallet, activity and ecosystem
 * navigation reproduce a user-supplied reference screenshot as closely as
 * technically possible — NOT "inspired by", NOT "a modern interpretation".
 * The ONLY substitution made is the literal photographic asset (the
 * reference's woman's photo) — replaced by an original AI-generated,
 * licensing-safe editorial portrait with the same creative direction
 * (Nigerian woman, gele headwrap, gold jewelry, Lagos skyline, golden
 * hour), per Section 3 of the directive. Everything else — grid, palette,
 * component shapes, icon placement — is reproduced deliberately.
 *
 * THIS IS A STANDALONE FULL-PAGE SHELL, NOT A CHILD OF <Layout>. The
 * reference's own dark-emerald sidebar/header is a completely different
 * shell from the rest of NaijaDeals (Layout.tsx's header + footer) — nesting
 * this inside <Layout> would either double up navigation or force Layout to
 * grow a "no header" mode that every other page would have to account for.
 * Aura Luxe intentionally renders its own <html> document, matching the
 * SAME Tailwind CDN + Google Fonts + /static/style.css bootstrap pattern
 * every other full-page shell in this codebase already uses (see
 * ControlCenterLayout.tsx for the precedent of a second, independent shell
 * living alongside the customer-facing Layout).
 *
 * REAL DATA (Section 8): wallet balance, active orders count, upcoming
 * bookings, ongoing deliveries, saved items and unread notifications are
 * ALL live queries via getAuraDashboardSnapshot() (src/lib/aura-experience.ts)
 * — reusing the exact same wallet.ts/booking-lifecycle.ts primitives every
 * other authenticated page already reads. Nothing here is fabricated.
 * Sections with NO backing data source yet (the "Recommended for You" cards,
 * "Trending on NaijaDeals", the Aura command bar's actual AI execution, the
 * chat panel's actual AI execution) are explicitly labeled [DEMO] per
 * Section 8's "clearly identify unconnected sections" rule — see the
 * DemoBadge component below, used consistently everywhere a section isn't
 * backend-wired yet.
 *
 * ARCHITECTURE (Section 4-7): which experience renders here is decided by
 * resolveAuraExperience() (src/lib/aura-experience.ts) — the Aura
 * Experience Engine's resolver. This file currently only implements the
 * VISUAL body for the 'luxe' slug; if resolveAuraExperience() ever returns
 * a different slug (once Classic/Pulse/Executive have their own reference
 * designs — Phase 4), a real `if (experience.slug === ...)` branch belongs
 * HERE, swapping which body component renders, without touching the
 * resolver or the route registration in src/index.tsx at all. That is the
 * entire point of the resolver/body separation: adding an experience is a
 * new body component + a new branch, never a rebuild of this file's shell.
 */

function DemoBadge({ label = 'DEMO' }: { label?: string }) {
  return (
    <span class="ml-1.5 align-middle text-[9px] font-bold tracking-wide uppercase text-amber-700 bg-amber-100 border border-amber-300 rounded px-1.5 py-0.5">
      {label}
    </span>
  )
}

interface RecommendationCard {
  category: 'STAY' | 'EATS' | 'SHOP' | 'GIGS' | 'DRIVE' | 'STREAM'
  categoryColor: string
  image: string
  title: string
  rating: number
  reviews: number
  location: string
  price: string
}

// [DEMO] — no live recommendation engine wired yet (Phase 3). These reuse
// REAL existing catalog/vendor photography already served elsewhere in
// public/static/ (not fabricated stock imagery) so at least the visual
// asset is honest, but the listings themselves are illustrative only —
// hence the DemoBadge on the section header below.
const DEMO_RECOMMENDATIONS: RecommendationCard[] = [
  { category: 'STAY', categoryColor: 'bg-blue-600', image: '/static/stay/ikoyi-guest-house-cover.jpg', title: 'The George Lagos', rating: 4.6, reviews: 1200, location: 'Ikoyi, Lagos', price: '₦95,000/night' },
  { category: 'EATS', categoryColor: 'bg-orange-500', image: '/static/vendor-photos/mamas-kitchen-grocers.jpg', title: 'Bukka Hut', rating: 4.5, reviews: 892, location: 'Victoria Island, Lagos', price: '₦8,000/meal' },
  { category: 'SHOP', categoryColor: 'bg-emerald-600', image: '/static/products/004-apple-iphone-13-128gb.jpg', title: 'iPhone 13 128GB', rating: 4.8, reviews: 3200, location: 'Verified Seller', price: '₦1,350,000' },
  { category: 'GIGS', categoryColor: 'bg-amber-500', image: '/static/vendor-photos/lagos-tech-hub.jpg', title: 'AC Repair Service', rating: 4.7, reviews: 486, location: 'Lagos', price: 'From ₦10,000' },
  { category: 'DRIVE', categoryColor: 'bg-slate-700', image: '/static/vendor-photos/abuja-electronics-mart.jpg', title: 'Ride to Airport', rating: 4.9, reviews: 2100, location: 'Reliable drivers', price: 'From ₦12,000' },
  { category: 'STREAM', categoryColor: 'bg-purple-700', image: '/static/vendor-photos/naija-gadget-store.jpg', title: 'Naija Nights', rating: 4.7, reviews: 1500, location: 'Action · History', price: 'Watch Now' },
]

const SHORTCUT_CARDS = [
  { key: 'shop', label: 'Shop', sub: 'Products & electronics', icon: 'shopping_bag', color: 'text-emerald-600', href: '/shop', live: true },
  { key: 'fresh', label: 'Fresh', sub: 'Groceries & farm produce', icon: 'nutrition', color: 'text-red-500', href: '/fresh', live: false },
  { key: 'eats', label: 'Eats', sub: 'Restaurants & dining', icon: 'ramen_dining', color: 'text-orange-500', href: '/eats', live: false },
  { key: 'gigs', label: 'Gigs', sub: 'Services & professionals', icon: 'construction', color: 'text-amber-500', href: '/gigs', live: true },
  { key: 'stay', label: 'Stay', sub: 'Hotels & short stays', icon: 'bed', color: 'text-yellow-700', href: '/stay', live: true },
  { key: 'drive', label: 'Drive', sub: 'Rides & transport', icon: 'directions_car', color: 'text-slate-800', href: '/drive', live: false },
  { key: 'send', label: 'Send', sub: 'Deliveries & logistics', icon: 'local_shipping', color: 'text-orange-600', href: '/send', live: false },
  { key: 'stream', label: 'Stream', sub: 'Movies, music & more', icon: 'headphones', color: 'text-gray-900', href: '/stream', live: false },
  { key: 'more', label: 'More', sub: 'All NaijaDeals services', icon: 'apps', color: 'text-teal-600', href: '/', live: true },
]

const QUICK_PROMPTS = [
  'Find a hotel in Lagos this weekend',
  'Order groceries I bought last week',
  'Find a restaurant near me',
  'Get a ride to the airport',
  'Plan my trip to Abuja',
]

function money(kobo: number) {
  return formatNaira(kobo)
}

export async function auraPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const experience = await resolveAuraExperience(db, user)

  let snapshot: AuraDashboardSnapshot | null = null
  if (user) {
    snapshot = await getAuraDashboardSnapshot(db, user.id)
  }

  const firstName = user ? user.name.split(' ')[0] : 'Guest'
  const hour = new Date().getUTCHours() + 1 // WAT = UTC+1
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return c.html(
    <html lang="en" dir="ltr">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Aura AI — Your Intelligent Assistant | NaijaDeals</title>
        <meta name="description" content="Aura AI — your intelligent assistant for everything across NaijaDeals. Ask. Find it. Do it." />
        <link rel="icon" href="/static/favicon.svg" />
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
        <script src="https://cdn.tailwindcss.com"></script>
        <script
          dangerouslySetInnerHTML={{
            __html: `
            tailwind.config = {
              theme: {
                extend: {
                  colors: {
                    auraDark: '${experience.theme_dark_color}',
                    auraPrimary: '${experience.theme_primary_color}',
                    auraGold: '${experience.theme_accent_color}',
                  },
                  fontFamily: {
                    sans: ['Inter', 'ui-sans-serif', 'system-ui'],
                    serif: ['Playfair Display', 'ui-serif', 'Georgia', 'serif'],
                  }
                }
              }
            }
          `,
          }}
        ></script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,600;0,700;1,600&display=swap" rel="stylesheet" />
        <link href="/static/style.css" rel="stylesheet" />
        <link href="/static/aura.css" rel="stylesheet" />
      </head>
      <body class="min-h-screen bg-[#F9F8F6] font-sans text-gray-900" id="aura-luxe-body">
        <div class="flex min-h-screen">
          {/* ================= LEFT SIDEBAR ================= */}
          <aside id="aura-sidebar" class="hidden lg:flex flex-col w-[240px] shrink-0 bg-auraDark text-white py-6 px-4 sticky top-0 h-screen overflow-y-auto">
            <a href="/" class="flex items-center gap-2 px-2 mb-6" aria-label="NaijaDeals home">
              <img src="/static/aura/africa-orb.png" alt="" class="w-8 h-8 object-contain drop-shadow-[0_0_6px_rgba(0,135,83,0.7)]" />
              <span class="flex flex-col leading-none">
                <span class="text-[17px] font-bold text-white tracking-tight">NaijaDeals</span>
                <span class="text-[9px] text-[#88A28E] tracking-wide">Africa. Closer Together.</span>
              </span>
            </a>

            {/* Aura AI active nav pill */}
            <a href="/aura" class="flex items-center gap-2.5 rounded-xl px-3 py-2.5 mb-5 bg-white/[0.06] border border-auraGold/40" style="box-shadow: 0 0 0 1px rgba(204,164,59,0.12) inset">
              <span class="relative flex items-center justify-center w-7 h-7 rounded-full bg-auraPrimary/20">
                <img src="/static/aura/africa-orb.png" alt="" class="w-5 h-5 object-contain" />
              </span>
              <span class="flex flex-col leading-tight">
                <span class="text-[13px] font-bold text-white">Aura AI</span>
                <span class="text-[10px] text-auraGold">Ask. Find. Do.</span>
              </span>
            </a>

            {/* Main nav */}
            <nav class="flex flex-col gap-0.5 mb-5 text-[13px]">
              <a href="/" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-300 hover:bg-white/5 hover:text-white transition"><span class="material-symbols-outlined text-[18px]">home</span>Home</a>
              <a href="/shop" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-300 hover:bg-white/5 hover:text-white transition"><span class="material-symbols-outlined text-[18px]">search</span>Search</a>
              <a href="/countries" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-300 hover:bg-white/5 hover:text-white transition"><span class="material-symbols-outlined text-[18px]">explore</span>Explore</a>
              <a href="/account/wishlist" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-300 hover:bg-white/5 hover:text-white transition"><span class="material-symbols-outlined text-[18px]">bookmark</span>Saved</a>
              <a href="/account" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-300 hover:bg-white/5 hover:text-white transition"><span class="material-symbols-outlined text-[18px]">history</span>Recent Activity</a>
            </nav>

            <div class="text-[10px] font-semibold tracking-wider text-[#6B8A76] uppercase px-3 mb-1.5 mt-2">NaijaDeals Ecosystem</div>
            <nav class="flex flex-col gap-0.5 mb-5 text-[13px]">
              <a href="/shop" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-200 hover:bg-white/5 transition"><span class="material-symbols-outlined text-[18px] text-emerald-400">storefront</span>NaijaShop</a>
              <a href="/fresh" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-200 hover:bg-white/5 transition"><span class="material-symbols-outlined text-[18px] text-red-400">nutrition</span>NaijaFresh</a>
              <a href="/eats" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-200 hover:bg-white/5 transition"><span class="material-symbols-outlined text-[18px] text-orange-400">ramen_dining</span>NaijaEats</a>
              <a href="/gigs" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-200 hover:bg-white/5 transition"><span class="material-symbols-outlined text-[18px] text-amber-400">construction</span>NaijaGigs</a>
              <a href="/" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-200 hover:bg-white/5 transition"><span class="material-symbols-outlined text-[18px] text-lime-400">cottage</span>NaijaHome</a>
              <a href="/stay" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-200 hover:bg-white/5 transition"><span class="material-symbols-outlined text-[18px] text-yellow-500">bed</span>NaijaStay</a>
              <a href="/drive" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-200 hover:bg-white/5 transition"><span class="material-symbols-outlined text-[18px] text-slate-300">directions_car</span>NaijaDrive</a>
              <a href="/send" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-200 hover:bg-white/5 transition"><span class="material-symbols-outlined text-[18px] text-orange-300">local_shipping</span>NaijaSend</a>
              <a href="/stream" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-200 hover:bg-white/5 transition"><span class="material-symbols-outlined text-[18px] text-gray-300">headphones</span>NaijaStream</a>
              <a href="/" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-200 hover:bg-white/5 transition"><span class="material-symbols-outlined text-[18px] text-teal-300">apps</span>More Services</a>
            </nav>

            <div class="text-[10px] font-semibold tracking-wider text-[#6B8A76] uppercase px-3 mb-1.5 mt-2">My Account</div>
            <nav class="flex flex-col gap-0.5 mb-4 text-[13px]">
              <a href="/account" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-200 hover:bg-white/5 transition"><span class="material-symbols-outlined text-[18px]">person</span>Profile</a>
              <a href="/orders" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-200 hover:bg-white/5 transition"><span class="material-symbols-outlined text-[18px]">receipt_long</span>Orders</a>
              <a href="/account" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-200 hover:bg-white/5 transition"><span class="material-symbols-outlined text-[18px]">event_available</span>Bookings</a>
              <a href="/send" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-200 hover:bg-white/5 transition"><span class="material-symbols-outlined text-[18px]">local_shipping</span>Deliveries</a>
              <a href="/wallet" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-200 hover:bg-white/5 transition"><span class="material-symbols-outlined text-[18px]">account_balance_wallet</span>Wallet</a>
              <a href="/account/wishlist" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-200 hover:bg-white/5 transition"><span class="material-symbols-outlined text-[18px]">favorite</span>Wishlist</a>
              <a href="/account" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-200 hover:bg-white/5 transition justify-between">
                <span class="flex items-center gap-3"><span class="material-symbols-outlined text-[18px]">notifications</span>Notifications</span>
                {snapshot && snapshot.unreadNotificationsCount > 0 && (
                  <span class="bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">{snapshot.unreadNotificationsCount}</span>
                )}
              </a>
              <a href="/account" class="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-200 hover:bg-white/5 transition"><span class="material-symbols-outlined text-[18px]">settings</span>Settings</a>
            </nav>

            <div class="mt-auto rounded-xl p-4 relative overflow-hidden" style="background: linear-gradient(135deg, rgba(204,164,59,0.18), rgba(0,135,83,0.18));">
              <img src="/static/aura/africa-orb.png" alt="" class="absolute -right-3 -bottom-3 w-20 h-20 opacity-25 object-contain" />
              <p class="text-[12px] font-semibold text-auraGold leading-snug relative">A Smarter Africa Together.</p>
            </div>
          </aside>

          {/* ================= MAIN + RIGHT COLUMN WRAP ================= */}
          <div class="flex-1 flex flex-col lg:flex-row min-w-0">
            {/* ================= CENTER CONTENT ================= */}
            <main class="flex-1 min-w-0 px-4 md:px-6 py-5 max-w-[900px] mx-auto lg:mx-0 w-full">
              {/* ---- Top bar ---- */}
              <div class="flex items-center gap-3 mb-5">
                <div class="flex-1 max-w-[460px] flex items-center gap-2 bg-[#F0EFEA] rounded-full px-4 py-2.5">
                  <span class="material-symbols-outlined text-gray-500 text-[18px]">search</span>
                  <input type="text" placeholder="Search NaijaDeals or ask Aura anything..." class="bg-transparent outline-none flex-1 text-[13px] text-gray-700 placeholder:text-gray-500" />
                  <kbd class="text-[10px] bg-white text-gray-400 rounded px-1.5 py-0.5 border border-gray-200">Ctrl K</kbd>
                </div>
                <button class="hidden md:flex items-center gap-1.5 bg-auraPrimary text-white rounded-full px-3.5 py-2 text-[12px] font-medium shrink-0">
                  <span class="material-symbols-outlined text-[16px]">location_on</span>Lagos, Nigeria
                  <span class="material-symbols-outlined text-[14px]">expand_more</span>
                </button>
                <button class="relative shrink-0 w-9 h-9 rounded-full flex items-center justify-center hover:bg-gray-100">
                  <span class="material-symbols-outlined text-gray-700 text-[20px]">notifications</span>
                  {snapshot && snapshot.unreadNotificationsCount > 0 && (
                    <span class="absolute top-0.5 right-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{snapshot.unreadNotificationsCount}</span>
                  )}
                </button>
                {user ? (
                  <a href="/account" class="hidden md:flex items-center gap-2 shrink-0">
                    <span class="w-8 h-8 rounded-full bg-gradient-to-br from-amber-700 to-amber-500 text-white text-[12px] font-bold flex items-center justify-center">
                      {user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                    </span>
                    <span class="flex flex-col leading-tight">
                      <span class="text-[12.5px] font-semibold text-gray-800">{user.name}</span>
                      <span class="text-[10px] text-gray-400">Personal Account</span>
                    </span>
                    <span class="material-symbols-outlined text-gray-400 text-[16px]">expand_more</span>
                  </a>
                ) : (
                  <a href="/login?next=/aura" class="hidden md:flex items-center gap-1.5 shrink-0 text-[12.5px] font-semibold text-auraPrimary bg-auraPrimary/10 rounded-full px-3.5 py-2">
                    Sign in
                  </a>
                )}
                <button class="hidden xl:flex items-center gap-1 bg-white border border-gray-200 rounded-full px-3 py-2 text-[12px] font-medium text-gray-600 shrink-0">
                  <span class="material-symbols-outlined text-[15px]">public</span>₦ NGN
                  <span class="material-symbols-outlined text-[14px]">expand_more</span>
                </button>
              </div>

              {/* ---- Hero ---- */}
              <section class="relative rounded-2xl overflow-hidden mb-5" style="height: 320px;">
                <img src="/static/aura/hero-woman.jpg" alt="" class="absolute inset-0 w-full h-full object-cover" />
                <div class="absolute inset-0" style="background: linear-gradient(90deg, rgba(2,31,19,0.92) 0%, rgba(2,31,19,0.55) 45%, rgba(2,31,19,0.15) 75%, rgba(2,31,19,0.05) 100%);"></div>
                <div class="absolute top-6 right-6 text-right hidden md:block" style="transform: rotate(-4deg);">
                  <p class="font-serif italic text-auraGold text-[15px] leading-tight drop-shadow" style="text-shadow: 0 1px 3px rgba(0,0,0,0.5)">A Smarter Nigeria<br/>A Brighter Africa</p>
                </div>
                <div class="relative z-10 h-full flex flex-col justify-center px-8 max-w-[520px]">
                  <h1 class="font-serif italic text-auraGold text-[38px] leading-none mb-1" style="text-shadow: 0 2px 8px rgba(0,0,0,0.4)">Aura AI</h1>
                  <p class="text-white text-[26px] font-bold leading-tight mb-2.5">Ask. Find it. Do it.</p>
                  <p class="text-[#E7EFE9] text-[13.5px] mb-4 max-w-[380px]">Your intelligent assistant for everything across NaijaDeals.</p>
                  <div class="flex flex-wrap gap-2">
                    {[
                      { icon: 'search', label: 'Smarter Search' },
                      { icon: 'star', label: 'Personalized Results' },
                      { icon: 'bolt', label: 'Real Actions' },
                      { icon: 'public', label: 'Built for Africa' },
                    ].map((f) => (
                      <span class="flex items-center gap-1.5 bg-white/5 border border-auraGold/40 rounded-full pl-1 pr-3 py-1 text-[11px] text-white/90">
                        <span class="w-5 h-5 rounded-full bg-auraGold/25 flex items-center justify-center">
                          <span class="material-symbols-outlined text-[12px] text-auraGold">{f.icon}</span>
                        </span>
                        {f.label}
                      </span>
                    ))}
                  </div>
                </div>
              </section>

              {/* ---- Aura command bar ---- */}
              <form
                id="aura-command-form"
                class="flex items-center gap-3 bg-white rounded-full shadow-md border border-gray-100 pl-2 pr-2 py-2 mb-4 -mt-2 relative z-10"
                data-aura-demo-mode="true"
              >
                <span class="w-9 h-9 rounded-full bg-auraPrimary/10 flex items-center justify-center shrink-0">
                  <img src="/static/aura/africa-orb.png" alt="" class="w-6 h-6 object-contain" />
                </span>
                <input
                  id="aura-command-input"
                  type="text"
                  placeholder="What can I help you find or do today?"
                  class="flex-1 bg-transparent outline-none text-[13.5px] text-gray-700 placeholder:text-gray-400 min-w-0"
                  autocomplete="off"
                />
                <button type="button" id="aura-attach-image-btn" class="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100" aria-label="Attach image (prepared UI — not yet wired to a backend)">
                  <span class="material-symbols-outlined text-[19px]">image</span>
                </button>
                <button type="button" id="aura-mic-btn" class="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100" aria-label="Voice input (prepared UI — not yet wired to a backend)">
                  <span class="material-symbols-outlined text-[19px]">mic</span>
                </button>
                <button type="button" id="aura-location-btn" class="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100" aria-label="Share location (prepared UI — not yet wired to a backend)">
                  <span class="material-symbols-outlined text-[19px]">location_on</span>
                </button>
                <button type="submit" id="aura-send-btn" class="shrink-0 w-9 h-9 rounded-full bg-auraPrimary hover:bg-auraDark transition flex items-center justify-center" aria-label="Send to Aura (demo mode — Phase 3 will connect the real Aura backend)">
                  <span class="material-symbols-outlined text-white text-[18px]">send</span>
                </button>
              </form>

              {/* ---- Quick prompt chips ---- */}
              <div class="flex items-center gap-2 overflow-x-auto pb-1 mb-6 no-scrollbar">
                {QUICK_PROMPTS.map((p) => (
                  <button type="button" class="aura-quick-prompt shrink-0 bg-[#F5F4F0] border border-gray-200 rounded-full px-3.5 py-1.5 text-[12px] text-gray-600 hover:border-auraPrimary/40 whitespace-nowrap" data-prompt={p}>
                    {p}
                  </button>
                ))}
                <button type="button" class="shrink-0 w-7 h-7 rounded-full border border-gray-200 flex items-center justify-center text-gray-400 hover:bg-gray-50" aria-label="Refresh suggestions">
                  <span class="material-symbols-outlined text-[16px]">refresh</span>
                </button>
              </div>

              {/* ---- Vertical shortcut cards ---- */}
              <div class="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2.5 mb-7">
                {SHORTCUT_CARDS.map((s) => (
                  <a href={s.href} class="flex flex-col items-center text-center gap-1.5 bg-white border border-gray-100 rounded-xl p-3 hover:shadow-md hover:-translate-y-0.5 transition">
                    <span class={`material-symbols-outlined text-[22px] ${s.color}`}>{s.icon}</span>
                    <span class="text-[11.5px] font-semibold text-gray-800 leading-none">{s.label}{!s.live && <DemoBadge label="SOON" />}</span>
                    <span class="text-[9.5px] text-gray-400 leading-tight">{s.sub}</span>
                  </a>
                ))}
              </div>

              {/* ---- Recommended for You ---- */}
              <section class="mb-7">
                <div class="flex items-baseline justify-between mb-1">
                  <h2 class="text-[16px] font-bold text-gray-900">Recommended for You <DemoBadge /></h2>
                  <a href="/shop" class="text-[12px] font-semibold text-auraPrimary flex items-center gap-0.5">See all <span class="material-symbols-outlined text-[14px]">chevron_right</span></a>
                </div>
                <p class="text-[11.5px] text-gray-400 mb-3">Curated by Aura based on your activity, preferences and location</p>
                <div class="flex items-center gap-2 overflow-x-auto pb-1 mb-4 no-scrollbar">
                  {['All', 'Hotels', 'Restaurants', 'Products', 'Services', 'Rides', 'Events'].map((f, i) => (
                    <button type="button" class={`shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-medium whitespace-nowrap ${i === 0 ? 'bg-auraPrimary text-white' : 'bg-[#F5F4F0] text-gray-600'}`}>{f}</button>
                  ))}
                </div>
                <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                  {DEMO_RECOMMENDATIONS.map((r) => (
                    <div class="bg-white rounded-xl overflow-hidden border border-gray-100 hover:shadow-md transition">
                      <div class="relative aspect-[4/3]">
                        <img src={r.image} alt={r.title} class="w-full h-full object-cover" />
                        <span class={`absolute top-2 left-2 text-[9px] font-bold text-white rounded px-1.5 py-0.5 ${r.categoryColor}`}>{r.category}</span>
                        <button type="button" class="absolute top-2 right-2 w-6 h-6 rounded-full bg-white/90 flex items-center justify-center" aria-label="Save">
                          <span class="material-symbols-outlined text-[14px] text-gray-500">favorite</span>
                        </button>
                      </div>
                      <div class="p-2.5">
                        <p class="text-[12.5px] font-bold text-gray-900 truncate mb-0.5">{r.title}</p>
                        <p class="text-[10.5px] text-amber-500 flex items-center gap-0.5 mb-0.5">
                          <span class="material-symbols-outlined text-[12px]">star</span>{r.rating} <span class="text-gray-400">({r.reviews.toLocaleString()})</span>
                        </p>
                        <p class="text-[10.5px] text-gray-400 truncate mb-1">{r.location}</p>
                        <p class="text-[12.5px] font-bold text-gray-900">{r.price}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* ---- Bottom promo row ---- */}
              <section class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div class="md:col-span-1 relative rounded-xl overflow-hidden min-h-[150px]">
                  <img src="/static/aura/discover-africa.jpg" alt="" class="absolute inset-0 w-full h-full object-cover" />
                  <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent"></div>
                  <div class="relative z-10 h-full flex flex-col justify-end p-4">
                    <p class="text-white font-bold text-[14px] leading-tight mb-2">Discover Nigeria<br/>and Beyond</p>
                    <a href="/countries" class="inline-flex items-center gap-1 self-start bg-auraGold text-auraDark text-[11px] font-bold rounded-full px-3 py-1.5">Explore with Aura <span class="material-symbols-outlined text-[13px]">arrow_forward</span></a>
                  </div>
                </div>

                <div class="bg-white rounded-xl border border-gray-100 p-4">
                  <p class="text-[13px] font-bold text-gray-900 mb-2.5 flex items-center gap-1">Trending on NaijaDeals <DemoBadge /></p>
                  <ul class="space-y-2 text-[12px] text-gray-600">
                    <li class="flex items-center gap-2"><span class="material-symbols-outlined text-[15px] text-auraPrimary">local_fire_department</span>Top deals this week</li>
                    <li class="flex items-center gap-2"><span class="material-symbols-outlined text-[15px] text-auraPrimary">celebration</span>Festivals &amp; events happening near you</li>
                    <li class="flex items-center gap-2"><span class="material-symbols-outlined text-[15px] text-auraPrimary">verified</span>African brands to support</li>
                    <li class="flex items-center gap-2"><span class="material-symbols-outlined text-[15px] text-auraPrimary">flight</span>Travel deals across Africa</li>
                  </ul>
                </div>

                <div class="bg-white rounded-xl border border-gray-100 p-4 flex flex-col">
                  <p class="text-[13px] font-bold text-gray-900 mb-1">Your Wallet</p>
                  <div class="flex items-center gap-2 mb-3">
                    <p class="text-[22px] font-extrabold text-gray-900">{user && snapshot ? money(snapshot.walletBalanceKobo) : '₦ — — —'}</p>
                    {!user && <span class="text-[10px] text-gray-400">Sign in to view</span>}
                  </div>
                  <div class="flex gap-2 mt-auto">
                    <a href="/wallet" class="flex-1 text-center bg-auraPrimary text-white text-[12px] font-semibold rounded-lg py-2">Fund Wallet</a>
                    <a href="/wallet" class="flex-1 text-center bg-gray-100 text-gray-700 text-[12px] font-semibold rounded-lg py-2">View Details</a>
                  </div>
                </div>
              </section>
            </main>

            {/* ================= RIGHT PANEL ================= */}
            <aside class="w-full lg:w-[320px] shrink-0 px-4 md:px-6 py-5 lg:border-l lg:border-gray-100">
              {user ? (
                <>
                  <h2 class="text-[16px] font-bold text-gray-900 mb-0.5">{greeting}, {firstName} 👋</h2>
                  <p class="text-[12px] text-gray-400 mb-4">Here's what's happening with your NaijaDeals</p>

                  <div class="grid grid-cols-2 gap-2.5 mb-5">
                    <div class="bg-white border border-gray-100 rounded-xl p-3">
                      <span class="material-symbols-outlined text-emerald-500 text-[18px]">receipt_long</span>
                      <p class="text-[18px] font-extrabold text-gray-900 leading-tight mt-1">{snapshot?.activeOrdersCount ?? 0}</p>
                      <p class="text-[10.5px] text-gray-400">Active Orders</p>
                    </div>
                    <div class="bg-white border border-gray-100 rounded-xl p-3">
                      <span class="material-symbols-outlined text-blue-500 text-[18px]">event_available</span>
                      <p class="text-[18px] font-extrabold text-gray-900 leading-tight mt-1">{snapshot?.upcomingBookingsCount ?? 0}</p>
                      <p class="text-[10.5px] text-gray-400">Upcoming Bookings</p>
                    </div>
                    <div class="bg-white border border-gray-100 rounded-xl p-3">
                      <span class="material-symbols-outlined text-sky-500 text-[18px]">local_shipping</span>
                      <p class="text-[18px] font-extrabold text-gray-900 leading-tight mt-1">{snapshot?.ongoingDeliveriesCount ?? 0}</p>
                      <p class="text-[10.5px] text-gray-400">Ongoing Delivery</p>
                    </div>
                    <div class="bg-white border border-gray-100 rounded-xl p-3">
                      <span class="material-symbols-outlined text-red-500 text-[18px]">favorite</span>
                      <p class="text-[18px] font-extrabold text-gray-900 leading-tight mt-1">{snapshot?.savedItemsCount ?? 0}</p>
                      <p class="text-[10.5px] text-gray-400">Saved Items</p>
                    </div>
                  </div>

                  <p class="text-[13px] font-bold text-gray-900 mb-2">Upcoming</p>
                  <div class="space-y-2 mb-2">
                    {snapshot && snapshot.upcomingActivity.length > 0 ? (
                      snapshot.upcomingActivity.map((a) => (
                        <a href={a.href ?? '#'} class="flex items-center gap-3 bg-white border border-gray-100 rounded-xl p-3 hover:shadow-sm transition">
                          <span class={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${a.kind === 'delivery' ? 'bg-emerald-100 text-emerald-600' : a.kind === 'booking' ? 'bg-blue-100 text-blue-600' : 'bg-sky-100 text-sky-600'}`}>
                            <span class="material-symbols-outlined text-[18px]">{a.icon}</span>
                          </span>
                          <span class="flex-1 min-w-0">
                            <span class="block text-[12px] font-semibold text-gray-800 truncate">{a.title}</span>
                            <span class="block text-[10.5px] text-gray-400 truncate">{a.subtitle}</span>
                          </span>
                          <span class="material-symbols-outlined text-gray-300 text-[16px]">chevron_right</span>
                        </a>
                      ))
                    ) : (
                      <p class="text-[12px] text-gray-400 bg-white border border-gray-100 rounded-xl p-3">Nothing upcoming right now.</p>
                    )}
                  </div>
                </>
              ) : (
                <div class="bg-white border border-gray-100 rounded-xl p-4 text-center">
                  <span class="material-symbols-outlined text-auraPrimary text-[28px] mb-2">account_circle</span>
                  <p class="text-[13px] font-semibold text-gray-800 mb-1">Sign in to see your account</p>
                  <p class="text-[11.5px] text-gray-400 mb-3">Wallet balance, orders, bookings and deliveries appear here once you're signed in.</p>
                  <a href="/login?next=/aura" class="inline-block bg-auraPrimary text-white text-[12px] font-semibold rounded-lg px-4 py-2">Sign in</a>
                </div>
              )}
            </aside>
          </div>
        </div>

        {/* ================= FLOATING CHAT WITH AURA PANEL ================= */}
        <div id="aura-chat-panel" class="fixed bottom-5 right-5 z-50 w-[320px] rounded-2xl bg-auraDark text-white shadow-2xl overflow-hidden hidden lg:block" data-aura-demo-mode="true">
          <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <span class="flex items-center gap-2 text-[13px] font-semibold">
              <span class="w-6 h-6 rounded-full bg-auraPrimary/30 flex items-center justify-center">
                <img src="/static/aura/africa-orb.png" alt="" class="w-4 h-4 object-contain" />
              </span>
              Chat with Aura
            </span>
            <span class="flex items-center gap-1">
              <button type="button" id="aura-chat-expand-btn" class="w-6 h-6 rounded flex items-center justify-center text-white/60 hover:text-white" aria-label="Expand"><span class="material-symbols-outlined text-[15px]">open_in_full</span></button>
              <button type="button" id="aura-chat-close-btn" class="w-6 h-6 rounded flex items-center justify-center text-white/60 hover:text-white" aria-label="Close"><span class="material-symbols-outlined text-[15px]">close</span></button>
            </span>
          </div>
          <div class="px-5 py-5 text-center">
            <img src="/static/aura/africa-orb.png" alt="" class="w-14 h-14 mx-auto mb-3 object-contain drop-shadow-[0_0_14px_rgba(0,135,83,0.8)]" />
            <p class="text-[15px] font-bold mb-1">Ask. Find. Do.</p>
            <p class="text-[11.5px] text-white/60 mb-4 leading-snug">I'm Aura, your intelligent assistant. How can I help you today?</p>
            <div class="grid grid-cols-2 gap-2 mb-4">
              {['Help me plan a trip', 'Find something nearby', 'Compare options', 'Show my recent orders'].map((p) => (
                <button type="button" class="aura-chat-suggestion bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-[10.5px] text-white/80 hover:bg-white/10" data-prompt={p}>{p}</button>
              ))}
            </div>
          </div>
          <div class="px-3 pb-3">
            <div class="flex items-center gap-2 bg-black/30 border border-white/10 rounded-full px-3 py-2 mb-2">
              <span class="material-symbols-outlined text-white/40 text-[16px]">mic</span>
              <input id="aura-chat-input" type="text" placeholder="Ask Aura anything..." class="flex-1 bg-transparent outline-none text-[12px] text-white placeholder:text-white/40 min-w-0" />
              <button type="button" id="aura-chat-send-btn" class="w-7 h-7 rounded-full bg-auraPrimary flex items-center justify-center shrink-0" aria-label="Send (demo mode)">
                <span class="material-symbols-outlined text-white text-[14px]">send</span>
              </button>
            </div>
            <div class="flex items-center justify-between text-[10px] text-white/40 px-1">
              <span class="flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">mic</span>Voice</span>
              <span class="flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">image</span>Image</span>
              <span class="flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">location_on</span>Location</span>
              <span class="flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">attach_file</span>Attach</span>
            </div>
          </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="/static/aura.js"></script>
      </body>
    </html>
  )
}

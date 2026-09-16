import type { FC } from 'hono/jsx'
import { useRequestContext } from 'hono/jsx-renderer'
import type { AuthUser, AppEnv } from '../types'
import type { LocaleContext } from '../i18n'
import { createTranslator, LANGUAGES, LIVE_LANGUAGES, LANG_QUERY_PARAM } from '../i18n'
import { LanguageSelector } from './LanguageSelector'
import { getEcosystemNavLinks, type EcosystemNavLink } from '../lib/ecosystem-nav'

interface LayoutProps {
  title?: string
  description?: string
  user: AuthUser | null
  cartCount?: number
  wishlistCount?: number
  activeNav?: string
  /** City the visitor picked for delivery (nd_city cookie). Defaults to Lagos. */
  selectedCity?: string
  /**
   * Resolved by attachLocale middleware (src/lib/auth.ts) and stored on the
   * Hono context — every page handler MUST pass `locale={c.get('locale')}`.
   * This prop is intentionally REQUIRED (not optional): making it required
   * turns a forgotten pass-through into a TypeScript build failure instead of
   * a silent English fallback, which is exactly the bug class that caused
   * `?lang=fr` to render English on every single page before this fix (Phase
   * C, Section 3). Do not reintroduce a default value here.
   */
  locale: LocaleContext
  children: any
}

const CITIES = ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Kano', 'Enugu', 'Benin City', 'Kaduna', 'Owerri', 'Uyo', 'Aba', 'Jos']

/**
 * Phase 1b: the old hardcoded category slug list (removed) drifted out of
 * sync with the real taxonomy the moment migration 0053's seed landed —
 * every link 404'd-to-empty via shop.tsx's honest-zero-results fallback. The
 * header's CATEGORY surface is 100% DB-driven: the "All Categories"
 * mega-menu (built client-side in app.js's initMegaMenu() from GET
 * /api/catalog/categories/tree — see src/lib/mega-menu.ts) is the ONLY way
 * to browse categories from the header. No per-page server prop threading
 * needed since it's fetched once, lazily, client-side on first open, same
 * pattern as the existing wallet-balance/wishlist-ids header badges below.
 *
 * Micro-Checkpoint 2A (2026-09-16): the ECOSYSTEM pill strip (NaijaFresh,
 * NaijaEats, ...) used to be a hardcoded ECOSYSTEM_LINKS array right here —
 * meaning the Enterprise Control Center's ecosystem_verticals.nav_visible
 * toggle (Checkpoint 2's schema-only foundation) had ZERO effect on what a
 * customer actually saw. That gap is now closed: Layout is an ASYNC
 * component that reads useRequestContext() to call getEcosystemNavLinks(db)
 * (src/lib/ecosystem-nav.ts, cache-backed via the existing
 * homepage_feed_cache table) SERVER-SIDE, on every render, for all three
 * customer-facing surfaces (desktop pill strip, mobile horizontal scroller,
 * mobile drawer accordion) below. This is deliberately NOT client-side
 * fetched like the mega-menu — the ecosystem pills are simple text/icon
 * links (no deep nested tree to lazy-load), so a direct SSR read keeps the
 * page from needing an extra client-side network round-trip + layout shift
 * just to know 8 short strings. NaijaShop stays a pinned, non-DB-driven
 * first entry (see ecosystem-nav.ts's SHOP_PILL) — it's the core
 * marketplace this app is built around, not a togglable "vertical" row in
 * ecosystem_verticals.
 */

export const Layout: FC<LayoutProps> = async ({ title, description, user, cartCount = 0, wishlistCount = 0, selectedCity = 'Lagos', locale, children }) => {
  const t = createTranslator(locale)
  const c = useRequestContext<AppEnv>()
  const ecosystemLinks: EcosystemNavLink[] = await getEcosystemNavLinks(c.env.DB)
  return (
    <html lang={locale.language} dir={locale.dir}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title ? `${title} | NaijaDeals` : 'NaijaDeals — Shop, Eat, Hire, Stay. Built for Nigeria.'}</title>
        <meta name="description" content={description || 'One account. One ecosystem. Shop, groceries, food delivery, services, stays, rides, courier and streaming — all in one app, built for Nigeria.'} />
        <link rel="icon" href="/static/favicon.svg" />
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
        <script src="https://cdn.tailwindcss.com"></script>
        <script dangerouslySetInnerHTML={{
          __html: `
            tailwind.config = {
              theme: {
                extend: {
                  colors: {
                    primary: { DEFAULT: '#0B7A3B', dark: '#062D17', light: '#E8F5EC', fixed: '#FFC72C' },
                  },
                  fontFamily: { sans: ['Poppins', 'ui-sans-serif', 'system-ui'] }
                }
              }
            }
          `
        }}></script>
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link href="/static/style.css" rel="stylesheet" />
      </head>
      <body class="min-h-screen flex flex-col bg-gray-50 font-sans text-gray-900">
        {/* z-[60]: kept above the drawer/backdrop/bottom-nav as a defensive
            fallback, but the PRIMARY fix that makes #mobile-menu-btn and
            #mobile-nav-close-btn both independently clickable is spatial, not
            z-order: app.js's initMobileNavDrawer measures this header's actual
            rendered height at runtime and shifts #mobile-nav-drawer /
            #mobile-nav-backdrop to start below it, so the two elements never
            occupy the same pixels. Pure z-index cannot fix two `fixed`/`sticky
            top:0` elements fighting over the SAME band — whichever wins
            z-order swallows clicks meant for the other, no matter which one
            is "on top". See app.js for the full writeup. */}
        <header id="site-header" class="sticky top-0 z-[60] shadow-sm bg-primary-dark">
          {/* ===== DESKTOP: 3-tier header (Phase 1b, reference-matched) ===== */}
          <div class="hidden md:block bg-primary-dark text-white">
            {/* ---------- TIER 1: Utility bar ---------- */}
            <div class="border-b border-white/10">
              <div class="max-w-[80rem] mx-auto flex items-center justify-between px-6 lg:px-8 py-1.5 text-xs text-white/70">
                <div class="flex items-center gap-4">
                  <span>One Africa. More Possibilities.</span>
                </div>
                <div class="flex items-center gap-4">
                  <a href="/seller" class="hover:text-white transition-colors">{t('nav_sell_on_naijadeals')}</a>
                  <a href="/organizations/business" class="hover:text-white transition-colors hidden lg:inline">Business</a>
                  <a href="/help" class="hover:text-white transition-colors">{t('nav_help_center')}</a>
                  <a href="/orders" class="hover:text-white transition-colors hidden lg:inline">Track Order</a>
                  <span class="hidden xl:flex items-center gap-1.5 text-white/50">
                    <span class="material-symbols-outlined text-sm">smartphone</span>
                    Download App
                  </span>
                  <LanguageSelector locale={locale} variant="utility-bar" />
                </div>
              </div>
            </div>
            {/* ---------- TIER 2: Main header — logo, search, account/cart ---------- */}
            <div class="max-w-[80rem] mx-auto flex items-center gap-4 px-6 lg:px-8 py-2.5">
              <a href="/" class="flex items-center shrink-0 bg-white/5 hover:bg-white/10 transition-colors rounded-lg px-3 py-1.5" aria-label="NaijaDeals home">
                <span class="text-xl font-bold tracking-tight">Naija<span class="text-primary-fixed">Deals</span></span>
              </a>
              <label class="hidden lg:flex flex-col justify-center leading-tight px-2 py-1 rounded-lg hover:bg-white/10 transition-colors shrink-0 cursor-pointer">
                <span class="text-[11px] text-white/70">{t('nav_deliver_to')}</span>
                <select id="city-selector" class="text-sm font-semibold bg-transparent outline-none cursor-pointer [&>option]:text-gray-900">
                  {CITIES.map((city) => <option value={city} selected={city === selectedCity}>{city}</option>)}
                </select>
              </label>
              <form action="/shop" method="get" class="flex flex-1 max-w-2xl items-stretch rounded-md overflow-hidden bg-white">
                <input
                  type="text"
                  name="q"
                  placeholder="Search products, brands, sellers..."
                  class="flex-1 px-4 py-2.5 text-sm text-gray-800 outline-none min-w-0"
                />
                <button type="submit" class="flex items-center justify-center px-4 bg-primary-fixed text-primary-dark shrink-0">
                  <span class="material-symbols-outlined">search</span>
                </button>
              </form>
              <div class="flex items-center gap-0.5 ml-auto shrink-0">
                <a href="/wallet" class="hidden lg:flex flex-col justify-center leading-tight px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors">
                  <span class="text-[11px] text-white/70">{t('nav_balance')}</span>
                  <span class="text-sm font-semibold" id="wallet-balance-nav">--</span>
                </a>
                <a href="/account" aria-label="Messages" class="hidden lg:flex flex-col items-center justify-center px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors">
                  <span class="material-symbols-outlined text-xl">mail</span>
                </a>
                <a href="/account/wishlist" class="hidden lg:flex relative flex-col justify-center leading-tight px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors">
                  <span class="material-symbols-outlined text-xl">favorite</span>
                  <span id="wishlist-count-badge" class={`absolute -top-0.5 right-0.5 bg-primary-fixed text-primary-dark text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center ${wishlistCount > 0 ? '' : 'hidden'}`}>{wishlistCount}</span>
                </a>
                {user ? (
                  <a href="/account" class="flex flex-col justify-center leading-tight px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors">
                    <span class="text-[11px] text-white/70 truncate max-w-28">{t('auth_hello_greeting', { name: user.name.split(' ')[0] })}</span>
                    <span class="text-sm font-semibold">{t('nav_account')}</span>
                  </a>
                ) : (
                  <a href="/login" class="flex flex-col justify-center leading-tight px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors">
                    <span class="text-[11px] text-white/70">{t('nav_hello_sign_in')}</span>
                    <span class="text-sm font-semibold">{t('nav_account')}</span>
                  </a>
                )}
                <a href="/orders" class="hidden lg:flex flex-col justify-center leading-tight px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors">
                  <span class="text-sm font-semibold">{t('nav_orders_returns')}</span>
                </a>
                <a href="/cart" class="relative flex items-end gap-1 px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors">
                  <span class="material-symbols-outlined text-2xl">shopping_cart</span>
                  <span
                    id="cart-count-badge-desktop"
                    class={`absolute -top-0.5 right-0.5 bg-primary-fixed text-primary-dark text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center ${cartCount > 0 ? '' : 'hidden'}`}
                  >{cartCount}</span>
                  <span class="text-sm font-semibold hidden xl:inline">{t('nav_cart')}</span>
                </a>
              </div>
            </div>
            {/* ---------- TIER 3: All Categories trigger (DB-driven mega-menu) + ecosystem nav ---------- */}
            <nav class="bg-primary border-t border-white/10 relative">
              <div class="max-w-[80rem] mx-auto flex items-center gap-1 px-6 lg:px-8 py-0 text-sm font-medium">
                {/* All Categories — opens the DB-driven mega-menu (src/lib/mega-menu.ts via
                    GET /api/catalog/categories/tree). Fetched lazily on first click by
                    initMegaMenu() in app.js — NO hardcoded category list here at all,
                    replacing the old static CATEGORY_NAV array entirely (Phase 1b). */}
                <button
                  type="button"
                  id="all-categories-btn"
                  aria-haspopup="true"
                  aria-expanded="false"
                  aria-controls="mega-menu-panel"
                  class="flex items-center gap-1.5 shrink-0 px-3 py-2.5 bg-primary-dark hover:bg-black/20 transition-colors font-semibold"
                >
                  <span class="material-symbols-outlined text-lg">menu</span>
                  All Categories
                  <span class="material-symbols-outlined text-base">expand_more</span>
                </button>
                <div id="mega-menu-panel" class="hidden absolute left-0 top-full z-50 w-full lg:w-[960px] bg-white border border-gray-200 rounded-b-xl shadow-2xl overflow-hidden" role="menu" aria-label="All categories">
                  <div class="flex max-h-[70vh]">
                    <div id="mega-menu-depts" class="w-56 shrink-0 bg-gray-50 border-r border-gray-100 overflow-y-auto py-2"></div>
                    <div id="mega-menu-panels" class="flex-1 overflow-y-auto p-5"></div>
                  </div>
                  <div id="mega-menu-loading" class="p-10 text-center text-gray-400 text-sm">Loading categories…</div>
                </div>
                {/* Ecosystem pills — the "one super-app, not nine websites" strip */}
                <div id="ecosystem-nav-desktop" class="flex items-center gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden">
                  {ecosystemLinks.map((eco) => (
                    <a href={eco.href} class="flex items-center gap-1.5 shrink-0 px-2.5 py-2.5 hover:bg-white/10 transition-colors text-white/90">
                      <span class="material-symbols-outlined text-base">{eco.icon}</span>
                      {eco.label.replace('Naija', '')}
                      {!eco.live && <span class="text-[9px] bg-white/15 rounded px-1 py-0.5">Soon</span>}
                    </a>
                  ))}
                </div>
                <span class="w-px h-4 bg-white/20 shrink-0 mx-1"></span>
                <a href="/shop?deals=1" class="flex items-center gap-1 shrink-0 px-2.5 py-2.5 hover:bg-white/10 transition-colors text-primary-fixed font-semibold">{t('nav_deals')}</a>
              </div>
            </nav>
          </div>

          {/* ===== MOBILE: 3-row header (brand+actions / search / ecosystem scroller) ===== */}
          <div class="md:hidden bg-primary-dark text-white">
            {/* Row 1: menu, brand, location, account, cart */}
            <div class="flex items-center gap-2 px-3 py-2.5">
              <button id="mobile-menu-btn" aria-label={t('nav_categories')} class="p-1.5 -ml-1">
                <span class="material-symbols-outlined text-2xl">menu</span>
              </button>
              <a href="/" class="shrink-0" aria-label="NaijaDeals home">
                <span class="text-lg font-bold tracking-tight">Naija<span class="text-primary-fixed">Deals</span></span>
              </a>
              <button id="mobile-location-btn" class="flex items-center gap-0.5 text-[11px] text-white/80 ml-1 shrink-0">
                <span class="material-symbols-outlined text-sm">location_on</span>{selectedCity}
                <span class="material-symbols-outlined text-sm">expand_more</span>
              </button>
              <div class="ml-auto flex items-center gap-2 shrink-0">
                <LanguageSelector locale={locale} variant="mobile-icon" />
                {user ? (
                  <a href="/account" aria-label={t('nav_account')} class="flex items-center justify-center w-8 h-8 rounded-full bg-white/10">
                    <span class="material-symbols-outlined text-xl">person</span>
                  </a>
                ) : (
                  <a href="/login" class="flex items-center text-sm font-normal">
                    {t('auth_login')}<span class="material-symbols-outlined text-sm">chevron_right</span>
                  </a>
                )}
                <a href="/cart" aria-label={t('nav_cart')} class="relative p-1">
                  <span class="material-symbols-outlined text-2xl">shopping_cart</span>
                  <span
                    id="cart-count-badge-mobile"
                    class={`absolute -top-0.5 -right-0.5 bg-primary-fixed text-primary-dark text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center ${cartCount > 0 ? '' : 'hidden'}`}
                  >{cartCount}</span>
                </a>
              </div>
            </div>
            {/* Row 2: search */}
            <div class="px-3 pb-2.5">
              <form action="/shop" method="get" class="w-full flex items-stretch rounded-md overflow-hidden bg-white">
                <input type="text" name="q" placeholder="Search products, brands, sellers..." aria-label={t('nav_search')} class="flex-1 px-3 py-2.5 text-sm text-gray-800 outline-none min-w-0" />
                <button type="submit" aria-label={t('nav_search')} class="flex items-center justify-center px-3.5 bg-primary-fixed text-primary-dark shrink-0">
                  <span class="material-symbols-outlined text-lg">search</span>
                </button>
              </form>
            </div>
            {/* Row 3: horizontally-scrollable ecosystem nav */}
            <div id="ecosystem-nav-mobile-scroller" class="flex items-center gap-4 px-3 pb-2.5 overflow-x-auto text-[11px]">
              {ecosystemLinks.map((eco) => (
                <a href={eco.href} class="flex flex-col items-center gap-0.5 shrink-0 text-white/80">
                  <span class="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center">
                    <span class="material-symbols-outlined text-lg">{eco.icon}</span>
                  </span>
                  <span class="whitespace-nowrap">{eco.label.replace('Naija', '')}</span>
                </a>
              ))}
            </div>
          </div>
        </header>

        {/* ===== MOBILE NAV DRAWER (off-canvas) =====
            Hidden on desktop (md:hidden). Two pieces: a click-to-close backdrop
            and the sliding panel itself. Both start closed (`hidden` +
            `-translate-x-full`) and are toggled purely by app.js adding/removing
            the `mobile-nav-open` class on <html> — no framework, no hydration,
            matches this app's existing hand-rolled event-binding style. */}
        <div
          id="mobile-nav-backdrop"
          class="md:hidden fixed inset-0 bg-black/50 z-50 opacity-0 pointer-events-none transition-opacity duration-200"
          aria-hidden="true"
        ></div>
        <nav
          id="mobile-nav-drawer"
          class="md:hidden fixed top-0 left-0 h-full w-[82%] max-w-xs bg-white z-[55] -translate-x-full transition-transform duration-200 overflow-y-auto shadow-xl"
          aria-label={t('nav_categories')}
          aria-hidden="true"
        >
          <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 sticky top-0 bg-white">
            <span class="text-lg font-bold tracking-tight text-gray-900">Naija<span class="text-primary">Deals</span></span>
            <button id="mobile-nav-close-btn" aria-label="Close menu" class="p-1.5 -mr-1 text-gray-500 hover:text-gray-800">
              <span class="material-symbols-outlined text-2xl">close</span>
            </button>
          </div>
          <div class="py-2">
            <a href="/" class="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50">
              <span class="material-symbols-outlined text-xl text-gray-500">home</span>{t('nav_home')}
            </a>
            {/* All Categories — mobile accordion trigger. Populated lazily and
                client-side from the same /api/catalog/categories/tree endpoint
                the desktop mega-menu uses (see initMegaMenu() in app.js).
                No hardcoded category list here — replaces the old CATEGORY_NAV. */}
            <button
              id="mobile-all-categories-btn"
              type="button"
              aria-expanded="false"
              aria-controls="mobile-mega-menu-list"
              class="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-50"
            >
              <span class="flex items-center gap-3">
                <span class="material-symbols-outlined text-xl text-gray-500">menu</span>{t('nav_all')}
              </span>
              <span id="mobile-all-categories-chevron" class="material-symbols-outlined text-lg text-gray-400 transition-transform">expand_more</span>
            </button>
            <div id="mobile-mega-menu-list" class="hidden pl-4 pr-2 pb-1">
              <p id="mobile-mega-menu-loading" class="px-3 py-2 text-xs text-gray-400">Loading categories…</p>
            </div>
            <a href="/shop?deals=1" class="flex items-center gap-3 px-4 py-2.5 text-sm font-semibold text-primary hover:bg-gray-50 border-t border-gray-100 mt-1">
              <span class="material-symbols-outlined text-xl">bolt</span>{t('nav_deals')}
            </a>
          </div>
          <div id="ecosystem-nav-mobile-drawer" class="py-2 border-t border-gray-100">
            <p class="px-4 pt-1 pb-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Ecosystem</p>
            {ecosystemLinks.map((eco) => (
              <a href={eco.href} class="flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                <span class="material-symbols-outlined text-xl text-gray-500">{eco.icon}</span>
                <span class="flex-1">{eco.label}</span>
                {!eco.live && <span class="text-[9px] bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">Soon</span>}
              </a>
            ))}
          </div>
          <div class="py-2 border-t border-gray-100">
            <a href={user ? '/account' : '/login'} class="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50">
              <span class="material-symbols-outlined text-xl text-gray-500">person</span>{user ? t('nav_account') : t('auth_login')}
            </a>
            <a href="/orders" class="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50">
              <span class="material-symbols-outlined text-xl text-gray-500">receipt_long</span>{t('nav_orders_returns')}
            </a>
            <a href="/seller" class="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50">
              <span class="material-symbols-outlined text-xl text-gray-500">storefront</span>{t('nav_sell_on_naijadeals')}
            </a>
            <a href="/affiliate" class="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50">
              <span class="material-symbols-outlined text-xl text-gray-500">link</span>Affiliate Center
            </a>
            <a href="/help" class="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50">
              <span class="material-symbols-outlined text-xl text-gray-500">help</span>{t('nav_help_center')}
            </a>
          </div>
        </nav>

        {/* pb-14 reserves space for the sticky mobile bottom nav (h-~56px) so it never
            visually/interactively overlaps the last section of page content on short
            pages — bug found via Pat's mandatory mobile swipe test: a touch aimed at the
            Ecosystem rail (which sits near the bottom of a short above-the-fold view)
            was landing on the bottom nav's /login link instead, because `sticky bottom-0`
            reaches into the content's own space once the page is short enough. */}
        <main class="flex-1 pb-14 md:pb-0">{children}</main>

        {/* ===== MEGA FOOTER ===== */}
        <footer class="bg-primary-dark text-white mt-8">
          <div class="max-w-[80rem] mx-auto px-6 lg:px-8 py-10">
            <div class="border-b border-white/10 pb-8 mb-8">
              <div class="max-w-md">
                <h3 class="font-semibold mb-1">{t('footer_newsletter_heading')}</h3>
                <p class="text-sm text-white/70 mb-3">{t('footer_newsletter_body')}</p>
                <form id="newsletter-form" class="flex items-stretch rounded-md overflow-hidden bg-white/5 border border-white/20">
                  <input type="email" name="email" required placeholder="you@example.com" class="flex-1 px-3 py-2 text-sm bg-transparent outline-none placeholder:text-white/50" />
                  <button type="submit" class="px-4 bg-primary-fixed text-primary-dark flex items-center justify-center">
                    <span class="material-symbols-outlined text-lg">mail</span>
                  </button>
                </form>
                <p id="newsletter-msg" class="text-xs text-white/50 mt-2">You can withdraw your consent at any time via the unsubscribe link in any email we send you.</p>
              </div>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6 text-sm">
              <div>
                <h4 class="font-semibold mb-3">{t('footer_get_to_know_us')}</h4>
                <a href="/about" class="block text-white/70 hover:text-white py-1">About NaijaDeals</a>
                <a href="/seller" class="block text-white/70 hover:text-white py-1">{t('nav_sell_on_naijadeals')}</a>
                <a href="/affiliate" class="block text-white/70 hover:text-white py-1">Affiliate Center</a>
                <a href="/admin" class="block text-white/70 hover:text-white py-1">Careers</a>
                <a href="/help" class="block text-white/70 hover:text-white py-1">Press</a>
              </div>
              <div>
                <h4 class="font-semibold mb-3">{t('footer_customer_service')}</h4>
                <a href="/help" class="block text-white/70 hover:text-white py-1">{t('nav_help_center')}</a>
                <a href="/orders" class="block text-white/70 hover:text-white py-1">Track Order</a>
                <a href="/help" class="block text-white/70 hover:text-white py-1">Returns &amp; Refunds</a>
                <a href="/help" class="block text-white/70 hover:text-white py-1">Report a Seller</a>
              </div>
              <div>
                <h4 class="font-semibold mb-3">{t('footer_payments_delivery')}</h4>
                <a href="/wallet" class="block text-white/70 hover:text-white py-1">NaijaDeals Wallet</a>
                <a href="/help" class="block text-white/70 hover:text-white py-1">Payment Methods</a>
                <a href="/help" class="block text-white/70 hover:text-white py-1">Delivery Options</a>
                <a href="/help" class="block text-white/70 hover:text-white py-1">Buyer Protection</a>
              </div>
              <div id="ecosystem-nav-footer">
                <h4 class="font-semibold mb-3">{t('footer_ecosystem')}</h4>
                {/* Micro-Checkpoint 2A: this footer column was found to be a 4th
                    hardcoded copy of the ecosystem list (undetected until the live
                    hide/restore test caught it) — now DB-driven from the exact same
                    ecosystemLinks the header uses, so hiding a vertical removes it
                    here too. NaijaShop is excluded (it has its own dedicated footer
                    column above, not part of the "Ecosystem" list). */}
                {ecosystemLinks.filter((eco) => eco.href !== '/shop').map((eco) => (
                  <a href={eco.href} class="block text-white/70 hover:text-white py-1">{eco.label}</a>
                ))}
              </div>
              <div>
                <h4 class="font-semibold mb-3">{t('footer_policies')}</h4>
                <a href="/help" class="block text-white/70 hover:text-white py-1">Privacy Policy</a>
                <a href="/help" class="block text-white/70 hover:text-white py-1">Terms of Service</a>
                <a href="/help" class="block text-white/70 hover:text-white py-1">Seller Terms</a>
                <a href="/help" class="block text-white/70 hover:text-white py-1">Payment Terms</a>
              </div>
              <div>
                <h4 class="font-semibold mb-3">{t('footer_trust_safety')}</h4>
                <span class="flex items-center gap-1.5 text-white/70 py-1"><span class="material-symbols-outlined text-base">verified_user</span>Escrow protected</span>
                <span class="flex items-center gap-1.5 text-white/70 py-1"><span class="material-symbols-outlined text-base">local_shipping</span>Nationwide delivery</span>
                <span class="flex items-center gap-1.5 text-white/70 py-1"><span class="material-symbols-outlined text-base">payments</span>Pay in Naira</span>
                <span class="flex items-center gap-1.5 text-white/70 py-1"><span class="material-symbols-outlined text-base">verified</span>Verified sellers</span>
              </div>
            </div>
            <div class="flex flex-col md:flex-row items-center justify-between gap-3 mt-8 pt-6 border-t border-white/10 text-xs text-white/50">
              <span>{t('footer_rights')}</span>
              <div class="flex items-center gap-3">
                <LanguageSelector locale={locale} variant="footer" />
                <span class="flex items-center gap-1"><span class="material-symbols-outlined text-sm">download</span>Get the app (coming soon)</span>
              </div>
            </div>
          </div>
        </footer>

        {/* Mobile bottom nav */}
        <nav class="md:hidden sticky bottom-0 z-40 bg-white border-t border-gray-200 flex items-stretch">
          <a href="/" class="flex-1 flex flex-col items-center justify-center py-2 text-[11px] text-gray-600">
            <span class="material-symbols-outlined text-xl">home</span>Home
          </a>
          <a href="/shop" class="flex-1 flex flex-col items-center justify-center py-2 text-[11px] text-gray-600">
            <span class="material-symbols-outlined text-xl">storefront</span>Shop
          </a>
          <a href="/aura" class="flex-1 flex flex-col items-center justify-center py-2 text-[11px] text-gray-600">
            <span class="material-symbols-outlined text-xl">auto_awesome</span>Aura
          </a>
          <a href="/cart" class="flex-1 flex flex-col items-center justify-center py-2 text-[11px] text-gray-600 relative">
            <span class="material-symbols-outlined text-xl">shopping_cart</span>Cart
          </a>
          <a href={user ? '/account' : '/login'} class="flex-1 flex flex-col items-center justify-center py-2 text-[11px] text-gray-600">
            <span class="material-symbols-outlined text-xl">person</span>Account
          </a>
        </nav>

        <script src="/static/app.js"></script>
      </body>
    </html>
  )
}

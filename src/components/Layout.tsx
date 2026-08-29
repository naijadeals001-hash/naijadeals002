import type { FC } from 'hono/jsx'
import type { AuthUser } from '../types'

interface LayoutProps {
  title?: string
  description?: string
  user: AuthUser | null
  cartCount?: number
  wishlistCount?: number
  activeNav?: string
  children: any
}

const CITIES = ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Kano', 'Enugu', 'Benin City', 'Kaduna', 'Owerri', 'Uyo', 'Aba', 'Jos']

const ECOSYSTEM_LINKS = [
  { href: '/shop', label: 'NaijaShop', icon: 'storefront', live: true },
  { href: '/fresh', label: 'NaijaFresh', icon: 'nutrition', live: false },
  { href: '/eats', label: 'NaijaEats', icon: 'restaurant', live: false },
  { href: '/gigs', label: 'NaijaGigs', icon: 'design_services', live: false },
  { href: '/stay', label: 'NaijaStay', icon: 'bed', live: false },
  { href: '/drive', label: 'NaijaDrive', icon: 'directions_car', live: false },
  { href: '/send', label: 'NaijaSend', icon: 'local_shipping', live: false },
  { href: '/stream', label: 'NaijaStream', icon: 'play_circle', live: false },
  { href: '/aura', label: 'Aura AI', icon: 'auto_awesome', live: false }
]

const CATEGORY_NAV = [
  { href: '/shop?category=electronics', label: 'Electronics' },
  { href: '/shop?category=phones-tablets', label: 'Phones & Tablets' },
  { href: '/shop?category=fashion', label: 'Fashion' },
  { href: '/shop?category=home-kitchen', label: 'Home & Kitchen' },
  { href: '/shop?category=groceries', label: 'Groceries' },
  { href: '/shop?category=beauty-health', label: 'Beauty & Health' },
  { href: '/shop?category=sports-outdoors', label: 'Sports & Outdoors' },
  { href: '/shop?category=baby-products', label: 'Baby Products' },
  { href: '/shop?category=automotive', label: 'Automotive' }
]

export const Layout: FC<LayoutProps> = ({ title, description, user, cartCount = 0, wishlistCount = 0, children }) => {
  return (
    <html lang="en">
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
        <header class="sticky top-0 z-40 shadow-sm">
          {/* ===== DESKTOP: utility bar + main header + category nav ===== */}
          <div class="hidden md:block bg-primary-dark text-white">
            {/* Utility bar */}
            <div class="border-b border-white/10">
              <div class="max-w-[100rem] mx-auto flex items-center justify-between px-6 lg:px-8 py-1.5 text-xs text-white/70">
                <div class="flex items-center gap-4">
                  <span>Nigeria's Super App — Shop · Fresh · Eats · Gigs · Stay · Drive · Send · Stream</span>
                </div>
                <div class="flex items-center gap-4">
                  <a href="/seller" class="hover:text-white transition-colors">Sell on NaijaDeals</a>
                  <a href="/help" class="hover:text-white transition-colors">Help Center</a>
                  <span class="flex items-center gap-1">EN | ₦ NGN</span>
                </div>
              </div>
            </div>
            {/* Main header */}
            <div class="max-w-[100rem] mx-auto flex items-center gap-4 px-6 lg:px-8 py-2.5">
              <a href="/" class="flex items-center shrink-0 bg-white/5 hover:bg-white/10 transition-colors rounded-lg px-3 py-1.5" aria-label="NaijaDeals home">
                <span class="text-xl font-bold tracking-tight">Naija<span class="text-primary-fixed">Deals</span></span>
              </a>
              <label class="hidden lg:flex flex-col justify-center leading-tight px-2 py-1 rounded-lg hover:bg-white/10 transition-colors shrink-0 cursor-pointer">
                <span class="text-[11px] text-white/70">Deliver to</span>
                <select id="city-selector" class="text-sm font-semibold bg-transparent outline-none cursor-pointer [&>option]:text-gray-900">
                  {CITIES.map((city) => <option value={city} selected={city === 'Lagos'}>{city}</option>)}
                </select>
              </label>
              <form action="/shop" method="get" class="flex flex-1 max-w-2xl items-stretch rounded-md overflow-hidden bg-white">
                <select name="category" aria-label="Search category" class="hidden sm:block px-2 text-xs text-gray-600 border-r border-gray-200 outline-none bg-gray-50">
                  <option value="">All Categories</option>
                  {CATEGORY_NAV.map((c) => <option value={c.href.split('=')[1]}>{c.label}</option>)}
                </select>
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
                  <span class="text-[11px] text-white/70">Balance</span>
                  <span class="text-sm font-semibold" id="wallet-balance-nav">--</span>
                </a>
                <a href="/account/wishlist" class="hidden lg:flex relative flex-col justify-center leading-tight px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors">
                  <span class="material-symbols-outlined text-xl">favorite</span>
                  <span id="wishlist-count-badge" class={`absolute -top-0.5 right-0.5 bg-primary-fixed text-primary-dark text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center ${wishlistCount > 0 ? '' : 'hidden'}`}>{wishlistCount}</span>
                </a>
                {user ? (
                  <a href="/account" class="flex flex-col justify-center leading-tight px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors">
                    <span class="text-[11px] text-white/70 truncate max-w-28">Hello, {user.name.split(' ')[0]}</span>
                    <span class="text-sm font-semibold">Account &amp; Lists</span>
                  </a>
                ) : (
                  <a href="/login" class="flex flex-col justify-center leading-tight px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors">
                    <span class="text-[11px] text-white/70">Hello, sign in</span>
                    <span class="text-sm font-semibold">Account &amp; Lists</span>
                  </a>
                )}
                <a href="/orders" class="hidden lg:flex flex-col justify-center leading-tight px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors">
                  <span class="text-[11px] text-white/70">Returns</span>
                  <span class="text-sm font-semibold">&amp; Orders</span>
                </a>
                <a href="/cart" class="relative flex items-end gap-1 px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors">
                  <span class="material-symbols-outlined text-2xl">shopping_cart</span>
                  <span
                    id="cart-count-badge-desktop"
                    class={`absolute -top-0.5 right-0.5 bg-primary-fixed text-primary-dark text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center ${cartCount > 0 ? '' : 'hidden'}`}
                  >{cartCount}</span>
                  <span class="text-sm font-semibold hidden xl:inline">Cart</span>
                </a>
              </div>
            </div>
            {/* Category nav bar */}
            <nav class="bg-primary border-t border-white/10">
              <div class="max-w-[100rem] mx-auto flex items-center gap-1 px-6 lg:px-8 py-2 text-sm font-medium overflow-x-auto">
                <a href="/shop" class="flex items-center gap-1.5 shrink-0 px-2 py-1 rounded hover:bg-white/10 transition-colors font-semibold">
                  <span class="material-symbols-outlined text-lg">menu</span>All
                </a>
                {CATEGORY_NAV.map((link) => (
                  <a href={link.href} class="flex items-center gap-1 shrink-0 px-2 py-1 rounded hover:bg-white/10 transition-colors">
                    {link.label}
                  </a>
                ))}
                <span class="w-px h-4 bg-white/20 shrink-0 mx-1"></span>
                <a href="/shop?deals=1" class="flex items-center gap-1 shrink-0 px-2 py-1 rounded hover:bg-white/10 transition-colors text-primary-fixed font-semibold">Today's Deals</a>
                <a href="/wallet" class="flex items-center gap-1 shrink-0 px-2 py-1 rounded hover:bg-white/10 transition-colors">NaijaDeals Plus</a>
              </div>
            </nav>
            {/* Ecosystem shortcuts strip */}
            <div class="bg-primary-dark/60 border-t border-white/10">
              <div class="max-w-[100rem] mx-auto flex items-center gap-4 px-6 lg:px-8 py-1.5 text-xs overflow-x-auto">
                {ECOSYSTEM_LINKS.map((eco) => (
                  <a href={eco.href} class="flex items-center gap-1 shrink-0 text-white/70 hover:text-white transition-colors">
                    <span class="material-symbols-outlined text-sm">{eco.icon}</span>
                    {eco.label}
                    {!eco.live && <span class="text-[9px] bg-white/10 rounded px-1">Soon</span>}
                  </a>
                ))}
              </div>
            </div>
          </div>

          {/* ===== MOBILE: 3-row header (brand+actions / search / ecosystem scroller) ===== */}
          <div class="md:hidden bg-primary-dark text-white">
            {/* Row 1: menu, brand, location, account, cart */}
            <div class="flex items-center gap-2 px-3 py-2.5">
              <button id="mobile-menu-btn" aria-label="Menu" class="p-1.5 -ml-1">
                <span class="material-symbols-outlined text-2xl">menu</span>
              </button>
              <a href="/" class="shrink-0" aria-label="NaijaDeals home">
                <span class="text-lg font-bold tracking-tight">Naija<span class="text-primary-fixed">Deals</span></span>
              </a>
              <button id="mobile-location-btn" class="flex items-center gap-0.5 text-[11px] text-white/80 ml-1 shrink-0">
                <span class="material-symbols-outlined text-sm">location_on</span>Lagos
                <span class="material-symbols-outlined text-sm">expand_more</span>
              </button>
              <div class="ml-auto flex items-center gap-3 shrink-0">
                {user ? (
                  <a href="/account" aria-label="Account" class="flex items-center justify-center w-8 h-8 rounded-full bg-white/10">
                    <span class="material-symbols-outlined text-xl">person</span>
                  </a>
                ) : (
                  <a href="/login" class="flex items-center text-sm font-normal">
                    Sign in<span class="material-symbols-outlined text-sm">chevron_right</span>
                  </a>
                )}
                <a href="/cart" aria-label="Cart" class="relative p-1">
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
                <input type="text" name="q" placeholder="Search products, brands, sellers..." class="flex-1 px-3 py-2.5 text-sm text-gray-800 outline-none min-w-0" />
                <button type="submit" class="flex items-center justify-center px-3.5 bg-primary-fixed text-primary-dark shrink-0">
                  <span class="material-symbols-outlined text-lg">search</span>
                </button>
              </form>
            </div>
            {/* Row 3: horizontally-scrollable ecosystem nav */}
            <div class="flex items-center gap-4 px-3 pb-2.5 overflow-x-auto text-[11px]">
              {ECOSYSTEM_LINKS.map((eco) => (
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

        <main class="flex-1">{children}</main>

        {/* ===== MEGA FOOTER ===== */}
        <footer class="bg-primary-dark text-white mt-8">
          <div class="max-w-[100rem] mx-auto px-6 lg:px-8 py-10">
            <div class="border-b border-white/10 pb-8 mb-8">
              <div class="max-w-md">
                <h3 class="font-semibold mb-1">New to NaijaDeals?</h3>
                <p class="text-sm text-white/70 mb-3">Subscribe for updates on the latest offers, deals and ecosystem launches.</p>
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
                <h4 class="font-semibold mb-3">Get to Know Us</h4>
                <a href="/about" class="block text-white/70 hover:text-white py-1">About NaijaDeals</a>
                <a href="/seller" class="block text-white/70 hover:text-white py-1">Sell on NaijaDeals</a>
                <a href="/admin" class="block text-white/70 hover:text-white py-1">Careers</a>
                <a href="/help" class="block text-white/70 hover:text-white py-1">Press</a>
              </div>
              <div>
                <h4 class="font-semibold mb-3">Customer Service</h4>
                <a href="/help" class="block text-white/70 hover:text-white py-1">Help Center</a>
                <a href="/orders" class="block text-white/70 hover:text-white py-1">Track Order</a>
                <a href="/help" class="block text-white/70 hover:text-white py-1">Returns &amp; Refunds</a>
                <a href="/help" class="block text-white/70 hover:text-white py-1">Report a Seller</a>
              </div>
              <div>
                <h4 class="font-semibold mb-3">Payments &amp; Delivery</h4>
                <a href="/wallet" class="block text-white/70 hover:text-white py-1">NaijaDeals Wallet</a>
                <a href="/help" class="block text-white/70 hover:text-white py-1">Payment Methods</a>
                <a href="/help" class="block text-white/70 hover:text-white py-1">Delivery Options</a>
                <a href="/help" class="block text-white/70 hover:text-white py-1">Buyer Protection</a>
              </div>
              <div>
                <h4 class="font-semibold mb-3">Ecosystem</h4>
                <a href="/fresh" class="block text-white/70 hover:text-white py-1">NaijaFresh</a>
                <a href="/eats" class="block text-white/70 hover:text-white py-1">NaijaEats</a>
                <a href="/gigs" class="block text-white/70 hover:text-white py-1">NaijaGigs</a>
                <a href="/stay" class="block text-white/70 hover:text-white py-1">NaijaStay</a>
                <a href="/drive" class="block text-white/70 hover:text-white py-1">NaijaDrive</a>
                <a href="/send" class="block text-white/70 hover:text-white py-1">NaijaSend</a>
                <a href="/stream" class="block text-white/70 hover:text-white py-1">NaijaStream</a>
                <a href="/aura" class="block text-white/70 hover:text-white py-1">Aura AI</a>
              </div>
              <div>
                <h4 class="font-semibold mb-3">Policies</h4>
                <a href="/help" class="block text-white/70 hover:text-white py-1">Privacy Policy</a>
                <a href="/help" class="block text-white/70 hover:text-white py-1">Terms of Service</a>
                <a href="/help" class="block text-white/70 hover:text-white py-1">Seller Terms</a>
                <a href="/help" class="block text-white/70 hover:text-white py-1">Payment Terms</a>
              </div>
              <div>
                <h4 class="font-semibold mb-3">Trust &amp; Safety</h4>
                <span class="flex items-center gap-1.5 text-white/70 py-1"><span class="material-symbols-outlined text-base">verified_user</span>Escrow protected</span>
                <span class="flex items-center gap-1.5 text-white/70 py-1"><span class="material-symbols-outlined text-base">local_shipping</span>Nationwide delivery</span>
                <span class="flex items-center gap-1.5 text-white/70 py-1"><span class="material-symbols-outlined text-base">payments</span>Pay in Naira</span>
                <span class="flex items-center gap-1.5 text-white/70 py-1"><span class="material-symbols-outlined text-base">verified</span>Verified sellers</span>
              </div>
            </div>
            <div class="flex flex-col md:flex-row items-center justify-between gap-3 mt-8 pt-6 border-t border-white/10 text-xs text-white/50">
              <span>© 2026 NaijaDeals. All rights reserved. A Nigerian digital commerce ecosystem.</span>
              <div class="flex items-center gap-3">
                <span>EN | ₦ NGN</span>
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

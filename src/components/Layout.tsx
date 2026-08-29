import type { FC } from 'hono/jsx'
import type { AuthUser } from '../types'

interface LayoutProps {
  title?: string
  description?: string
  user: AuthUser | null
  cartCount?: number
  children: any
}

const NAV_LINKS = [
  { href: '/shop', label: 'NaijaShop' },
  { href: '/shop?deals=1', label: "Today's Deals" },
  { href: '/orders', label: 'Buy Again' },
  { href: '/ecosystem', label: 'Ecosystem' },
  { href: '/wallet', label: 'Wallet' },
  { href: '/help', label: 'Customer Service' }
]

export const Layout: FC<LayoutProps> = ({ title, description, user, cartCount = 0, children }) => {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title ? `${title} | NaijaDeals` : 'NaijaDeals — Shop, Eat, Hire, Stay. Built for Nigeria.'}</title>
        <meta name="description" content={description || 'One account. One ecosystem. Shop, food delivery, services and stays — all in one app, built for Nigeria.'} />
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
          {/* Desktop top bar */}
          <div class="hidden md:block bg-primary-dark text-white">
            <div class="max-w-[100rem] mx-auto flex items-center gap-4 px-6 lg:px-8 py-2.5">
              <a href="/" class="flex items-center shrink-0 bg-white/5 hover:bg-white/10 transition-colors rounded-lg px-3 py-1.5" aria-label="NaijaDeals home">
                <span class="text-xl font-bold tracking-tight">Naija<span class="text-primary-fixed">Deals</span></span>
              </a>
              <div class="hidden lg:flex flex-col justify-center leading-tight px-2 py-1 rounded-lg hover:bg-white/10 transition-colors shrink-0 cursor-default">
                <span class="text-[11px] text-white/70">Deliver to</span>
                <span class="text-sm font-semibold flex items-center gap-1">
                  <span class="material-symbols-outlined text-base">location_on</span>Lagos
                </span>
              </div>
              <form action="/shop" method="get" class="flex flex-1 max-w-2xl items-stretch rounded-md overflow-hidden bg-white">
                <input
                  type="text"
                  name="q"
                  placeholder="Search products, vendors..."
                  class="flex-1 px-4 py-2.5 text-sm text-gray-800 outline-none"
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
                {user ? (
                  <div class="relative group">
                    <a href="/account" class="flex flex-col justify-center leading-tight px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors">
                      <span class="text-[11px] text-white/70 truncate max-w-28">Hello, {user.name.split(' ')[0]}</span>
                      <span class="text-sm font-semibold">Account &amp; Lists</span>
                    </a>
                  </div>
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
            <nav class="bg-primary border-t border-white/10">
              <div class="max-w-[100rem] mx-auto flex items-center gap-1 px-6 lg:px-8 py-2 text-sm font-medium overflow-x-auto">
                <a href="/shop" class="flex items-center gap-1.5 shrink-0 px-2 py-1 rounded hover:bg-white/10 transition-colors font-semibold">
                  <span class="material-symbols-outlined text-lg">menu</span>All
                </a>
                {NAV_LINKS.map((link) => (
                  <a href={link.href} class="flex items-center gap-1 shrink-0 px-2 py-1 rounded hover:bg-white/10 transition-colors">
                    {link.label}
                  </a>
                ))}
              </div>
            </nav>
          </div>

          {/* Mobile top bar */}
          <div class="md:hidden bg-primary-dark text-white">
            <div class="flex items-center px-4 py-3">
              <a href="/" class="shrink-0" aria-label="NaijaDeals home">
                <span class="text-lg font-bold tracking-tight">Naija<span class="text-primary-fixed">Deals</span></span>
              </a>
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
            <div class="px-4 pb-3">
              <form action="/shop" method="get" class="w-full flex items-stretch rounded-md overflow-hidden bg-white">
                <input type="text" name="q" placeholder="Search products, vendors..." class="flex-1 px-3 py-2.5 text-sm text-gray-800 outline-none min-w-0" />
                <button type="submit" class="flex items-center justify-center px-3.5 bg-primary-fixed text-primary-dark shrink-0">
                  <span class="material-symbols-outlined text-lg">search</span>
                </button>
              </form>
            </div>
          </div>
        </header>

        <main class="flex-1">{children}</main>

        <footer class="bg-primary-dark text-white mt-8">
          <div class="max-w-[100rem] mx-auto px-6 lg:px-8 py-10">
            <div class="border-b border-white/10 pb-8 mb-8">
              <div class="max-w-md">
                <h3 class="font-semibold mb-1">New to NaijaDeals?</h3>
                <p class="text-sm text-white/70 mb-3">Subscribe to our newsletter to get updates on the latest offers, deals and campaigns.</p>
                <form id="newsletter-form" class="flex items-stretch rounded-md overflow-hidden bg-white/5 border border-white/20">
                  <input type="email" name="email" required placeholder="you@example.com" class="flex-1 px-3 py-2 text-sm bg-transparent outline-none placeholder:text-white/50" />
                  <button type="submit" class="px-4 bg-primary-fixed text-primary-dark flex items-center justify-center">
                    <span class="material-symbols-outlined text-lg">mail</span>
                  </button>
                </form>
                <p id="newsletter-msg" class="text-xs text-white/50 mt-2">You can withdraw your consent at any time via the unsubscribe link in any email we send you.</p>
              </div>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
              <div>
                <h4 class="font-semibold mb-3">Shop</h4>
                <a href="/shop" class="block text-white/70 hover:text-white py-1">All categories</a>
                <a href="/shop?deals=1" class="block text-white/70 hover:text-white py-1">Flash deals</a>
                <a href="/orders" class="block text-white/70 hover:text-white py-1">Track order</a>
              </div>
              <div>
                <h4 class="font-semibold mb-3">Ecosystem</h4>
                <a href="/ecosystem" class="block text-white/70 hover:text-white py-1">NaijaEats</a>
                <a href="/ecosystem" class="block text-white/70 hover:text-white py-1">NaijaGigs</a>
                <a href="/ecosystem" class="block text-white/70 hover:text-white py-1">NaijaStay</a>
              </div>
              <div>
                <h4 class="font-semibold mb-3">Account</h4>
                <a href="/wallet" class="block text-white/70 hover:text-white py-1">Wallet</a>
                <a href="/orders" class="block text-white/70 hover:text-white py-1">Orders</a>
                <a href="/help" class="block text-white/70 hover:text-white py-1">Help center</a>
              </div>
              <div>
                <h4 class="font-semibold mb-3">Trust</h4>
                <span class="flex items-center gap-1.5 text-white/70 py-1"><span class="material-symbols-outlined text-base">verified_user</span>Escrow protected</span>
                <span class="flex items-center gap-1.5 text-white/70 py-1"><span class="material-symbols-outlined text-base">local_shipping</span>Nationwide delivery</span>
                <span class="flex items-center gap-1.5 text-white/70 py-1"><span class="material-symbols-outlined text-base">payments</span>Pay in Naira</span>
              </div>
            </div>
            <div class="flex flex-col md:flex-row items-center justify-between gap-2 mt-8 pt-6 border-t border-white/10 text-xs text-white/50">
              <span>© 2026 NaijaDeals. All rights reserved.</span>
              <span>One account. One ecosystem. Multiple services: shop, eat, book and send, all in one app.</span>
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
          <a href="/cart" class="flex-1 flex flex-col items-center justify-center py-2 text-[11px] text-gray-600 relative">
            <span class="material-symbols-outlined text-xl">shopping_cart</span>Cart
          </a>
          <a href="/orders" class="flex-1 flex flex-col items-center justify-center py-2 text-[11px] text-gray-600">
            <span class="material-symbols-outlined text-xl">receipt_long</span>Orders
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

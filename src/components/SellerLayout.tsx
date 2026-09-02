import type { FC } from 'hono/jsx'
import type { AuthUser, VendorRow } from '../types'
import type { LocaleContext } from '../i18n'

interface SellerLayoutProps {
  title?: string
  user: AuthUser
  vendor: VendorRow
  /** Which Seller Center nav item is current. Must match one of NAV_ITEMS[].key. */
  active: string
  /** Resolved by attachLocale middleware — required, mirrors Layout.tsx's contract exactly (see Layout.tsx for why this must not be optional). */
  locale: LocaleContext
  children: any
}

/**
 * "Seller Center" navigation shell — the structure Phase 2 establishes for future
 * phases to expand into. Only `implemented: true` items link to a real, ownership-
 * gated route; everything else renders as a disabled "Coming soon" entry (no href,
 * so it can never 404 or be mistaken for a working page). Do not flip `implemented`
 * to true for an item until its route actually exists and is wired behind
 * requireActiveSeller.
 */
const NAV_ITEMS: { key: string; label: string; icon: string; href?: string; implemented: boolean }[] = [
  { key: 'overview', label: 'Overview', icon: 'dashboard', href: '/seller/dashboard', implemented: true },
  { key: 'products', label: 'Products', icon: 'inventory_2', href: '/seller/products', implemented: true },
  { key: 'orders', label: 'Orders', icon: 'receipt_long', href: '/seller/orders', implemented: true },
  { key: 'customers', label: 'Customers', icon: 'group', implemented: false },
  { key: 'finance', label: 'Finance', icon: 'payments', href: '/seller/finance', implemented: true },
  { key: 'analytics', label: 'Analytics', icon: 'monitoring', implemented: false },
  { key: 'promotions', label: 'Promotions', icon: 'sell', implemented: false },
  { key: 'store', label: 'Store', icon: 'storefront', implemented: false },
  { key: 'settings', label: 'Settings', icon: 'settings', implemented: false }
]

const VERIFICATION_BADGE: Record<string, { label: string; class: string }> = {
  verified: { label: 'Verified', class: 'bg-primary-light text-primary-dark' },
  pending: { label: 'Verification pending', class: 'bg-amber-50 text-amber-700' },
  rejected: { label: 'Rejected', class: 'bg-red-50 text-red-700' },
  suspended: { label: 'Suspended', class: 'bg-red-50 text-red-700' }
}

export const SellerLayout: FC<SellerLayoutProps> = ({ title, user, vendor, active, locale, children }) => {
  const badge = VERIFICATION_BADGE[vendor.verification_status] || VERIFICATION_BADGE.pending
  return (
    <html lang={locale.language} dir={locale.dir}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title ? `${title} | Seller Center | NaijaDeals` : 'Seller Center | NaijaDeals'}</title>
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
        {/* ===== Seller Center top bar — deliberately distinct chrome from the storefront header, same design tokens ===== */}
        <header class="sticky top-0 z-40 bg-primary-dark text-white shadow-sm">
          <div class="max-w-[100rem] mx-auto flex items-center gap-3 px-4 md:px-6 lg:px-8 py-2.5">
            <a href="/" class="flex items-center shrink-0" aria-label="NaijaDeals home">
              <span class="text-lg font-bold tracking-tight">Naija<span class="text-primary-fixed">Deals</span></span>
            </a>
            <span class="w-px h-5 bg-white/20 shrink-0"></span>
            <span class="text-sm font-semibold text-white/90 shrink-0">Seller Center</span>
            <div class="ml-auto flex items-center gap-3 shrink-0">
              <span class={`hidden sm:inline text-[11px] font-semibold px-2 py-1 rounded-full ${badge.class}`}>{badge.label}</span>
              <span class="hidden md:flex flex-col leading-tight text-right">
                <span class="text-[11px] text-white/60">Store</span>
                <span class="text-sm font-semibold truncate max-w-[10rem]">{vendor.business_name || vendor.name}</span>
              </span>
              <a href="/" class="flex items-center gap-1 text-xs text-white/70 hover:text-white transition-colors">
                <span class="material-symbols-outlined text-base">arrow_back</span>
                <span class="hidden sm:inline">Back to NaijaDeals</span>
              </a>
            </div>
          </div>
          {/* Mobile verification badge row */}
          <div class="sm:hidden px-4 pb-2">
            <span class={`inline-block text-[11px] font-semibold px-2 py-1 rounded-full ${badge.class}`}>{badge.label}</span>
          </div>
        </header>

        <div class="flex-1 max-w-[100rem] w-full mx-auto md:flex">
          {/* ===== Desktop sidebar ===== */}
          <nav class="hidden md:block w-56 shrink-0 border-r border-gray-200 bg-white py-4">
            {NAV_ITEMS.map((item) =>
              item.implemented && item.href ? (
                <a
                  href={item.href}
                  class={`flex items-center gap-2.5 px-5 py-2.5 text-sm font-medium transition-colors ${
                    active === item.key ? 'bg-primary-light text-primary-dark border-r-2 border-primary' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span class="material-symbols-outlined text-lg">{item.icon}</span>
                  {item.label}
                </a>
              ) : (
                <span class="flex items-center gap-2.5 px-5 py-2.5 text-sm font-medium text-gray-400 cursor-not-allowed" aria-disabled="true">
                  <span class="material-symbols-outlined text-lg">{item.icon}</span>
                  {item.label}
                  <span class="ml-auto text-[9px] bg-gray-100 text-gray-400 rounded px-1.5 py-0.5">Soon</span>
                </span>
              )
            )}
          </nav>

          {/* ===== Mobile horizontal nav scroller ===== */}
          <nav class="md:hidden flex items-center gap-1 px-3 py-2 overflow-x-auto bg-white border-b border-gray-200 text-xs">
            {NAV_ITEMS.map((item) =>
              item.implemented && item.href ? (
                <a
                  href={item.href}
                  class={`flex flex-col items-center gap-0.5 shrink-0 px-3 py-1.5 rounded-lg ${
                    active === item.key ? 'bg-primary-light text-primary-dark' : 'text-gray-500'
                  }`}
                >
                  <span class="material-symbols-outlined text-lg">{item.icon}</span>
                  {item.label}
                </a>
              ) : (
                <span class="flex flex-col items-center gap-0.5 shrink-0 px-3 py-1.5 rounded-lg text-gray-300">
                  <span class="material-symbols-outlined text-lg">{item.icon}</span>
                  {item.label}
                </span>
              )
            )}
          </nav>

          <main class="flex-1 min-w-0">{children}</main>
        </div>

        <script src="/static/app.js"></script>
      </body>
    </html>
  )
}

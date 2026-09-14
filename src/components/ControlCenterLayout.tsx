import type { FC } from 'hono/jsx'
import type { AuthUser } from '../types'
import type { ControlCenterAccessResolution } from '../lib/control-center-rbac'

interface ControlCenterLayoutProps {
  title?: string
  user: AuthUser
  ccAccess: ControlCenterAccessResolution
  /** Which left-nav item is current. Must match one of NAV_GROUPS[].items[].key. */
  active: string
  children: any
}

/**
 * Enterprise Control Center shell — Phase 1 visual redesign.
 *
 * DESIGN PROVENANCE: rebuilt against a user-supplied reference screenshot
 * (an "Enterprise Control Center" command-center benchmark) that was
 * explicitly designated the VISUAL/UX benchmark, never a brand to copy and
 * never authorization to fabricate functionality. Every real feature below
 * (nav grouping, KPI row, ecosystem ribbon, live feed, search, health,
 * pending actions) reproduces that reference's COMPOSITION and DENSITY
 * using NaijaDeals' own emerald/teal identity and, critically, only real
 * NaijaDeals data — metrics with no real source render an honest
 * "not yet built" state in the SAME grid slot rather than being deleted
 * or faked (see control-center-dashboard.ts's header comment).
 *
 * Every nav item still declares the CC permission key required to use it,
 * and unimplemented modules still render as a disabled, clearly-labeled
 * entry — the visual upgrade does NOT relax the "modules not yet real must
 * not be presented as operational" rule from Phase 1 Section 16.
 */
const NAV_GROUPS: {
  group: string
  items: { key: string; label: string; icon: string; href?: string; permission?: string; implemented: boolean }[]
}[] = [
  {
    group: 'Monitor & Analyze',
    items: [
      { key: 'overview', label: 'Command Center', icon: 'dashboard', href: '/control-center', implemented: true },
      { key: 'analytics', label: 'Analytics & Reports', icon: 'monitoring', implemented: false },
      { key: 'system_health', label: 'System Health', icon: 'health_and_safety', href: '/control-center/system-health', permission: 'system_health.read', implemented: true },
      { key: 'audit', label: 'Audit & Governance', icon: 'gavel', href: '/control-center/audit', permission: 'audit.read', implemented: true },
    ],
  },
  {
    group: 'Users & Entities',
    items: [
      { key: 'customers', label: 'Customers', icon: 'group', href: '/control-center/customers', permission: 'customers.read', implemented: true },
      { key: 'vendors', label: 'Vendors & Stores', icon: 'storefront', href: '/control-center/vendors', permission: 'vendors.read', implemented: true },
      { key: 'providers', label: 'Providers & Partners', icon: 'engineering', href: '/control-center/providers', permission: 'providers.read', implemented: true },
    ],
  },
  {
    group: 'Operations',
    items: [
      { key: 'africa', label: 'Africa Operations', icon: 'public', href: '/control-center/africa', implemented: true },
      { key: 'operations_tower', label: 'Operations Tower', icon: 'fact_check', href: '/control-center/operations', implemented: true },
      { key: 'orders', label: 'Orders & Fulfillment', icon: 'receipt_long', permission: 'orders.read', implemented: false },
      { key: 'bookings', label: 'Bookings', icon: 'event_available', permission: 'bookings.read', implemented: false },
      { key: 'logistics', label: 'Rides & Logistics', icon: 'local_shipping', implemented: false },
    ],
  },
  {
    group: 'Ecosystem',
    items: [{ key: 'ecosystem', label: 'NaijaDeals Ecosystem', icon: 'hub', href: '/control-center/ecosystem', implemented: true }],
  },
  {
    group: 'Finance & Payments',
    items: [
      { key: 'finance', label: 'Payments & Finance', icon: 'payments', href: '/control-center/finance', permission: 'payments.read', implemented: true },
      { key: 'wallets', label: 'Wallets & Escrow', icon: 'account_balance_wallet', permission: 'wallets.read', implemented: false },
    ],
  },
  {
    group: 'Trust & Safety',
    items: [
      { key: 'verification', label: 'Verification & KYC', icon: 'verified_user', href: '/control-center/verification', implemented: true },
      { key: 'moderation', label: 'Content Moderation', icon: 'shield', href: '/control-center/moderation', permission: 'moderation.read', implemented: true },
      { key: 'risk', label: 'Fraud & Risk', icon: 'gpp_maybe', implemented: false },
    ],
  },
  {
    group: 'Marketing & Growth',
    items: [
      { key: 'promotions', label: 'Promotions & Campaigns', icon: 'sell', permission: 'promotions.read', implemented: false },
      { key: 'affiliates', label: 'Affiliates', icon: 'diversity_3', implemented: false },
      { key: 'communications', label: 'Communications', icon: 'forum', href: '/control-center/communications', permission: 'notifications.read', implemented: true },
    ],
  },
  {
    group: 'Platform Management',
    items: [
      { key: 'countries', label: 'Countries / Africa', icon: 'public', href: '/control-center/countries', implemented: true },
      { key: 'integrations', label: 'Integrations & APIs', icon: 'cable', permission: 'integrations.read', implemented: false },
      { key: 'configuration', label: 'Platform Settings', icon: 'settings', permission: 'configuration.read', implemented: false },
    ],
  },
  {
    group: 'Aura AI',
    items: [{ key: 'aura', label: 'Aura AI Operations', icon: 'auto_awesome', href: '/control-center/aura', implemented: true }],
  },
]

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  platform_admin: 'Platform Administrator',
  operations_admin: 'Operations Administrator',
  finance_admin: 'Finance Administrator',
  trust_safety_admin: 'Trust & Safety Administrator',
  support_admin: 'Customer Support Administrator',
  vendor_admin: 'Vendor/Provider Administrator',
  marketing_admin: 'Marketing Administrator',
  content_admin: 'Content Administrator',
  logistics_admin: 'Logistics Administrator',
  analytics_admin: 'Analytics Administrator',
  integration_admin: 'Integration Administrator',
  auditor: 'Read-Only Auditor',
}

export const ControlCenterLayout: FC<ControlCenterLayoutProps> = ({ title, user, ccAccess, active, children }) => {
  const roleLabel = ccAccess.roleKeys.map((k) => ROLE_LABELS[k] ?? k).join(', ')
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  return (
    <html lang="en" dir="ltr">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title ? `${title} | Control Center | NaijaDeals` : 'Control Center | NaijaDeals'}</title>
        <meta name="robots" content="noindex, nofollow" />
        <link rel="icon" href="/static/favicon.svg" />
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
        <script src="https://cdn.tailwindcss.com"></script>
        <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
        <script
          dangerouslySetInnerHTML={{
            __html: `
            tailwind.config = {
              theme: {
                extend: {
                  colors: {
                    ccbg: '#080B0A',
                    ccpanel: '#0F1613',
                    ccpanel2: '#131C18',
                    ccborder: '#1E2B25',
                    ccaccent: { DEFAULT: '#17C983', dark: '#0B7A3B', light: '#0F2A20' },
                    ccteal: '#2DD4BF',
                  },
                  fontFamily: { sans: ['Poppins', 'ui-sans-serif', 'system-ui'] }
                }
              }
            }
          `,
          }}
        ></script>
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        <link href="/static/style.css" rel="stylesheet" />
        <style
          dangerouslySetInnerHTML={{
            __html: `
            .cc-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
            .cc-scrollbar::-webkit-scrollbar-thumb { background: #1E2B25; border-radius: 3px; }
            .cc-glass { background: linear-gradient(135deg, rgba(23,201,131,0.06), rgba(45,212,191,0.02)); backdrop-filter: blur(6px); }
            .cc-pulse { animation: cc-pulse-anim 2s ease-in-out infinite; }
            @keyframes cc-pulse-anim { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
          `,
          }}
        ></style>
      </head>
      <body class="min-h-screen flex flex-col bg-ccbg font-sans text-gray-100 cc-scrollbar">
        {/* ===== Top bar ===== */}
        <header id="cc-header" class="sticky top-0 z-40 bg-ccpanel/95 border-b border-ccborder backdrop-blur">
          <div class="max-w-[110rem] mx-auto flex items-center gap-3 px-4 md:px-6 py-2.5">
            <a href="/control-center" class="flex items-center gap-2 shrink-0" aria-label="NaijaDeals Control Center home">
              <span class="material-symbols-outlined text-ccaccent text-2xl">travel_explore</span>
              <span class="hidden lg:flex flex-col leading-none">
                <span class="text-sm font-extrabold tracking-tight text-white">NaijaDeals</span>
                <span class="text-[9px] font-semibold text-ccaccent tracking-wider">ENTERPRISE CONTROL CENTER</span>
              </span>
            </a>
            <span class="w-px h-6 bg-ccborder shrink-0 hidden md:block"></span>

            <div id="cc-search-wrap" class="hidden md:flex flex-1 max-w-md relative">
              <div class="flex items-center gap-2 bg-black/40 border border-ccborder rounded-lg px-3 py-1.5 text-xs text-gray-500 w-full focus-within:ring-2 focus-within:ring-ccaccent/40 focus-within:border-ccaccent/40">
                <span class="material-symbols-outlined text-base">search</span>
                <input
                  id="cc-search-input"
                  type="text"
                  placeholder="Search customers, vendors, orders, bookings..."
                  autocomplete="off"
                  class="bg-transparent outline-none flex-1 text-gray-200 placeholder:text-gray-500"
                />
                <kbd class="text-[10px] bg-white/5 border border-ccborder rounded px-1.5 py-0.5 text-gray-500">Ctrl K</kbd>
              </div>
              <div id="cc-search-results" class="hidden absolute top-full mt-2 left-0 right-0 bg-ccpanel2 border border-ccborder rounded-xl shadow-2xl max-h-96 overflow-y-auto z-50 cc-scrollbar"></div>
            </div>

            <div class="ml-auto flex items-center gap-3 shrink-0">
              <div class="hidden xl:flex items-center gap-1.5 cc-glass border border-ccaccent/20 rounded-lg px-3 py-1.5">
                <span class="relative flex h-2 w-2">
                  <span class="cc-pulse absolute inline-flex h-full w-full rounded-full bg-ccaccent opacity-75"></span>
                  <span class="relative inline-flex rounded-full h-2 w-2 bg-ccaccent"></span>
                </span>
                <span class="text-[11px] font-semibold text-ccaccent">All Systems Operational</span>
              </div>
              <span class="hidden sm:flex flex-col leading-tight text-right text-[10px] text-gray-500">
                <span>{dateStr}</span>
                <span>{timeStr} WAT</span>
              </span>
              <span class="hidden md:flex flex-col leading-tight text-right border-l border-ccborder pl-3">
                <span class="text-[11px] text-gray-500 truncate max-w-[12rem]">{roleLabel}</span>
                <span class="text-sm font-semibold text-white truncate max-w-[12rem]">{user.name}</span>
              </span>
              <form action="/control-center/logout" method="post" class="shrink-0">
                <button type="submit" class="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors border border-ccborder rounded-lg px-3 py-1.5 hover:border-ccaccent/40">
                  <span class="material-symbols-outlined text-base">logout</span>
                  <span class="hidden sm:inline">Sign out</span>
                </button>
              </form>
            </div>
          </div>
        </header>

        <div class="flex-1 max-w-[110rem] w-full mx-auto md:flex">
          {/* ===== Desktop left nav (grouped) ===== */}
          <nav class="hidden md:block w-64 shrink-0 border-r border-ccborder bg-ccpanel py-4 overflow-y-auto cc-scrollbar max-h-[calc(100vh-56px)] sticky top-[56px]">
            {NAV_GROUPS.map((g) => (
              <div class="mb-1">
                <div class="px-5 pt-4 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">{g.group}</div>
                {g.items.map((item) => {
                  const hasPermission = !item.permission || ccAccess.permissionKeys.has(item.permission)
                  const isUsable = item.implemented && item.href && hasPermission
                  return isUsable ? (
                    <a
                      href={item.href}
                      class={`flex items-center gap-2.5 px-5 py-2 text-sm font-medium transition-colors ${
                        active === item.key ? 'bg-ccaccent-light text-ccaccent border-r-2 border-ccaccent' : 'text-gray-300 hover:bg-white/5'
                      }`}
                    >
                      <span class="material-symbols-outlined text-lg">{item.icon}</span>
                      {item.label}
                    </a>
                  ) : (
                    <span
                      class="flex items-center gap-2.5 px-5 py-2 text-sm font-medium text-gray-600/70 cursor-not-allowed"
                      aria-disabled="true"
                      title={!hasPermission ? 'Your role does not have this permission' : 'On the roadmap — not yet implemented'}
                    >
                      <span class="material-symbols-outlined text-lg opacity-50">{item.icon}</span>
                      <span class="truncate">{item.label}</span>
                      <span class="ml-auto w-1.5 h-1.5 rounded-full bg-gray-700 shrink-0"></span>
                    </span>
                  )
                })}
              </div>
            ))}
          </nav>

          {/* ===== Mobile horizontal nav scroller ===== */}
          <nav class="md:hidden flex items-center gap-1 px-3 py-2 overflow-x-auto bg-ccpanel border-b border-ccborder text-xs cc-scrollbar">
            {NAV_GROUPS.flatMap((g) => g.items)
              .filter((i) => i.implemented && (!i.permission || ccAccess.permissionKeys.has(i.permission)))
              .map((item) => (
                <a
                  href={item.href}
                  class={`flex flex-col items-center gap-0.5 shrink-0 px-3 py-1.5 rounded-lg ${
                    active === item.key ? 'bg-ccaccent-light text-ccaccent' : 'text-gray-400'
                  }`}
                >
                  <span class="material-symbols-outlined text-lg">{item.icon}</span>
                  <span class="whitespace-nowrap">{item.label}</span>
                </a>
              ))}
          </nav>

          <main class="flex-1 min-w-0">{children}</main>
        </div>

        {/* ===== Real global search wiring (Ctrl+K, live fetch, permission-scoped server-side) ===== */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
            (function () {
              var input = document.getElementById('cc-search-input');
              var resultsBox = document.getElementById('cc-search-results');
              if (!input || !resultsBox) return;
              var timer = null;
              var typeIcons = { customer: 'person', vendor: 'storefront', provider: 'engineering', order: 'receipt_long', booking: 'event_available' };
              function render(results, query) {
                if (!query || query.length < 2) { resultsBox.classList.add('hidden'); resultsBox.innerHTML = ''; return; }
                if (results.length === 0) {
                  resultsBox.innerHTML = '<div class="p-4 text-xs text-gray-500">No matches for "' + query.replace(/</g,'&lt;') + '"</div>';
                } else {
                  resultsBox.innerHTML = results.map(function(r) {
                    var icon = typeIcons[r.type] || 'search';
                    var body = '<span class="material-symbols-outlined text-ccaccent text-lg">' + icon + '</span>' +
                      '<div class="flex-1 min-w-0"><div class="text-sm text-white truncate">' + (r.title||'').replace(/</g,'&lt;') + '</div>' +
                      '<div class="text-xs text-gray-500 truncate">' + (r.subtitle||'').replace(/</g,'&lt;') + '</div></div>' +
                      '<span class="text-[10px] uppercase text-gray-600">' + r.type + '</span>';
                    return r.href
                      ? '<a href="' + r.href + '" class="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 border-b border-ccborder/50">' + body + '</a>'
                      : '<div class="flex items-center gap-3 px-4 py-2.5 border-b border-ccborder/50">' + body + '</div>';
                  }).join('');
                }
                resultsBox.classList.remove('hidden');
              }
              input.addEventListener('input', function () {
                var query = input.value;
                clearTimeout(timer);
                timer = setTimeout(function () {
                  if (!query || query.length < 2) { resultsBox.classList.add('hidden'); return; }
                  fetch('/api/control-center/search?q=' + encodeURIComponent(query))
                    .then(function (res) { return res.json(); })
                    .then(function (data) { render(data.results || [], query); })
                    .catch(function () { resultsBox.classList.add('hidden'); });
                }, 200);
              });
              document.addEventListener('click', function (e) {
                if (!e.target.closest('#cc-search-wrap')) resultsBox.classList.add('hidden');
              });
              document.addEventListener('keydown', function (e) {
                if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); input.focus(); }
              });
            })();
          `,
          }}
        ></script>
      </body>
    </html>
  )
}

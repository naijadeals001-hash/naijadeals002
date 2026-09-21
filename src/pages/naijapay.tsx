import type { Context } from 'hono'
import type { AppEnv } from '../types'
import { getNaijaPaySnapshot } from '../lib/naijapay-experience'
import { formatNaira } from '../lib/money'
import { getEcosystemNavLinks } from '../lib/ecosystem-nav'

/**
 * NaijaPay — production wallet rebrand (Phase 1).
 *
 * PROVENANCE: visual language (green/gold African-premium fintech, African
 * continent motif, wallet card, balance panel, transaction list, financial
 * activity chart, ecosystem strip, mobile companion view) matched as closely
 * as technically possible to Pat's supplied reference image. Every FINANCIAL
 * number on this page is real — see src/lib/naijapay-experience.ts's header
 * comment for the exhaustive list of reference-image features that do NOT
 * exist in the backend today (Pending/Reserved/Withdrawable sub-balances,
 * Rewards, Cashback, Cards & Payment Methods, Business/Merchant Wallet,
 * Statements, Limits, Airtime & Bills, Request Money) and are therefore
 * rendered here as explicit <ComingSoon> panels, never as fabricated
 * functional UI — same "never fabricate a capability" rule already
 * enforced for Aura (src/lib/aura-ai/orchestrator.ts).
 *
 * ROUTE STRATEGY (Pat's explicit instruction): lives at /naijapay,
 * independent of the existing /wallet (src/pages/wallet.tsx), which remains
 * untouched. Both read/write the SAME wallet_ledger/wallet_accounts tables
 * via the SAME src/lib/wallet.ts primitives — there is exactly one wallet
 * engine; this is only a second, richer view onto it. /wallet is not
 * replaced until Pat explicitly approves cutover after QA.
 *
 * ACTIONS: "Add Money" reuses the existing real Paystack top-up flow
 * (POST /api/wallet/topup/initialize + /verify — identical backend call
 * wallet.tsx's page already uses). "Send Money" and "Withdraw" have NO
 * backend implementation anywhere in this codebase (no P2P transfer table,
 * no bank-payout table for personal wallets — only sellers/affiliates have
 * payout tables, and those are a different account type entirely) — they
 * render as disabled "Coming Soon" actions, never as buttons that silently
 * no-op or fake a success screen.
 */

function ComingSoonBadge() {
  return (
    <span class="ml-1.5 align-middle text-[9px] font-bold tracking-wide uppercase text-amber-700 bg-amber-100 border border-amber-300 rounded px-1.5 py-0.5">
      Coming Soon
    </span>
  )
}

/** Reusable African-continent glow motif — real public-domain SVG silhouette (see public/static/naijapay/africa-map.svg), recolored via CSS `color`, never a placeholder box. */
function AfricaGlyph({ class: cls = 'w-24 h-24', opacity = 0.9 }: { class?: string; opacity?: number }) {
  return (
    <img
      src="/static/naijapay/africa-map.svg"
      alt=""
      class={cls}
      style={`opacity:${opacity};filter:drop-shadow(0 0 10px rgba(0,135,83,0.55))`}
    />
  )
}

const SIDEBAR_ITEMS: { key: string; label: string; icon: string; href?: string; implemented: boolean }[] = [
  { key: 'overview', label: 'Overview', icon: 'dashboard', href: '/naijapay', implemented: true },
  { key: 'transactions', label: 'Transactions', icon: 'receipt_long', href: '/naijapay#transactions', implemented: true },
  { key: 'send', label: 'Send Money', icon: 'send', implemented: false },
  { key: 'withdraw', label: 'Withdraw', icon: 'account_balance', implemented: false },
  { key: 'add', label: 'Add Money', icon: 'add_circle', implemented: true },
  { key: 'cards', label: 'Cards & Payment Methods', icon: 'credit_card', implemented: false },
  { key: 'rewards', label: 'Rewards', icon: 'redeem', implemented: false },
  { key: 'statements', label: 'Statements', icon: 'description', implemented: false },
  { key: 'security', label: 'Security', icon: 'shield', href: '/account', implemented: true },
  { key: 'limits', label: 'Limits', icon: 'speed', implemented: false },
  { key: 'business', label: 'Business Wallet', icon: 'business_center', implemented: false },
  { key: 'merchant', label: 'Merchant Wallet', icon: 'storefront', implemented: false },
  { key: 'settings', label: 'Settings', icon: 'settings', href: '/account', implemented: true },
]

const ENTRY_ICON: Record<string, string> = {
  topup: 'add_circle',
  order_payment: 'shopping_bag',
  booking_payment: 'calendar_month',
  refund: 'undo',
  payout: 'account_balance_wallet',
  escrow_release: 'lock_open',
}

export async function naijapayPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')!
  const locale = c.get('locale')

  const [snapshot, ecosystemLinks] = await Promise.all([
    getNaijaPaySnapshot(db, user, '30d'),
    getEcosystemNavLinks(db),
  ])

  const firstName = user.name.split(' ')[0]
  const hour = new Date().getUTCHours() + 1 // WAT = UTC+1
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const chartLabels = JSON.stringify(snapshot.money_flow.map((b) => b.date.slice(5))) // MM-DD
  const chartIn = JSON.stringify(snapshot.money_flow.map((b) => Math.round(b.money_in_kobo / 100)))
  const chartOut = JSON.stringify(snapshot.money_flow.map((b) => Math.round(b.money_out_kobo / 100)))

  return c.html(
    <html lang={locale.language} dir={locale.dir}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>NaijaPay — One wallet. Every NaijaDeals experience. | NaijaDeals</title>
        <meta name="description" content="NaijaPay — your real NaijaDeals wallet. Add money, view transactions, track your financial activity across the ecosystem." />
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
                    npDark: '#021F13',
                    npPrimary: '#008753',
                    npPrimaryDark: '#00623C',
                    npGold: '#CCA43B',
                    npIvory: '#F9F8F3',
                  },
                  fontFamily: {
                    sans: ['Inter', 'ui-sans-serif', 'system-ui'],
                    serif: ['Playfair Display', 'ui-serif', 'Georgia', 'serif'],
                  },
                  screens: { dt: '1440px' },
                }
              }
            }
          `,
          }}
        ></script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,600;0,700;1,600&display=swap" rel="stylesheet" />
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <link href="/static/style.css" rel="stylesheet" />
        <link href="/static/naijapay.css" rel="stylesheet" />
      </head>
      <body class="min-h-screen bg-npIvory font-sans text-gray-900 pb-20 md:pb-0" id="naijapay-body">
        <div class="flex flex-col md:flex-row min-h-screen">
          {/* ================= LEFT SIDEBAR ================= */}
          <aside id="np-sidebar" class="hidden md:flex flex-col shrink-0 bg-npDark text-white sticky top-0 h-screen overflow-y-auto md:w-[72px] md:items-center md:py-5 md:px-0 dt:w-[240px] dt:items-stretch dt:py-6 dt:px-4">
            <a href="/" class="flex items-center gap-2 dt:px-2 mb-6 justify-center dt:justify-start" aria-label="NaijaDeals home">
              <AfricaGlyph class="w-7 h-7 object-contain" opacity={1} />
              <span class="hidden dt:block font-serif italic text-[15px] font-bold leading-tight">NaijaPay</span>
            </a>

            <a href="/naijapay" class="flex items-center justify-center dt:justify-start dt:gap-2.5 rounded-xl dt:px-3 py-2.5 mb-5 bg-white/[0.06] border border-npGold/40" title="NaijaPay Wallet">
              <span class="relative flex items-center justify-center w-7 h-7 rounded-full bg-npPrimary/20">
                <span class="material-symbols-outlined text-[16px] text-npGold">account_balance_wallet</span>
              </span>
              <span class="hidden dt:block">
                <span class="block text-[12.5px] font-bold leading-none">NaijaPay Wallet</span>
                <span class="text-[10px] text-npGold">One wallet. Every experience.</span>
              </span>
            </a>

            <nav class="flex flex-col gap-0.5 mb-5 text-[13px] w-full">
              {SIDEBAR_ITEMS.map((item) =>
                item.implemented && item.href ? (
                  <a href={item.href} class="flex items-center justify-center dt:justify-start dt:gap-3 px-0 dt:px-3 py-2 rounded-lg text-gray-200 hover:bg-white/5 hover:text-white transition" title={item.label}>
                    <span class="material-symbols-outlined text-[19px]">{item.icon}</span>
                    <span class="hidden dt:block">{item.label}</span>
                  </a>
                ) : (
                  <span class="flex items-center justify-center dt:justify-between dt:gap-3 px-0 dt:px-3 py-2 rounded-lg text-gray-500 cursor-not-allowed" title={`${item.label} — coming soon`}>
                    <span class="flex items-center dt:gap-3">
                      <span class="material-symbols-outlined text-[19px]">{item.icon}</span>
                      <span class="hidden dt:block">{item.label}</span>
                    </span>
                    <span class="hidden dt:inline-block text-[8.5px] font-bold uppercase tracking-wide bg-white/5 text-gray-400 rounded px-1.5 py-0.5">Soon</span>
                  </span>
                )
              )}
            </nav>

            <div class="hidden dt:block mt-auto bg-white/[0.05] border border-npGold/20 rounded-xl p-4">
              <p class="font-serif italic text-npGold text-[12.5px] leading-snug mb-2">
                &ldquo;A stronger Africa through people, commerce and opportunity.&rdquo;
              </p>
              <div class="flex items-center gap-2">
                <AfricaGlyph class="w-8 h-8 object-contain opacity-80" />
                <span class="text-[10.5px] text-white/50">Build. Trade. Thrive.<br />Across Africa and beyond.</span>
              </div>
            </div>
          </aside>

          {/* ================= MAIN COLUMN ================= */}
          <main class="flex-1 min-w-0">
            {/* ---- Mobile top bar ---- */}
            <div class="md:hidden bg-npDark text-white px-4 pt-5 pb-4 rounded-b-2xl">
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                  <AfricaGlyph class="w-5 h-5 object-contain" opacity={1} />
                  <span class="font-serif italic font-bold text-[15px]">NaijaPay</span>
                </div>
                <a href="/notifications" class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center" aria-label="Notifications">
                  <span class="material-symbols-outlined text-[18px]">notifications</span>
                </a>
              </div>
              <p class="text-[15px] font-bold">{greeting}, {firstName} 👋</p>
              <p class="text-[11px] text-npGold">Ask Aura. Find it. Do it.</p>
            </div>

            <div class="max-w-[1200px] mx-auto px-4 md:px-6 dt:px-8 py-5 dt:py-6">
              {/* ---- Desktop header ---- */}
              <div class="hidden md:flex items-start justify-between mb-5">
                <div>
                  <h1 class="text-[19px] dt:text-[22px] font-bold text-gray-900">{greeting}, {firstName}</h1>
                  <p class="text-[12.5px] text-gray-500">One wallet. Every NaijaDeals experience.</p>
                </div>
                <div class="flex items-center gap-2">
                  <span class="flex items-center gap-1.5 bg-white border border-gray-200 rounded-full px-3 py-1.5 text-[12px] font-semibold text-gray-700">
                    <span class="material-symbols-outlined text-[15px] text-npPrimary">payments</span>
                    NGN
                  </span>
                </div>
              </div>

              {/* ================= PRIMARY WALLET CARD + BALANCE PANEL ================= */}
              <div class="grid dt:grid-cols-[1fr_320px] gap-4 mb-5">
                {/* ---- Wallet card (REAL balance) ---- */}
                <div class="relative overflow-hidden rounded-2xl bg-gradient-to-br from-npPrimaryDark via-npPrimary to-npDark text-white p-5 dt:p-6">
                  <div class="absolute -right-6 -bottom-10 text-npGold" style="width:220px;height:220px">
                    <AfricaGlyph class="w-full h-full object-contain" opacity={0.22} />
                  </div>
                  <div class="relative z-10">
                    <div class="flex items-center justify-between mb-4">
                      <span class="text-[13px] font-bold">NaijaPay Wallet</span>
                      <span class="flex items-center gap-1.5 bg-white/10 border border-npGold/40 rounded-full pl-1 pr-2.5 py-1 text-[10.5px] font-semibold">
                        <AfricaGlyph class="w-3.5 h-3.5" opacity={1} />
                        Africa Pays Together
                      </span>
                    </div>
                    <div class="flex items-center gap-2 mb-1">
                      <span class="text-[12px] text-white/70">Available Balance</span>
                      <button type="button" id="np-toggle-balance-btn" class="text-white/60 hover:text-white" aria-label="Toggle balance visibility">
                        <span class="material-symbols-outlined text-[16px]">visibility</span>
                      </button>
                    </div>
                    <p class="text-[30px] dt:text-[34px] font-bold mb-4" id="np-balance-display" data-real-balance={formatNaira(snapshot.available_balance_kobo)}>
                      {formatNaira(snapshot.available_balance_kobo)}
                    </p>
                    <div class="flex items-center gap-2 mb-4 flex-wrap">
                      <button type="button" id="np-add-money-btn" class="flex items-center gap-1.5 bg-white text-npPrimaryDark font-bold text-[12.5px] rounded-lg px-4 py-2">
                        <span class="material-symbols-outlined text-[16px]">add</span>Add Money
                      </button>
                      <button type="button" disabled class="flex items-center gap-1.5 bg-white/10 text-white/50 font-semibold text-[12.5px] rounded-lg px-4 py-2 cursor-not-allowed" title="Send Money — coming soon">
                        <span class="material-symbols-outlined text-[16px]">send</span>Send Money<ComingSoonBadge />
                      </button>
                      <button type="button" disabled class="flex items-center gap-1.5 bg-white/10 text-white/50 font-semibold text-[12.5px] rounded-lg px-4 py-2 cursor-not-allowed" title="Withdraw — coming soon">
                        <span class="material-symbols-outlined text-[16px]">account_balance</span>Withdraw<ComingSoonBadge />
                      </button>
                    </div>
                    <div class="flex items-center gap-1.5 text-[10.5px] text-white/50">
                      <span class="material-symbols-outlined text-[13px] text-npPrimary bg-white rounded-full">verified</span>
                      Backed by an auditable wallet ledger &middot; NGN
                    </div>
                  </div>
                </div>

                {/* ---- Real wallet info panel (replaces reference's Pending/Reserved/Rewards/Cashback with REAL data) ---- */}
                <div class="bg-white border border-gray-100 rounded-2xl p-4 dt:p-5">
                  <p class="text-[12.5px] font-bold text-gray-800 mb-3">Wallet Information</p>
                  <dl class="space-y-2.5 text-[12.5px]">
                    <div class="flex items-center justify-between">
                      <dt class="flex items-center gap-1.5 text-gray-500"><span class="w-2 h-2 rounded-full bg-npPrimary"></span>Account status</dt>
                      <dd class="font-semibold text-gray-800">Active</dd>
                    </div>
                    <div class="flex items-center justify-between">
                      <dt class="flex items-center gap-1.5 text-gray-500"><span class="w-2 h-2 rounded-full bg-blue-500"></span>Currency</dt>
                      <dd class="font-semibold text-gray-800">Nigerian Naira (NGN)</dd>
                    </div>
                    <div class="flex items-center justify-between">
                      <dt class="flex items-center gap-1.5 text-gray-500"><span class="w-2 h-2 rounded-full bg-purple-500"></span>Total transactions</dt>
                      <dd class="font-semibold text-gray-800">{snapshot.transaction_count.toLocaleString()}</dd>
                    </div>
                    <div class="flex items-center justify-between">
                      <dt class="flex items-center gap-1.5 text-gray-500"><span class="w-2 h-2 rounded-full bg-npGold"></span>Lifetime money in</dt>
                      <dd class="font-semibold text-npPrimary">{formatNaira(snapshot.lifetime_credits_kobo)}</dd>
                    </div>
                    <div class="flex items-center justify-between">
                      <dt class="flex items-center gap-1.5 text-gray-500"><span class="w-2 h-2 rounded-full bg-red-500"></span>Lifetime money out</dt>
                      <dd class="font-semibold text-red-600">{formatNaira(snapshot.lifetime_debits_kobo)}</dd>
                    </div>
                  </dl>
                  <div class="mt-3 pt-3 border-t border-gray-100">
                    <p class="text-[10.5px] text-gray-400 flex items-center gap-1">
                      <span class="material-symbols-outlined text-[13px]">info</span>
                      Rewards, Cashback and Cards are not live yet — see roadmap below.
                    </p>
                  </div>
                </div>
              </div>

              {/* ================= QUICK ACTIONS ================= */}
              <div class="bg-white border border-gray-100 rounded-2xl p-4 mb-5">
                <p class="text-[12.5px] font-bold text-gray-800 mb-3">Quick Actions</p>
                <div class="grid grid-cols-3 dt:grid-cols-6 gap-2.5">
                  <button type="button" id="np-quick-add-btn" class="flex flex-col items-center gap-1.5 bg-npIvory border border-gray-100 rounded-xl p-3 hover:shadow-sm transition">
                    <span class="material-symbols-outlined text-npPrimary text-[20px]">add_circle</span>
                    <span class="text-[11px] font-medium text-gray-700">Top Up</span>
                  </button>
                  <a href="#transactions" class="flex flex-col items-center gap-1.5 bg-npIvory border border-gray-100 rounded-xl p-3 hover:shadow-sm transition">
                    <span class="material-symbols-outlined text-npPrimary text-[20px]">receipt_long</span>
                    <span class="text-[11px] font-medium text-gray-700">History</span>
                  </a>
                  {[
                    { label: 'Send', icon: 'send' },
                    { label: 'Withdraw', icon: 'account_balance' },
                    { label: 'Request', icon: 'request_quote' },
                    { label: 'Airtime & Bills', icon: 'sim_card' },
                  ].map((a) => (
                    <button type="button" disabled class="flex flex-col items-center gap-1.5 bg-gray-50 border border-gray-100 rounded-xl p-3 opacity-60 cursor-not-allowed relative" title={`${a.label} — coming soon`}>
                      <span class="material-symbols-outlined text-gray-400 text-[20px]">{a.icon}</span>
                      <span class="text-[11px] font-medium text-gray-500">{a.label}</span>
                      <span class="absolute top-1 right-1 text-[7px] font-bold uppercase bg-amber-100 text-amber-700 rounded px-1">Soon</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* ================= TRANSACTIONS + FINANCIAL ACTIVITY ================= */}
              <div class="grid dt:grid-cols-[1fr_380px] gap-4 mb-5">
                {/* ---- Recent transactions (REAL wallet_ledger) ---- */}
                <div class="bg-white border border-gray-100 rounded-2xl p-4 dt:p-5" id="transactions">
                  <div class="flex items-center justify-between mb-3">
                    <p class="text-[13px] font-bold text-gray-800">Recent Transactions</p>
                    <a href="/wallet" class="text-[11.5px] font-semibold text-npPrimary">See all</a>
                  </div>
                  {snapshot.recent_transactions.length === 0 ? (
                    <p class="text-sm text-gray-400 text-center py-10">No transactions yet. Add money to get started.</p>
                  ) : (
                    <div class="divide-y divide-gray-100">
                      {snapshot.recent_transactions.slice(0, 8).map((entry) => (
                        <div class="flex items-center justify-between py-2.5">
                          <div class="flex items-center gap-3 min-w-0">
                            <span class={`material-symbols-outlined w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${entry.entry_type === 'credit' ? 'bg-npPrimary/10 text-npPrimary' : 'bg-red-50 text-red-600'}`}>
                              {ENTRY_ICON[entry.reference_type] || (entry.entry_type === 'credit' ? 'south_west' : 'north_east')}
                            </span>
                            <div class="min-w-0">
                              <p class="text-[13px] font-medium text-gray-800 truncate">{entry.description}</p>
                              <p class="text-[11px] text-gray-400">{new Date(entry.created_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                            </div>
                          </div>
                          <p class={`text-[13px] font-bold shrink-0 ${entry.entry_type === 'credit' ? 'text-npPrimary' : 'text-red-600'}`}>
                            {entry.entry_type === 'credit' ? '+' : '-'}{formatNaira(entry.amount_kobo)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ---- Financial Activity chart (REAL money in/out, no fabricated Fees/Refunds series) ---- */}
                <div class="bg-white border border-gray-100 rounded-2xl p-4 dt:p-5">
                  <div class="flex items-center justify-between mb-1">
                    <p class="text-[13px] font-bold text-gray-800">Financial Activity</p>
                    <span class="text-[11px] text-gray-400">Last 30 Days</span>
                  </div>
                  <div class="flex items-center gap-3 mb-2 text-[10.5px] text-gray-500">
                    <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-npPrimary"></span>Money In</span>
                    <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-red-500"></span>Money Out</span>
                  </div>
                  {snapshot.money_flow.length === 0 ? (
                    <p class="text-sm text-gray-400 text-center py-10">No activity in the last 30 days.</p>
                  ) : (
                    <div style="height:180px">
                      <canvas id="np-activity-chart"></canvas>
                    </div>
                  )}
                </div>
              </div>

              {/* ================= AFRICA PROMOTIONAL BANNER (real ecosystem links) ================= */}
              <div class="relative overflow-hidden rounded-2xl bg-gradient-to-r from-npDark via-npPrimaryDark to-npPrimary text-white p-5 dt:p-6 mb-5">
                <div class="absolute right-2 top-1/2 -translate-y-1/2 opacity-15 text-npGold" style="width:180px;height:180px">
                  <AfricaGlyph class="w-full h-full object-contain" opacity={1} />
                </div>
                <div class="relative z-10 max-w-md">
                  <p class="font-serif italic text-npGold text-[20px] dt:text-[24px] leading-tight mb-1">One Africa.<br />More Possibilities.</p>
                  <p class="text-[12px] text-white/70 mb-4">Pay. Earn. Save. Grow. Across Africa and beyond.</p>
                  <a href="/countries" class="inline-flex items-center gap-1.5 bg-npGold text-npDark text-[12px] font-bold rounded-full px-4 py-2">
                    Explore NaijaDeals <span class="material-symbols-outlined text-[15px]">arrow_forward</span>
                  </a>
                </div>
              </div>

              {/* ================= ROADMAP (explicit, never disguised as live) ================= */}
              <div class="bg-white border border-gray-100 rounded-2xl p-4 dt:p-5 mb-5">
                <p class="text-[13px] font-bold text-gray-800 mb-1">Coming to NaijaPay <ComingSoonBadge /></p>
                <p class="text-[11.5px] text-gray-500 mb-3">These are on the roadmap. They are not live yet — we'd rather tell you honestly than fake them.</p>
                <div class="grid sm:grid-cols-2 dt:grid-cols-4 gap-2.5">
                  {[
                    { label: 'Send Money (P2P)', icon: 'send', desc: 'Transfer to other NaijaDeals users' },
                    { label: 'Withdraw to Bank', icon: 'account_balance', desc: 'Cash out to your bank account' },
                    { label: 'Rewards & Cashback', icon: 'redeem', desc: 'Earn points and cashback on spend' },
                    { label: 'Cards & Payment Methods', icon: 'credit_card', desc: 'Save cards for faster checkout' },
                    { label: 'Statements', icon: 'description', desc: 'Downloadable monthly statements' },
                    { label: 'Spending Limits', icon: 'speed', desc: 'Set daily/monthly limits' },
                    { label: 'Business Wallet', icon: 'business_center', desc: 'Separate wallet for your business' },
                    { label: 'Airtime & Bills', icon: 'sim_card', desc: 'Pay airtime, data and bills' },
                  ].map((f) => (
                    <div class="flex items-start gap-2.5 bg-npIvory border border-gray-100 rounded-xl p-3">
                      <span class="material-symbols-outlined text-gray-400 text-[18px] mt-0.5">{f.icon}</span>
                      <div>
                        <p class="text-[11.5px] font-semibold text-gray-700">{f.label}</p>
                        <p class="text-[10px] text-gray-400">{f.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ================= ECOSYSTEM STRIP (real, DB-driven) ================= */}
              <div class="bg-white border border-gray-100 rounded-2xl p-4 dt:p-5 mb-5">
                <div class="flex items-center justify-between mb-1">
                  <p class="text-[13px] font-bold text-gray-800">Explore NaijaDeals with NaijaPay</p>
                  <a href="/" class="hidden dt:flex items-center gap-1 bg-npPrimary text-white text-[11.5px] font-semibold rounded-full px-3.5 py-1.5">Start Exploring <span class="material-symbols-outlined text-[14px]">arrow_forward</span></a>
                </div>
                <p class="text-[11px] text-gray-400 mb-3">Same wallet. Use it across every NaijaDeals service.</p>
                <div class="flex md:grid overflow-x-auto md:overflow-visible no-scrollbar gap-2.5 md:grid-cols-4 dt:grid-cols-8 -mx-1 px-1">
                  {ecosystemLinks.map((link) => (
                    <a href={link.href} class="flex flex-col items-center text-center gap-1.5 bg-npIvory border border-gray-100 rounded-xl p-3 hover:shadow-md hover:-translate-y-0.5 transition shrink-0 w-[84px] md:w-auto">
                      <span class="material-symbols-outlined text-npPrimary text-[22px]">{link.icon}</span>
                      <span class="text-[10.5px] font-semibold text-gray-700">{link.label}</span>
                      {!link.live && <span class="text-[8px] font-bold uppercase text-amber-600">Soon</span>}
                    </a>
                  ))}
                </div>
              </div>

              <p class="text-center text-[11px] text-gray-400 pb-6">From Nigeria to Africa and Beyond &middot; NaijaPay is a NaijaDeals product</p>
            </div>
          </main>
        </div>

        {/* ================= MOBILE BOTTOM NAV ================= */}
        <nav id="np-bottom-nav" class="md:hidden fixed bottom-0 inset-x-0 z-50 bg-white border-t border-gray-200 flex items-stretch" style="padding-bottom: env(safe-area-inset-bottom, 0px);">
          <a href="/" class="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-gray-500">
            <span class="material-symbols-outlined text-[22px]">home</span>
            <span class="text-[10px] font-medium">Home</span>
          </a>
          <a href="/orders" class="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-gray-500">
            <span class="material-symbols-outlined text-[22px]">receipt_long</span>
            <span class="text-[10px] font-medium">Activity</span>
          </a>
          <button type="button" id="np-quick-pay-btn" class="flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 -mt-3">
            <span class="w-12 h-12 rounded-full bg-npPrimary flex items-center justify-center shadow-lg border-4 border-white">
              <span class="material-symbols-outlined text-white text-[22px]">qr_code_scanner</span>
            </span>
            <span class="text-[10px] font-bold text-npPrimary -mt-0.5">Pay</span>
          </button>
          <a href="/naijapay" aria-current="page" class="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-npPrimary">
            <span class="material-symbols-outlined text-[22px]">account_balance_wallet</span>
            <span class="text-[10px] font-bold">Wallet</span>
          </a>
          <a href="/account" class="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-gray-500">
            <span class="material-symbols-outlined text-[22px]">apps</span>
            <span class="text-[10px] font-medium">More</span>
          </a>
        </nav>

        <script
          dangerouslySetInnerHTML={{
            __html: `window.__NAIJAPAY_CHART_DATA__ = { labels: ${chartLabels}, moneyIn: ${chartIn}, moneyOut: ${chartOut} };`,
          }}
        ></script>
        <script src="/static/naijapay.js"></script>
      </body>
    </html>
  )
}

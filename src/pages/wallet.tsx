import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import type { AppEnv } from '../types'
import { getWalletBalance, getWalletHistory } from '../lib/wallet'
import { formatNaira } from '../lib/money'

const QUICK_AMOUNTS_KOBO = [500000, 1000000, 2500000, 5000000] // ₦5,000 / ₦10,000 / ₦25,000 / ₦50,000

export async function walletPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')!
  const locale = c.get('locale')

  const [balance, history] = await Promise.all([
    getWalletBalance(db, user.id),
    getWalletHistory(db, user.id, 30)
  ])

  return c.render(
    <Layout title="Wallet" user={user} locale={locale}>
      <div class="max-w-3xl mx-auto px-6 lg:px-8 py-6">
        <h1 class="text-2xl font-bold text-gray-800 mb-6">NaijaDeals Wallet</h1>

        <div class="bg-gradient-to-br from-primary-dark to-primary text-white rounded-2xl p-6 mb-6">
          <p class="text-white/70 text-sm">Available balance</p>
          <p class="text-3xl font-bold mt-1" id="wallet-balance-display">{formatNaira(balance)}</p>
          <p class="text-white/60 text-xs mt-2 flex items-center gap-1">
            <span class="material-symbols-outlined text-sm">verified_user</span>
            Backed by an auditable transaction ledger
          </p>
        </div>

        <div class="bg-white border border-gray-200 rounded-xl p-5 mb-6">
          <h2 class="font-bold text-gray-800 mb-3">Top up wallet</h2>
          <div id="topup-error" class="hidden bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg mb-3"></div>
          <div class="flex gap-2 flex-wrap mb-3">
            {QUICK_AMOUNTS_KOBO.map((amt) => (
              <button type="button" class="topup-quick-btn text-sm border border-gray-300 rounded-lg px-4 py-2 hover:border-primary hover:bg-primary-light transition" data-amount-kobo={amt}>
                {formatNaira(amt)}
              </button>
            ))}
          </div>
          <div class="flex gap-2">
            <input type="number" id="topup-custom-amount" min="100" placeholder="Custom amount (₦)" class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            <button type="button" id="topup-btn" class="bg-primary text-white font-semibold px-5 py-2 rounded-lg hover:bg-primary-dark transition">
              Top up
            </button>
          </div>
          <p class="text-xs text-gray-400 mt-2">Funded securely via Paystack (card or bank transfer). Minimum ₦100.</p>
        </div>

        <div class="bg-white border border-gray-200 rounded-xl p-5">
          <h2 class="font-bold text-gray-800 mb-3">Transaction history</h2>
          {history.length === 0 ? (
            <p class="text-sm text-gray-400 text-center py-8">No transactions yet.</p>
          ) : (
            <div class="divide-y divide-gray-100">
              {history.map((entry: any) => (
                <div class="flex items-center justify-between py-3">
                  <div class="flex items-center gap-3">
                    <span class={`material-symbols-outlined w-9 h-9 rounded-full flex items-center justify-center ${entry.entry_type === 'credit' ? 'bg-primary-light text-primary' : 'bg-red-50 text-red-600'}`}>
                      {entry.entry_type === 'credit' ? 'south_west' : 'north_east'}
                    </span>
                    <div>
                      <p class="text-sm font-medium text-gray-800">{entry.description}</p>
                      <p class="text-xs text-gray-400">{new Date(entry.created_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                    </div>
                  </div>
                  <p class={`text-sm font-bold ${entry.entry_type === 'credit' ? 'text-primary' : 'text-red-600'}`}>
                    {entry.entry_type === 'credit' ? '+' : '-'}{formatNaira(entry.amount_kobo)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}

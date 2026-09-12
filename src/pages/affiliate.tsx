import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import type { AppEnv } from '../types'
import { formatNaira } from '../lib/money'
import {
  getAffiliateProfileByUserId,
  getPrimaryReferralCode,
  getAffiliateBalance,
  getAffiliateClickStats,
  getAffiliateLedgerHistory,
  getAffiliateCommissions,
  getAffiliatePayouts
} from '../lib/affiliate'

/**
 * /affiliate — the single gateway for the Affiliate program, mirroring the
 * exact 3-state pattern src/pages/seller.tsx already established:
 *
 *   State A — Guest (no session)                    -> landing page
 *   State B — Authenticated, not yet enrolled        -> same landing page,
 *                                                        CTA joins in place (no redirect)
 *   State C — Authenticated, has an affiliate_profiles row -> full dashboard
 *
 * The hero copy/layout in State A/B is reproduced VERBATIM from production's
 * actual observed /affiliate HTML (captured via curl against the live site),
 * not invented: title, H1, body copy, CTA and the 3 feature cards below it.
 */
export async function affiliatePage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')
  const locale = c.get('locale')

  // ---------- State A: Guest ----------
  if (!user) {
    return c.render(
      <Layout title="Become a NaijaDeals Affiliate" user={null} locale={locale} description="One account. One ecosystem. Shop, groceries, food delivery, services, stays, rides, courier and streaming — all in one app, built for Nigeria.">
        <AffiliateHero ctaHref="/login?next=/affiliate" ctaLabel="Join the Affiliate Program" />
      </Layout>
    )
  }

  const profile = await getAffiliateProfileByUserId(db, user.id)

  // ---------- State B: authenticated, not yet enrolled ----------
  if (!profile) {
    return c.render(
      <Layout title="Become a NaijaDeals Affiliate" user={user} locale={locale}>
        <AffiliateHero ctaHref="#" ctaLabel="Join the Affiliate Program" ctaId="affiliate-join-btn" />
      </Layout>
    )
  }

  // ---------- State C: enrolled — full dashboard ----------
  const [referralCode, balanceKobo, stats, ledger, commissions, payouts] = await Promise.all([
    getPrimaryReferralCode(db, profile.id),
    getAffiliateBalance(db, profile.id),
    getAffiliateClickStats(db, profile.id),
    getAffiliateLedgerHistory(db, profile.id, 20),
    getAffiliateCommissions(db, profile.id, 20),
    getAffiliatePayouts(db, profile.id, 10)
  ])

  return c.render(
    <Layout title="Affiliate Dashboard" user={user} locale={locale}>
      <AffiliateDashboard
        profile={profile}
        referralCode={referralCode?.code ?? null}
        balanceKobo={balanceKobo}
        stats={stats}
        ledger={ledger}
        commissions={commissions}
        payouts={payouts}
      />
    </Layout>
  )
}

// ============================================================
// State A/B — Landing hero (verbatim production copy)
// ============================================================
function AffiliateHero({ ctaHref, ctaLabel, ctaId }: { ctaHref: string; ctaLabel: string; ctaId?: string }) {
  const FEATURES = [
    { icon: 'link', text: 'Get a unique referral link in seconds' },
    { icon: 'payments', text: 'Earn real commission on every qualifying order' },
    { icon: 'account_balance_wallet', text: 'Track clicks, referrals and earnings in one dashboard' }
  ]

  return (
    <div class="max-w-3xl mx-auto px-6 lg:px-8 py-10">
      <div class="bg-gradient-to-br from-primary-dark to-primary text-white rounded-2xl p-8 mb-8 text-center">
        <h1 class="text-2xl md:text-3xl font-bold mb-2">Earn commission for every sale you refer</h1>
        <p class="text-white/80 max-w-xl mx-auto mb-6">
          Join the NaijaDeals Affiliate program for free. Get your own referral link, share it, and earn a commission whenever someone you refer completes a purchase.
        </p>
        <a
          href={ctaHref}
          id={ctaId}
          class="inline-block bg-primary-fixed text-primary-dark font-semibold px-6 py-3 rounded-lg hover:opacity-90 transition"
        >
          {ctaLabel}
        </a>
        <div id="affiliate-join-error" class="hidden bg-red-500/20 text-white text-sm px-4 py-2.5 rounded-lg mt-4 max-w-md mx-auto"></div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {FEATURES.map((f) => (
          <div class="bg-white border border-gray-200 rounded-xl p-5 text-center">
            <span class="material-symbols-outlined text-3xl text-primary mb-2 inline-block">{f.icon}</span>
            <p class="text-sm font-medium text-gray-700">{f.text}</p>
          </div>
        ))}
      </div>

      {ctaId && (
        <script
          dangerouslySetInnerHTML={{
            __html: `
              document.getElementById('${ctaId}').addEventListener('click', async function (e) {
                e.preventDefault();
                var btn = e.currentTarget;
                var errorBox = document.getElementById('affiliate-join-error');
                errorBox.classList.add('hidden');
                btn.textContent = 'Joining...';
                try {
                  var res = await fetch('/api/affiliate/me/join', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
                  var data = await res.json();
                  if (!res.ok) throw new Error(data.error || 'Unable to join the affiliate program');
                  window.location.reload();
                } catch (err) {
                  btn.textContent = '${ctaLabel}';
                  errorBox.textContent = err.message || 'Something went wrong. Please try again.';
                  errorBox.classList.remove('hidden');
                }
              });
            `
          }}
        />
      )}
    </div>
  )
}

// ============================================================
// State C — Dashboard
// ============================================================
function AffiliateDashboard({
  profile,
  referralCode,
  balanceKobo,
  stats,
  ledger,
  commissions,
  payouts
}: {
  profile: any
  referralCode: string | null
  balanceKobo: number
  stats: { totalClicks: number; totalAttributions: number; totalConverted: number }
  ledger: any[]
  commissions: any[]
  payouts: any[]
}) {
  const referralLink = referralCode ? `https://naijadeals.com/?ref=${referralCode}` : null

  return (
    <div class="max-w-5xl mx-auto px-6 lg:px-8 py-8">
      <h1 class="text-2xl font-bold text-gray-800 mb-1">Affiliate Dashboard</h1>
      <p class="text-sm text-gray-500 mb-6">Share your link, track referrals, and get paid for every qualifying order.</p>

      {/* Referral link */}
      <div class="bg-gradient-to-br from-primary-dark to-primary text-white rounded-2xl p-6 mb-6">
        <p class="text-white/70 text-sm mb-1">Your referral link</p>
        <div class="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center mt-2">
          <input
            type="text"
            readonly
            value={referralLink ?? ''}
            id="affiliate-referral-link"
            class="flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/50 outline-none"
          />
          <button
            id="affiliate-copy-btn"
            type="button"
            class="bg-primary-fixed text-primary-dark font-semibold px-5 py-2.5 rounded-lg hover:opacity-90 transition shrink-0"
          >
            Copy link
          </button>
        </div>
        <p class="text-white/60 text-xs mt-3">Referral code: <span class="font-mono font-semibold">{referralCode ?? '—'}</span></p>
      </div>

      {/* Stats grid */}
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard icon="payments" label="Available balance" value={formatNaira(balanceKobo)} highlight />
        <StatCard icon="ads_click" label="Total clicks" value={String(stats.totalClicks)} />
        <StatCard icon="how_to_reg" label="Referrals tracked" value={String(stats.totalAttributions)} />
        <StatCard icon="task_alt" label="Converted to sales" value={String(stats.totalConverted)} />
      </div>

      {/* Payout request */}
      <div class="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <div class="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 class="font-bold text-gray-800">Request a payout</h2>
            <p class="text-sm text-gray-500">Minimum payout threshold: {formatNaira(profile.payout_threshold_kobo)}</p>
          </div>
          <button
            id="affiliate-payout-btn"
            type="button"
            class="bg-primary text-white font-semibold px-5 py-2.5 rounded-lg hover:bg-primary-dark transition"
            disabled={balanceKobo < profile.payout_threshold_kobo || balanceKobo <= 0}
          >
            Request payout
          </button>
        </div>
        <div id="affiliate-payout-msg" class="hidden text-sm px-4 py-2.5 rounded-lg mt-3"></div>
      </div>

      {/* Commissions */}
      <div class="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <h2 class="font-bold text-gray-800 mb-3">Recent commissions</h2>
        {commissions.length === 0 ? (
          <p class="text-sm text-gray-400 text-center py-8">No commissions yet — share your referral link to start earning.</p>
        ) : (
          <div class="divide-y divide-gray-100">
            {commissions.map((row: any) => (
              <div class="flex items-center justify-between py-3">
                <div>
                  <p class="text-sm font-medium text-gray-800">Order #{row.order_id}</p>
                  <p class="text-xs text-gray-400">
                    {new Date(row.created_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })} · {row.status}
                  </p>
                </div>
                <p class="text-sm font-bold text-primary">+{formatNaira(row.commission_kobo)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ledger */}
      <div class="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <h2 class="font-bold text-gray-800 mb-3">Ledger history</h2>
        {ledger.length === 0 ? (
          <p class="text-sm text-gray-400 text-center py-8">No ledger entries yet.</p>
        ) : (
          <div class="divide-y divide-gray-100">
            {ledger.map((entry: any) => (
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

      {/* Payout history */}
      <div class="bg-white border border-gray-200 rounded-xl p-5">
        <h2 class="font-bold text-gray-800 mb-3">Payout requests</h2>
        {payouts.length === 0 ? (
          <p class="text-sm text-gray-400 text-center py-8">No payout requests yet.</p>
        ) : (
          <div class="divide-y divide-gray-100">
            {payouts.map((p: any) => (
              <div class="flex items-center justify-between py-3">
                <div>
                  <p class="text-sm font-medium text-gray-800">{formatNaira(p.amount_kobo)}</p>
                  <p class="text-xs text-gray-400">{new Date(p.requested_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                </div>
                <span class={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                  p.status === 'paid' ? 'bg-primary-light text-primary' :
                  p.status === 'rejected' ? 'bg-red-50 text-red-600' :
                  'bg-amber-50 text-amber-700'
                }`}>
                  {p.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <script
        dangerouslySetInnerHTML={{
          __html: `
            document.getElementById('affiliate-copy-btn').addEventListener('click', function () {
              var input = document.getElementById('affiliate-referral-link');
              input.select();
              input.setSelectionRange(0, 99999);
              navigator.clipboard.writeText(input.value).then(function () {
                var btn = document.getElementById('affiliate-copy-btn');
                var original = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(function () { btn.textContent = original; }, 2000);
              });
            });

            var payoutBtn = document.getElementById('affiliate-payout-btn');
            payoutBtn.addEventListener('click', async function () {
              var msg = document.getElementById('affiliate-payout-msg');
              msg.classList.add('hidden');
              payoutBtn.disabled = true;
              payoutBtn.textContent = 'Requesting...';
              try {
                var res = await fetch('/api/affiliate/me/payouts', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
                var data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Unable to request payout');
                window.location.reload();
              } catch (err) {
                payoutBtn.disabled = false;
                payoutBtn.textContent = 'Request payout';
                msg.textContent = err.message || 'Something went wrong. Please try again.';
                msg.className = 'text-sm px-4 py-2.5 rounded-lg mt-3 bg-red-50 text-red-700';
              }
            });
          `
        }}
      />
    </div>
  )
}

function StatCard({ icon, label, value, highlight }: { icon: string; label: string; value: string; highlight?: boolean }) {
  return (
    <div class={`border rounded-xl p-4 ${highlight ? 'bg-primary-light border-primary/20' : 'bg-white border-gray-200'}`}>
      <span class={`material-symbols-outlined text-xl mb-1.5 inline-block ${highlight ? 'text-primary' : 'text-gray-400'}`}>{icon}</span>
      <p class={`text-lg font-bold ${highlight ? 'text-primary' : 'text-gray-800'}`}>{value}</p>
      <p class="text-xs text-gray-500">{label}</p>
    </div>
  )
}

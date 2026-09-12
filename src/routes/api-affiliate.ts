import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth } from '../lib/auth'
import {
  getAffiliateProfileByUserId,
  getPrimaryReferralCode,
  enrollAffiliate,
  getAffiliateBalance,
  getAffiliateLedgerHistory,
  getAffiliateCommissions,
  getAffiliateClickStats,
  getAffiliatePayouts,
  requestAffiliatePayout
} from '../lib/affiliate'

/**
 * /api/affiliate/* — member-only affiliate program API.
 *
 * Path naming deliberately mirrors production's OBSERVED real endpoints
 * (/api/affiliate/me/join, /api/affiliate/me/payouts — confirmed 401-without-auth
 * in docs/NAIJADEALS-LIVE-PRODUCTION-AUDIT.md) rather than an invented shape,
 * extended with the /me/* sibling routes this dashboard needs (profile, stats,
 * ledger, commissions). Every route resolves the affiliate strictly from the
 * AUTHENTICATED user's session (c.get('user').id) — never from a client-supplied
 * affiliate_id — exactly like src/lib/seller.ts's ownership-resolution rule.
 */
export const affiliateApi = new Hono<AppEnv>()

affiliateApi.use('*', requireAuth)

/** Enrolls the current user in the affiliate program (idempotent). */
affiliateApi.post('/me/join', async (c) => {
  const user = c.get('user')!
  const profile = await enrollAffiliate(c.env.DB, user.id, user.name)
  const referralCode = await getPrimaryReferralCode(c.env.DB, profile.id)
  return c.json({ success: true, profile, referral_code: referralCode?.code ?? null })
})

/** Current user's affiliate profile + referral link + balance, or enrolled=false if not yet joined. */
affiliateApi.get('/me', async (c) => {
  const user = c.get('user')!
  const profile = await getAffiliateProfileByUserId(c.env.DB, user.id)
  if (!profile) return c.json({ enrolled: false })

  const referralCode = await getPrimaryReferralCode(c.env.DB, profile.id)
  const balanceKobo = await getAffiliateBalance(c.env.DB, profile.id)
  const stats = await getAffiliateClickStats(c.env.DB, profile.id)

  return c.json({
    enrolled: true,
    profile,
    referral_code: referralCode?.code ?? null,
    balance_kobo: balanceKobo,
    stats
  })
})

/** Ledger history (credits/debits) for the current user's affiliate account. */
affiliateApi.get('/me/ledger', async (c) => {
  const user = c.get('user')!
  const profile = await getAffiliateProfileByUserId(c.env.DB, user.id)
  if (!profile) return c.json({ error: 'Not enrolled in the affiliate program' }, 404)

  const history = await getAffiliateLedgerHistory(c.env.DB, profile.id, 50)
  return c.json({ history })
})

/** Commission records (one per referred order_item) for the current user's affiliate account. */
affiliateApi.get('/me/commissions', async (c) => {
  const user = c.get('user')!
  const profile = await getAffiliateProfileByUserId(c.env.DB, user.id)
  if (!profile) return c.json({ error: 'Not enrolled in the affiliate program' }, 404)

  const commissions = await getAffiliateCommissions(c.env.DB, profile.id, 50)
  return c.json({ commissions })
})

/** Payout history for the current user's affiliate account. */
affiliateApi.get('/me/payouts', async (c) => {
  const user = c.get('user')!
  const profile = await getAffiliateProfileByUserId(c.env.DB, user.id)
  if (!profile) return c.json({ error: 'Not enrolled in the affiliate program' }, 404)

  const payouts = await getAffiliatePayouts(c.env.DB, profile.id, 20)
  return c.json({ payouts })
})

/** Requests a payout of the full available balance. */
affiliateApi.post('/me/payouts', async (c) => {
  const user = c.get('user')!
  const profile = await getAffiliateProfileByUserId(c.env.DB, user.id)
  if (!profile) return c.json({ error: 'Not enrolled in the affiliate program' }, 404)
  if (profile.status !== 'active') return c.json({ error: 'Your affiliate account is not currently active' }, 403)

  try {
    const payout = await requestAffiliatePayout(c.env.DB, profile.id)
    return c.json({ success: true, payout })
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Unable to request payout' }, 400)
  }
})

import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth } from '../lib/auth'
import { getWalletBalance, getWalletHistory, creditWallet } from '../lib/wallet'
import { initializePaystackTransaction, verifyPaystackTransaction } from '../lib/paystack'

export const walletApi = new Hono<AppEnv & { Bindings: AppEnv['Bindings'] & { PAYSTACK_SECRET_KEY?: string } }>()

walletApi.use('*', requireAuth)

walletApi.get('/', async (c) => {
  const user = c.get('user')!
  const balance = await getWalletBalance(c.env.DB, user.id)
  const history = await getWalletHistory(c.env.DB, user.id, 30)
  return c.json({ balance_kobo: balance, history })
})

/** Initiates a wallet top-up via Paystack. The wallet is only credited after verified payment. */
walletApi.post('/topup/initialize', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<{ amount_kobo: number }>().catch(() => null)
  if (!body?.amount_kobo || body.amount_kobo < 10000) {
    return c.json({ error: 'Minimum top-up is ₦100' }, 400)
  }

  const secretKey = c.env.PAYSTACK_SECRET_KEY
  if (!secretKey) return c.json({ error: 'Wallet funding is not configured yet' }, 503)

  const reference = `ND-TOPUP-${user.id}-${Date.now()}`
  await c.env.DB.prepare(
    'INSERT INTO payment_transactions (user_id, provider, provider_reference, amount_kobo, status) VALUES (?, ?, ?, ?, ?)'
  ).bind(user.id, 'paystack', reference, body.amount_kobo, 'initiated').run()

  const origin = new URL(c.req.url).origin
  const init = await initializePaystackTransaction(secretKey, {
    email: user.email ?? `${user.phone}@naijadeals.com`,
    amountKobo: body.amount_kobo,
    reference,
    callbackUrl: `${origin}/wallet?topup_ref=${reference}`
  })

  return c.json({ authorization_url: init.authorization_url, reference })
})

/**
 * Client-side verify callback — exists for immediate UX feedback after the
 * customer returns from Paystack's checkout page. The webhook
 * (api-webhooks.ts) is the AUTHORITATIVE confirmation path; this route can
 * legitimately race it (e.g. the webhook fires while the customer's browser
 * is also calling this route, or the customer double-clicks/retries after a
 * slow network response).
 *
 * CONCURRENCY HARDENING (Engine 7 Phase 2, Unit 3 — same G-2 class as the
 * webhook handler): the prior implementation read `tx.status`, branched on
 * it, then performed an unconditional UPDATE — non-atomic, so this route
 * racing the webhook (or racing itself under a client retry) could both
 * pass the status check while it was still 'initiated' and both credit the
 * wallet. Fixed with the identical CAS claim used in api-webhooks.ts:
 * `UPDATE ... WHERE id = ? AND status = 'initiated'`, checking rows_written.
 * Only the winner credits; the loser (this route losing to a concurrent
 * webhook delivery, or a retried client call losing to its own earlier
 * successful call) returns `already_processed: true` without re-crediting.
 */
walletApi.post('/topup/verify', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<{ reference: string }>().catch(() => null)
  if (!body?.reference) return c.json({ error: 'reference required' }, 400)

  const secretKey = c.env.PAYSTACK_SECRET_KEY
  if (!secretKey) return c.json({ error: 'Payments not configured' }, 503)

  const tx = await c.env.DB.prepare(
    "SELECT * FROM payment_transactions WHERE provider_reference = ? AND user_id = ?"
  ).bind(body.reference, user.id).first<any>()
  if (!tx) return c.json({ error: 'Transaction not found' }, 404)
  if (tx.status === 'success') return c.json({ success: true, already_processed: true })

  const verified = await verifyPaystackTransaction(secretKey, body.reference)
  if (verified.status !== 'success') {
    return c.json({ success: false, status: verified.status })
  }

  // CAS claim (G-2 fix) — only the ONE caller that finds status still
  // 'initiated' proceeds to credit. A concurrent webhook delivery or a
  // duplicate client call for the same reference loses the claim here.
  const claim = await c.env.DB.prepare("UPDATE payment_transactions SET status = 'success', raw_payload = ? WHERE id = ? AND status = 'initiated'")
    .bind(JSON.stringify(verified), tx.id)
    .run()
  if ((claim.meta.rows_written ?? 0) === 0) {
    // Lost the race — a concurrent webhook delivery (or a duplicate call to
    // this same route) already claimed and credited this reference. Never
    // fabricate a second success by re-crediting; report the true state.
    return c.json({ success: true, already_processed: true })
  }

  await creditWallet(c.env.DB, user.id, tx.amount_kobo, 'topup', body.reference, 'Wallet top-up via Paystack')

  return c.json({ success: true })
})

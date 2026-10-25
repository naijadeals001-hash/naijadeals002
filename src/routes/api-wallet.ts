import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth } from '../lib/auth'
import { getWalletBalance, getWalletHistory, creditWallet } from '../lib/wallet'
import { initializePaystackTransaction, verifyPaystackTransaction } from '../lib/paystack'
import { createPaymentIntent, IdempotencyConflictError } from '../lib/payment-engine'
import { assertVerticalTransactionAllowed, RolloutGuardError } from '../lib/control-center-rollout'

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

  try {
    await assertVerticalTransactionAllowed(c.env.DB, 'ecosystem.naijapay', 'NG')
  } catch (err) {
    if (err instanceof RolloutGuardError) return c.json({ error: err.message, code: err.code }, err.status as any)
    throw err
  }

  const secretKey = c.env.PAYSTACK_SECRET_KEY
  if (!secretKey) return c.json({ error: 'Wallet funding is not configured yet' }, 503)

  const idempotencyKey = c.req.header('Idempotency-Key')?.trim()
  if (!idempotencyKey) return c.json({ error: 'Idempotency-Key header is required for wallet funding' }, 400)

  let intent
  try {
    intent = await createPaymentIntent(c.env.DB, {
      idempotencyKey,
      userId: user.id,
      verticalKey: 'ecosystem.naijapay',
      countryIso: 'NG',
      currency: 'NGN',
      amountMinor: body.amount_kobo,
      fundingMethod: 'paystack',
      lineItems: [{ code: 'wallet_topup', description: 'NaijaPay wallet funding', amountMinor: body.amount_kobo }],
    })
  } catch (error) {
    if (error instanceof IdempotencyConflictError) return c.json({ error: error.message, code: 'IDEMPOTENCY_CONFLICT' }, 409)
    throw error
  }

  const reference = intent.intent.transactionReference
  const existing = await c.env.DB.prepare('SELECT provider_reference FROM payment_transactions WHERE intent_id = ?').bind(intent.intent.id).first<{ provider_reference: string }>()
  if (existing) return c.json({ reference: existing.provider_reference, transaction_reference: reference, already_initialized: true }, 200)

  await c.env.DB.prepare(
    'INSERT INTO payment_transactions (user_id, provider, provider_reference, amount_kobo, status, currency, idempotency_key, transaction_reference, intent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.id, 'paystack', reference, body.amount_kobo, 'initiated', 'NGN', idempotencyKey, reference, intent.intent.id).run()
  await c.env.DB.prepare("UPDATE payment_intents SET status = 'pending', updated_at = datetime('now') WHERE id = ? AND status = 'created'").bind(intent.intent.id).run()

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

import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { verifyPaystackWebhookSignature } from '../lib/paystack'
import { confirmOrderPayment } from '../lib/orders'
import { creditWallet } from '../lib/wallet'

export const webhooksApi = new Hono<AppEnv & { Bindings: AppEnv['Bindings'] & { PAYSTACK_SECRET_KEY?: string } }>()

/**
 * Paystack webhook — the AUTHORITATIVE source of payment confirmation.
 * The client-side verify-payment/topup-verify routes exist for immediate UX feedback,
 * but this webhook is what we'd rely on if the user closes the tab mid-flow.
 *
 * CONCURRENCY HARDENING (Engine 7 Phase 2, Unit 3 — G-2 + F-1, see
 * docs/ENGINE-7-PAYMENT-FINANCE-AUDIT.md §5 and
 * docs/ENGINE-7-PHASE-2-FORENSIC-REVIEW.md §D for the original findings):
 *
 * G-2 FIX: the prior implementation read `tx.status`, branched on it in
 * application code, then performed an UNCONDITIONAL `UPDATE ... WHERE id = ?`
 * — the exact TOCTOU shape Booking Invariant 9 fixed for bookings, left
 * unfixed here. Paystack retries webhook delivery on any non-2xx/timeout
 * response, and nothing prevents two deliveries for the SAME reference from
 * being in flight concurrently (e.g. a slow first request that Paystack
 * gives up on and retries before the first one finishes). Two concurrent
 * deliveries could both pass the `tx.status === 'success'` check while it
 * was still 'initiated', both perform the unconditional UPDATE, and BOTH
 * proceed to call creditWallet()/confirmOrderPayment() — a double credit /
 * double order-confirmation from a single underlying charge.
 *
 * FIX: the UPDATE is now a CAS claim (`WHERE id = ? AND status = 'initiated'`,
 * checking rows_written) — the exact "claim before you touch the money"
 * pattern already proven in payForBooking()/resolveDispute() (Booking
 * Invariant 9), reused here as a precedent for the SAME transaction-row
 * shape it was designed for (not the wallet's numeric-CAS adaptation from
 * Unit 2 — this row has a real finite status enum, so the enum-CAS pattern
 * applies directly, unmodified). Only the ONE delivery that wins the claim
 * proceeds to credit the wallet / confirm the order; every other concurrent
 * or retried delivery for the same reference sees rows_written === 0 and
 * returns 200 OK without re-running any financial side effect — still
 * idempotent from Paystack's perspective (retries must get 200, or Paystack
 * keeps retrying forever), but now genuinely idempotent under real
 * concurrency, not just under sequential re-delivery.
 *
 * F-1 FIX: the prior implementation credited the wallet using
 * `event.data.amount` — a value taken directly from the (signature-verified,
 * but still webhook-payload-controlled) event body — without ever comparing
 * it to the amount actually recorded in `payment_transactions.amount_kobo`
 * when the transaction was initiated server-side (the trusted value: it was
 * written by OUR OWN code in /topup/initialize or the checkout route, before
 * the customer ever reached Paystack). A malformed or unexpected payload
 * shape could in principle cause a mismatch between what was charged and
 * what gets credited. FIX: the webhook now (a) cross-checks
 * `event.data.amount === tx.amount_kobo` and rejects (never credits, still
 * returns 200 so Paystack doesn't retry a payload it can't fix by retrying)
 * on any mismatch, logging the discrepancy for investigation, and (b) credits
 * the wallet using `tx.amount_kobo` (the trusted, server-recorded value),
 * never the raw event payload's amount — mirroring exactly how
 * /topup/verify and /verify-payment already only ever act on `tx.*` fields
 * for the order-payment path. A defensive currency check is also added:
 * Paystack's `event.data.currency` is compared against `'NGN'` (the only
 * currency this codebase's payment/wallet code ever computes in — see
 * Phase 1 audit Finding E-5) and any other value is rejected the same way.
 */
webhooksApi.post('/paystack', async (c) => {
  const secretKey = c.env.PAYSTACK_SECRET_KEY
  if (!secretKey) return c.text('Not configured', 503)

  const rawBody = await c.req.text()
  const signature = c.req.header('x-paystack-signature')
  const valid = await verifyPaystackWebhookSignature(secretKey, rawBody, signature ?? null)
  if (!valid) return c.text('Invalid signature', 401)

  const event = JSON.parse(rawBody)
  if (event.event !== 'charge.success') return c.text('OK', 200) // ignore other event types

  const reference: string = event.data.reference
  const eventAmountKobo: number = event.data.amount
  const eventCurrency: string | undefined = event.data.currency

  const tx = await c.env.DB.prepare('SELECT * FROM payment_transactions WHERE provider_reference = ?')
    .bind(reference)
    .first<any>()
  if (!tx) return c.text('OK', 200) // unknown reference, nothing to do
  if (tx.status === 'success') return c.text('OK', 200) // already processed — idempotent (fast path, avoids a wasted claim attempt on the common re-delivery case)

  // F-1: never trust the webhook payload's amount/currency over what THIS
  // server recorded when the transaction was initiated. Reject (without
  // crediting, without erroring back to Paystack) on any mismatch.
  if (eventAmountKobo !== tx.amount_kobo) {
    console.error(
      `Paystack webhook amount mismatch for reference ${reference}: event says ${eventAmountKobo} kobo, payment_transactions recorded ${tx.amount_kobo} kobo. Rejecting — no credit/confirmation performed.`
    )
    return c.text('OK', 200)
  }
  if (eventCurrency && eventCurrency !== 'NGN') {
    console.error(`Paystack webhook currency mismatch for reference ${reference}: event says ${eventCurrency}, this codebase only computes NGN. Rejecting.`)
    return c.text('OK', 200)
  }

  // G-2: CAS claim — only the ONE concurrent/retried delivery that finds
  // status still 'initiated' proceeds. Every other one (duplicate delivery,
  // retry racing the first attempt) loses the claim and returns 200 without
  // re-crediting/re-confirming anything.
  const claim = await c.env.DB.prepare("UPDATE payment_transactions SET status = 'success', raw_payload = ? WHERE id = ? AND status = 'initiated'")
    .bind(rawBody, tx.id)
    .run()
  if ((claim.meta.rows_written ?? 0) === 0) {
    // Lost the race (or the status changed between our read and this claim
    // for any other reason, e.g. a status other than 'initiated'/'success'
    // that this codebase doesn't currently write but could in the future) —
    // another delivery already handled (or is handling) this reference.
    // Never re-run the financial side effect. Still 200 so Paystack doesn't
    // keep retrying a reference that has genuinely already been dealt with.
    return c.text('OK', 200)
  }

  if (tx.order_id) {
    await confirmOrderPayment(c.env.DB, tx.order_id, 'paystack', reference)
  } else {
    // No order_id means this was a wallet top-up transaction. Credit the
    // TRUSTED, server-recorded amount (tx.amount_kobo) — already verified
    // above to match the event payload, but tx.amount_kobo is what we
    // actually promised to charge, so it is the correct value to credit
    // even in the (should-be-impossible, now-rejected-above) case they
    // ever diverged.
    await creditWallet(c.env.DB, tx.user_id, tx.amount_kobo, 'topup', reference, 'Wallet top-up via Paystack (webhook)')
  }

  return c.text('OK', 200)
})

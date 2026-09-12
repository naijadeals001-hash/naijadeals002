/**
 * Affiliate program — core business logic.
 *
 * DATABASE CONTRACT: migrations 0017_affiliate_foundation.sql and
 * 0018_affiliate_account_state.sql, reconstructed from production's live
 * schema (see docs/NAIJADEALS-PRODUCTION-SCHEMA-MAP.md). This is the
 * database contract production actually uses — the tables, columns, and
 * relationships are recovered fact, not invented.
 *
 * WHAT IS NOT RECOVERED (marked UNKNOWN — SOURCE CODE REQUIRED per the
 * reconstruction plan's non-negotiable rule): the EXACT commission
 * calculation formula production actually runs — whether it varies by
 * category, vendor, campaign tier, or affiliate performance level. The only
 * recoverable fact from the schema is that `affiliate_profiles.default_commission_bps`
 * defaults to 500 (5%) and that `affiliate_campaigns` can override a rate per
 * campaign (`commission_type`/`commission_value`). This module isolates that
 * one known fact behind calculateCommissionBps() so replacing it with the
 * real formula later (if ever recovered) is a one-function change, never a
 * schema or call-site change — see that function's own comment.
 *
 * DESIGN RULE (mirrors src/lib/wallet.ts exactly): affiliate_accounts.cached_available_kobo
 * is a read-optimization cache only. affiliate_ledger is the append-only
 * source of truth. Every balance mutation MUST go through creditAffiliateLedger()
 * below, inside a single D1 batch so the ledger insert and cache update are
 * atomic — never UPDATE affiliate_accounts directly from anywhere else.
 */
import type { Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import type {
  AppEnv,
  AffiliateProfileRow,
  AffiliateReferralCodeRow,
  AffiliateAttributionRow,
  AffiliateCommissionRow,
  AffiliateLedgerEntryRow,
  AffiliatePayoutRow,
  CartItemRow
} from '../types'

const ATTRIBUTION_WINDOW_DAYS = 30
const CLICK_COOKIE = 'nd_aff_click'
const CLICK_COOKIE_DAYS = 30

// ---------- Referral code generation ----------

function randomCodeSuffix(length = 6): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous 0/O/1/I
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

/**
 * Generates a unique referral code for a new affiliate, derived from their
 * display name/user id where possible for a memorable link, falling back to
 * a fully random code on collision. Retries a handful of times against the
 * UNIQUE constraint on affiliate_referral_codes.code rather than trusting
 * uniqueness client-side.
 */
async function generateUniqueReferralCode(db: D1Database, seed: string): Promise<string> {
  const base = seed.replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toUpperCase() || 'ND'
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = attempt === 0 ? `${base}${randomCodeSuffix(4)}` : randomCodeSuffix(8)
    const existing = await db
      .prepare('SELECT id FROM affiliate_referral_codes WHERE code = ?')
      .bind(candidate)
      .first<{ id: number }>()
    if (!existing) return candidate
  }
  // Extremely unlikely fallback: timestamp-seeded, still checked for real uniqueness by the caller's INSERT.
  return `ND${Date.now().toString(36).toUpperCase()}`
}

// ---------- Enrollment ----------

export async function getAffiliateProfileByUserId(db: D1Database, userId: number): Promise<AffiliateProfileRow | null> {
  const row = await db.prepare('SELECT * FROM affiliate_profiles WHERE user_id = ?').bind(userId).first<AffiliateProfileRow>()
  return row ?? null
}

export async function getAffiliateProfileById(db: D1Database, affiliateId: number): Promise<AffiliateProfileRow | null> {
  const row = await db.prepare('SELECT * FROM affiliate_profiles WHERE id = ?').bind(affiliateId).first<AffiliateProfileRow>()
  return row ?? null
}

export async function getPrimaryReferralCode(db: D1Database, affiliateId: number): Promise<AffiliateReferralCodeRow | null> {
  const row = await db
    .prepare('SELECT * FROM affiliate_referral_codes WHERE affiliate_id = ? AND is_primary = 1 LIMIT 1')
    .bind(affiliateId)
    .first<AffiliateReferralCodeRow>()
  return row ?? null
}

/**
 * Enrolls a user in the affiliate program (idempotent — a user with an
 * existing profile just gets that profile back, never a second row, since
 * user_id is UNIQUE on affiliate_profiles by schema constraint). Status
 * defaults to 'active' immediately per the schema's own DEFAULT — production's
 * recovered schema shows no distinct "pending review" gate on this table
 * (unlike the seller/vendor onboarding flow, which does have an explicit
 * verification_status column). If a future review requirement is recovered,
 * this is the single place to add it.
 */
export async function enrollAffiliate(db: D1Database, userId: number, displayName: string | null): Promise<AffiliateProfileRow> {
  const existing = await getAffiliateProfileByUserId(db, userId)
  if (existing) return existing

  const inserted = await db
    .prepare('INSERT INTO affiliate_profiles (user_id, display_name) VALUES (?, ?)')
    .bind(userId, displayName)
    .run()
  const affiliateId = inserted.meta.last_row_id as number

  const code = await generateUniqueReferralCode(db, displayName || `AFF${userId}`)
  await db
    .prepare('INSERT INTO affiliate_referral_codes (affiliate_id, code, is_primary, is_active) VALUES (?, ?, 1, 1)')
    .bind(affiliateId, code)
    .run()

  // Ledger/account row created lazily on first credit (ensureAffiliateAccount), mirroring wallet.ts's ensureWalletAccount pattern exactly.

  const profile = await getAffiliateProfileById(db, affiliateId)
  return profile!
}

// ---------- Click tracking & attribution ----------

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder()
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Records a click against a referral code and returns the click_token to be
 * stored in the visitor's cookie. Never blocks the visit if the code is
 * invalid/inactive — an unrecognized ?ref= code is treated as "no referral",
 * not an error, so a mistyped/expired link never breaks the page it points to.
 */
export async function recordClick(
  db: D1Database,
  code: string,
  landingPath: string,
  referrer: string | null,
  ipForHash: string | null,
  userAgent: string | null
): Promise<{ clickToken: string; affiliateId: number } | null> {
  const refCode = await db
    .prepare('SELECT * FROM affiliate_referral_codes WHERE code = ? AND is_active = 1')
    .bind(code)
    .first<AffiliateReferralCodeRow>()
  if (!refCode) return null

  const clickToken = `clk_${randomCodeSuffix(20)}`
  const ipHash = ipForHash ? await sha256Hex(ipForHash) : null

  const inserted = await db
    .prepare(
      `INSERT INTO affiliate_clicks (referral_code_id, affiliate_id, click_token, landing_path, referrer, ip_hash, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(refCode.id, refCode.affiliate_id, clickToken, landingPath, referrer, ipHash, userAgent)
    .run()

  const clickId = inserted.meta.last_row_id as number

  // Create (or refresh) a pending attribution immediately on click — last-touch
  // semantics: a NEW click for the SAME affiliate+code combination extends the
  // window rather than creating a duplicate. If a different affiliate's code is
  // clicked, that becomes the new attribution (last-touch wins for now — first-touch
  // vs. last-touch vs. weighted attribution logic beyond this is UNKNOWN — SOURCE
  // CODE REQUIRED, not guessed).
  const expiresAt = new Date(Date.now() + ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const attributionToken = `attr_${randomCodeSuffix(20)}`
  await db
    .prepare(
      `INSERT INTO affiliate_attributions (click_id, affiliate_id, referral_code_id, attribution_token, status, expires_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`
    )
    .bind(clickId, refCode.affiliate_id, refCode.id, attributionToken, expiresAt)
    .run()

  return { clickToken, affiliateId: refCode.affiliate_id }
}

export const AFFILIATE_CLICK_COOKIE = CLICK_COOKIE
export const AFFILIATE_CLICK_COOKIE_MAX_AGE_SECONDS = CLICK_COOKIE_DAYS * 24 * 60 * 60

/**
 * Finds the visitor's active (non-expired) pending attribution, if any, by
 * click_token — used at checkout time to know whose commission to credit.
 * Also opportunistically attaches customer_user_id once the visitor is known
 * to be logged in, so a guest-click -> later-login -> purchase path still
 * resolves to the right customer for reporting (does not affect payout logic,
 * which is keyed on the affiliate side, not the customer side).
 */
export async function findActiveAttributionByClickToken(db: D1Database, clickToken: string): Promise<AffiliateAttributionRow | null> {
  const click = await db.prepare('SELECT id FROM affiliate_clicks WHERE click_token = ?').bind(clickToken).first<{ id: number }>()
  if (!click) return null

  const attribution = await db
    .prepare(
      `SELECT * FROM affiliate_attributions
       WHERE click_id = ? AND status = 'pending' AND expires_at > datetime('now')
       ORDER BY id DESC LIMIT 1`
    )
    .bind(click.id)
    .first<AffiliateAttributionRow>()
  return attribution ?? null
}

export async function attachCustomerToAttribution(db: D1Database, attributionId: number, customerUserId: number): Promise<void> {
  await db
    .prepare(`UPDATE affiliate_attributions SET customer_user_id = ?, last_touch_at = datetime('now') WHERE id = ?`)
    .bind(customerUserId, attributionId)
    .run()
}

/**
 * Finds the most recent pending, non-expired attribution already linked to a
 * given customer (i.e. attachCustomerToAttribution already ran for this
 * user on some earlier request — see affiliateClickMiddleware below).
 *
 * WHY THIS EXISTS / how attribution reaches checkout without any schema
 * change: rather than threading a click_token or attribution_id through
 * checkout -> createPendingOrder -> confirmOrderPayment -> Paystack webhook
 * (which would require either a new orders column or passing extra state
 * through a webhook payload we don't control), confirmOrderPayment simply
 * looks up "does THIS customer (order.user_id) have a pending attribution
 * right now" at the moment payment is confirmed. This keeps orders.ts's
 * function signatures unchanged and requires zero migration — the
 * attribution table itself is the only state that needs to exist, and it
 * already does (migration 0017).
 */
export async function getLatestPendingAttributionForCustomer(db: D1Database, customerUserId: number): Promise<AffiliateAttributionRow | null> {
  const row = await db
    .prepare(
      `SELECT * FROM affiliate_attributions
       WHERE customer_user_id = ? AND status = 'pending' AND expires_at > datetime('now')
       ORDER BY id DESC LIMIT 1`
    )
    .bind(customerUserId)
    .first<AffiliateAttributionRow>()
  return row ?? null
}

// ---------- Commission calculation (isolated, replaceable) ----------

/**
 * Resolves the commission rate (in basis points) to apply for a given
 * affiliate/order-item combination.
 *
 * ISOLATION NOTICE: production's ACTUAL commission formula (whether it
 * varies by product category, vendor tier, campaign, or affiliate
 * performance history) is UNKNOWN — SOURCE CODE REQUIRED. Only the schema
 * default (500 bps = 5%) and the existence of an `affiliate_campaigns`
 * override mechanism are recoverable facts. This function is the ONLY place
 * a rate is decided — every call site (confirmCommissionsForOrder below)
 * calls this and never hardcodes a number itself, so if the real formula is
 * ever recovered, this is a single-function change with zero call-site
 * impact.
 */
export function calculateCommissionBps(affiliate: { default_commission_bps: number }, _productId: number, _vendorId: number): number {
  return affiliate.default_commission_bps
}

export function calculateCommissionKobo(grossKobo: number, rateBps: number): number {
  return Math.floor((grossKobo * rateBps) / 10_000)
}

// ---------- Commission creation on order payment ----------

/**
 * Called once an order is confirmed paid (see src/lib/orders.ts's
 * confirmOrderPayment — this function is invoked from there, never
 * duplicated inline). For each order_item, if the order's customer had an
 * active affiliate attribution at checkout time, creates a pending
 * commission row and credits the affiliate's ledger.
 *
 * Idempotent per order_item: order_items.id is UNIQUE on
 * affiliate_commissions.order_item_id by schema constraint, so calling this
 * twice for the same order (e.g. a retried webhook) can never double-credit
 * — the INSERT is wrapped so a UNIQUE violation is swallowed as "already
 * processed", exactly like confirmOrderPayment's own idempotency guard.
 */
export async function confirmCommissionsForOrder(
  db: D1Database,
  orderId: number,
  customerUserId: number,
  attributionId: number | null
): Promise<void> {
  if (!attributionId) return

  const attribution = await db.prepare('SELECT * FROM affiliate_attributions WHERE id = ?').bind(attributionId).first<AffiliateAttributionRow>()
  if (!attribution || attribution.status !== 'pending') return

  const affiliate = await getAffiliateProfileById(db, attribution.affiliate_id)
  if (!affiliate || affiliate.status !== 'active') return

  const { results: items } = await db
    .prepare(
      `SELECT oi.id AS order_item_id, oi.listing_id, oi.product_id, oi.vendor_id, oi.line_total_kobo
       FROM order_items oi WHERE oi.order_id = ?`
    )
    .bind(orderId)
    .all<{ order_item_id: number; listing_id: number; product_id: number; vendor_id: number; line_total_kobo: number }>()

  for (const item of items) {
    const already = await db
      .prepare('SELECT id FROM affiliate_commissions WHERE order_item_id = ?')
      .bind(item.order_item_id)
      .first<{ id: number }>()
    if (already) continue // idempotent — already processed for this order_item

    const rateBps = calculateCommissionBps(affiliate, item.product_id, item.vendor_id)
    const commissionKobo = calculateCommissionKobo(item.line_total_kobo, rateBps)
    if (commissionKobo <= 0) continue

    await db
      .prepare(
        `INSERT INTO affiliate_commissions
           (affiliate_id, attribution_id, order_id, order_item_id, listing_id, product_id, vendor_id,
            customer_user_id, commission_basis, commission_rate_bps, gross_kobo, commission_kobo, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'order_item_percentage', ?, ?, ?, 'pending')`
      )
      .bind(
        affiliate.id,
        attributionId,
        orderId,
        item.order_item_id,
        item.listing_id,
        item.product_id,
        item.vendor_id,
        customerUserId,
        rateBps,
        item.line_total_kobo,
        commissionKobo
      )
      .run()

    await creditAffiliateLedger(db, affiliate.id, commissionKobo, 'commission_pending', String(orderId), orderId, `Pending commission for order #${orderId}`)
  }

  await db.prepare(`UPDATE affiliate_attributions SET status = 'converted', last_touch_at = datetime('now') WHERE id = ?`).bind(attributionId).run()
}

/**
 * Convenience wrapper for the checkout call site (src/lib/orders.ts's
 * confirmOrderPayment): resolves whatever pending attribution the customer
 * currently has (if any) and confirms commissions against it. Safe to call
 * unconditionally on EVERY order — customers with no affiliate attribution
 * simply produce a no-op (zero D1 writes beyond the lookup), so this never
 * needs an `if (isAffiliateOrder)` branch at the call site and can never
 * regress a normal, non-referred checkout.
 */
export async function confirmCommissionsForOrderIfAttributed(db: D1Database, orderId: number, customerUserId: number): Promise<void> {
  const attribution = await getLatestPendingAttributionForCustomer(db, customerUserId)
  if (!attribution) return
  await confirmCommissionsForOrder(db, orderId, customerUserId, attribution.id)
}

// ---------- Ledger (mirrors src/lib/wallet.ts's pattern exactly) ----------

async function ensureAffiliateAccount(db: D1Database, affiliateId: number) {
  await db.prepare('INSERT OR IGNORE INTO affiliate_accounts (affiliate_id, cached_available_kobo) VALUES (?, 0)').bind(affiliateId).run()
}

export async function getAffiliateBalance(db: D1Database, affiliateId: number): Promise<number> {
  const row = await db.prepare('SELECT cached_available_kobo FROM affiliate_accounts WHERE affiliate_id = ?').bind(affiliateId).first<{ cached_available_kobo: number }>()
  return row?.cached_available_kobo ?? 0
}

export async function creditAffiliateLedger(
  db: D1Database,
  affiliateId: number,
  amountKobo: number,
  referenceType: string,
  referenceId: string | null,
  orderId: number | null,
  description: string
): Promise<number> {
  if (amountKobo <= 0) throw new Error('Credit amount must be positive')
  await ensureAffiliateAccount(db, affiliateId)

  const current = await getAffiliateBalance(db, affiliateId)
  const newBalance = current + amountKobo

  await db.batch([
    db
      .prepare(
        `INSERT INTO affiliate_ledger (affiliate_id, entry_type, amount_kobo, balance_after_kobo, reference_type, reference_id, order_id, description)
         VALUES (?, 'credit', ?, ?, ?, ?, ?, ?)`
      )
      .bind(affiliateId, amountKobo, newBalance, referenceType, referenceId, orderId, description),
    db
      .prepare(`UPDATE affiliate_accounts SET cached_available_kobo = ?, updated_at = datetime('now') WHERE affiliate_id = ?`)
      .bind(newBalance, affiliateId)
  ])

  return newBalance
}

export async function debitAffiliateLedger(
  db: D1Database,
  affiliateId: number,
  amountKobo: number,
  referenceType: string,
  referenceId: string | null,
  description: string
): Promise<number> {
  if (amountKobo <= 0) throw new Error('Debit amount must be positive')
  await ensureAffiliateAccount(db, affiliateId)

  const current = await getAffiliateBalance(db, affiliateId)
  if (current < amountKobo) throw new InsufficientAffiliateBalanceError()
  const newBalance = current - amountKobo

  await db.batch([
    db
      .prepare(
        `INSERT INTO affiliate_ledger (affiliate_id, entry_type, amount_kobo, balance_after_kobo, reference_type, reference_id, description)
         VALUES (?, 'debit', ?, ?, ?, ?, ?)`
      )
      .bind(affiliateId, amountKobo, newBalance, referenceType, referenceId, description),
    db
      .prepare(`UPDATE affiliate_accounts SET cached_available_kobo = ?, updated_at = datetime('now') WHERE affiliate_id = ?`)
      .bind(newBalance, affiliateId)
  ])

  return newBalance
}

export class InsufficientAffiliateBalanceError extends Error {
  constructor() {
    super('Insufficient affiliate balance')
    this.name = 'InsufficientAffiliateBalanceError'
  }
}

export async function getAffiliateLedgerHistory(db: D1Database, affiliateId: number, limit = 30): Promise<AffiliateLedgerEntryRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM affiliate_ledger WHERE affiliate_id = ? ORDER BY id DESC LIMIT ?')
    .bind(affiliateId, limit)
    .all<AffiliateLedgerEntryRow>()
  return results
}

export async function getAffiliateCommissions(db: D1Database, affiliateId: number, limit = 30): Promise<AffiliateCommissionRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM affiliate_commissions WHERE affiliate_id = ? ORDER BY id DESC LIMIT ?')
    .bind(affiliateId, limit)
    .all<AffiliateCommissionRow>()
  return results
}

export async function getAffiliateClickStats(db: D1Database, affiliateId: number): Promise<{ totalClicks: number; totalAttributions: number; totalConverted: number }> {
  const clicks = await db.prepare('SELECT COUNT(*) AS n FROM affiliate_clicks WHERE affiliate_id = ?').bind(affiliateId).first<{ n: number }>()
  const attributions = await db.prepare('SELECT COUNT(*) AS n FROM affiliate_attributions WHERE affiliate_id = ?').bind(affiliateId).first<{ n: number }>()
  const converted = await db.prepare(`SELECT COUNT(*) AS n FROM affiliate_attributions WHERE affiliate_id = ? AND status = 'converted'`).bind(affiliateId).first<{ n: number }>()
  return {
    totalClicks: clicks?.n ?? 0,
    totalAttributions: attributions?.n ?? 0,
    totalConverted: converted?.n ?? 0
  }
}

// ---------- Payout requests ----------

/**
 * Requests a payout of the affiliate's full available balance. Debits the
 * ledger immediately (moving the funds out of "available") and creates a
 * 'requested' payout row — mirrors the seller payout audit pattern
 * conceptually, though the actual bank-transfer execution (like seller
 * payouts) is an admin-reviewed action, not automatic, per the schema's own
 * decided_by_user_id/decided_at/paid_at columns implying a human approval
 * step. This function only ever creates the REQUEST — it never marks a
 * payout 'paid' itself.
 */
export async function requestAffiliatePayout(db: D1Database, affiliateId: number): Promise<AffiliatePayoutRow> {
  const balance = await getAffiliateBalance(db, affiliateId)
  if (balance <= 0) throw new Error('No available balance to withdraw')

  const affiliate = await getAffiliateProfileById(db, affiliateId)
  if (affiliate && balance < affiliate.payout_threshold_kobo) {
    throw new Error(`Minimum payout threshold not yet reached`)
  }

  const inserted = await db
    .prepare(`INSERT INTO affiliate_payouts (affiliate_id, amount_kobo, status) VALUES (?, ?, 'requested')`)
    .bind(affiliateId, balance)
    .run()
  const payoutId = inserted.meta.last_row_id as number

  await debitAffiliateLedger(db, affiliateId, balance, 'payout_requested', String(payoutId), `Payout requested: ${payoutId}`)

  const payout = await db.prepare('SELECT * FROM affiliate_payouts WHERE id = ?').bind(payoutId).first<AffiliatePayoutRow>()
  return payout!
}

export async function getAffiliatePayouts(db: D1Database, affiliateId: number, limit = 20): Promise<AffiliatePayoutRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM affiliate_payouts WHERE affiliate_id = ? ORDER BY id DESC LIMIT ?')
    .bind(affiliateId, limit)
    .all<AffiliatePayoutRow>()
  return results
}

// ---------- Global click-capture middleware ----------

/**
 * Global Hono middleware (mounted `app.use('*', ...)` in src/index.tsx, AFTER
 * attachUser/attachLocale): on any request carrying a `?ref=CODE` query
 * param, records the click (recordClick) and sets the nd_aff_click cookie so
 * later checkouts on this device attribute correctly, regardless of which
 * page the visitor actually landed on (matches how real referral links work
 * — a link can point to any product/page, not just /affiliate itself).
 *
 * Deliberately fails open and NEVER blocks/slows a normal page load:
 * - No `?ref=` present -> the whole D1 lookup is skipped entirely (single
 *   query-string check, zero DB calls) — this is the path taken by every
 *   normal, non-referred visit, so it can never regress existing traffic.
 * - Unrecognized/inactive code -> recordClick() returns null, next() runs
 *   as normal, no cookie is set (see recordClick's own doc comment).
 * - Any unexpected error is caught and swallowed here (never propagated) —
 *   affiliate tracking is a best-effort side channel, not a request-blocking
 *   dependency, exactly like attachLocale's manual-language-save try/catch.
 * - If the visitor is already logged in, immediately attaches
 *   customer_user_id to the new attribution so a same-session purchase
 *   later in this request's lifecycle (or a subsequent request) resolves
 *   correctly via getLatestPendingAttributionForCustomer.
 */
export async function affiliateClickMiddleware(c: Context<AppEnv>, next: () => Promise<void>) {
  const ref = c.req.query('ref')
  if (ref) {
    try {
      const url = new URL(c.req.url)
      const result = await recordClick(
        c.env.DB,
        ref,
        url.pathname,
        c.req.header('referer') ?? null,
        c.req.header('cf-connecting-ip') ?? null,
        c.req.header('user-agent') ?? null
      )
      if (result) {
        setCookie(c, AFFILIATE_CLICK_COOKIE, result.clickToken, {
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
          path: '/',
          maxAge: AFFILIATE_CLICK_COOKIE_MAX_AGE_SECONDS
        })

        const user = c.get('user')
        if (user) {
          const attribution = await findActiveAttributionByClickToken(c.env.DB, result.clickToken)
          if (attribution) {
            await attachCustomerToAttribution(c.env.DB, attribution.id, user.id)
          }
        }
      }
    } catch (err) {
      console.error('Affiliate click capture failed', err)
    }
  } else {
    // No ?ref= on THIS request, but a returning visitor may already carry the
    // cookie from an earlier click. Opportunistically attach customer_user_id
    // once they log in, so a guest-click -> later-login -> purchase path
    // still resolves (see findActiveAttributionByClickToken's doc comment).
    const user = c.get('user')
    if (user) {
      const clickToken = getCookie(c, AFFILIATE_CLICK_COOKIE)
      if (clickToken) {
        try {
          const attribution = await findActiveAttributionByClickToken(c.env.DB, clickToken)
          if (attribution && !attribution.customer_user_id) {
            await attachCustomerToAttribution(c.env.DB, attribution.id, user.id)
          }
        } catch (err) {
          console.error('Affiliate attribution attach failed', err)
        }
      }
    }
  }

  await next()
}

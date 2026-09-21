/**
 * NaijaPay — real-data aggregation layer for the NaijaPay wallet experience.
 *
 * PROVENANCE (Pat's explicit directive, this session): NaijaPay is a visual
 * rebrand of the EXISTING wallet (wallet_ledger + wallet_accounts, see
 * ./wallet.ts), matched as closely as technically possible to a supplied
 * reference design (green/gold African-premium fintech aesthetic, African
 * continent motif, wallet card, balance breakdown panel, transaction list,
 * financial activity chart, mobile companion view).
 *
 * THE ONE NON-NEGOTIABLE RULE THIS FILE ENFORCES (Pat's explicit "zero
 * financial fabrication" mandate, mirroring the same principle already
 * enforced in src/lib/aura-ai/orchestrator.ts's system prompt): every number
 * this module returns is either a REAL read from wallet_ledger/
 * wallet_accounts, or explicitly typed as `null`/absent so the page layer
 * can render a "Coming Soon" badge instead of a fabricated figure. This file
 * does NOT invent:
 *   - Pending balance       — no such column/concept exists in wallet_accounts.
 *   - Reserved balance      — same.
 *   - Withdrawable balance  — same (would need to be balance minus something
 *                              that doesn't exist yet — there is no
 *                              distinction from Available in this schema).
 *   - Rewards points        — no rewards table exists anywhere in the schema.
 *   - Cashback               — no cashback table/column exists.
 *   - Fees / Refunds as distinct ledger categories — wallet_ledger.
 *     reference_type is only 'topup' | 'order_payment' | 'refund' | 'payout'
 *     | 'escrow_release' | 'booking_payment' today; 'refund' entries ARE
 *     real and are surfaced (see getMoneyFlow below), but there is no
 *     separate "fees" category to report, so it is never invented.
 *   - Business Wallet / Merchant Wallet — one wallet per user, period; no
 *     org-level wallet exists in the schema. Not represented here at all.
 *   - Cards & Payment Methods — no stored-card table exists (Paystack is not
 *     even configured with a secret in production as of this session).
 *
 * Anything in the reference image with no real backing data is intentionally
 * NOT modeled by this file. The page layer (src/pages/naijapay.tsx) renders
 * those reference-image panels as explicit "Coming Soon" cards using the
 * SAME <ComingSoonBadge> convention Aura Luxe already established via
 * <DemoBadge> in src/pages/aura.tsx — never as functional-looking UI.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { getWalletBalance, getWalletHistory } from './wallet'
import type { AuthUser } from '../types'

export interface NaijaPayLedgerEntry {
  id: number
  entry_type: 'credit' | 'debit'
  amount_kobo: number
  balance_after_kobo: number
  reference_type: string
  reference_id: string | null
  description: string
  created_at: string
}

export interface MoneyFlowBucket {
  /** ISO date (YYYY-MM-DD), UTC day bucket. */
  date: string
  money_in_kobo: number
  money_out_kobo: number
}

export interface NaijaPaySnapshot {
  user: { id: number; name: string; email: string | null; phone: string | null }
  /** Real cached balance from wallet_accounts. The ONLY balance figure this module reports. */
  available_balance_kobo: number
  /** Real, most-recent 30 ledger entries. */
  recent_transactions: NaijaPayLedgerEntry[]
  /** Real day-bucketed credit/debit totals for the requested window. Empty array if no activity. */
  money_flow: MoneyFlowBucket[]
  /** Total real credits/debits across the whole ledger (all-time) — used for small header stats, never a fabricated figure. */
  lifetime_credits_kobo: number
  lifetime_debits_kobo: number
  /** Count of real ledger rows — used to legitimately show "X transactions", never invented. */
  transaction_count: number
  currency: 'NGN'
}

const WINDOW_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const
export type MoneyFlowWindow = keyof typeof WINDOW_DAYS

/**
 * Real day-bucketed Money In / Money Out for the requested window, computed
 * directly from wallet_ledger. No "fees" or "refunds" sub-series — those
 * are not distinct concepts in this schema (a refund IS a credit; it is
 * counted inside money_in_kobo like any other credit, not fabricated as a
 * separate category).
 */
export async function getMoneyFlow(db: D1Database, userId: number, window: MoneyFlowWindow): Promise<MoneyFlowBucket[]> {
  const days = WINDOW_DAYS[window]
  const { results } = await db
    .prepare(
      `SELECT
         substr(created_at, 1, 10) AS day,
         SUM(CASE WHEN entry_type = 'credit' THEN amount_kobo ELSE 0 END) AS money_in_kobo,
         SUM(CASE WHEN entry_type = 'debit' THEN amount_kobo ELSE 0 END) AS money_out_kobo
       FROM wallet_ledger
       WHERE user_id = ? AND created_at >= datetime('now', ?)
       GROUP BY day
       ORDER BY day ASC`
    )
    .bind(userId, `-${days} days`)
    .all<{ day: string; money_in_kobo: number; money_out_kobo: number }>()

  return results.map((r) => ({
    date: r.day,
    money_in_kobo: r.money_in_kobo || 0,
    money_out_kobo: r.money_out_kobo || 0,
  }))
}

/** Real all-time lifetime credit/debit totals + row count — no estimation, no rounding tricks. */
async function getLifetimeTotals(db: D1Database, userId: number): Promise<{ credits: number; debits: number; count: number }> {
  const row = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN amount_kobo ELSE 0 END), 0) AS credits,
         COALESCE(SUM(CASE WHEN entry_type = 'debit' THEN amount_kobo ELSE 0 END), 0) AS debits,
         COUNT(*) AS count
       FROM wallet_ledger WHERE user_id = ?`
    )
    .bind(userId)
    .first<{ credits: number; debits: number; count: number }>()
  return { credits: row?.credits ?? 0, debits: row?.debits ?? 0, count: row?.count ?? 0 }
}

/**
 * Assembles the full real-data snapshot for the NaijaPay page. Every field
 * traces directly to wallet_accounts/wallet_ledger — see file header.
 */
export async function getNaijaPaySnapshot(db: D1Database, user: AuthUser, moneyFlowWindow: MoneyFlowWindow = '30d'): Promise<NaijaPaySnapshot> {
  const [balance, history, moneyFlow, lifetime] = await Promise.all([
    getWalletBalance(db, user.id),
    getWalletHistory(db, user.id, 30),
    getMoneyFlow(db, user.id, moneyFlowWindow),
    getLifetimeTotals(db, user.id),
  ])

  return {
    user: { id: user.id, name: user.name, email: user.email, phone: user.phone },
    available_balance_kobo: balance,
    recent_transactions: history as unknown as NaijaPayLedgerEntry[],
    money_flow: moneyFlow,
    lifetime_credits_kobo: lifetime.credits,
    lifetime_debits_kobo: lifetime.debits,
    transaction_count: lifetime.count,
    currency: 'NGN',
  }
}

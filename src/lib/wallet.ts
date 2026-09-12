/**
 * Wallet ledger helpers.
 *
 * DESIGN RULE: wallet_accounts.cached_balance_kobo is a read-optimization cache only.
 * The wallet_ledger table is the append-only source of truth. Every balance mutation
 * MUST go through creditWallet()/debitWallet() below. Never let application code
 * UPDATE wallet_accounts directly from anywhere else.
 *
 * CONCURRENCY HARDENING (Engine 7 Phase 2, Unit 2 — see
 * docs/ENGINE-7-PHASE-2-FORENSIC-REVIEW.md §A/§I for the full analysis):
 *
 * PRIOR implementation (pre-Phase-2) read cached_balance_kobo via a separate
 * SELECT, computed the new balance in application code, then wrote it back
 * — a classic "lost update" race. Two concurrent calls for the same userId
 * could both read the same stale balance, both compute an independent
 * newBalance, and the second writer's UPDATE would silently overwrite the
 * first's result.
 *
 * FIRST FIX ATTEMPT (superseded, kept here only as a documented cautionary
 * note): moved the arithmetic into a single guarded UPDATE
 * (`SET cached_balance_kobo = cached_balance_kobo +/- ?`) so the CACHE
 * itself could no longer lose updates, then did a SEPARATE follow-up
 * SELECT afterwards purely to read the resulting value for the ledger's
 * balance_after_kobo column. This still had a bug: between this call's own
 * guarded UPDATE committing and its own follow-up SELECT running, a SECOND
 * concurrent request's UPDATE could land, so the ledger row this call
 * writes could get stamped with a balance_after_kobo that includes another
 * transaction's contribution — the cached balance itself would still end up
 * mathematically correct in aggregate, but the LEDGER's point-in-time
 * snapshot for this specific entry would be wrong. Reproduced deliberately
 * with a `node:sqlite` prototype (an "intruder" UPDATE injected between the
 * guarded UPDATE and the follow-up SELECT) before ever landing in
 * production, then corrected below.
 *
 * FINAL FIX (this file): the balance UPDATE and the ledger INSERT are
 * combined into ONE atomic `db.batch()` call. The ledger INSERT does NOT
 * read a separately-fetched value — it uses a CORRELATED SUBQUERY against
 * wallet_accounts with the IDENTICAL WHERE guard as the UPDATE
 * (`WHERE user_id = ? [AND cached_balance_kobo >= ? for debit]`), so the
 * balance_after_kobo it stamps is computed from the exact same guarded read
 * the UPDATE itself is allowed to act on — there is no separate SELECT step
 * at all, and therefore no gap for a second writer to interleave into. D1's
 * db.batch() executes all statements in the array as a single atomic unit
 * (Cloudflare's documented behavior — same primitive already relied on
 * elsewhere in this codebase for ledger+cache pairs), so both statements
 * either both see the pre-mutation state and both act, or (if a concurrent
 * batch already changed the row) both re-evaluate against whatever state
 * they actually run against — but always within one atomic unit, never
 * split across a request boundary with anything else free to run between
 * them.
 *
 * WHY THIS IS THE CORRECT GENERALIZATION OF THE BOOKING CAS PATTERN
 * (precedent, not copy-paste): booking-lifecycle.ts's transitionBooking()
 * and booking-payments.ts's payForBooking() use
 * `WHERE status = 'expected-old-enum-value'` — CAS over a FINITE enum.
 * A wallet balance is not a finite enum, it's a monotonically-checked
 * NUMBER, so the natural adaptation is `WHERE cached_balance_kobo >= ?`
 * (debit) — "claim only if the current numeric value satisfies the
 * invariant", which is the same "check-and-claim-in-one-guarded-statement"
 * idea, just generalized from equality-on-enum to inequality-on-integer.
 * Credit has no floor to protect (crediting is always safe), so its guard
 * is simply `WHERE user_id = ?` with no additional numeric condition —
 * still a single guarded UPDATE, still batched atomically with its ledger
 * INSERT for the same reason (avoid a separate follow-up SELECT).
 *
 * CHOICE OF rows_written OVER UPDATE...RETURNING (documented per explicit
 * requirement, not a stylistic preference): local D1/SQLite DOES support
 * `UPDATE ... RETURNING` (verified directly against the local engine during
 * Unit 1's forensic review, via a live `wrangler d1 execute --local` test).
 * It was NOT adopted here for two independent reasons:
 *   1. Cloudflare's hosted D1 (the actual production target, not just local
 *      dev) has no independently-confirmed guarantee in this repo's own
 *      testing history that RETURNING behaves identically to local SQLite
 *      across every storage backend D1 may use in production — whereas
 *      `D1PreparedStatement.run().meta.rows_written` is the EXACT mechanism
 *      payForBooking() and resolveDispute() already use in production,
 *      proven correct under real concurrent load (Booking Invariant 9's
 *      55/55 pass, twice).
 *   2. RETURNING only reports back the row(s) actually mutated by ITS OWN
 *      statement. Inside a db.batch() array, that is exactly equivalent to
 *      checking rows_written on the same statement's result — RETURNING
 *      would not eliminate the need for a batch, and would not close any
 *      race that rows_written doesn't already close, so it buys nothing
 *      here beyond a different way to read the same signal. Reusing
 *      rows_written keeps every CAS site in this repository behaviorally
 *      identical and avoids introducing a second, differently-verified
 *      success-detection mechanism for no functional gain.
 *
 * NOTE ON IDEMPOTENCY: creditWallet()/debitWallet() intentionally do NOT
 * deduplicate by (reference_type, reference_id) — wallet_ledger has no
 * unique constraint on that pair (confirmed in the Unit 1 forensic review).
 * Idempotency against double-firing is the CALLER's responsibility, enforced
 * upstream via CAS on the caller's own state (e.g. payForBooking()'s
 * `WHERE payment_status = 'unpaid'` claim, confirmOrderPayment()'s
 * `WHERE payment_status != 'unpaid'` guard) so that a legitimate retry of
 * the OUTER operation never reaches creditWallet()/debitWallet() twice for
 * the same business event in the first place. This file has no visibility
 * into "business event" identity — only the caller does — so it cannot
 * safely reject a same-reference_id call without risking rejection of a
 * LEGITIMATE second, unrelated transaction that happens to reuse a
 * reference_id (e.g. two separate manual top-ups against the same order
 * id in a refund-and-repay scenario). This is documented behavior, not an
 * oversight — see tests/payment-engine/ for explicit coverage confirming
 * two calls with an identical reference_id currently produce two distinct
 * ledger rows, each with a correct/consistent balance_after_kobo.
 */

export class InsufficientFundsError extends Error {
  constructor() {
    super('Insufficient wallet balance')
    this.name = 'InsufficientFundsError'
  }
}

export async function getWalletBalance(db: D1Database, userId: number): Promise<number> {
  const row = await db
    .prepare('SELECT cached_balance_kobo FROM wallet_accounts WHERE user_id = ?')
    .bind(userId)
    .first<{ cached_balance_kobo: number }>()
  return row?.cached_balance_kobo ?? 0
}

async function ensureWalletAccount(db: D1Database, userId: number) {
  await db
    .prepare('INSERT OR IGNORE INTO wallet_accounts (user_id, cached_balance_kobo) VALUES (?, 0)')
    .bind(userId)
    .run()
}

/**
 * Atomically credits a wallet. The ledger INSERT and the balance UPDATE run
 * inside ONE db.batch() call; the ledger row's balance_after_kobo is
 * computed by a correlated subquery against wallet_accounts (the same row
 * the UPDATE touches), so there is no separate follow-up SELECT and
 * therefore no window for a concurrent request to interleave between
 * "mutate the cache" and "read the cache for the ledger snapshot".
 *
 * ensureWalletAccount() guarantees the row exists first (idempotent
 * INSERT OR IGNORE — safe to race with itself), so the guard
 * `WHERE user_id = ?` inside the batch is guaranteed to match a row for a
 * valid userId; if the batch still reports 0 rows_written on the UPDATE,
 * that is a genuine invariant violation (accounts are never deleted
 * anywhere in this codebase) and is surfaced loudly, never silently
 * swallowed.
 */
export async function creditWallet(
  db: D1Database,
  userId: number,
  amountKobo: number,
  referenceType: string,
  referenceId: string | null,
  description: string
): Promise<number> {
  if (amountKobo <= 0) throw new Error('Credit amount must be positive')
  await ensureWalletAccount(db, userId)

  const [, updateResult] = await db.batch([
    db
      .prepare(
        `INSERT INTO wallet_ledger (user_id, entry_type, amount_kobo, balance_after_kobo, reference_type, reference_id, description)
         SELECT ?, 'credit', ?, cached_balance_kobo + ?, ?, ?, ?
         FROM wallet_accounts WHERE user_id = ?`
      )
      .bind(userId, amountKobo, amountKobo, referenceType, referenceId, description, userId),
    db
      .prepare(
        `UPDATE wallet_accounts SET cached_balance_kobo = cached_balance_kobo + ?, updated_at = datetime('now')
         WHERE user_id = ?`
      )
      .bind(amountKobo, userId),
  ])

  if ((updateResult.meta.rows_written ?? 0) === 0) {
    throw new Error(`creditWallet: wallet_accounts row for user ${userId} not found after ensureWalletAccount — this should never happen`)
  }

  const balanceRow = await db
    .prepare('SELECT cached_balance_kobo FROM wallet_accounts WHERE user_id = ?')
    .bind(userId)
    .first<{ cached_balance_kobo: number }>()
  return balanceRow!.cached_balance_kobo
}

/**
 * Atomically debits a wallet. The balance check AND the balance mutation
 * happen in the SAME guarded UPDATE
 * (`WHERE user_id = ? AND cached_balance_kobo >= ?`), batched together with
 * a ledger INSERT that uses the identical guard via a correlated subquery
 * — so there is no gap between "check sufficient funds", "subtract funds",
 * and "record the resulting balance" for a second concurrent debit to slip
 * through, and no separate SELECT for the ledger snapshot to race against.
 *
 * If the guarded UPDATE affects 0 rows, the caller genuinely does not have
 * sufficient balance RIGHT NOW (not merely "didn't have it a moment ago
 * when we last checked") — InsufficientFundsError is thrown and, because
 * both statements share the identical WHERE guard inside one db.batch(),
 * NO ledger row is ever written for a rejected debit, exactly mirroring
 * payForBooking()'s "losers never reach the money-moving step" guarantee.
 */
export async function debitWallet(
  db: D1Database,
  userId: number,
  amountKobo: number,
  referenceType: string,
  referenceId: string | null,
  description: string
): Promise<number> {
  if (amountKobo <= 0) throw new Error('Debit amount must be positive')
  await ensureWalletAccount(db, userId)

  const [, updateResult] = await db.batch([
    db
      .prepare(
        `INSERT INTO wallet_ledger (user_id, entry_type, amount_kobo, balance_after_kobo, reference_type, reference_id, description)
         SELECT ?, 'debit', ?, cached_balance_kobo - ?, ?, ?, ?
         FROM wallet_accounts WHERE user_id = ? AND cached_balance_kobo >= ?`
      )
      .bind(userId, amountKobo, amountKobo, referenceType, referenceId, description, userId, amountKobo),
    db
      .prepare(
        `UPDATE wallet_accounts SET cached_balance_kobo = cached_balance_kobo - ?, updated_at = datetime('now')
         WHERE user_id = ? AND cached_balance_kobo >= ?`
      )
      .bind(amountKobo, userId, amountKobo),
  ])

  if ((updateResult.meta.rows_written ?? 0) === 0) {
    // Either insufficient funds right now, or (impossible in this codebase —
    // accounts are never deleted) the row vanished. Either way, reject.
    // Never fabricate a debit that didn't actually happen. Because the
    // ledger INSERT above shares the identical guard, it also affected 0
    // rows in the same atomic batch — no phantom ledger row exists.
    throw new InsufficientFundsError()
  }

  const balanceRow = await db
    .prepare('SELECT cached_balance_kobo FROM wallet_accounts WHERE user_id = ?')
    .bind(userId)
    .first<{ cached_balance_kobo: number }>()
  return balanceRow!.cached_balance_kobo
}

export async function getWalletHistory(db: D1Database, userId: number, limit = 20) {
  const { results } = await db
    .prepare('SELECT * FROM wallet_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?')
    .bind(userId, limit)
    .all()
  return results
}

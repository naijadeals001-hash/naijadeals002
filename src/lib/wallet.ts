/**
 * Wallet ledger helpers.
 *
 * DESIGN RULE: wallet_accounts.cached_balance_kobo is a read-optimization cache only.
 * The wallet_ledger table is the append-only source of truth. Every balance mutation
 * MUST go through creditWallet()/debitWallet() below, inside a single D1 batch so the
 * ledger insert and cache update are atomic. Never let application code UPDATE
 * wallet_accounts directly from anywhere else.
 *
 * D1 does not yet support full interactive multi-statement transactions the way
 * Postgres does, so we use db.batch() for atomicity across the ledger insert + cache
 * update, and we recompute the "current balance" from the cache row which is only
 * ever written here. Debit operations re-check balance immediately before writing
 * to reduce (not fully eliminate, given D1's eventual consistency across colos)
 * race conditions — acceptable for MVP scale, revisit with Durable Objects if
 * concurrent-write volume grows.
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

  const current = await getWalletBalance(db, userId)
  const newBalance = current + amountKobo

  await db.batch([
    db
      .prepare(
        `INSERT INTO wallet_ledger (user_id, entry_type, amount_kobo, balance_after_kobo, reference_type, reference_id, description)
         VALUES (?, 'credit', ?, ?, ?, ?, ?)`
      )
      .bind(userId, amountKobo, newBalance, referenceType, referenceId, description),
    db
      .prepare(`UPDATE wallet_accounts SET cached_balance_kobo = ?, updated_at = datetime('now') WHERE user_id = ?`)
      .bind(newBalance, userId)
  ])

  return newBalance
}

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

  const current = await getWalletBalance(db, userId)
  if (current < amountKobo) {
    throw new InsufficientFundsError()
  }
  const newBalance = current - amountKobo

  await db.batch([
    db
      .prepare(
        `INSERT INTO wallet_ledger (user_id, entry_type, amount_kobo, balance_after_kobo, reference_type, reference_id, description)
         VALUES (?, 'debit', ?, ?, ?, ?, ?)`
      )
      .bind(userId, amountKobo, newBalance, referenceType, referenceId, description),
    db
      .prepare(`UPDATE wallet_accounts SET cached_balance_kobo = ?, updated_at = datetime('now') WHERE user_id = ?`)
      .bind(newBalance, userId)
  ])

  return newBalance
}

export async function getWalletHistory(db: D1Database, userId: number, limit = 20) {
  const { results } = await db
    .prepare('SELECT * FROM wallet_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?')
    .bind(userId, limit)
    .all()
  return results
}

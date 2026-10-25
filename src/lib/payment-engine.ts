import type { D1Database } from '@cloudflare/workers-types'

export type PaymentStatus = 'created' | 'pending' | 'authorized' | 'succeeded' | 'failed' | 'reversed' | 'refunded' | 'disputed' | 'cancelled'
export type FundingMethod = 'wallet' | 'paystack' | 'bank_transfer' | 'provider_balance' | 'other'

export interface PaymentLineItem {
  code: string
  description: string
  amountMinor: number
}

export interface CreatePaymentIntentInput {
  idempotencyKey: string
  userId: number
  verticalKey: string
  orderReference?: string | null
  countryIso: string
  currency: string
  amountMinor: number
  fundingMethod: FundingMethod
  merchantReference?: string | null
  lineItems?: PaymentLineItem[]
  expiresAt?: string | null
}

export interface PaymentIntent {
  id: number
  transactionReference: string
  idempotencyKey: string
  userId: number
  verticalKey: string
  orderReference: string | null
  countryIso: string
  currency: string
  amountMinor: number
  status: PaymentStatus
  fundingMethod: FundingMethod
  merchantReference: string | null
  expiresAt: string | null
  createdAt: string
  updatedAt: string
}

export class PaymentContractError extends Error {}
export class IdempotencyConflictError extends PaymentContractError {}

function assertPositiveInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new PaymentContractError(`${field} must be a positive integer minor amount`)
}

function normalizeKey(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 160) throw new PaymentContractError(`${field} is required and must be at most 160 characters`)
  return normalized
}

function makeReference(): string {
  return `ND-PAY-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`
}

function mapIntent(row: any): PaymentIntent {
  return {
    id: Number(row.id), transactionReference: row.transaction_reference, idempotencyKey: row.idempotency_key,
    userId: Number(row.user_id), verticalKey: row.vertical_key, orderReference: row.order_reference,
    countryIso: row.country_iso, currency: row.currency, amountMinor: Number(row.amount_minor), status: row.status,
    fundingMethod: row.funding_method, merchantReference: row.merchant_reference, expiresAt: row.expires_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

/** Creates or returns the same intent for a retried user operation. */
export async function createPaymentIntent(db: D1Database, input: CreatePaymentIntentInput): Promise<{ intent: PaymentIntent; created: boolean }> {
  const idempotencyKey = normalizeKey(input.idempotencyKey, 'idempotencyKey')
  const verticalKey = normalizeKey(input.verticalKey, 'verticalKey')
  const countryIso = normalizeKey(input.countryIso, 'countryIso').toUpperCase()
  const currency = normalizeKey(input.currency, 'currency').toUpperCase()
  assertPositiveInteger(input.amountMinor, 'amountMinor')
  if (!/^[A-Z]{3}$/.test(currency)) throw new PaymentContractError('currency must be an ISO 4217 code')
  if (!/^[A-Z]{2}$/.test(countryIso)) throw new PaymentContractError('countryIso must be an ISO 3166-1 alpha-2 code')
  if (input.lineItems?.some((item) => !item.code || !item.description || !Number.isSafeInteger(item.amountMinor) || item.amountMinor <= 0)) {
    throw new PaymentContractError('lineItems must contain positive integer minor amounts')
  }
  const transactionReference = makeReference()
  try {
    const result = await db.prepare(`INSERT INTO payment_intents
      (transaction_reference, idempotency_key, user_id, vertical_key, order_reference, country_iso, currency, amount_minor, status, funding_method, merchant_reference, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?, ?)`)
      .bind(transactionReference, idempotencyKey, input.userId, verticalKey, input.orderReference ?? null, countryIso, currency, input.amountMinor, input.fundingMethod, input.merchantReference ?? null, input.expiresAt ?? null).run()
    const row = await db.prepare('SELECT * FROM payment_intents WHERE id = ?').bind(result.meta.last_row_id).first()
    if (!row) throw new Error('Payment intent was inserted but could not be read back')
    if (input.lineItems?.length) {
      await db.prepare('INSERT INTO payment_intent_events (payment_intent_id, event_type, payload_json) VALUES (?, ?, ?)')
        .bind(row.id, 'contract.created', JSON.stringify({ line_items: input.lineItems })).run()
    }
    return { intent: mapIntent(row), created: true }
  } catch (error) {
    const existing = await db.prepare('SELECT * FROM payment_intents WHERE user_id = ? AND idempotency_key = ?').bind(input.userId, idempotencyKey).first()
    if (!existing) throw error
    const same = Number(existing.amount_minor) === input.amountMinor && existing.currency === currency && existing.vertical_key === verticalKey
    if (!same) throw new IdempotencyConflictError('Idempotency key was already used for a different payment contract')
    return { intent: mapIntent(existing), created: false }
  }
}

export async function recordPaymentEvent(db: D1Database, intentId: number, eventType: string, payload: unknown, provider?: string, providerReference?: string): Promise<boolean> {
  const existing = await db.prepare(`SELECT id FROM payment_intent_events
    WHERE payment_intent_id = ? AND event_type = ? AND provider_reference IS ?`)
    .bind(intentId, eventType, providerReference ?? null).first()
  if (existing) return false
  try {
    await db.prepare(`INSERT INTO payment_intent_events
      (payment_intent_id, event_type, provider, provider_reference, payload_json) VALUES (?, ?, ?, ?, ?)`)
      .bind(intentId, eventType, provider ?? null, providerReference ?? null, JSON.stringify(payload ?? {})).run()
    return true
  } catch (error) {
    // A concurrent callback may have won the unique insert between the read
    // and write. Treat that as a replay, never as a second financial event.
    const replay = await db.prepare(`SELECT id FROM payment_intent_events
      WHERE payment_intent_id = ? AND event_type = ? AND provider_reference IS ?`)
      .bind(intentId, eventType, providerReference ?? null).first()
    if (replay) return false
    throw error
  }
}

export interface JournalLineInput {
  accountCode: string
  direction: 'debit' | 'credit'
  amountMinor: number
}

/** Posts one balanced, immutable double-entry journal entry atomically. */
export async function postJournalEntry(db: D1Database, input: {
  entryReference: string
  currency: string
  sourceType: string
  sourceReference: string
  description?: string
  lines: JournalLineInput[]
}): Promise<number> {
  if (!input.lines.length || input.lines.length < 2) throw new PaymentContractError('A journal entry needs at least two lines')
  const debit = input.lines.filter((line) => line.direction === 'debit').reduce((sum, line) => sum + line.amountMinor, 0)
  const credit = input.lines.filter((line) => line.direction === 'credit').reduce((sum, line) => sum + line.amountMinor, 0)
  if (debit !== credit || !Number.isSafeInteger(debit) || debit <= 0) throw new PaymentContractError('Journal debits and credits must balance in positive integer minor units')
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new PaymentContractError('Journal currency must be an ISO 4217 code')
  const entry = db.prepare(`INSERT INTO journal_entries
    (entry_reference, currency, source_type, source_reference, description) VALUES (?, ?, ?, ?, ?)`)
    .bind(input.entryReference, input.currency, input.sourceType, input.sourceReference, input.description ?? '')
  const result = await entry.run()
  const entryId = Number(result.meta.last_row_id)
  await db.batch(input.lines.map((line) => db.prepare(`INSERT INTO journal_lines
    (journal_entry_id, account_code, direction, amount_minor, currency) VALUES (?, ?, ?, ?, ?)`)
    .bind(entryId, line.accountCode, line.direction, line.amountMinor, input.currency)))
  return entryId
}

export async function transitionPaymentIntent(db: D1Database, intentId: number, from: PaymentStatus, to: PaymentStatus): Promise<boolean> {
  const result = await db.prepare(`UPDATE payment_intents SET status = ?, updated_at = datetime('now') WHERE id = ? AND status = ?`)
    .bind(to, intentId, from).run()
  return (result.meta.rows_written ?? 0) > 0
}

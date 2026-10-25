import type { D1Database } from '@cloudflare/workers-types'

export interface NaijaPayTransactionFilters {
  userId?: number
  page: number
  pageSize: number
  status?: string
  category?: string
  currency?: string
}

export async function listNaijaPayTransactions(db: D1Database, filters: NaijaPayTransactionFilters) {
  const clauses: string[] = []
  const values: Array<string | number> = []
  if (filters.userId !== undefined) { clauses.push('pi.user_id = ?'); values.push(filters.userId) }
  if (filters.status) { clauses.push('pi.status = ?'); values.push(filters.status) }
  if (filters.category) { clauses.push('pi.vertical_key = ?'); values.push(filters.category) }
  if (filters.currency) { clauses.push('pi.currency = ?'); values.push(filters.currency.toUpperCase()) }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const count = await db.prepare(`SELECT COUNT(*) AS total FROM payment_intents pi ${where}`).bind(...values).first<{ total: number }>()
  const offset = (filters.page - 1) * filters.pageSize
  const rows = await db.prepare(`SELECT pi.id, pi.transaction_reference, pi.idempotency_key, pi.user_id,
    pi.vertical_key, pi.order_reference, pi.country_iso, pi.currency, pi.amount_minor,
    pi.status, pi.funding_method, pi.merchant_reference, pi.created_at, pi.updated_at
    FROM payment_intents pi ${where} ORDER BY pi.created_at DESC, pi.id DESC LIMIT ? OFFSET ?`)
    .bind(...values, filters.pageSize, offset).all()
  return { rows: rows.results, total: Number(count?.total ?? 0), page: filters.page, pageSize: filters.pageSize }
}

export async function getNaijaPayTransaction(db: D1Database, id: number, userId?: number) {
  const ownership = userId === undefined ? '' : ' AND pi.user_id = ?'
  const values = userId === undefined ? [id] : [id, userId]
  const intent = await db.prepare(`SELECT pi.id, pi.transaction_reference, pi.user_id, pi.vertical_key,
    pi.order_reference, pi.country_iso, pi.currency, pi.amount_minor, pi.status,
    pi.funding_method, pi.merchant_reference, pi.expires_at, pi.created_at, pi.updated_at
    FROM payment_intents pi WHERE pi.id = ?${ownership}`).bind(...values).first<any>()
  if (!intent) return null
  const events = await db.prepare(`SELECT id, event_type, provider, provider_reference, payload_json, created_at
    FROM payment_intent_events WHERE payment_intent_id = ? ORDER BY id ASC`).bind(id).all()
  return { ...intent, events: events.results.map((event: any) => ({ ...event, payload_json: undefined })) }
}

export async function listNaijaPayProviders(db: D1Database) {
  const rows = await db.prepare(`SELECT p.*, COUNT(pc.iso_code) AS country_count,
    SUM(CASE WHEN pc.rollout_status = 'operational' THEN 1 ELSE 0 END) AS operational_country_count
    FROM naijapay_providers p LEFT JOIN naijapay_provider_countries pc ON pc.provider_id = p.id
    GROUP BY p.id ORDER BY p.category, p.display_name`).all()
  return rows.results
}

export async function getNaijaPayProvider(db: D1Database, providerKey: string) {
  const provider = await db.prepare('SELECT * FROM naijapay_providers WHERE provider_key = ?').bind(providerKey).first<any>()
  if (!provider) return null
  const countries = await db.prepare('SELECT * FROM naijapay_provider_countries WHERE provider_id = ? ORDER BY iso_code').bind(provider.id).all()
  const products = await db.prepare('SELECT id, product_code, display_name, category, country_iso, currency, operation, operational_status, metadata_json FROM naijapay_products WHERE provider_id = ? ORDER BY country_iso, display_name').bind(provider.id).all()
  return { ...provider, countries: countries.results, products: products.results }
}

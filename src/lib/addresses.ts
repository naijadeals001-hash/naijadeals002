import type { AddressRow } from '../types'

/** Countries the address book actually offers a region list + country selector for today (Stage 2C: NG only — no GH/KE activation implied). Extend this list only when a country's checkout/address flow is genuinely wired up, never just because country_regions has rows for it. */
export const ADDRESS_SUPPORTED_COUNTRIES: { iso: string; name: string }[] = [
  { iso: 'NG', name: 'Nigeria' }
]

/** All saved addresses for a user, default first. */
export async function getAddressesForUser(db: D1Database, userId: number): Promise<AddressRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC')
    .bind(userId)
    .all<AddressRow>()
  return results
}

export async function getAddress(db: D1Database, userId: number, addressId: number): Promise<AddressRow | null> {
  const row = await db
    .prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?')
    .bind(addressId, userId)
    .first<AddressRow>()
  return row ?? null
}

export interface AddressInput {
  label: string
  recipient_name: string
  phone: string
  line1: string
  city: string
  state: string
  country_iso?: string
  delivery_instructions?: string | null
  is_default?: boolean
}

/** Reference list of Nigerian states, DB-sourced (never hardcoded in a page/component). Kept exactly as-is — existing callers are unaffected by the Stage 2C country_regions addition below. */
export async function getNigerianStates(db: D1Database): Promise<{ id: number; name: string; is_fct: number }[]> {
  const { results } = await db
    .prepare('SELECT id, name, is_fct FROM nigerian_states ORDER BY sort_order ASC')
    .all<{ id: number; name: string; is_fct: number }>()
  return results
}

/**
 * Stage 2C — country-parameterized region list, generalizing getNigerianStates()
 * above without replacing it. Backed by country_regions (migration 0071),
 * seeded from nigerian_states for NG so the returned NG data is identical.
 */
export async function getRegionsForCountry(db: D1Database, countryIso: string): Promise<{ id: number; name: string; is_capital_region: number }[]> {
  const { results } = await db
    .prepare('SELECT id, name, is_capital_region FROM country_regions WHERE country_iso = ? ORDER BY sort_order ASC')
    .bind(countryIso)
    .all<{ id: number; name: string; is_capital_region: number }>()
  return results
}

export async function createAddress(db: D1Database, userId: number, input: AddressInput): Promise<number> {
  // First address for a user is always the default, regardless of what was passed in.
  const existingCount = await db.prepare('SELECT COUNT(*) as n FROM addresses WHERE user_id = ?').bind(userId).first<{ n: number }>()
  const makeDefault = input.is_default || (existingCount?.n ?? 0) === 0

  if (makeDefault) {
    await db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').bind(userId).run()
  }

  const result = await db
    .prepare(
      `INSERT INTO addresses (user_id, label, recipient_name, phone, line1, city, state, country_iso, is_default, delivery_instructions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(userId, input.label, input.recipient_name, input.phone, input.line1, input.city, input.state, input.country_iso ?? 'NG', makeDefault ? 1 : 0, input.delivery_instructions ?? null)
    .run()
  return result.meta.last_row_id as number
}

export async function updateAddress(db: D1Database, userId: number, addressId: number, input: AddressInput): Promise<void> {
  if (input.is_default) {
    await db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').bind(userId).run()
  }
  await db
    .prepare(
      `UPDATE addresses SET label = ?, recipient_name = ?, phone = ?, line1 = ?, city = ?, state = ?, country_iso = ?, is_default = ?, delivery_instructions = ?
       WHERE id = ? AND user_id = ?`
    )
    .bind(input.label, input.recipient_name, input.phone, input.line1, input.city, input.state, input.country_iso ?? 'NG', input.is_default ? 1 : 0, input.delivery_instructions ?? null, addressId, userId)
    .run()
}

export async function deleteAddress(db: D1Database, userId: number, addressId: number): Promise<void> {
  await db.prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?').bind(addressId, userId).run()
}

export async function setDefaultAddress(db: D1Database, userId: number, addressId: number): Promise<void> {
  await db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').bind(userId).run()
  await db.prepare('UPDATE addresses SET is_default = 1 WHERE id = ? AND user_id = ?').bind(addressId, userId).run()
}

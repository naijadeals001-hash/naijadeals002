import type { AddressRow } from '../types'

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
  delivery_instructions?: string | null
  is_default?: boolean
}

/** Reference list of Nigerian states, DB-sourced (never hardcoded in a page/component). */
export async function getNigerianStates(db: D1Database): Promise<{ id: number; name: string; is_fct: number }[]> {
  const { results } = await db
    .prepare('SELECT id, name, is_fct FROM nigerian_states ORDER BY sort_order ASC')
    .all<{ id: number; name: string; is_fct: number }>()
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
      `INSERT INTO addresses (user_id, label, recipient_name, phone, line1, city, state, is_default, delivery_instructions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(userId, input.label, input.recipient_name, input.phone, input.line1, input.city, input.state, makeDefault ? 1 : 0, input.delivery_instructions ?? null)
    .run()
  return result.meta.last_row_id as number
}

export async function updateAddress(db: D1Database, userId: number, addressId: number, input: AddressInput): Promise<void> {
  if (input.is_default) {
    await db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').bind(userId).run()
  }
  await db
    .prepare(
      `UPDATE addresses SET label = ?, recipient_name = ?, phone = ?, line1 = ?, city = ?, state = ?, is_default = ?, delivery_instructions = ?
       WHERE id = ? AND user_id = ?`
    )
    .bind(input.label, input.recipient_name, input.phone, input.line1, input.city, input.state, input.is_default ? 1 : 0, input.delivery_instructions ?? null, addressId, userId)
    .run()
}

export async function deleteAddress(db: D1Database, userId: number, addressId: number): Promise<void> {
  await db.prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?').bind(addressId, userId).run()
}

export async function setDefaultAddress(db: D1Database, userId: number, addressId: number): Promise<void> {
  await db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').bind(userId).run()
  await db.prepare('UPDATE addresses SET is_default = 1 WHERE id = ? AND user_id = ?').bind(addressId, userId).run()
}

/**
 * Logistics Engine 2.0 — Driver, Vehicle, Fleet/Provider identity
 * (spec sections 11-16, 47-48).
 *
 * IDENTITY COMES FROM IDENTITY ENGINE (section 11, non-negotiable): a
 * driver_profiles row is ALWAYS resolved by the AUTHENTICATED user's id
 * (c.get('user').id) — never a client-supplied driver_id. Mirrors
 * seller.ts/providers.ts's resolveXStatus pattern exactly.
 *
 * COUNTRY-NEUTRAL VERIFICATION (section 12): this module does NOT hardcode
 * Nigerian document types. driver_documents.document_type (migration 0016)
 * already uses a generic CHECK ('drivers_license','national_id',
 * 'background_check','other') — no Nigeria-specific values added here.
 */
import type { Context } from 'hono'
import type { AppEnv, DriverProfileRow, DriverOperationalStatus } from '../types'

export class LogisticsDriverError extends Error {}

export type DriverState = 'NO_DRIVER' | 'PENDING_VERIFICATION' | 'SUSPENDED' | 'DEACTIVATED' | 'ACTIVE_DRIVER'

export interface DriverResolution {
  state: DriverState
  driver: DriverProfileRow | null
}

/** userId MUST come from c.get('user').id — never client input. */
export async function resolveDriverStatus(db: D1Database, userId: number): Promise<DriverResolution> {
  const driver = await db.prepare('SELECT * FROM driver_profiles WHERE user_id = ?').bind(userId).first<DriverProfileRow>()
  if (!driver) return { state: 'NO_DRIVER', driver: null }
  if (driver.status === 'suspended') return { state: 'SUSPENDED', driver }
  if (driver.status === 'deactivated') return { state: 'DEACTIVATED', driver }
  if (driver.status === 'pending_verification') return { state: 'PENDING_VERIFICATION', driver }
  return { state: 'ACTIVE_DRIVER', driver }
}

export async function requireActiveDriver(c: Context<AppEnv>, next: () => Promise<void>) {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Authentication required' }, 401)
  const { state, driver } = await resolveDriverStatus(c.env.DB, user.id)
  if (state !== 'ACTIVE_DRIVER' || !driver) {
    return c.json({ error: 'Active driver profile required', state }, 403)
  }
  c.set('driverProfile' as any, driver)
  await next()
}

export interface CreateDriverProfileInput {
  licenseNumber: string
  countryIso?: string
  providerId?: number | null
  identityOrganizationId?: number | null
}

/** Driver onboarding (section 12). No hardcoded Nigerian requirements — countryIso is passed through, not assumed. */
export async function createDriverProfile(db: D1Database, userId: number, input: CreateDriverProfileInput): Promise<number> {
  const existing = await db.prepare('SELECT id FROM driver_profiles WHERE user_id = ?').bind(userId).first<{ id: number }>()
  if (existing) throw new LogisticsDriverError('You already have a driver profile')

  const result = await db
    .prepare(
      `INSERT INTO driver_profiles (user_id, provider_id, identity_organization_id, license_number, country_iso, status, operational_status)
       VALUES (?, ?, ?, ?, ?, 'pending_verification', 'offline')`
    )
    .bind(userId, input.providerId ?? null, input.identityOrganizationId ?? null, input.licenseNumber, input.countryIso ?? 'NG')
    .run()

  return Number(result.meta.last_row_id)
}

/**
 * Driver operational status (section 13): "Only authorized systems may
 * modify driver operational status." Ownership-scoped by user_id — a
 * driver may only change THEIR OWN operational status; dispatch-driven
 * transitions (assigned/en_route/busy) are written by
 * logistics-dispatch.ts, not by this driver-facing setter.
 */
export async function setDriverOperationalStatus(db: D1Database, userId: number, status: DriverOperationalStatus): Promise<void> {
  const allowedSelfSet: DriverOperationalStatus[] = ['offline', 'available', 'on_break']
  if (!allowedSelfSet.includes(status)) {
    throw new LogisticsDriverError('Drivers may only self-set offline/available/on_break — other states are dispatch-controlled')
  }
  const result = await db
    .prepare(`UPDATE driver_profiles SET operational_status = ?, is_online = ?, last_online_at = datetime('now'), updated_at = datetime('now') WHERE user_id = ?`)
    .bind(status, status === 'offline' ? 0 : 1, userId)
    .run()
  if (!result.meta.rows_written) throw new LogisticsDriverError('Driver profile not found')
}

export async function getDriverJobs(db: D1Database, driverId: number, limit = 50) {
  const { results } = await db
    .prepare(
      `SELECT dj.*, s.tracking_number, s.status as shipment_status, s.destination_country_iso
       FROM delivery_jobs dj JOIN shipments s ON s.id = dj.shipment_id
       WHERE dj.driver_id = ? ORDER BY dj.id DESC LIMIT ?`
    )
    .bind(driverId, limit)
    .all<any>()
  return results
}

export async function getAvailableJobsForDriver(db: D1Database, driverId: number, limit = 50) {
  // Section 47: "available jobs" — unassigned jobs a driver COULD accept.
  // Real eligibility filtering (service area, vehicle type match) is the
  // dispatch/matching layer's job (logistics-dispatch.ts); this is the
  // simple unfiltered feed for now — documented as a matching-quality gap.
  const { results } = await db
    .prepare(
      `SELECT dj.*, s.tracking_number, s.destination_country_iso, s.speed_tier
       FROM delivery_jobs dj JOIN shipments s ON s.id = dj.shipment_id
       WHERE dj.status = 'unassigned' ORDER BY dj.id ASC LIMIT ?`
    )
    .bind(limit)
    .all<any>()
  return results
}

// ---------------- Vehicles ----------------

export interface CreateVehicleInput {
  vehicleTypeId: number
  registrationNumber: string
  countryIso?: string
  make?: string | null
  model?: string | null
  year?: number | null
  weightCapacityKg?: number | null
  baseCity?: string | null
}

export async function addVehicleToProvider(db: D1Database, providerId: number, input: CreateVehicleInput): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO vehicles (provider_id, vehicle_type_id, registration_number, country_iso, make, model, year, weight_capacity_kg, base_city)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(providerId, input.vehicleTypeId, input.registrationNumber, input.countryIso ?? 'NG', input.make ?? null, input.model ?? null, input.year ?? null, input.weightCapacityKg ?? null, input.baseCity ?? null)
    .run()
  return Number(result.meta.last_row_id)
}

export async function getVehiclesForProvider(db: D1Database, providerId: number) {
  const { results } = await db.prepare('SELECT * FROM vehicles WHERE provider_id = ? ORDER BY id DESC').bind(providerId).all<any>()
  return results
}

export async function assignVehicleToDriver(db: D1Database, driverId: number, vehicleId: number): Promise<void> {
  await db.batch([
    db.prepare(`UPDATE driver_vehicle_assignments SET unassigned_at = datetime('now'), is_current = 0 WHERE driver_id = ? AND is_current = 1`).bind(driverId),
    db.prepare(`INSERT INTO driver_vehicle_assignments (driver_id, vehicle_id, is_current) VALUES (?, ?, 1)`).bind(driverId, vehicleId),
  ])
}

export async function getCurrentVehicleForDriver(db: D1Database, driverId: number) {
  return db
    .prepare(
      `SELECT v.* FROM driver_vehicle_assignments dva JOIN vehicles v ON v.id = dva.vehicle_id
       WHERE dva.driver_id = ? AND dva.is_current = 1`
    )
    .bind(driverId)
    .first<any>()
}

export async function getVehicleTypes(db: D1Database) {
  const { results } = await db.prepare('SELECT * FROM vehicle_types WHERE is_active = 1 ORDER BY display_order ASC').all<any>()
  return results
}

// ---------------- Logistics Providers (fleets / 3PL) ----------------

export interface CreateLogisticsProviderInput {
  providerName: string
  countryIso?: string
  contactPhone?: string | null
  contactEmail?: string | null
  organizationId?: number | null
}

/** Section 15/16: fleet operators + third-party logistics providers. One provider row per user (existing UNIQUE index, migration 0015). */
export async function createLogisticsProvider(db: D1Database, userId: number, input: CreateLogisticsProviderInput): Promise<number> {
  const existing = await db.prepare('SELECT id FROM logistics_providers WHERE user_id = ?').bind(userId).first<{ id: number }>()
  if (existing) throw new LogisticsDriverError('You already have a logistics provider profile')

  const result = await db
    .prepare(`INSERT INTO logistics_providers (user_id, organization_id, provider_name, country_iso, contact_phone, contact_email) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(userId, input.organizationId ?? null, input.providerName, input.countryIso ?? 'NG', input.contactPhone ?? null, input.contactEmail ?? null)
    .run()
  return Number(result.meta.last_row_id)
}

export async function resolveLogisticsProviderForUser(db: D1Database, userId: number) {
  return db.prepare('SELECT * FROM logistics_providers WHERE user_id = ?').bind(userId).first<any>()
}

/** Fleet dashboard driver roster (section 48). Ownership-scoped by provider_id, never a bare driver id. */
export async function getDriversForProvider(db: D1Database, providerId: number) {
  const { results } = await db.prepare('SELECT * FROM driver_profiles WHERE provider_id = ? ORDER BY id DESC').bind(providerId).all<any>()
  return results
}

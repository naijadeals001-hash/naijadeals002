/**
 * Logistics Engine 2.0 — Pickup/Dropoff execution, delivery attempts,
 * proof of delivery, OTP verification, failed delivery (spec sections
 * 7-8, 33-39).
 *
 * NEVER TRUST A CLIENT-SIDE "DELIVERED" BUTTON (section 34, non-negotiable):
 * completeDeliveryJob requires a valid proof — OTP verified server-side
 * against a HASHED code (never stored/compared in plaintext), a stored
 * signature/photo reference, or an explicit 'none' for proof-exempt
 * deliveries. A bare "mark delivered" with no proof type set is rejected.
 *
 * PER-ATTEMPT HISTORY (section 37): every failed OR successful completion
 * writes a delivery_attempts row with an incrementing attempt_number —
 * never overwrites a prior attempt.
 */
import { logShipmentEvent, transitionShipmentStatus } from './logistics-tracking'
import type { JobType } from './logistics-dispatch'
import { NotOwnedJobError } from './logistics-dispatch'

export class LogisticsDeliveryError extends Error {}
export class InvalidOtpError extends LogisticsDeliveryError {
  constructor() {
    super('The OTP code is invalid or has expired')
  }
}

function jobTable(jobType: JobType): string {
  return jobType === 'pickup' ? 'pickup_jobs' : 'delivery_jobs'
}

/** Web Crypto SHA-256 — Cloudflare Workers runtime has no Node crypto module (project-wide constraint), so OTP hashing uses SubtleCrypto, never plaintext storage. */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

const OTP_TTL_MINUTES = 15

/**
 * Generates and stores a HASHED OTP for a job's completion proof (section
 * 34). Returns the PLAINTEXT code exactly once, for the notification layer
 * to send to the customer — it is never persisted or logged in plaintext.
 */
export async function generateDeliveryOtp(db: D1Database, jobType: JobType, jobId: number): Promise<string> {
  const otp = generateOtp()
  const hash = await sha256Hex(otp)
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000).toISOString()

  await db
    .prepare(`UPDATE ${jobTable(jobType)} SET proof_type = 'otp', otp_code_hash = ?, otp_expires_at = ?, otp_verified_at = NULL WHERE id = ?`)
    .bind(hash, expiresAt, jobId)
    .run()

  return otp
}

/** Server-side OTP verification (section 34). Never trusts a bare "delivered=true" from the client. */
export async function verifyDeliveryOtp(db: D1Database, jobType: JobType, jobId: number, driverId: number, submittedOtp: string): Promise<void> {
  const job = await db.prepare(`SELECT otp_code_hash, otp_expires_at FROM ${jobTable(jobType)} WHERE id = ? AND driver_id = ?`).bind(jobId, driverId).first<{ otp_code_hash: string | null; otp_expires_at: string | null }>()
  if (!job) throw new NotOwnedJobError()
  if (!job.otp_code_hash || !job.otp_expires_at) throw new InvalidOtpError()
  if (new Date(job.otp_expires_at).getTime() < Date.now()) throw new InvalidOtpError()

  const submittedHash = await sha256Hex(submittedOtp)
  if (submittedHash !== job.otp_code_hash) throw new InvalidOtpError()

  await db.prepare(`UPDATE ${jobTable(jobType)} SET otp_verified_at = datetime('now') WHERE id = ?`).bind(jobId).run()
}

/** Pickup execution — driver marks en_route/arrived/completed. Ownership-scoped by driverId. */
export async function markJobEnRoute(db: D1Database, jobType: JobType, jobId: number, driverId: number, location?: { latitude: number; longitude: number }): Promise<void> {
  const result = await db
    .prepare(`UPDATE ${jobTable(jobType)} SET status = 'en_route', en_route_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND driver_id = ? AND status IN ('accepted', 'assigned')`)
    .bind(jobId, driverId)
    .run()
  if (!result.meta.rows_written) throw new NotOwnedJobError()

  const job = await db.prepare(`SELECT shipment_id FROM ${jobTable(jobType)} WHERE id = ?`).bind(jobId).first<{ shipment_id: number }>()
  if (job) {
    await logShipmentEvent(db, job.shipment_id, `${jobType}_en_route`, null, 'driver', null, location)
    if (jobType === 'pickup') await transitionShipmentStatus(db, job.shipment_id, 'driver_en_route_to_pickup', null, 'driver', null, location)
    else await transitionShipmentStatus(db, job.shipment_id, 'out_for_delivery', null, 'driver', null, location).catch(() => {}) // may already be out_for_delivery from a prior attempt
  }
}

export async function markJobArrived(db: D1Database, jobType: JobType, jobId: number, driverId: number, location?: { latitude: number; longitude: number }): Promise<void> {
  const result = await db
    .prepare(`UPDATE ${jobTable(jobType)} SET status = 'arrived', arrived_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND driver_id = ? AND status = 'en_route'`)
    .bind(jobId, driverId)
    .run()
  if (!result.meta.rows_written) throw new NotOwnedJobError()

  const job = await db.prepare(`SELECT shipment_id FROM ${jobTable(jobType)} WHERE id = ?`).bind(jobId).first<{ shipment_id: number }>()
  if (job) {
    await logShipmentEvent(db, job.shipment_id, `arrived_${jobType}`, null, 'driver', null, location)
    if (jobType === 'pickup') await transitionShipmentStatus(db, job.shipment_id, 'arrived_pickup', null, 'driver', null, location)
    else await transitionShipmentStatus(db, job.shipment_id, 'arrived_dropoff', null, 'driver', null, location)
  }
}

export interface CompletionProof {
  type: 'otp' | 'signature' | 'photo' | 'qr' | 'none'
  otpCode?: string
  signatureRef?: string // R2 object key — never a raw base64 blob in the DB row
  photoRef?: string
  location?: { latitude: number; longitude: number }
}

/**
 * Completes a pickup or delivery job — REQUIRES a valid proof (section 34
 * non-negotiable). Writes a delivery_attempts row with outcome='succeeded'
 * (section 37: every completion is an attempt, tracked, never bypassing
 * the attempt ledger).
 */
export async function completeJob(db: D1Database, jobType: JobType, jobId: number, driverId: number, proof: CompletionProof): Promise<void> {
  const job = await db.prepare(`SELECT * FROM ${jobTable(jobType)} WHERE id = ? AND driver_id = ?`).bind(jobId, driverId).first<any>()
  if (!job) throw new NotOwnedJobError()

  if (proof.type === 'otp') {
    await verifyDeliveryOtp(db, jobType, jobId, driverId, proof.otpCode ?? '')
  }
  // 'signature'/'photo'/'qr'/'none' proof types are recorded as provided —
  // this module does not re-verify a signature/photo image's authenticity
  // (out of scope; documented gap), but it DOES require the caller to have
  // actually supplied a stored reference before accepting completion for
  // those types (enforced below), never accepting a bare "done".
  if (['signature', 'photo', 'qr'].includes(proof.type) && !proof.signatureRef && !proof.photoRef) {
    throw new LogisticsDeliveryError(`Proof type "${proof.type}" requires a stored reference`)
  }

  const nextAttemptNumber = (job.attempt_count ?? 0) + 1

  await db.batch([
    db
      .prepare(
        `UPDATE ${jobTable(jobType)} SET status = 'completed', completed_at = datetime('now'), attempt_count = ?, proof_type = ?,
         completion_latitude = ?, completion_longitude = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .bind(nextAttemptNumber, proof.type, proof.location?.latitude ?? null, proof.location?.longitude ?? null, jobId),
    db
      .prepare(`INSERT INTO delivery_attempts (job_type, job_id, attempt_number, outcome, actor_user_id, actor_role, latitude, longitude) VALUES (?, ?, ?, 'succeeded', NULL, 'driver', ?, ?)`)
      .bind(jobType, jobId, nextAttemptNumber, proof.location?.latitude ?? null, proof.location?.longitude ?? null),
  ])

  if (jobType === 'pickup') {
    await transitionShipmentStatus(db, job.shipment_id, 'picked_up', null, 'driver', 'Pickup completed', proof.location)
    await logShipmentEvent(db, job.shipment_id, 'pickup_completed', null, 'driver')
  } else {
    await transitionShipmentStatus(db, job.shipment_id, 'delivered', null, 'driver', 'Delivery completed', proof.location)
    await logShipmentEvent(db, job.shipment_id, 'delivery_completed', null, 'driver')
    await db.prepare(`UPDATE driver_profiles SET operational_status = 'available' WHERE id = ?`).bind(driverId).run()
  }
}

export type FailureReason =
  | 'recipient_unavailable' | 'wrong_address' | 'access_issue' | 'customer_cancellation'
  | 'damaged_package' | 'driver_issue' | 'vehicle_failure' | 'weather_disruption' | 'service_unavailable'

/**
 * Records a FAILED attempt (section 36/37) — never overwrites the prior
 * attempt row, always appends. The job returns to a re-attemptable state
 * (status='attempted') rather than terminal, so a second attempt can be
 * scheduled without recreating the job.
 */
export async function recordFailedAttempt(
  db: D1Database,
  jobType: JobType,
  jobId: number,
  driverId: number,
  reason: FailureReason,
  notes?: string,
  location?: { latitude: number; longitude: number }
): Promise<void> {
  const job = await db.prepare(`SELECT * FROM ${jobTable(jobType)} WHERE id = ? AND driver_id = ?`).bind(jobId, driverId).first<any>()
  if (!job) throw new NotOwnedJobError()

  const nextAttemptNumber = (job.attempt_count ?? 0) + 1

  await db.batch([
    db
      .prepare(`UPDATE ${jobTable(jobType)} SET status = 'attempted', attempt_count = ?, failure_reason = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(nextAttemptNumber, reason, jobId),
    db
      .prepare(`INSERT INTO delivery_attempts (job_type, job_id, attempt_number, outcome, reason, actor_user_id, actor_role, notes, latitude, longitude) VALUES (?, ?, ?, 'failed', ?, NULL, 'driver', ?, ?, ?)`)
      .bind(jobType, jobId, nextAttemptNumber, reason, notes ?? null, location?.latitude ?? null, location?.longitude ?? null),
  ])

  const shipmentStatus = jobType === 'pickup' ? 'failed' : 'delivery_attempted'
  await transitionShipmentStatus(db, job.shipment_id, shipmentStatus as any, null, 'driver', `Attempt #${nextAttemptNumber} failed: ${reason}`, location)
  await logShipmentEvent(db, job.shipment_id, `${jobType}_attempt_failed`, null, 'driver', notes)
}

export async function getAttemptsForJob(db: D1Database, jobType: JobType, jobId: number) {
  const { results } = await db
    .prepare('SELECT * FROM delivery_attempts WHERE job_type = ? AND job_id = ? ORDER BY attempt_number ASC')
    .bind(jobType, jobId)
    .all<any>()
  return results
}

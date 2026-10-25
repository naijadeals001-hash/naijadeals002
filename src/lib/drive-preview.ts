export const ACTIVE_NAIJADRIVE_ZONES = ['abuja-central', 'gwarinpa', 'lokogoma'] as const

export type DrivePreviewBookingInput = {
  pickupZone?: unknown
  dropoffZone?: unknown
  vehicleCategory?: unknown
}

export type DrivePreviewValidation =
  | { ok: true }
  | { ok: false; status: 400; error: string; code: string }

export function validateDrivePreviewBooking(input: DrivePreviewBookingInput | null): DrivePreviewValidation {
  if (typeof input?.pickupZone !== 'string' || typeof input.dropoffZone !== 'string' || !input.pickupZone || !input.dropoffZone) {
    return { ok: false, status: 400, code: 'INVALID_ZONES', error: 'Choose both a pickup and destination zone.' }
  }
  if (!ACTIVE_NAIJADRIVE_ZONES.includes(input.pickupZone as typeof ACTIVE_NAIJADRIVE_ZONES[number]) || !ACTIVE_NAIJADRIVE_ZONES.includes(input.dropoffZone as typeof ACTIVE_NAIJADRIVE_ZONES[number])) {
    return { ok: false, status: 400, code: 'ZONE_UNAVAILABLE', error: 'That location is outside the active Abuja pilot zones.' }
  }
  return { ok: true }
}

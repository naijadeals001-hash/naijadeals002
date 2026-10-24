import type { AbujaServiceZone, FareRule, VehicleCategory } from '../domain/types.js'

/**
 * Pilot configuration is data, not route logic. Adding Lagos should add another
 * city configuration and database rows, not require copying ride handlers.
 * Vehicle categories remain disabled until the required regulatory/operational
 * verification has been completed for the Abuja pilot.
 */
export const ABUJA_ZONES: AbujaServiceZone[] = [
  { key: 'abuja-central', name: 'Abuja Central', countryIso: 'NG', city: 'Abuja', center: { latitude: 9.0579, longitude: 7.4951 }, radiusKm: 18, active: true },
  { key: 'gwarinpa', name: 'Gwarinpa', countryIso: 'NG', city: 'Abuja', center: { latitude: 9.1057, longitude: 7.4042 }, radiusKm: 10, active: true },
  { key: 'lokogoma', name: 'Lokogoma', countryIso: 'NG', city: 'Abuja', center: { latitude: 8.9856, longitude: 7.4295 }, radiusKm: 9, active: true },
  { key: 'airport-axis', name: 'Nnamdi Azikiwe Airport axis', countryIso: 'NG', city: 'Abuja', center: { latitude: 9.0068, longitude: 7.2632 }, radiusKm: 12, active: false },
]

export const ABUJA_ENABLED_VEHICLE_CATEGORIES: VehicleCategory[] = ['car']

export const ABUJA_FARE_RULES: FareRule[] = [
  {
    vehicleCategory: 'car',
    baseFareKobo: 50000,
    perKmKobo: 18000,
    perMinuteKobo: 500,
    minimumFareKobo: 100000,
    bookingFeeKobo: 10000,
    cancellationFeeKobo: 50000,
  },
]

export function findAbujaZone(key: string): AbujaServiceZone | undefined {
  return ABUJA_ZONES.find((zone) => zone.key === key && zone.active)
}

export function getAbujaFareRule(category: VehicleCategory): FareRule {
  const rule = ABUJA_FARE_RULES.find((candidate) => candidate.vehicleCategory === category)
  if (!rule || !ABUJA_ENABLED_VEHICLE_CATEGORIES.includes(category)) {
    throw new Error(`Vehicle category ${category} is not enabled for the Abuja pilot`)
  }
  return rule
}

import type { FareRule } from './types.js'

export interface FareEstimateInput {
  distanceKm: number
  durationMinutes: number
  rule: FareRule
}

export function estimateFareKobo(input: FareEstimateInput): number {
  if (!Number.isFinite(input.distanceKm) || input.distanceKm < 0) throw new Error('distanceKm must be a non-negative finite number')
  if (!Number.isFinite(input.durationMinutes) || input.durationMinutes < 0) throw new Error('durationMinutes must be a non-negative finite number')
  const { rule } = input
  const variable = Math.round(input.distanceKm * rule.perKmKobo) + Math.round(input.durationMinutes * rule.perMinuteKobo)
  return Math.max(rule.minimumFareKobo, rule.baseFareKobo + rule.bookingFeeKobo + variable)
}

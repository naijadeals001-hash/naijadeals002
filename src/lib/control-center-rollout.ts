import type { EcosystemCapabilityState } from './control-center-ecosystem'

export type CountryRolloutStatus = 'PLANNED' | 'PRE-LAUNCH' | 'BETA' | 'LIVE' | 'PAUSED' | 'SUSPENDED'

export type RolloutCountry = {
  id: number
  isoCode: string
  name: string
  region: string
  currencyCode: string
  defaultLanguage: string
  status: CountryRolloutStatus
  displayOrder: number
}

export type RolloutVertical = {
  id: number
  key: string
  name: string
  status: string
  controlType: string
  globallyEnabled: boolean
  route: string | null
  countryOverride: boolean | null
  enabledInCountry: boolean
  capabilityState: EcosystemCapabilityState | 'operational' | 'partial' | 'incomplete' | 'unavailable'
}

type RolloutVerticalRow = Omit<RolloutVertical, 'capabilityState'>

const OPERATIONAL_COUNTRY_STATUSES = new Set<CountryRolloutStatus>(['LIVE', 'BETA'])

export async function listRolloutCountries(db: D1Database): Promise<RolloutCountry[]> {
  const { results } = await db.prepare(`
    SELECT id, iso_code AS isoCode, name, region, currency_code AS currencyCode,
           default_language AS defaultLanguage, status, display_order AS displayOrder
    FROM cc_countries
    ORDER BY display_order ASC, name ASC
  `).all<RolloutCountry>()
  return results
}

export async function listRolloutVerticals(db: D1Database, countryIso?: string): Promise<RolloutVertical[]> {
  const country = countryIso ? countryIso.toUpperCase() : null
  const { results } = await db.prepare(`
    SELECT cap.id, cap.key, cap.name, cap.status, cap.control_type AS controlType,
           cap.enabled AS globallyEnabled, cap.route,
           override.enabled AS countryOverride,
           CASE
             WHEN override.enabled IS NOT NULL THEN override.enabled
             WHEN countryRow.status IN ('LIVE', 'BETA') THEN cap.enabled
             ELSE 0
           END AS enabledInCountry
    FROM cc_capabilities cap
    LEFT JOIN cc_countries countryRow ON countryRow.iso_code = ?
    LEFT JOIN cc_capability_country_overrides override
      ON override.capability_id = cap.id AND override.country_id = countryRow.id
    WHERE cap.key LIKE 'ecosystem.%'
    ORDER BY cap.sort_order ASC, cap.id ASC
  `).bind(country).all<RolloutVerticalRow>()

  return results.map((row) => ({
    ...row,
    globallyEnabled: !!row.globallyEnabled,
    countryOverride: row.countryOverride === null ? null : !!row.countryOverride,
    enabledInCountry: !!row.enabledInCountry,
    capabilityState: capabilityStateFor(row.key, row.status, !!row.enabledInCountry),
  }))
}

export async function getCountryRollout(db: D1Database, isoCode: string): Promise<{ country: RolloutCountry | null; verticals: RolloutVertical[] }> {
  const iso = isoCode.toUpperCase()
  const countries = await listRolloutCountries(db)
  const country = countries.find((candidate) => candidate.isoCode === iso) ?? null
  return { country, verticals: await listRolloutVerticals(db, iso) }
}

export async function isCountryOperational(db: D1Database, isoCode: string): Promise<boolean> {
  const row = await db.prepare('SELECT status FROM cc_countries WHERE iso_code = ?').bind(isoCode.toUpperCase()).first<{ status: CountryRolloutStatus }>()
  return !!row && OPERATIONAL_COUNTRY_STATUSES.has(row.status)
}

export async function isVerticalEnabledInCountry(db: D1Database, verticalKey: string, isoCode: string): Promise<boolean> {
  const key = verticalKey.startsWith('ecosystem.') ? verticalKey : `ecosystem.${verticalKey}`
  const row = await db.prepare(`
    SELECT CASE
      WHEN override.enabled IS NOT NULL THEN override.enabled
      WHEN countryRow.status IN ('LIVE', 'BETA') THEN cap.enabled
      ELSE 0
    END AS enabled
    FROM cc_capabilities cap
    LEFT JOIN cc_countries countryRow ON countryRow.iso_code = ?
    LEFT JOIN cc_capability_country_overrides override
      ON override.capability_id = cap.id AND override.country_id = countryRow.id
    WHERE cap.key = ?
  `).bind(isoCode.toUpperCase(), key).first<{ enabled: number }>()
  return row?.enabled === 1
}

export async function setCountryStatus(db: D1Database, countryId: number, status: CountryRolloutStatus): Promise<RolloutCountry | null> {
  await db.prepare(`UPDATE cc_countries SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(status, countryId).run()
  return db.prepare(`
    SELECT id, iso_code AS isoCode, name, region, currency_code AS currencyCode,
           default_language AS defaultLanguage, status, display_order AS displayOrder
    FROM cc_countries WHERE id = ?
  `).bind(countryId).first<RolloutCountry>()
}

export async function setVerticalCountryOverride(db: D1Database, verticalKey: string, countryId: number, enabled: boolean, userId: number, reason: string | null): Promise<void> {
  const key = verticalKey.startsWith('ecosystem.') ? verticalKey : `ecosystem.${verticalKey}`
  await db.prepare(`
    INSERT INTO cc_capability_country_overrides (capability_id, country_id, enabled, reason, created_by_user_id, updated_at)
    SELECT id, ?, ?, ?, ?, datetime('now') FROM cc_capabilities WHERE key = ?
    ON CONFLICT(capability_id, country_id) DO UPDATE SET enabled = excluded.enabled, reason = excluded.reason, updated_at = datetime('now'), created_by_user_id = excluded.created_by_user_id
  `).bind(countryId, enabled ? 1 : 0, reason, userId, key).run()
}

function capabilityStateFor(key: string, status: string, enabled: boolean): RolloutVertical['capabilityState'] {
  if (!enabled) return status === 'UNIMPLEMENTED' ? 'incomplete' : 'unavailable'
  if (key === 'ecosystem.naijashop' || key === 'ecosystem.naijaeats' || key === 'ecosystem.naijagigs' || key === 'ecosystem.naijastay') return 'partial'
  return status === 'ACTIVE' ? 'partial' : 'incomplete'
}

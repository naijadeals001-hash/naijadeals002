import type { EcosystemCapabilityState } from './control-center-ecosystem'

export type CountryRolloutStatus = 'PLANNED' | 'PRE-LAUNCH' | 'BETA' | 'LIVE' | 'PAUSED' | 'SUSPENDED'

export type RolloutGuardCode = 'VERTICAL_NOT_CONFIGURED' | 'VERTICAL_DISABLED' | 'COUNTRY_NOT_OPERATIONAL' | 'VERTICAL_DISABLED_IN_COUNTRY' | 'VERTICAL_DISABLED_IN_CITY' | 'VERTICAL_RESTRICTED_IN_CITY'

export class RolloutGuardError extends Error {
  readonly code: RolloutGuardCode
  readonly status = 409

  constructor(code: RolloutGuardCode, message: string) {
    super(message)
    this.name = 'RolloutGuardError'
    this.code = code
  }
}

export type RolloutCountry = {
  id: number
  isoCode: string
  iso3Code: string | null
  name: string
  region: string
  currencyCode: string
  dialingCode: string | null
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
    SELECT id, iso_code AS isoCode, iso3_code AS iso3Code, name, region,
           currency_code AS currencyCode, dialing_code AS dialingCode,
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
    SELECT cap.enabled AS globally_enabled,
           cap.status AS capability_status,
           countryRow.status AS country_status,
           override.enabled AS country_override
    FROM cc_capabilities cap
    LEFT JOIN cc_countries countryRow ON countryRow.iso_code = ?
    LEFT JOIN cc_capability_country_overrides override
      ON override.capability_id = cap.id AND override.country_id = countryRow.id
    WHERE cap.key = ?
  `).bind(isoCode.toUpperCase(), key).first<{ globally_enabled: number; capability_status: string; country_status: CountryRolloutStatus | null; country_override: number | null }>()
  return !!row && row.globally_enabled === 1 && row.capability_status === 'ACTIVE' && !!row.country_status && OPERATIONAL_COUNTRY_STATUSES.has(row.country_status) && (row.country_override === null ? true : row.country_override === 1)
}

/**
 * Transaction-boundary guard. Unlike the discovery helper, this fails closed
 * when the capability, country, configuration status, or global switch is
 * missing. Global disablement is evaluated before country overrides, so a
 * country cannot re-enable a globally disabled vertical.
 */
export async function assertVerticalTransactionAllowed(db: D1Database, verticalKey: string, isoCode: string, cityName?: string | null): Promise<void> {
  const key = verticalKey.startsWith('ecosystem.') ? verticalKey : `ecosystem.${verticalKey}`
  const verticalSlug = key.replace(/^ecosystem\.naija/, '')
  const country = isoCode.trim().toUpperCase()
  const city = cityName?.trim().toLowerCase() || null
  const row = await db.prepare(`
    SELECT cap.enabled AS globally_enabled,
           cap.status AS capability_status,
           countryRow.status AS country_status,
           override.enabled AS country_override
    FROM cc_capabilities cap
    LEFT JOIN cc_countries countryRow ON countryRow.iso_code = ?
    LEFT JOIN cc_capability_country_overrides override
      ON override.capability_id = cap.id AND override.country_id = countryRow.id
    WHERE cap.key = ?
  `).bind(country, key).first<{ globally_enabled: number; capability_status: string; country_status: CountryRolloutStatus | null; country_override: number | null }>()

  if (!row) throw new RolloutGuardError('VERTICAL_NOT_CONFIGURED', `Vertical capability ${key} is not configured for transactions`)
  if (row.globally_enabled !== 1) throw new RolloutGuardError('VERTICAL_DISABLED', `Vertical ${key} is globally disabled`)
  if (row.capability_status !== 'ACTIVE') throw new RolloutGuardError('VERTICAL_NOT_CONFIGURED', `Vertical ${key} is not operationally configured`)
  if (!row.country_status || !OPERATIONAL_COUNTRY_STATUSES.has(row.country_status)) throw new RolloutGuardError('COUNTRY_NOT_OPERATIONAL', `Country ${country} is not operational for new transactions`)
  if (row.country_override === 0) throw new RolloutGuardError('VERTICAL_DISABLED_IN_COUNTRY', `Vertical ${key} is disabled in country ${country}`)
  if (city) {
    const cityOverride = await db.prepare(`
      SELECT enablement_state FROM cc_vertical_city_overrides
      WHERE vertical_slug = ? AND country_iso = ? AND lower(trim(city_name)) = ?
    `).bind(verticalSlug, country, city).first<{ enablement_state: 'enabled' | 'disabled' | 'restricted' }>()
    // City configuration is an explicit narrowing layer. An absent override
    // inherits the country decision; a city can never re-enable a globally or
    // country-disabled vertical.
    if (cityOverride?.enablement_state === 'disabled') throw new RolloutGuardError('VERTICAL_DISABLED_IN_CITY', `Vertical ${key} is disabled in ${cityName}, ${country}`)
    if (cityOverride?.enablement_state === 'restricted') throw new RolloutGuardError('VERTICAL_RESTRICTED_IN_CITY', `Vertical ${key} is restricted in ${cityName}, ${country}`)
  }
}

export async function setCountryStatus(db: D1Database, countryId: number, status: CountryRolloutStatus): Promise<RolloutCountry | null> {
  await db.prepare(`UPDATE cc_countries SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(status, countryId).run()
  return db.prepare(`
    SELECT id, iso_code AS isoCode, iso3_code AS iso3Code, name, region,
           currency_code AS currencyCode, dialing_code AS dialingCode,
           default_language AS defaultLanguage, status, display_order AS displayOrder
    FROM cc_countries WHERE id = ?
  `).bind(countryId).first<RolloutCountry>()
}

export async function setVerticalCityOverride(db: D1Database, verticalKey: string, countryIso: string, cityName: string, enablementState: 'enabled' | 'disabled' | 'restricted', userId: number, reason: string | null): Promise<void> {
  const slug = verticalKey.replace(/^ecosystem\./, '')
  await db.prepare(`
    INSERT INTO cc_vertical_city_overrides (vertical_slug,country_iso,city_name,enablement_state,reason,created_by_user_id,updated_at)
    VALUES (?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(vertical_slug,country_iso,city_name) DO UPDATE SET enablement_state=excluded.enablement_state, reason=excluded.reason, created_by_user_id=excluded.created_by_user_id, updated_at=datetime('now')
  `).bind(slug, countryIso.trim().toUpperCase(), cityName.trim(), enablementState, reason, userId).run()
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

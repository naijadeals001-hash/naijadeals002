/**
 * Single source of truth for the Control Center's ecosystem portfolio.
 *
 * This is administrative discoverability metadata, not a claim that every
 * vertical is operational. Capability state is deliberately explicit so the
 * central console can show the whole platform without fabricating integration.
 * Identity, authorization, audit, and finance remain shared Control Center
 * services; verticals do not receive separate admin systems here.
 */

export type EcosystemCapabilityState = 'operational' | 'partial' | 'incomplete' | 'unavailable'

export type UnifiedEcosystemVertical = {
  key: string
  name: string
  productArea: string
  route: string
  capabilityState: EcosystemCapabilityState
  adminSurface: string
  evidence: string
  registryStatus: string
  enablementState: 'enabled' | 'disabled' | 'restricted'
  implementationState: 'planned' | 'in_progress' | 'partial' | 'implementation_complete'
  automatedAcceptanceState: 'not_run' | 'failed' | 'partial' | 'passed'
  browserAcceptanceState: 'not_run' | 'failed' | 'partial' | 'passed'
  outstandingAcceptance: string[]
  operationsState: 'healthy' | 'degraded' | 'unavailable' | 'not_yet_operational'
  integrationState: 'configured' | 'unconfigured' | 'unhealthy' | 'unverified'
  releaseState: 'not_released' | 'preview_verified' | 'production_verified'
  ownerRole: string
  dependencies: string[]
  blockers: string
  healthDetail: string
  latestRemoteSha: string | null
  lastStatusUpdateAt: string | null
  liveCountryCount: number
  totalCountryCount: number
}

const REQUIRED_VERTICALS: UnifiedEcosystemVertical[] = [
  ['shop', 'NaijaShop', 'Commerce', '/', 'partial', 'Marketplace and Control Center customer/vendor views', 'Marketplace data and moderation surfaces exist; full commerce operations remain distributed across existing modules.'],
  ['fresh', 'NaijaFresh', 'Commerce', '/fresh', 'incomplete', 'Central registry only', 'Discoverable in the central registry; no dedicated Control Center operations surface was verified.'],
  ['eats', 'NaijaEats', 'Commerce', '/eats', 'partial', 'Existing operator screens plus central provider/entity oversight', 'Customer and operator surfaces exist; central oversight is limited to shared entity and provider controls.'],
  ['drive', 'NaijaDrive', 'Mobility', '/drive', 'incomplete', 'Central registry and readiness visibility', 'Fare preview foundation exists; routed provider, booking, dispatch, presence, payments, and persistence remain unavailable.'],
  ['gigs', 'NaijaGigs', 'Services', '/gigs', 'incomplete', 'Central registry only', 'Vertical is discoverable; no verified dedicated Control Center operations surface was found.'],
  ['stay', 'NaijaStay', 'Travel', '/stay', 'incomplete', 'Central registry and shared booking visibility', 'Customer-facing booking surfaces exist; vertical-specific administration remains incomplete.'],
  ['send', 'NaijaSend', 'Logistics', '/send', 'unavailable', 'Central registry only', 'No live delivery engine was verified in this preview.'],
  ['pay', 'NaijaPay', 'Finance', '/naijapay', 'partial', 'Shared Payments & Finance view', 'Central finance view reads supported payment transactions, refunds, disputes, GMV, and platform revenue sources.'],
  ['auto', 'NaijaAuto', 'Mobility', '/auto', 'incomplete', 'Central registry only', 'Discoverable; no dedicated operational administration surface was verified.'],
  ['homes', 'NaijaHomes', 'Property', '/homes', 'incomplete', 'Central registry only', 'Discoverable; no dedicated operational administration surface was verified.'],
  ['travel', 'NaijaTravel', 'Travel', '/travel', 'incomplete', 'Central registry only', 'Discoverable; no dedicated operational administration surface was verified.'],
  ['events', 'NaijaEvents', 'Experiences', '/events', 'incomplete', 'Central registry only', 'Discoverable; no dedicated operational administration surface was verified.'],
  ['learn', 'NaijaLearn', 'Education', '/learn', 'incomplete', 'Central registry only', 'Discoverable; no dedicated operational administration surface was verified.'],
  ['jobs', 'NaijaJobs', 'Work', '/jobs', 'incomplete', 'Central registry only', 'Discoverable; no dedicated operational administration surface was verified.'],
  ['health', 'NaijaHealth', 'Health', '/health', 'incomplete', 'Central registry only', 'Discoverable; no dedicated operational administration surface was verified.'],
  ['farm', 'NaijaFarm', 'Agriculture', '/farm', 'incomplete', 'Central registry only', 'Discoverable; no dedicated operational administration surface was verified.'],
  ['stream', 'NaijaStream', 'Media', '/stream', 'incomplete', 'Central registry only', 'Discoverable; no dedicated operational administration surface was verified.'],
  ['home', 'NaijaHome', 'Home Services', '/home', 'incomplete', 'Central registry only', 'Discoverable; no dedicated operational administration surface was verified.'],
  ['beauty', 'NaijaBeauty', 'Beauty', '/beauty', 'incomplete', 'Central registry only', 'Discoverable; no dedicated operational administration surface was verified.'],
  ['aura', 'Aura AI', 'Platform Intelligence', '/aura', 'incomplete', 'Aura AI operations shell', 'Control Center shell exists; no model-backed command execution is connected.'],
].map(([key, name, productArea, route, capabilityState, adminSurface, evidence]) => ({
  key, name, productArea, route, capabilityState: capabilityState as EcosystemCapabilityState, adminSurface, evidence,
  registryStatus: 'not_loaded', enablementState: 'disabled', implementationState: 'planned', automatedAcceptanceState: 'not_run', browserAcceptanceState: 'not_run', outstandingAcceptance: [], operationsState: 'unavailable', integrationState: 'unconfigured', releaseState: 'not_released', ownerRole: 'platform_admin', dependencies: [], blockers: '', healthDetail: '', latestRemoteSha: null, lastStatusUpdateAt: null, liveCountryCount: 0, totalCountryCount: 0,
}))

export const UNIFIED_ECOSYSTEM_VERTICALS = Object.freeze(REQUIRED_VERTICALS)

export const ECOSYSTEM_STATE_LABELS: Record<EcosystemCapabilityState, string> = {
  operational: 'Operational',
  partial: 'Partial integration',
  incomplete: 'Incomplete',
  unavailable: 'Unavailable',
}

export async function getUnifiedEcosystemRegistry(db: D1Database): Promise<UnifiedEcosystemVertical[]> {
  const [configured, readiness, capabilities, countries, development] = await Promise.all([
    db.prepare('SELECT slug, name, status, route FROM ecosystem_verticals ORDER BY display_order, id').all<{ slug: string; name: string; status: string; route: string }>(),
    db.prepare('SELECT * FROM cc_vertical_readiness').all<any>(),
    db.prepare("SELECT key, status, enabled FROM cc_capabilities WHERE key LIKE 'ecosystem.%'").all<{ key: string; status: string; enabled: number }>(),
    db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status IN ('LIVE','BETA') THEN 1 ELSE 0 END) AS live FROM cc_countries").first<{ total: number; live: number }>(),
    db.prepare('SELECT vertical, implementation_state, automated_test_state, browser_acceptance, remote_sha FROM cc_development_tasks').all<any>(),
  ])

  const configuredByKey = new Map((configured.results ?? []).map((row) => [row.slug, row]))
  const readinessByKey = new Map((readiness.results ?? []).map((row) => [row.vertical_slug, row]))
  const capabilityByKey = new Map((capabilities.results ?? []).map((row) => [row.key.replace(/^ecosystem\./, ''), row]))
  const developmentByKey = new Map<string, any>()
  for (const task of development.results ?? []) {
    const key = String(task.vertical).toLowerCase().replace(/^naija/, '').replace('fulfillment', 'eats').replace('private-rides', 'drive')
    if (!developmentByKey.has(key) || task.implementation_state === 'IMPLEMENTED') developmentByKey.set(key, task)
  }

  return UNIFIED_ECOSYSTEM_VERTICALS.map((vertical) => {
    const row = configuredByKey.get(vertical.key)
    const ready = readinessByKey.get(vertical.key) ?? {}
    const capability = capabilityByKey.get(vertical.key)
    const task = developmentByKey.get(vertical.key)
    const implementationState = ready.implementation_state ?? (task?.implementation_state === 'IMPLEMENTED' ? 'implementation_complete' : vertical.implementationState)
    const enabled = capability ? capability.enabled === 1 : ready.enablement_state === 'enabled'
    const enablementState = ready.enablement_state === 'restricted' ? 'restricted' : enabled ? 'enabled' : 'disabled'
    const acceptanceAuto = ready.automated_acceptance_state ?? (task?.automated_test_state === 'PASSED' ? 'passed' : vertical.automatedAcceptanceState)
    const acceptanceBrowser = ready.browser_acceptance_state ?? vertical.browserAcceptanceState
    const blockers = ready.blockers || vertical.blockers
    return {
      ...vertical,
      name: row?.name || vertical.name,
      route: row?.route || vertical.route,
      registryStatus: row?.status || vertical.registryStatus,
      enablementState,
      implementationState,
      automatedAcceptanceState: acceptanceAuto,
      browserAcceptanceState: acceptanceBrowser,
      outstandingAcceptance: JSON.parse(ready.outstanding_acceptance_json || '[]'),
      operationsState: ready.operations_state || vertical.operationsState,
      integrationState: ready.integration_state || vertical.integrationState,
      releaseState: ready.release_state || (task?.preview_state === 'PREVIEW_VERIFIED' ? 'preview_verified' : vertical.releaseState),
      ownerRole: ready.owner_role || vertical.ownerRole,
      dependencies: JSON.parse(ready.dependencies_json || '[]'),
      blockers,
      healthDetail: ready.health_detail || '',
      latestRemoteSha: ready.latest_remote_sha || task?.remote_sha || null,
      lastStatusUpdateAt: ready.last_status_update_at || null,
      liveCountryCount: Number(countries?.live ?? 0),
      totalCountryCount: Number(countries?.total ?? 0),
      capabilityState: enablementState === 'disabled' ? 'unavailable' : implementationState === 'implementation_complete' && acceptanceAuto === 'passed' ? 'operational' : 'partial',
      evidence: `${vertical.evidence} Registry: ${row?.status ?? 'not configured'}; implementation ${implementationState}; operations ${ready.operations_state ?? 'not yet operational'}; release ${ready.release_state ?? 'not released'}.`,
    }
  })
}

export function hasUnifiedVertical(key: string): boolean {
  return UNIFIED_ECOSYSTEM_VERTICALS.some((vertical) => vertical.key === key)
}

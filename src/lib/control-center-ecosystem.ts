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
}))

export const UNIFIED_ECOSYSTEM_VERTICALS = Object.freeze(REQUIRED_VERTICALS)

export const ECOSYSTEM_STATE_LABELS: Record<EcosystemCapabilityState, string> = {
  operational: 'Operational',
  partial: 'Partial integration',
  incomplete: 'Incomplete',
  unavailable: 'Unavailable',
}

export async function getUnifiedEcosystemRegistry(db: D1Database): Promise<UnifiedEcosystemVertical[]> {
  const configured = await db
    .prepare('SELECT slug, name, status, route FROM ecosystem_verticals ORDER BY display_order, id')
    .all<{ slug: string; name: string; status: string; route: string }>()
    .catch(() => ({ results: [] as { slug: string; name: string; status: string; route: string }[] }))

  const configuredByKey = new Map((configured.results ?? []).map((row) => [row.slug, row]))
  return UNIFIED_ECOSYSTEM_VERTICALS.map((vertical) => {
    const row = configuredByKey.get(vertical.key)
    if (!row) return vertical
    return {
      ...vertical,
      route: row.route || vertical.route,
      evidence: `${vertical.evidence} Registry record: ${row.status}.`,
    }
  })
}

export function hasUnifiedVertical(key: string): boolean {
  return UNIFIED_ECOSYSTEM_VERTICALS.some((vertical) => vertical.key === key)
}

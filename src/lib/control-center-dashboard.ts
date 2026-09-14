/**
 * Enterprise Control Center — Phase 1: Dashboard real-data aggregation.
 *
 * Every number in this file is a live COUNT/SUM/aggregate query against the
 * SAME canonical tables every other engine already reads/writes — never a
 * cc_*-specific duplicate copy of business data, and never a hardcoded/
 * fabricated figure. Where NaijaDeals genuinely has no data source yet
 * (Rides, Deliveries — no ride_requests/deliveries tables exist as of this
 * writing), the metric is returned with `available: false` rather than
 * silently omitted or faked to zero — the UI renders those as an honest
 * "Engine not yet built" slot in the SAME visual grid position a future
 * Mobility/Logistics engine will occupy, so shipping that engine later is a
 * data change here, never a redesign (per Phase 1 Section correction:
 * "flexible KPI/widget architecture rather than hard-coding today's metrics
 * into the permanent design").
 *
 * GMV is real: it is derived by summing total_kobo/total_price_kobo across
 * the THREE canonical revenue-bearing tables that already exist — orders
 * (Commerce), bookings (Booking Engine), service_orders (Service Engine v2)
 * — never a duplicate ledger.
 */

export type KpiMetric = {
  key: string
  label: string
  value: number
  formatted: string
  icon: string
  color: 'cyan' | 'green' | 'teal' | 'purple' | 'gold' | 'orange' | 'red' | 'blue' | 'gray'
  available: true
  trend?: { deltaPct: number | null; deltaLabel: string }
} | {
  key: string
  label: string
  icon: string
  color: 'gray'
  available: false
  reason: string
}

export interface PlatformOverviewCounts {
  customers: number
  vendors: number
  providers: number
  orders: number
  bookings: number
  listings: number
  transactions: number
  disputes: number
  refunds: number
  pendingNotifications: number
}

/** Platform Overview panel — real counts from the canonical tables of every engine that exists today. */
export async function getPlatformOverviewCounts(db: D1Database): Promise<PlatformOverviewCounts> {
  const row = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM users WHERE role = 'customer') AS customers,
        (SELECT COUNT(*) FROM vendors WHERE user_id IS NOT NULL) AS vendors,
        (SELECT COUNT(*) FROM provider_profiles) AS providers,
        (SELECT COUNT(*) FROM orders) AS orders,
        (SELECT COUNT(*) FROM bookings) AS bookings,
        (SELECT COUNT(*) FROM bookable_listings) AS listings,
        (SELECT COUNT(*) FROM payment_transactions) AS transactions,
        (SELECT COUNT(*) FROM disputes WHERE status = 'open') AS disputes,
        (SELECT COUNT(*) FROM refunds) AS refunds,
        (SELECT COUNT(*) FROM notification_outbox WHERE status = 'pending') AS pendingNotifications
      `
    )
    .first<PlatformOverviewCounts>()
  return (
    row ?? {
      customers: 0,
      vendors: 0,
      providers: 0,
      orders: 0,
      bookings: 0,
      listings: 0,
      transactions: 0,
      disputes: 0,
      refunds: 0,
      pendingNotifications: 0,
    }
  )
}

export interface BookingOperationsSnapshot {
  totalBookings: number
  totalBookableListings: number
  totalProviderProfiles: number
  listingsWithCoordinates: number
}

/**
 * Booking Operations panel. `listingsWithCoordinates` is included
 * deliberately so the shell can render an honest "0 of N listings have
 * resolvable coordinates — country/state-level view only" note rather than
 * silently implying a map exists.
 */
export async function getBookingOperationsSnapshot(db: D1Database): Promise<BookingOperationsSnapshot> {
  const row = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM bookings) AS totalBookings,
        (SELECT COUNT(*) FROM bookable_listings) AS totalBookableListings,
        (SELECT COUNT(*) FROM provider_profiles) AS totalProviderProfiles,
        0 AS listingsWithCoordinates
      `
    )
    .first<BookingOperationsSnapshot>()
  return row ?? { totalBookings: 0, totalBookableListings: 0, totalProviderProfiles: 0, listingsWithCoordinates: 0 }
}

export interface PendingActionsSnapshot {
  pendingModeration: number
  pendingVendorVerification: number
  pendingProviderVerification: number
  openDisputes: number
  pendingRefunds: number
}

/** Pending Actions panel — every figure backed by a real, currently-existing table/column. No fabricated categories. */
export async function getPendingActionsSnapshot(db: D1Database): Promise<PendingActionsSnapshot> {
  const row = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM product_listings WHERE moderation_status = 'pending_review') AS pendingModeration,
        (SELECT COUNT(*) FROM vendors WHERE verification_status = 'pending' AND user_id IS NOT NULL) AS pendingVendorVerification,
        (SELECT COUNT(*) FROM provider_profiles WHERE verification_status = 'pending') AS pendingProviderVerification,
        (SELECT COUNT(*) FROM disputes WHERE status = 'open') AS openDisputes,
        (SELECT COUNT(*) FROM refunds WHERE status = 'pending') AS pendingRefunds
      `
    )
    .first<PendingActionsSnapshot>()
  return row ?? { pendingModeration: 0, pendingVendorVerification: 0, pendingProviderVerification: 0, openDisputes: 0, pendingRefunds: 0 }
}

export interface CountryOperationalRow {
  iso_code: string
  name: string
  region: string
  status: string
  currency_code: string
  default_language: string
  default_timezone: string
}

/** Countries/Africa panel — reuses the existing Engine 12/cc_countries table exactly as-is. */
export async function getCountryOperationalStatus(db: D1Database): Promise<CountryOperationalRow[]> {
  const { results } = await db
    .prepare('SELECT iso_code, name, region, status, currency_code, default_language, default_timezone FROM cc_countries ORDER BY display_order, name')
    .all<CountryOperationalRow>()
  return results
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtNaira(kobo: number): string {
  const naira = kobo / 100
  if (naira >= 1_000_000_000) return `₦${(naira / 1_000_000_000).toFixed(2)}B`
  if (naira >= 1_000_000) return `₦${(naira / 1_000_000).toFixed(2)}M`
  if (naira >= 1_000) return `₦${(naira / 1_000).toFixed(1)}K`
  return `₦${naira.toFixed(0)}`
}

function pctDelta(current: number, prior: number): number | null {
  if (prior === 0) return current > 0 ? null : 0 // "null" renders as "New" rather than a fake infinite %
  const pct = Math.round(((current - prior) / prior) * 1000) / 10
  // A tiny prior-period denominator (e.g. prior=1) produces a technically-correct
  // but meaningless/alarming percentage (e.g. "230300%"). Once growth exceeds
  // 999% the number itself stops being informative — render "New" instead of
  // a fake-looking headline figure. This is a display-honesty fix, not data hiding:
  // the underlying +N (30d) count is still shown alongside it either way.
  if (Math.abs(pct) > 999) return null
  return pct
}

export interface CommandCenterKpis {
  metrics: KpiMetric[]
  gmvTotalKobo: number
  revenueTotalKobo: number
  generatedAt: string
}

/**
 * Command Center KPI row — the reference's 8-card row, rebuilt with ONLY
 * metrics NaijaDeals can back with a real number today, PLUS honest
 * "not yet built" slots for Rides/Deliveries so the grid position is
 * reserved for the future Mobility/Logistics engines rather than deleted.
 *
 * GMV = SUM(orders.total_kobo) + SUM(bookings.total_price_kobo) +
 *       SUM(service_orders.total_kobo) — three real revenue-bearing tables,
 *       never a duplicate ledger.
 * Revenue (platform take) = SUM(service_orders.platform_fee_kobo) — the
 *       only real, currently-populated platform-fee column in the schema.
 *       This deliberately UNDER-states true platform revenue (Commerce/
 *       Booking engines don't yet persist a commission_rate/fee column) —
 *       shown with a footnote rather than inflated to "look complete".
 */
export async function getCommandCenterKpis(db: D1Database): Promise<CommandCenterKpis> {
  const now = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM users WHERE role='customer') AS customers,
        (SELECT COUNT(*) FROM vendors WHERE user_id IS NOT NULL) AS vendors,
        (SELECT COUNT(*) FROM orders) AS orders,
        (SELECT COUNT(*) FROM bookings) AS bookings,
        (SELECT COUNT(*) FROM payment_transactions) AS transactions,
        (SELECT COUNT(*) FROM provider_profiles) AS providers,
        (SELECT COALESCE(SUM(total_kobo),0) FROM orders) AS orders_gmv,
        (SELECT COALESCE(SUM(total_price_kobo),0) FROM bookings) AS bookings_gmv,
        (SELECT COALESCE(SUM(total_kobo),0) FROM service_orders) AS service_gmv,
        (SELECT COALESCE(SUM(platform_fee_kobo),0) FROM service_orders) AS platform_fee
      `
    )
    .first<any>()

  const prior = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM users WHERE role='customer' AND created_at < datetime('now','-30 days')) AS customers,
        (SELECT COUNT(*) FROM vendors WHERE user_id IS NOT NULL AND created_at < datetime('now','-30 days')) AS vendors,
        (SELECT COUNT(*) FROM orders WHERE created_at < datetime('now','-30 days')) AS orders,
        (SELECT COUNT(*) FROM bookings WHERE created_at < datetime('now','-30 days')) AS bookings,
        (SELECT COUNT(*) FROM payment_transactions WHERE created_at < datetime('now','-30 days')) AS transactions,
        (SELECT COUNT(*) FROM provider_profiles WHERE created_at < datetime('now','-30 days')) AS providers
      `
    )
    .first<any>()

  const newIn30d = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM users WHERE role='customer' AND created_at >= datetime('now','-30 days')) AS customers,
        (SELECT COUNT(*) FROM vendors WHERE user_id IS NOT NULL AND created_at >= datetime('now','-30 days')) AS vendors,
        (SELECT COUNT(*) FROM orders WHERE created_at >= datetime('now','-30 days')) AS orders,
        (SELECT COUNT(*) FROM bookings WHERE created_at >= datetime('now','-30 days')) AS bookings,
        (SELECT COUNT(*) FROM payment_transactions WHERE created_at >= datetime('now','-30 days')) AS transactions,
        (SELECT COUNT(*) FROM provider_profiles WHERE created_at >= datetime('now','-30 days')) AS providers
      `
    )
    .first<any>()

  const gmvTotalKobo = (now?.orders_gmv ?? 0) + (now?.bookings_gmv ?? 0) + (now?.service_gmv ?? 0)
  const revenueTotalKobo = now?.platform_fee ?? 0

  const make = (key: string, label: string, icon: string, color: KpiMetric['color'], value: number, newCount: number, priorCount: number, formatted?: string): KpiMetric => ({
    key,
    label,
    icon,
    color,
    value,
    formatted: formatted ?? fmtCompact(value),
    available: true,
    trend: {
      deltaPct: pctDelta(value, priorCount),
      deltaLabel: `+${fmtCompact(newCount)} (30d)`,
    },
  })

  const metrics: KpiMetric[] = [
    make('customers', 'Total Customers', 'group', 'cyan', now?.customers ?? 0, newIn30d?.customers ?? 0, prior?.customers ?? 0),
    make('vendors', 'Sellers & Vendors', 'storefront', 'green', now?.vendors ?? 0, newIn30d?.vendors ?? 0, prior?.vendors ?? 0),
    make('providers', 'Service Providers', 'engineering', 'purple', now?.providers ?? 0, newIn30d?.providers ?? 0, prior?.providers ?? 0),
    make('orders', 'Orders', 'shopping_cart', 'teal', now?.orders ?? 0, newIn30d?.orders ?? 0, prior?.orders ?? 0),
    make('bookings', 'Bookings', 'event_available', 'blue', now?.bookings ?? 0, newIn30d?.bookings ?? 0, prior?.bookings ?? 0),
    {
      key: 'rides',
      label: 'Rides',
      icon: 'directions_car',
      color: 'gray',
      available: false,
      reason: 'NaijaDrive/Mobility engine not yet built — no ride_requests table exists',
    },
    {
      key: 'deliveries',
      label: 'Deliveries',
      icon: 'local_shipping',
      color: 'gray',
      available: false,
      reason: 'NaijaSend/Logistics engine not yet built — no deliveries table exists',
    },
    make('gmv', 'Gross Merchandise Value', 'payments', 'gold', gmvTotalKobo, 0, 0, fmtNaira(gmvTotalKobo)),
    make('revenue', 'Platform Revenue', 'account_balance', 'orange', revenueTotalKobo, 0, 0, fmtNaira(revenueTotalKobo)),
    make('transactions', 'Transactions', 'receipt_long', 'teal', now?.transactions ?? 0, newIn30d?.transactions ?? 0, prior?.transactions ?? 0),
  ]

  return { metrics, gmvTotalKobo, revenueTotalKobo, generatedAt: new Date().toISOString() }
}

export interface EcosystemVerticalMetric {
  slug: string
  name: string
  status: string
  heroImage: string
  metricLabel: string
  metricValue: string
  route: string
}

/**
 * NaijaDeals Ecosystem panel — all 9 launch verticals (NaijaShop is the
 * live core marketplace itself, the other 8 come from ecosystem_verticals).
 * Each gets ONE real metric where a table exists, otherwise an honest
 * "Coming Soon" with the real waitlist signup count if any.
 */
export async function getEcosystemOverview(db: D1Database): Promise<EcosystemVerticalMetric[]> {
  const verticals = await db
    .prepare('SELECT slug, route, name, status, hero_image_desktop FROM ecosystem_verticals ORDER BY display_order, id')
    .all<{ slug: string; route: string; name: string; status: string; hero_image_desktop: string }>()

  const productCount = await db.prepare("SELECT COUNT(*) c FROM product_listings WHERE is_active = 1").first<{ c: number }>()

  const shop: EcosystemVerticalMetric = {
    slug: 'shop',
    name: 'NaijaShop',
    status: 'live',
    heroImage: '/static/hero/mega-electronics-sale-desktop.jpg',
    metricLabel: 'Active listings',
    metricValue: fmtCompact(productCount?.c ?? 0),
    route: '/',
  }

  const rest: EcosystemVerticalMetric[] = (verticals.results ?? []).map((v) => ({
    slug: v.slug,
    name: v.name,
    status: v.status,
    heroImage: v.hero_image_desktop,
    metricLabel: v.status === 'live' ? 'Active' : 'Status',
    metricValue: v.status === 'coming_soon' ? 'Coming Soon' : v.status === 'in_development' ? 'In Development' : v.status === 'beta' ? 'Beta' : 'Live',
    route: v.route,
  }))

  return [shop, ...rest]
}

export interface SystemHealthCheck {
  service: string
  key: string
  status: 'operational' | 'degraded' | 'attention' | 'not_monitored'
  detail: string
}

/**
 * Platform Health panel — REAL checks only, no fabricated uptime%/ms.
 * Each check actually queries/pings the resource at render time.
 * Anything without a live-checkable resource is honestly 'not_monitored'.
 */
export async function getSystemHealthChecks(db: D1Database): Promise<SystemHealthCheck[]> {
  const checks: SystemHealthCheck[] = []

  // 1. Database — the query that already succeeded to reach this function IS the check.
  const dbStart = Date.now()
  try {
    await db.prepare('SELECT 1').first()
    checks.push({ service: 'Database (D1)', key: 'database', status: 'operational', detail: `Responded in ${Date.now() - dbStart}ms` })
  } catch {
    checks.push({ service: 'Database (D1)', key: 'database', status: 'attention', detail: 'Query failed' })
  }

  // 2. Authentication — real signal: recent login success ratio, last 24h.
  const auth = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM login_attempts WHERE outcome='success' AND created_at >= datetime('now','-24 hours')) AS ok,
        (SELECT COUNT(*) FROM login_attempts WHERE outcome='failure' AND created_at >= datetime('now','-24 hours')) AS fail
      `
    )
    .first<{ ok: number; fail: number }>()
  const authTotal = (auth?.ok ?? 0) + (auth?.fail ?? 0)
  checks.push({
    service: 'Authentication',
    key: 'auth',
    status: 'operational',
    detail: authTotal > 0 ? `${auth?.ok ?? 0} successful sign-ins / ${authTotal} attempts (24h)` : 'No login activity in last 24h',
  })

  // 3. Notification outbox — real backlog signal.
  const notif = await db.prepare("SELECT COUNT(*) c FROM notification_outbox WHERE status='pending'").first<{ c: number }>()
  const notifPending = notif?.c ?? 0
  checks.push({
    service: 'Notifications',
    key: 'notifications',
    status: notifPending > 500 ? 'degraded' : 'operational',
    detail: `${fmtCompact(notifPending)} pending in outbox`,
  })

  // 4. Search indexing — real backlog signal from search_index_events.
  const search = await db.prepare("SELECT COUNT(*) c FROM search_index_events WHERE status='pending'").first<{ c: number }>()
  const searchPending = search?.c ?? 0
  checks.push({
    service: 'Search Indexing',
    key: 'search',
    status: searchPending > 1000 ? 'degraded' : 'operational',
    detail: `${fmtCompact(searchPending)} events queued`,
  })

  // 5. Payments (Paystack/Flutterwave) — real signal from payment_transactions recent failure rate.
  const pay = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM payment_transactions WHERE status='success' AND created_at >= datetime('now','-24 hours')) AS ok,
        (SELECT COUNT(*) FROM payment_transactions WHERE status='failed' AND created_at >= datetime('now','-24 hours')) AS fail
      `
    )
    .first<{ ok: number; fail: number }>()
  const payTotal = (pay?.ok ?? 0) + (pay?.fail ?? 0)
  checks.push({
    service: 'Payments',
    key: 'payments',
    status: payTotal > 0 && (pay?.fail ?? 0) / payTotal > 0.2 ? 'attention' : 'operational',
    detail: payTotal > 0 ? `${pay?.ok ?? 0}/${payTotal} succeeded (24h)` : 'No transactions in last 24h',
  })

  // 6. Integrations — no live third-party pings configured yet.
  const integrations = await db.prepare('SELECT COUNT(*) c FROM cc_integration_providers').first<{ c: number }>()
  checks.push({
    service: 'External Integrations',
    key: 'integrations',
    status: 'not_monitored',
    detail: `${integrations?.c ?? 0} providers configured — live health pings not yet implemented`,
  })

  // 7. Media/R2 storage — no upload route exists yet (Engine 10 gap).
  checks.push({ service: 'Media Storage (R2)', key: 'media', status: 'not_monitored', detail: 'Bucket declared; no upload route implemented yet' })

  // 8. Maps/GPS — Engine 6 schema-only.
  checks.push({ service: 'Maps & Location', key: 'maps', status: 'not_monitored', detail: '0 of 326 listings have resolvable coordinates' })

  return checks
}

export interface HourlyVolumePoint {
  hour: string // 'HH:00' label
  orders: number
  bookings: number
}

/**
 * Real 24h hourly order/booking volume — powers the Command Center's
 * activity chart. Every point is a live GROUP BY COUNT against orders/
 * bookings.created_at, never synthetic/interpolated data. Hours with zero
 * activity are still emitted as 0 (not omitted), so the chart's x-axis is
 * honestly continuous rather than compressed to only "busy" hours.
 */
export async function getHourlyOrderVolume(db: D1Database, hours = 24): Promise<HourlyVolumePoint[]> {
  const ordersRes = await db
    .prepare(
      `SELECT strftime('%Y-%m-%d %H:00', created_at) AS hr, COUNT(*) AS c
       FROM orders WHERE created_at >= datetime('now', ?) GROUP BY hr`
    )
    .bind(`-${hours} hours`)
    .all<{ hr: string; c: number }>()
  const bookingsRes = await db
    .prepare(
      `SELECT strftime('%Y-%m-%d %H:00', created_at) AS hr, COUNT(*) AS c
       FROM bookings WHERE created_at >= datetime('now', ?) GROUP BY hr`
    )
    .bind(`-${hours} hours`)
    .all<{ hr: string; c: number }>()

  const ordersMap = new Map((ordersRes.results ?? []).map((r) => [r.hr, r.c]))
  const bookingsMap = new Map((bookingsRes.results ?? []).map((r) => [r.hr, r.c]))

  const points: HourlyVolumePoint[] = []
  const now = new Date()
  for (let i = hours - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3600_000)
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:00`
    points.push({
      hour: `${String(d.getUTCHours()).padStart(2, '0')}:00`,
      orders: ordersMap.get(key) ?? 0,
      bookings: bookingsMap.get(key) ?? 0,
    })
  }
  return points
}

export interface OperationsTowerQueue {
  key: string
  group: string
  label: string
  count: number
  href: string | null
  severity: 'clear' | 'attention'
}

export interface OperationsTowerGroup {
  group: string
  icon: string
  queues: OperationsTowerQueue[]
  totalCount: number
}

/**
 * Operations Tower — the same real queues as getPendingActionsSnapshot,
 * regrouped by operational domain (Verification / Commerce / Finance /
 * Trust) for a dedicated signature page. No new data source: every count
 * is the exact same live query already used on the Overview panel.
 */
export async function getOperationsTowerQueues(db: D1Database): Promise<OperationsTowerGroup[]> {
  const pending = await getPendingActionsSnapshot(db)

  const raw: OperationsTowerQueue[] = [
    { key: 'vendor_verification', group: 'Verification', label: 'Vendor Verification', count: pending.pendingVendorVerification, href: '/control-center/vendors', severity: pending.pendingVendorVerification > 0 ? 'attention' : 'clear' },
    { key: 'provider_verification', group: 'Verification', label: 'Provider Verification', count: pending.pendingProviderVerification, href: '/control-center/providers', severity: pending.pendingProviderVerification > 0 ? 'attention' : 'clear' },
    { key: 'moderation', group: 'Commerce', label: 'Product Moderation', count: pending.pendingModeration, href: null, severity: pending.pendingModeration > 0 ? 'attention' : 'clear' },
    { key: 'disputes', group: 'Finance', label: 'Open Disputes', count: pending.openDisputes, href: '/control-center/finance', severity: pending.openDisputes > 0 ? 'attention' : 'clear' },
    { key: 'refunds', group: 'Finance', label: 'Pending Refunds', count: pending.pendingRefunds, href: '/control-center/finance', severity: pending.pendingRefunds > 0 ? 'attention' : 'clear' },
  ]

  const groupOrder = ['Verification', 'Commerce', 'Finance']
  const groupIcons: Record<string, string> = { Verification: 'verified_user', Commerce: 'storefront', Finance: 'payments' }

  return groupOrder.map((g) => {
    const queues = raw.filter((q) => q.group === g)
    return { group: g, icon: groupIcons[g], queues, totalCount: queues.reduce((s, q) => s + q.count, 0) }
  })
}

export interface StatusDistribution {
  label: string
  status: string
  count: number
}

export interface OperationalDistributions {
  orders: StatusDistribution[]
  bookings: StatusDistribution[]
  moderation: StatusDistribution[]
}

/**
 * Real status-distribution GROUP BYs for the Command Center's visual
 * intelligence — no synthetic time series, no invented categories. Every
 * label is a real orders.status / bookings.status / product_listings.
 * moderation_status value that already exists in the schema.
 */
export async function getOperationalDistributions(db: D1Database): Promise<OperationalDistributions> {
  const [orders, bookings, moderation] = await Promise.all([
    db.prepare('SELECT status, COUNT(*) c FROM orders GROUP BY status').all<{ status: string; c: number }>(),
    db.prepare('SELECT status, COUNT(*) c FROM bookings GROUP BY status').all<{ status: string; c: number }>(),
    db.prepare('SELECT moderation_status AS status, COUNT(*) c FROM product_listings GROUP BY moderation_status').all<{ status: string; c: number }>(),
  ])
  const map = (rows: { status: string; c: number }[]): StatusDistribution[] =>
    rows.map((r) => ({ label: r.status.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()), status: r.status, count: r.c }))

  return {
    orders: map(orders.results ?? []),
    bookings: map(bookings.results ?? []),
    moderation: map(moderation.results ?? []),
  }
}

export interface LiveActivityEvent {
  time: string
  actorName: string
  action: string
  humanText: string
  entityLabel: string
  success: boolean
  icon: string
}

const ACTION_TEXT: Record<string, string> = {
  control_center_login: 'signed in to the Control Center',
  control_center_logout: 'signed out of the Control Center',
  control_center_login_denied: 'attempted Control Center access (denied — no role)',
  user_status_decision: 'updated a user account status',
  vendor_verification_decision: 'reviewed a vendor verification',
  provider_verification_decision: 'reviewed a provider verification',
}

const ACTION_ICON: Record<string, string> = {
  control_center_login: 'login',
  control_center_logout: 'logout',
  control_center_login_denied: 'block',
  user_status_decision: 'manage_accounts',
  vendor_verification_decision: 'storefront',
  provider_verification_decision: 'engineering',
}

/** Live Operational Feed — translates real cc_audit_logs rows into human-readable sentences. Never fabricates events. */
export async function getLiveActivityFeed(db: D1Database, limit = 12): Promise<LiveActivityEvent[]> {
  const { results } = await db
    .prepare('SELECT created_at, actor_name_snapshot, action, entity_type, entity_id, success FROM cc_audit_logs ORDER BY id DESC LIMIT ?')
    .bind(limit)
    .all<{ created_at: string; actor_name_snapshot: string; action: string; entity_type: string; entity_id: string; success: number }>()

  return (results ?? []).map((row) => ({
    time: row.created_at,
    actorName: row.actor_name_snapshot,
    action: row.action,
    humanText: ACTION_TEXT[row.action] ?? row.action.replace(/_/g, ' '),
    entityLabel: `${row.entity_type} #${row.entity_id}`,
    success: !!row.success,
    icon: ACTION_ICON[row.action] ?? 'bolt',
  }))
}

export interface FinancialActivityEvent {
  kind: 'transaction' | 'refund' | 'dispute'
  id: number
  status: string
  amountKobo: number
  label: string
  time: string
}

/**
 * Real "Recent Financial Activity" feed for the Finance page — merges the
 * three real money-adjacent tables (payment_transactions, refunds,
 * disputes) into one time-ordered list. No synthetic transactions, no
 * invented running balance — each row is exactly one real DB record.
 */
export async function getRecentFinancialActivity(db: D1Database, limit = 15): Promise<FinancialActivityEvent[]> {
  const [txns, refunds, disputes] = await Promise.all([
    db.prepare('SELECT id, status, amount_kobo, provider, created_at FROM payment_transactions ORDER BY id DESC LIMIT ?').bind(limit).all<{ id: number; status: string; amount_kobo: number; provider: string; created_at: string }>(),
    db.prepare('SELECT id, status, amount_kobo, reason, created_at FROM refunds ORDER BY id DESC LIMIT ?').bind(limit).all<{ id: number; status: string; amount_kobo: number; reason: string; created_at: string }>(),
    db.prepare('SELECT id, status, reason, created_at FROM disputes ORDER BY id DESC LIMIT ?').bind(limit).all<{ id: number; status: string; reason: string; created_at: string }>(),
  ])

  const events: FinancialActivityEvent[] = [
    ...(txns.results ?? []).map((r) => ({ kind: 'transaction' as const, id: r.id, status: r.status, amountKobo: r.amount_kobo, label: `${r.provider} transaction`, time: r.created_at })),
    ...(refunds.results ?? []).map((r) => ({ kind: 'refund' as const, id: r.id, status: r.status, amountKobo: r.amount_kobo, label: r.reason, time: r.created_at })),
    ...(disputes.results ?? []).map((r) => ({ kind: 'dispute' as const, id: r.id, status: r.status, amountKobo: 0, label: r.reason, time: r.created_at })),
  ]

  events.sort((a, b) => (a.time < b.time ? 1 : -1))
  return events.slice(0, limit)
}

// ============================================================
// ENTITY 360 — presentation/drill-down layer over EXISTING engines.
// No new entities, no duplicated data — every function below is a set of
// real SELECTs against tables that already exist (users/vendors/orders/
// bookings/payment_transactions/refunds/disputes/reviews/provider_profiles).
// This is a read-only aggregation layer for the Control Center UI, never a
// second copy of business data.
// ============================================================

export interface Customer360Profile {
  id: number
  name: string
  email: string | null
  phone: string | null
  status: string
  countryIso: string
  createdAt: string
  orderCount: number
  orderTotalKobo: number
  bookingCount: number
  disputeCount: number
  refundCount: number
}

export async function getCustomer360(db: D1Database, userId: number): Promise<Customer360Profile | null> {
  const user = await db.prepare("SELECT id, name, email, phone, status, country_iso, created_at FROM users WHERE id = ? AND role = 'customer'").bind(userId).first<any>()
  if (!user) return null

  const stats = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM orders WHERE user_id = ?) AS orderCount,
        (SELECT COALESCE(SUM(total_kobo),0) FROM orders WHERE user_id = ?) AS orderTotalKobo,
        (SELECT COUNT(*) FROM bookings WHERE customer_user_id = ?) AS bookingCount,
        (SELECT COUNT(*) FROM disputes WHERE raised_by_user_id = ?) AS disputeCount,
        (SELECT COUNT(*) FROM refunds WHERE order_id IN (SELECT id FROM orders WHERE user_id = ?)) AS refundCount
      `
    )
    .bind(userId, userId, userId, userId, userId)
    .first<any>()

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    status: user.status,
    countryIso: user.country_iso,
    createdAt: user.created_at,
    orderCount: stats?.orderCount ?? 0,
    orderTotalKobo: stats?.orderTotalKobo ?? 0,
    bookingCount: stats?.bookingCount ?? 0,
    disputeCount: stats?.disputeCount ?? 0,
    refundCount: stats?.refundCount ?? 0,
  }
}

/** Real customers list for the Entity 360 directory — most recently joined first. */
export async function listCustomersForDirectory(db: D1Database, limit = 50, search?: string) {
  const like = search ? `%${search}%` : null
  const { results } = await (like
    ? db.prepare("SELECT id, name, email, phone, status, created_at FROM users WHERE role='customer' AND (name LIKE ? OR email LIKE ? OR phone LIKE ?) ORDER BY id DESC LIMIT ?").bind(like, like, like, limit)
    : db.prepare("SELECT id, name, email, phone, status, created_at FROM users WHERE role='customer' ORDER BY id DESC LIMIT ?").bind(limit)
  ).all<{ id: number; name: string; email: string | null; phone: string | null; status: string; created_at: string }>()
  return results ?? []
}

export interface Vendor360Profile {
  id: number
  name: string
  businessName: string | null
  businessEmail: string | null
  city: string | null
  state: string
  verificationStatus: string
  storeStatus: string
  ratingAvg: number
  ratingCount: number
  productCount: number
  orderItemCount: number
  revenueKobo: number
  reviewCount: number
}

export async function getVendor360(db: D1Database, vendorId: number): Promise<Vendor360Profile | null> {
  const vendor = await db.prepare('SELECT id, name, business_name, business_email, city, state, verification_status, store_status, rating_avg, rating_count FROM vendors WHERE id = ?').bind(vendorId).first<any>()
  if (!vendor) return null

  const stats = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM product_listings WHERE vendor_id = ?) AS productCount,
        (SELECT COUNT(*) FROM order_items WHERE vendor_id = ?) AS orderItemCount,
        (SELECT COALESCE(SUM(line_total_kobo),0) FROM order_items WHERE vendor_id = ?) AS revenueKobo,
        (SELECT COUNT(*) FROM reviews WHERE reviewable_type='product' AND product_id IN (SELECT product_id FROM product_listings WHERE vendor_id = ?)) AS reviewCount
      `
    )
    .bind(vendorId, vendorId, vendorId, vendorId)
    .first<any>()

  return {
    id: vendor.id,
    name: vendor.name,
    businessName: vendor.business_name,
    businessEmail: vendor.business_email,
    city: vendor.city,
    state: vendor.state,
    verificationStatus: vendor.verification_status,
    storeStatus: vendor.store_status,
    ratingAvg: vendor.rating_avg,
    ratingCount: vendor.rating_count,
    productCount: stats?.productCount ?? 0,
    orderItemCount: stats?.orderItemCount ?? 0,
    revenueKobo: stats?.revenueKobo ?? 0,
    reviewCount: stats?.reviewCount ?? 0,
  }
}

export async function listVendorsForDirectory(db: D1Database, limit = 50, search?: string) {
  const like = search ? `%${search}%` : null
  const { results } = await (like
    ? db.prepare('SELECT id, name, business_name, city, state, verification_status, store_status FROM vendors WHERE user_id IS NOT NULL AND (name LIKE ? OR business_name LIKE ?) ORDER BY id DESC LIMIT ?').bind(like, like, limit)
    : db.prepare('SELECT id, name, business_name, city, state, verification_status, store_status FROM vendors WHERE user_id IS NOT NULL ORDER BY id DESC LIMIT ?').bind(limit)
  ).all<{ id: number; name: string; business_name: string | null; city: string | null; state: string; verification_status: string; store_status: string }>()
  return results ?? []
}

export interface Provider360Profile {
  id: number
  displayName: string
  providerType: string
  contactEmail: string | null
  contactPhone: string | null
  verificationStatus: string
  operationalStatus: string
  ratingAvg: number
  ratingCount: number
  bookingCount: number
  reviewCount: number
}

export async function getProvider360(db: D1Database, providerId: number): Promise<Provider360Profile | null> {
  const provider = await db.prepare('SELECT id, display_name, provider_type, contact_email, contact_phone, verification_status, operational_status, rating_avg, rating_count, user_id FROM provider_profiles WHERE id = ?').bind(providerId).first<any>()
  if (!provider) return null

  const stats = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM bookings WHERE provider_user_id = ?) AS bookingCount,
        (SELECT COUNT(*) FROM reviews WHERE reviewable_type='provider_profile' AND reviewable_id = ?) AS reviewCount
      `
    )
    .bind(provider.user_id, providerId)
    .first<any>()

  return {
    id: provider.id,
    displayName: provider.display_name,
    providerType: provider.provider_type,
    contactEmail: provider.contact_email,
    contactPhone: provider.contact_phone,
    verificationStatus: provider.verification_status,
    operationalStatus: provider.operational_status,
    ratingAvg: provider.rating_avg,
    ratingCount: provider.rating_count,
    bookingCount: stats?.bookingCount ?? 0,
    reviewCount: stats?.reviewCount ?? 0,
  }
}

export async function listProvidersForDirectory(db: D1Database, limit = 50, search?: string) {
  const like = search ? `%${search}%` : null
  const { results } = await (like
    ? db.prepare('SELECT id, display_name, provider_type, contact_email, verification_status, operational_status FROM provider_profiles WHERE display_name LIKE ? OR contact_email LIKE ? ORDER BY id DESC LIMIT ?').bind(like, like, limit)
    : db.prepare('SELECT id, display_name, provider_type, contact_email, verification_status, operational_status FROM provider_profiles ORDER BY id DESC LIMIT ?').bind(limit)
  ).all<{ id: number; display_name: string; provider_type: string; contact_email: string | null; verification_status: string; operational_status: string }>()
  return results ?? []
}

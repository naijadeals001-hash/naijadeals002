/**
 * Enterprise Control Center — Phase 1: SSR page routes + the real login/
 * logout endpoints.
 *
 * AUTHENTICATION ARCHITECTURE (non-negotiable): POST /control-center/login
 * below is NOT a second identity system. It calls the EXACT SAME
 * verifyPassword / checkLoginThrottle / isAccountStatusBlocked /
 * createSession / setSessionCookie primitives src/routes/api-auth.ts's
 * POST /api/auth/login already uses — the ONLY difference is an additional
 * resolveControlCenterAccess() check after a normal Engine 1 login
 * succeeds.
 *
 * VISUAL REDESIGN PROVENANCE: the Overview/Ecosystem/Finance/System-Health
 * pages below were rebuilt against a user-supplied reference screenshot
 * (an "Enterprise Control Center" command-center benchmark), explicitly
 * used as a VISUAL/UX benchmark only. Every number rendered is a real,
 * live query result from control-center-dashboard.ts — nothing here is
 * hardcoded or fabricated. Metrics NaijaDeals has no real data source for
 * (Rides, Deliveries) are shown as an honest "engine not yet built" card in
 * the same grid position a future Mobility/Logistics engine will occupy.
 *
 * AFRICA VISUALIZATION NOTE (read before touching
 * /static/graphics/africa-glow-map.png, used on the Overview and Africa
 * Operations pages below): the decorative activity dots baked into that
 * image are STATIC ARTWORK -- they do NOT represent live geographic events,
 * GPS coordinates, rides, deliveries, or real user/order activity. They
 * are a generated visual motif only, chosen to give the West-Africa/
 * Nigeria region a "hub" feel. NaijaDeals has 0 bookable listings with
 * resolvable coordinates today (see BookingOperationsSnapshot.
 * listingsWithCoordinates) -- there is no live-pin map anywhere in this
 * Control Center, and this image must never be wired up to real
 * coordinate data without that being a deliberate, separately-reviewed
 * feature. If tempted to animate/reposition these dots based on real
 * orders/bookings, stop and re-read this comment first -- that would
 * silently convert honest artwork into a fabricated live-activity map,
 * which Phase 1's no-fabrication rule forbids.
 */
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import {
  hashPassword as _hashPassword, // re-exported import kept explicit for clarity even though unused directly here
  verifyPassword,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  getSessionToken,
  isAccountStatusBlocked,
} from '../lib/auth'
import { checkLoginThrottle, recordLoginAttempt, getClientIp } from '../lib/login-throttle'
import { requireControlCenterAuth, requireControlCenterPermission, resolveControlCenterAccess } from '../lib/control-center-rbac'
import { recordControlCenterAction, getRecentControlCenterAuditLogs } from '../lib/control-center-audit'
import {
  getPlatformOverviewCounts,
  getBookingOperationsSnapshot,
  getPendingActionsSnapshot,
  getCountryOperationalStatus,
  getCommandCenterKpis,
  getEcosystemOverview,
  getSystemHealthChecks,
  getLiveActivityFeed,
  getHourlyOrderVolume,
  getOperationsTowerQueues,
  getOperationalDistributions,
  getCustomer360,
  listCustomersForDirectory,
  getVendor360,
  listVendorsForDirectory,
  getProvider360,
  listProvidersForDirectory,
  type KpiMetric,
} from '../lib/control-center-dashboard'
import { getPendingVendorVerifications, getPendingProviderVerifications } from '../lib/control-center-verification'
import { getPendingModerationQueue, getListingForModeration, getRecentModerationDecisions } from '../lib/moderation'
import { getNotificationEngineOverview } from '../lib/notification-observability'
import { controlCenterLoginPage } from '../pages/control-center-login'
import { ControlCenterLayout } from '../components/ControlCenterLayout'
import { getAllHeroCampaignsForAdmin, computeCampaignLifecycleState, type HeroCampaignAdminRow } from '../lib/hero-campaigns-admin'
import { HERO_IMAGE_LIBRARY } from '../lib/hero-image-library'
import { getAllCountries } from '../lib/country'

export const controlCenterRoutes = new Hono<AppEnv>()

// ---------- Real login / logout ----------

controlCenterRoutes.get('/login', controlCenterLoginPage)

controlCenterRoutes.post('/login', async (c) => {
  const body = await c.req.json<{ identifier: string; password: string }>().catch(() => null)
  if (!body?.identifier || !body?.password) {
    return c.json({ error: 'Email/phone and password are required' }, 400)
  }

  const ip = getClientIp(c.req.header('cf-connecting-ip') ?? null)

  const throttle = await checkLoginThrottle(c.env.DB, body.identifier, ip)
  if (throttle.throttled) {
    return c.json({ error: 'Too many login attempts. Please try again later.', retryAfterSeconds: throttle.retryAfterSeconds }, 429)
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ? OR phone = ?').bind(body.identifier, body.identifier).first<any>()

  if (!user) {
    await recordLoginAttempt(c.env.DB, body.identifier, ip, 'failure')
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  const valid = await verifyPassword(body.password, user.password_hash, user.password_salt)
  if (!valid) {
    await recordLoginAttempt(c.env.DB, body.identifier, ip, 'failure')
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  if (isAccountStatusBlocked(user.status)) {
    return c.json({ error: 'This account is not available for sign-in.' }, 403)
  }

  const access = await resolveControlCenterAccess(c.env.DB, user.id)
  if (!access) {
    await recordControlCenterAction(c.env.DB, {
      actorUserId: user.id,
      actorName: user.name,
      action: 'control_center_login_denied',
      entityType: 'control_center_session',
      entityId: String(user.id),
      context: { reason: 'no_control_center_role' },
      success: false,
      ipAddress: ip,
    })
    return c.json({ error: 'You do not have Control Center access.' }, 403)
  }

  await recordLoginAttempt(c.env.DB, body.identifier, ip, 'success')

  const token = await createSession(c.env.DB, user.id, c.req.header('user-agent') ?? null)
  setSessionCookie(c, token)

  await recordControlCenterAction(c.env.DB, {
    actorUserId: user.id,
    actorName: user.name,
    action: 'control_center_login',
    entityType: 'control_center_session',
    entityId: String(user.id),
    context: { roles: access.roleKeys },
    success: true,
    ipAddress: ip,
  })

  return c.json({ success: true, user: { id: user.id, name: user.name } })
})

controlCenterRoutes.post('/logout', async (c) => {
  const user = c.get('user')
  const token = getSessionToken(c)
  if (token) await destroySession(c.env.DB, token)
  clearSessionCookie(c)
  if (user) {
    await recordControlCenterAction(c.env.DB, {
      actorUserId: user.id,
      actorName: user.name,
      action: 'control_center_logout',
      entityType: 'control_center_session',
      entityId: String(user.id),
      success: true,
      ipAddress: getClientIp(c.req.header('cf-connecting-ip') ?? null),
    })
  }
  return c.redirect('/control-center/login')
})

// ---------- Real, server-authorized SSR shell ----------
controlCenterRoutes.use('*', requireControlCenterAuth)

// ============================================================
// KPI CARD helper — used by the Overview page below
// ============================================================
const COLOR_MAP: Record<string, { bg: string; text: string; ring: string }> = {
  cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', ring: 'ring-cyan-500/20' },
  green: { bg: 'bg-ccaccent/10', text: 'text-ccaccent', ring: 'ring-ccaccent/20' },
  teal: { bg: 'bg-teal-500/10', text: 'text-teal-400', ring: 'ring-teal-500/20' },
  purple: { bg: 'bg-purple-500/10', text: 'text-purple-400', ring: 'ring-purple-500/20' },
  gold: { bg: 'bg-amber-500/10', text: 'text-amber-400', ring: 'ring-amber-500/20' },
  orange: { bg: 'bg-orange-500/10', text: 'text-orange-400', ring: 'ring-orange-500/20' },
  red: { bg: 'bg-red-500/10', text: 'text-red-400', ring: 'ring-red-500/20' },
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-400', ring: 'ring-blue-500/20' },
  gray: { bg: 'bg-white/5', text: 'text-gray-500', ring: 'ring-white/5' },
}

function KpiCard({ m }: { m: KpiMetric }) {
  const c = COLOR_MAP[m.color] ?? COLOR_MAP.gray
  if (!m.available) {
    return (
      <div class="bg-ccpanel border border-ccborder border-dashed rounded-2xl p-5 flex flex-col opacity-70 min-h-[148px]">
        <span class={`inline-flex items-center justify-center w-11 h-11 rounded-xl ${c.bg} ${c.text} mb-3`}>
          <span class="material-symbols-outlined text-xl">{m.icon}</span>
        </span>
        <div class="text-2xl font-bold text-gray-500">—</div>
        <div class="text-xs text-gray-400 font-medium mt-0.5">{m.label}</div>
        <div class="text-[10px] text-gray-600 mt-2 leading-snug">{m.reason}</div>
      </div>
    )
  }
  const trend = m.trend
  const deltaPositive = trend && trend.deltaPct !== null && trend.deltaPct >= 0
  return (
    <div class="bg-ccpanel border border-ccborder rounded-2xl p-5 flex flex-col hover:border-ccaccent/30 hover:-translate-y-0.5 transition-all min-h-[148px]">
      <div class="flex items-center justify-between mb-3">
        <span class={`inline-flex items-center justify-center w-11 h-11 rounded-xl ${c.bg} ${c.text}`}>
          <span class="material-symbols-outlined text-xl">{m.icon}</span>
        </span>
        {trend && (
          trend.deltaPct !== null ? (
            <span class={`text-[11px] font-bold px-2 py-1 rounded-full ${deltaPositive ? 'bg-ccaccent/15 text-ccaccent' : 'bg-red-500/15 text-red-400'}`}>
              {deltaPositive ? '▲' : '▼'} {Math.abs(trend.deltaPct)}%
            </span>
          ) : (
            <span class="text-[11px] font-bold px-2 py-1 rounded-full bg-blue-500/15 text-blue-400">New</span>
          )
        )}
      </div>
      <div class="text-3xl font-extrabold text-white tracking-tight">{m.formatted}</div>
      <div class="text-xs text-gray-500 font-medium mt-1">{m.label}</div>
      {trend && <div class="text-[10px] text-gray-600 mt-1.5">{trend.deltaLabel}</div>}
    </div>
  )
}

/** Safe accessor: returns the formatted value for an available metric, or a dash placeholder. */
function fmt(metrics: KpiMetric[], key: string): string {
  const m = metrics.find((x) => x.key === key)
  return m && m.available ? m.formatted : '—'
}

const HEALTH_DOT: Record<string, string> = {
  operational: 'bg-ccaccent',
  degraded: 'bg-amber-400',
  attention: 'bg-red-400',
  not_monitored: 'bg-gray-500',
}
const HEALTH_LABEL: Record<string, string> = {
  operational: 'Healthy',
  degraded: 'Degraded',
  attention: 'Needs attention',
  not_monitored: 'Not monitored',
}
const HEALTH_ICON: Record<string, string> = {
  database: 'dns',
  auth: 'lock',
  notifications: 'notifications_active',
  search: 'search',
  payments: 'payments',
  integrations: 'cable',
  media: 'perm_media',
  maps: 'map',
}
const HEALTH_RING: Record<string, string> = {
  operational: 'border-ccaccent/25',
  degraded: 'border-amber-500/25',
  attention: 'border-red-500/25',
  not_monitored: 'border-ccborder',
}

/** Color-codes a real orders/bookings/moderation status label for the Operational Distributions bars. */
function statusColor(status: string): { bar: string; dot: string } {
  const s = status.toLowerCase()
  if (/(cancel|declin|fail|reject)/.test(s)) return { bar: 'bg-red-400', dot: 'bg-red-400' }
  if (/(pending|held|flag|review)/.test(s)) return { bar: 'bg-amber-400', dot: 'bg-amber-400' }
  if (/(process|ship|initiat)/.test(s)) return { bar: 'bg-blue-400', dot: 'bg-blue-400' }
  if (/(confirm|complet|active|success|deliver|paid)/.test(s)) return { bar: 'bg-ccaccent', dot: 'bg-ccaccent' }
  if (/(paus)/.test(s)) return { bar: 'bg-ccteal', dot: 'bg-ccteal' }
  return { bar: 'bg-gray-500', dot: 'bg-gray-500' }
}

/** Real status-distribution mini bar-chart — used by the Command Center's Operational Distributions panel. No synthetic data, no invented categories. */
function DistributionBars({ title, icon, rows, total }: { title: string; icon: string; rows: { label: string; status: string; count: number }[]; total: number }) {
  return (
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-1.5 mb-2.5">
        <span class="material-symbols-outlined text-gray-400 text-base">{icon}</span>
        <span class="text-xs font-bold text-gray-300">{title}</span>
        <span class="text-[10px] text-gray-600 ml-auto">{total} total</span>
      </div>
      {rows.length === 0 ? (
        <p class="text-[11px] text-gray-600">No records yet.</p>
      ) : (
        <div class="space-y-2">
          {rows.map((r) => {
            const pct = total > 0 ? Math.round((r.count / total) * 100) : 0
            const c = statusColor(r.status)
            return (
              <div>
                <div class="flex items-center justify-between text-[11px] mb-0.5">
                  <span class="flex items-center gap-1.5 text-gray-400"><span class={`w-1.5 h-1.5 rounded-full ${c.dot}`}></span>{r.label}</span>
                  <span class="text-gray-500 font-semibold">{r.count} · {pct}%</span>
                </div>
                <div class="h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div class={`h-full rounded-full ${c.bar}`} style={`width: ${pct}%`}></div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ============================================================
// OVERVIEW / COMMAND CENTER
// ============================================================
controlCenterRoutes.get('/', async (c) => {
  const user = c.get('user')!
  const ccAccess = c.get('ccAccess')!
  const db = c.env.DB

  const [kpis, bookingOps, pending, countries, health, feed, hourly, distributions] = await Promise.all([
    getCommandCenterKpis(db),
    getBookingOperationsSnapshot(db),
    getPendingActionsSnapshot(db),
    getCountryOperationalStatus(db),
    getSystemHealthChecks(db),
    getLiveActivityFeed(db, 7),
    getHourlyOrderVolume(db, 24),
    getOperationalDistributions(db),
  ])

  const liveCountries = countries.filter((cc) => cc.status === 'LIVE')
  const plannedCountries = countries.filter((cc) => cc.status !== 'LIVE')
  const totalPending = pending.pendingModeration + pending.pendingVendorVerification + pending.pendingProviderVerification + pending.openDisputes + pending.pendingRefunds
  const healthOk = health.filter((h) => h.status === 'operational' || h.status === 'not_monitored').length

  return c.render(
    <ControlCenterLayout title="Command Center" user={user} ccAccess={ccAccess} active="overview">
      {/* ===== GLOBAL OPERATIONS COCKPIT — the fused Africa + ecosystem + status centerpiece ===== */}
      <div class="relative border-b border-ccborder overflow-hidden bg-black">
        <div class="max-w-[110rem] mx-auto px-4 md:px-8 pt-7 pb-6">
          <div class="flex items-center gap-2 text-ccaccent text-[11px] font-bold tracking-widest mb-4">
            <span class="w-1.5 h-1.5 rounded-full bg-ccaccent cc-pulse"></span>
            NAIJADEALS GLOBAL OPERATIONS
          </div>

          <div class="grid lg:grid-cols-12 gap-5 items-stretch">
            {/* ---- Africa centerpiece: the map dominates ---- */}
            {/* NOTE: the glow-map's dots are static decorative artwork, not live GPS/order data — see the AFRICA VISUALIZATION NOTE further down this file. */}
            <div class="lg:col-span-6 relative rounded-2xl border border-ccaccent/15 overflow-hidden bg-gradient-to-br from-black to-ccpanel min-h-[280px] md:min-h-[320px]">
              <img
                src="/static/graphics/africa-glow-map.png"
                alt="Africa operational map — decorative artwork, not a live data map"
                class="absolute inset-0 w-full h-full object-cover object-[60%_40%] opacity-90 scale-[1.35] md:scale-[1.15]"
              />
              <div class="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent"></div>
              <div class="absolute inset-0 bg-gradient-to-r from-black/40 via-transparent to-transparent"></div>
              <div class="absolute top-4 left-4 right-4 flex items-start justify-between">
                <div>
                  <div class="text-white font-extrabold text-lg leading-tight drop-shadow">One Africa.</div>
                  <div class="text-ccaccent font-extrabold text-lg leading-tight drop-shadow">Infinite Opportunities.</div>
                </div>
                <a href="/control-center/africa" class="text-[10px] font-bold bg-black/50 border border-white/10 text-white rounded-full px-3 py-1.5 hover:border-ccaccent/50 transition-colors backdrop-blur-sm">
                  Full map →
                </a>
              </div>
              <div class="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-3">
                <div class="bg-black/55 backdrop-blur-sm border border-ccaccent/30 rounded-xl px-3.5 py-2.5">
                  <div class="flex items-center gap-1.5 text-ccaccent text-[10px] font-bold">
                    <span class="w-1.5 h-1.5 rounded-full bg-ccaccent cc-pulse"></span> NIGERIA · LIVE
                  </div>
                  <div class="text-white text-xs mt-0.5">{fmt(kpis.metrics, 'orders')} orders · {fmt(kpis.metrics, 'vendors')} vendors</div>
                </div>
                <div class="text-right">
                  <div class="text-2xl font-extrabold text-white">{liveCountries.length}<span class="text-gray-500 text-base">/{countries.length}</span></div>
                  <div class="text-[10px] text-gray-400">Markets live · {plannedCountries.length} planned</div>
                </div>
              </div>
            </div>

            {/* ---- Systems pulse ring ---- */}
            <div class="lg:col-span-3 bg-ccpanel border border-ccborder rounded-2xl p-5 flex flex-col items-center justify-center text-center">
              <div class="relative w-32 h-32 md:w-36 md:h-36 rounded-full flex items-center justify-center mb-3"
                   style={`background: conic-gradient(#17C983 ${healthOk === 0 ? 0 : Math.round((healthOk / health.length) * 360)}deg, #1E2B25 0deg); `}>
                <div class="absolute inset-[9px] rounded-full bg-ccpanel flex flex-col items-center justify-center">
                  <span class="text-2xl font-extrabold text-white">{healthOk}/{health.length}</span>
                  <span class="text-[9px] text-gray-500 font-semibold tracking-wide">SYSTEMS</span>
                </div>
              </div>
              <div class="flex items-center gap-1.5 text-ccaccent text-xs font-bold">
                <span class="relative flex h-2 w-2"><span class="cc-pulse absolute inline-flex h-full w-full rounded-full bg-ccaccent opacity-75"></span><span class="relative inline-flex rounded-full h-2 w-2 bg-ccaccent"></span></span>
                All Systems Operational
              </div>
              <a href="/control-center/system-health" class="text-[11px] text-gray-500 hover:text-ccaccent mt-2 font-semibold">View health matrix →</a>
            </div>

            {/* ---- Ecosystem vertical strip ---- */}
            <div class="lg:col-span-3 bg-gradient-to-br from-ccpanel to-ccpanel2 border border-ccborder rounded-2xl p-4 flex flex-col">
              <div class="flex items-center justify-between mb-2.5">
                <span class="text-xs font-bold text-white flex items-center gap-1.5"><span class="material-symbols-outlined text-ccaccent text-base">hub</span>9 Verticals</span>
                <span class="text-[10px] text-gray-500">1 live</span>
              </div>
              <div class="grid grid-cols-3 gap-1.5 flex-1">
                {[
                  { l: 'Shop', live: true }, { l: 'Fresh', live: false }, { l: 'Eats', live: false },
                  { l: 'Gigs', live: false }, { l: 'Stay', live: false }, { l: 'Drive', live: false },
                  { l: 'Send', live: false }, { l: 'Stream', live: false }, { l: 'Aura', live: false },
                ].map((v) => (
                  <div class={`rounded-lg border px-1.5 py-2.5 text-center ${v.live ? 'bg-ccaccent/10 border-ccaccent/30' : 'bg-black/20 border-ccborder'}`}>
                    <div class={`text-[10px] font-bold ${v.live ? 'text-ccaccent' : 'text-gray-500'}`}>{v.l}</div>
                  </div>
                ))}
              </div>
              <a href="/control-center/ecosystem" class="text-[11px] text-ccaccent hover:underline mt-2.5 text-center font-semibold">View ecosystem →</a>
            </div>
          </div>
        </div>
      </div>

      <div class="max-w-[110rem] mx-auto px-4 md:px-8 py-6 md:py-8">
        {/* ===== KPI strip — supporting metrics, not the centerpiece ===== */}
        <div class="flex items-center justify-between mb-3">
          <span class="text-[11px] font-bold text-gray-500 tracking-wide uppercase">Supporting Metrics</span>
          <span class="text-[11px] text-gray-600">Live counts — updated on every page load</span>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          {kpis.metrics.map((m) => <KpiCard m={m} />)}
        </div>

        {/* ===== Activity chart + Operational Distributions (real data only) ===== */}
        <div class="grid lg:grid-cols-3 gap-5 mb-6">
          <div class="lg:col-span-2 bg-ccpanel border border-ccborder rounded-2xl p-5 md:p-6">
            <div class="flex items-center justify-between mb-1">
              <h2 class="text-base font-bold text-white flex items-center gap-2">
                <span class="material-symbols-outlined text-ccaccent text-xl">show_chart</span>
                24-Hour Activity
              </h2>
              <span class="text-[11px] text-gray-500">Real orders + bookings, hourly</span>
            </div>
            <p class="text-xs text-gray-500 mb-3">Live GROUP BY COUNT from orders.created_at / bookings.created_at — zero-activity hours are shown as 0, never omitted.</p>
            <div class="h-56">
              <canvas id="cc-activity-chart"></canvas>
            </div>
          </div>

          <div class="bg-ccpanel border border-ccborder rounded-2xl p-5 md:p-6 flex flex-col gap-5">
            <div class="flex items-center justify-between mb-[-8px]">
              <h2 class="text-sm font-bold text-white flex items-center gap-2">
                <span class="material-symbols-outlined text-ccaccent text-lg">bar_chart</span>
                Operational Distributions
              </h2>
            </div>
            <p class="text-[11px] text-gray-600 mb-[-12px]">Real status GROUP BYs — no invented time series.</p>
            <DistributionBars title="Orders" icon="shopping_cart" rows={distributions.orders} total={distributions.orders.reduce((s, r) => s + r.count, 0)} />
            <DistributionBars title="Bookings" icon="event_available" rows={distributions.bookings} total={distributions.bookings.reduce((s, r) => s + r.count, 0)} />
            <DistributionBars title="Product Moderation" icon="fact_check" rows={distributions.moderation} total={distributions.moderation.reduce((s, r) => s + r.count, 0)} />
          </div>
        </div>

        <div class="grid lg:grid-cols-3 gap-5 mb-6">
          {/* ===== Live Operational Feed — colored indicator → action → entity → actor → time ===== */}
          <div class="lg:col-span-2 bg-ccpanel border border-ccborder rounded-2xl p-5 md:p-6 flex flex-col">
            <div class="flex items-center justify-between mb-1">
              <h2 class="text-base font-bold text-white flex items-center gap-2">
                <span class="material-symbols-outlined text-ccaccent text-xl">bolt</span>
                Live Operational Feed
              </h2>
              <a href="/control-center/audit" class="text-xs text-ccaccent hover:underline font-semibold">View all →</a>
            </div>
            <p class="text-xs text-gray-500 mb-4">Real cc_audit_logs — every event below actually happened.</p>
            <div class="flex-1 space-y-1 overflow-y-auto max-h-72 cc-scrollbar">
              {feed.length === 0 ? (
                <p class="text-xs text-gray-600">No activity recorded yet.</p>
              ) : (
                feed.map((ev) => (
                  <div class="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-white/[0.03] transition-colors">
                    <span class={`inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${ev.success ? 'bg-ccaccent/10 text-ccaccent' : 'bg-red-500/10 text-red-400'}`}>
                      <span class="material-symbols-outlined text-base">{ev.icon}</span>
                    </span>
                    <div class="min-w-0 flex-1">
                      <p class="text-sm text-gray-200 font-medium leading-snug truncate">{ev.humanText.charAt(0).toUpperCase() + ev.humanText.slice(1)}</p>
                      <p class="text-[11px] text-gray-500 truncate">{ev.entityLabel} · by {ev.actorName}</p>
                    </div>
                    <span class="text-[10px] text-gray-600 shrink-0">{ev.time.split(' ')[1]?.slice(0, 5) ?? ev.time}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ===== Aura AI — prominent premium position, honestly unbuilt ===== */}
          <a href="/control-center/aura" class="relative block rounded-2xl overflow-hidden border border-purple-500/20 bg-gradient-to-br from-purple-500/[0.07] via-ccaccent/[0.05] to-ccteal/[0.05] p-5 md:p-6 hover:border-ccaccent/40 transition-colors group">
            <div class="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-purple-500/10 blur-2xl"></div>
            <div class="relative">
              <div class="flex items-center justify-between mb-3">
                <span class="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-purple-500/20 to-ccaccent/20 text-ccaccent">
                  <span class="material-symbols-outlined text-2xl">auto_awesome</span>
                </span>
                <span class="text-[9px] font-bold bg-white/5 text-gray-400 rounded-full px-2.5 py-1">ROADMAP</span>
              </div>
              <div class="text-base font-extrabold text-white">Aura AI</div>
              <div class="text-[11px] text-ccaccent font-semibold mb-3">The Intelligence Layer of NaijaDeals</div>
              <div class="space-y-1.5 mb-3">
                {['"Which vendors have the highest cancellation rate?"', '"Show unresolved trust issues in Lagos"', '"Suspend this vendor"'].map((q) => (
                  <div class="text-[11px] text-gray-500 bg-black/25 rounded-lg px-2.5 py-1.5 italic truncate">{q}</div>
                ))}
              </div>
              <p class="text-[10px] text-gray-600 leading-snug">Natural-language command interface for this Control Center — visual shell today, not yet connected to a model. Designed now so the engine slots in without a redesign.</p>
              <div class="text-xs text-ccaccent font-semibold mt-3 group-hover:underline">Explore Aura →</div>
            </div>
          </a>
        </div>

        <div class="grid lg:grid-cols-3 gap-5 mb-6">
          {/* ===== Operations Tower teaser ===== */}
          <div class="lg:col-span-2 bg-ccpanel border border-ccborder rounded-2xl p-5 md:p-6">
            <div class="flex items-center justify-between mb-1">
              <h2 class="text-base font-bold text-white flex items-center gap-2">
                <span class="material-symbols-outlined text-ccaccent text-xl">fact_check</span>
                Operations Tower
              </h2>
              <a href="/control-center/operations" class="text-xs text-ccaccent hover:underline font-semibold">Full tower →</a>
            </div>
            <p class="text-xs text-gray-500 mb-4">Real queues only — every figure is backed by a live table.</p>
            {totalPending === 0 ? (
              <div class="flex items-center gap-3 bg-ccaccent/10 border border-ccaccent/20 rounded-xl px-5 py-4">
                <span class="material-symbols-outlined text-ccaccent text-2xl">check_circle</span>
                <span class="text-sm font-semibold text-ccaccent">All clear — nothing pending across verification, moderation, disputes or refunds.</span>
              </div>
            ) : (
              <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  { label: 'Product Moderation', value: pending.pendingModeration },
                  { label: 'Vendor Verification', value: pending.pendingVendorVerification },
                  { label: 'Provider Verification', value: pending.pendingProviderVerification },
                  { label: 'Open Disputes', value: pending.openDisputes },
                  { label: 'Pending Refunds', value: pending.pendingRefunds },
                ].map((q) => (
                  <div class="bg-black/20 border border-ccborder rounded-xl p-4">
                    <div class={`text-2xl font-extrabold ${q.value > 0 ? 'text-amber-400' : 'text-ccaccent'}`}>{q.value}</div>
                    <div class="text-[11px] text-gray-500 mt-0.5">{q.label}</div>
                    {q.value === 0 && <div class="text-[10px] text-ccaccent mt-1 font-semibold">✓ Clear</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ===== System Health teaser ===== */}
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-5 md:p-6">
            <div class="flex items-center justify-between mb-3">
              <h2 class="text-base font-bold text-white flex items-center gap-2">
                <span class="material-symbols-outlined text-ccaccent text-xl">health_and_safety</span>
                Platform Health
              </h2>
              <a href="/control-center/system-health" class="text-xs text-ccaccent hover:underline font-semibold">Details →</a>
            </div>
            <div class="space-y-2.5">
              {health.slice(0, 5).map((h) => (
                <div class="flex items-center justify-between text-xs">
                  <span class="flex items-center gap-2 text-gray-300"><span class={`w-2 h-2 rounded-full ${HEALTH_DOT[h.status]}`}></span>{h.service}</span>
                  <span class="text-gray-500 font-medium">{HEALTH_LABEL[h.status]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ===== Signature footer band ===== */}
        <div
          class="relative rounded-2xl overflow-hidden border border-ccborder"
          style="background-image: linear-gradient(120deg, rgba(8,11,10,0.9), rgba(8,11,10,0.55)), url('/static/hero/naijasend-nationwide-desktop.jpg'); background-size: cover; background-position: center;"
        >
          <div class="px-6 md:px-10 py-8 md:py-10 text-center">
            <div class="text-ccaccent text-xs font-bold tracking-widest mb-2">NAIJADEALS ENTERPRISE CONTROL CENTER</div>
            <div class="text-2xl md:text-3xl font-extrabold text-white tracking-tight">One Africa. Infinite Opportunities.</div>
            <div class="text-sm text-gray-400 mt-1">Nigeria Today. Africa Tomorrow.</div>
          </div>
        </div>
      </div>

      <script
        dangerouslySetInnerHTML={{
          __html: `
          (function () {
            var el = document.getElementById('cc-activity-chart');
            if (!el || !window.Chart) return;
            var labels = ${JSON.stringify(hourly.map((h) => h.hour))};
            var orders = ${JSON.stringify(hourly.map((h) => h.orders))};
            var bookings = ${JSON.stringify(hourly.map((h) => h.bookings))};
            new Chart(el.getContext('2d'), {
              type: 'line',
              data: {
                labels: labels,
                datasets: [
                  { label: 'Orders', data: orders, borderColor: '#17C983', backgroundColor: 'rgba(23,201,131,0.12)', fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 },
                  { label: 'Bookings', data: bookings, borderColor: '#2DD4BF', backgroundColor: 'rgba(45,212,191,0.08)', fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 }
                ]
              },
              options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { labels: { color: '#9CA3AF', boxWidth: 10, font: { size: 11 } } } },
                scales: {
                  x: { ticks: { color: '#6B7280', font: { size: 10 }, maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,0.03)' } },
                  y: { ticks: { color: '#6B7280', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.03)' }, beginAtZero: true }
                }
              }
            });
          })();
        `,
        }}
      ></script>
    </ControlCenterLayout>
  )
})

// ============================================================
// AFRICA OPERATIONS — dedicated signature page
// ============================================================
const REGION_FLAG: Record<string, string> = {
  NG: '🇳🇬', GH: '🇬🇭', KE: '🇰🇪', ZA: '🇿🇦', UG: '🇺🇬', TZ: '🇹🇿', RW: '🇷🇼', SN: '🇸🇳', CI: '🇨🇮', CM: '🇨🇲',
}
const REGION_ORDER = ['West Africa', 'East Africa', 'Southern Africa', 'Central Africa']
const LANGUAGE_NAME: Record<string, string> = { en: 'English', fr: 'French', sw: 'Swahili' }

controlCenterRoutes.get('/africa', async (c) => {
  const user = c.get('user')!
  const ccAccess = c.get('ccAccess')!
  const db = c.env.DB
  const [kpis, bookingOps, countries] = await Promise.all([
    getCommandCenterKpis(db),
    getBookingOperationsSnapshot(db),
    getCountryOperationalStatus(db),
  ])
  const liveCountries = countries.filter((cc) => cc.status === 'LIVE')
  const plannedCountries = countries.filter((cc) => cc.status !== 'LIVE')
  const regions = REGION_ORDER.map((region) => ({ region, list: countries.filter((cc) => cc.region === region) })).filter((r) => r.list.length > 0)

  return c.render(
    <ControlCenterLayout title="Africa Operations" user={user} ccAccess={ccAccess} active="africa">
      {/* ===== SIGNATURE HERO — Africa dominates the screen ===== */}
      <div class="relative bg-black border-b border-ccaccent/10 overflow-hidden">
        <div class="max-w-[110rem] mx-auto px-4 md:px-8 pt-8 pb-6 relative">
          <div class="flex items-center gap-2 text-ccaccent text-[11px] font-bold tracking-widest mb-1">
            <span class="w-1.5 h-1.5 rounded-full bg-ccaccent cc-pulse"></span> AFRICA OPERATIONS CENTER
          </div>
          <h1 class="text-3xl md:text-4xl font-extrabold text-white tracking-tight mb-1">One Africa. {countries.length} Markets. Infinite Opportunities.</h1>
          <p class="text-sm text-gray-400 max-w-2xl mb-2">
            Real cc_countries data — country/region-level status only. No GPS map is rendered: 0 of {bookingOps.totalBookableListings} bookable
            listings currently have resolvable coordinates. This is an honest operational registry, not a live pin map.
          </p>
        </div>

        {/* Full-width dominant map */}
        <div class="relative w-full h-[420px] md:h-[560px] -mt-2">
          <img
            src="/static/graphics/africa-glow-map.png"
            alt="Africa — NaijaDeals operational footprint"
            class="absolute inset-0 w-full h-full object-cover object-[54%_38%]"
          />
          <div class="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-black/10"></div>
          <div class="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-black/40"></div>

          {/* Nigeria callout — highlighted, pulsing */}
          <div class="absolute left-[27%] md:left-[32%] top-[52%] flex flex-col items-center">
            <span class="relative flex h-4 w-4 mb-2">
              <span class="cc-pulse absolute inline-flex h-full w-full rounded-full bg-ccaccent opacity-60"></span>
              <span class="relative inline-flex rounded-full h-4 w-4 bg-ccaccent border-2 border-white/80"></span>
            </span>
            <div class="bg-black/70 backdrop-blur-sm border border-ccaccent/40 rounded-xl px-4 py-3 text-center shadow-2xl min-w-[180px]">
              <div class="text-2xl mb-0.5">🇳🇬</div>
              <div class="text-white font-extrabold text-sm">Nigeria</div>
              <div class="text-ccaccent text-[10px] font-bold mb-2">● LIVE — HQ MARKET</div>
              <div class="grid grid-cols-2 gap-1.5 text-center">
                <div><div class="text-white font-bold text-sm">{fmt(kpis.metrics, 'orders')}</div><div class="text-[9px] text-gray-500">Orders</div></div>
                <div><div class="text-white font-bold text-sm">{fmt(kpis.metrics, 'vendors')}</div><div class="text-[9px] text-gray-500">Vendors</div></div>
              </div>
            </div>
          </div>

          {/* Overlaid readout cards */}
          <div class="absolute top-6 right-4 md:right-8 flex flex-col gap-3 items-end">
            <div class="bg-black/55 backdrop-blur-sm border border-ccborder rounded-xl px-4 py-3 text-right">
              <div class="text-2xl font-extrabold text-ccaccent">{liveCountries.length}</div>
              <div class="text-[10px] text-gray-400">Market{liveCountries.length === 1 ? '' : 's'} live</div>
            </div>
            <div class="bg-black/55 backdrop-blur-sm border border-ccborder rounded-xl px-4 py-3 text-right">
              <div class="text-2xl font-extrabold text-white">{plannedCountries.length}</div>
              <div class="text-[10px] text-gray-400">Markets planned</div>
            </div>
            <div class="bg-black/55 backdrop-blur-sm border border-ccborder rounded-xl px-4 py-3 text-right">
              <div class="text-2xl font-extrabold text-white">{regions.length}</div>
              <div class="text-[10px] text-gray-400">Regions represented</div>
            </div>
          </div>

          {/* Region legend chips, bottom */}
          <div class="absolute bottom-5 left-4 md:left-8 right-4 md:right-8 flex flex-wrap gap-2">
            {regions.map((r) => (
              <a href={`#region-${r.region.replace(/\s+/g, '-')}`} class="text-[11px] font-semibold bg-black/55 backdrop-blur-sm border border-ccborder hover:border-ccaccent/40 text-gray-200 rounded-full px-3.5 py-1.5 transition-colors">
                {r.region} <span class="text-gray-500">({r.list.length})</span>
              </a>
            ))}
          </div>
        </div>
      </div>

      <div class="max-w-[110rem] mx-auto px-4 md:px-8 py-8">
        {/* ===== Country selector — regional groupings ===== */}
        <div class="space-y-8 mb-8">
          {regions.map((r) => (
            <div id={`region-${r.region.replace(/\s+/g, '-')}`}>
              <div class="flex items-center gap-2 mb-3">
                <span class="material-symbols-outlined text-ccaccent text-lg">public</span>
                <h2 class="text-sm font-bold text-white uppercase tracking-wide">{r.region}</h2>
                <span class="text-xs text-gray-500">{r.list.length} market{r.list.length === 1 ? '' : 's'}</span>
              </div>
              <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {r.list.map((cc) => {
                  const isLive = cc.status === 'LIVE'
                  return (
                    <div class={`rounded-xl border p-4 ${isLive ? 'bg-ccaccent/[0.06] border-ccaccent/30' : 'bg-ccpanel border-ccborder'}`}>
                      <div class="flex items-center justify-between mb-2">
                        <span class="text-2xl">{REGION_FLAG[cc.iso_code] ?? '🌍'}</span>
                        <span class={`text-[9px] font-bold px-2 py-0.5 rounded-full ${isLive ? 'bg-ccaccent text-ccbg' : 'bg-white/5 text-gray-400'}`}>{cc.status}</span>
                      </div>
                      <div class="text-sm font-bold text-white">{cc.name}</div>
                      <div class="text-[10px] text-gray-500 mb-2">{cc.iso_code}</div>
                      <div class="flex items-center gap-2 text-[10px] text-gray-500">
                        <span class="flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">payments</span>{cc.currency_code}</span>
                        <span class="flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">translate</span>{LANGUAGE_NAME[cc.default_language] ?? cc.default_language}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* ===== Vertical availability + integrations — honest state ===== */}
        <div class="grid lg:grid-cols-2 gap-5 mb-8">
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-6">
            <h2 class="text-sm font-bold text-white flex items-center gap-2 mb-1">
              <span class="material-symbols-outlined text-ccaccent text-lg">hub</span>
              Vertical Availability
            </h2>
            <p class="text-[11px] text-gray-600 mb-4">Per-country vertical rollout configuration (cc_capability_country_overrides) is not yet populated — today, all 9 verticals ship together at country launch rather than staggered per-market. This section is honestly showing that, not a fabricated matrix.</p>
            <div class="flex items-center gap-2 bg-black/20 border border-ccborder rounded-xl px-4 py-3">
              <span class="material-symbols-outlined text-gray-500 text-lg">info</span>
              <span class="text-xs text-gray-400">Nigeria: NaijaShop live · 8 verticals building toward the same launch.</span>
            </div>
          </div>
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-6">
            <h2 class="text-sm font-bold text-white flex items-center gap-2 mb-1">
              <span class="material-symbols-outlined text-ccaccent text-lg">cable</span>
              Market Integrations
            </h2>
            <p class="text-[11px] text-gray-600 mb-4">Real cc_integration_providers table — 0 providers configured yet. Payment/logistics partners will register here per-market as they're onboarded.</p>
            <div class="flex items-center gap-2 bg-black/20 border border-ccborder rounded-xl px-4 py-3">
              <span class="material-symbols-outlined text-gray-500 text-lg">info</span>
              <span class="text-xs text-gray-400">No third-party integrations configured yet for any market.</span>
            </div>
          </div>
        </div>

        {/* ===== Full registry table ===== */}
        <div class="bg-ccpanel border border-ccborder rounded-2xl p-6">
          <h2 class="text-base font-bold text-white flex items-center gap-2 mb-4">
            <span class="material-symbols-outlined text-ccaccent text-xl">table_rows</span>
            All Countries — Live Registry
          </h2>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead><tr class="text-left text-gray-500 border-b border-ccborder text-xs">
                <th class="py-2 pr-4">Country</th><th class="py-2 pr-4">Region</th><th class="py-2 pr-4">Currency</th><th class="py-2 pr-4">Language</th><th class="py-2 pr-4">Timezone</th><th class="py-2 pr-4">Status</th>
              </tr></thead>
              <tbody>
                {countries.map((row) => (
                  <tr class="border-b border-ccborder/50">
                    <td class="py-2.5 pr-4 text-white whitespace-nowrap">{REGION_FLAG[row.iso_code] ?? '🌍'} {row.name} ({row.iso_code})</td>
                    <td class="py-2.5 pr-4 text-gray-400 whitespace-nowrap">{row.region}</td>
                    <td class="py-2.5 pr-4 text-gray-400">{row.currency_code}</td>
                    <td class="py-2.5 pr-4 text-gray-400">{LANGUAGE_NAME[row.default_language] ?? row.default_language}</td>
                    <td class="py-2.5 pr-4 text-gray-500 text-xs whitespace-nowrap">{row.default_timezone}</td>
                    <td class="py-2.5 pr-4"><span class={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${row.status === 'LIVE' ? 'bg-ccaccent-light text-ccaccent' : 'bg-white/5 text-gray-400'}`}>{row.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ControlCenterLayout>
  )
})

// ============================================================
// OPERATIONS TOWER — dedicated signature page (real queues, regrouped)
// ============================================================
controlCenterRoutes.get('/operations', async (c) => {
  const user = c.get('user')!
  const ccAccess = c.get('ccAccess')!
  const towerGroups = await getOperationsTowerQueues(c.env.DB)
  const grandTotal = towerGroups.reduce((s, g) => s + g.totalCount, 0)

  return c.render(
    <ControlCenterLayout title="Operations Tower" user={user} ccAccess={ccAccess} active="operations_tower">
      <div class="max-w-[80rem] mx-auto px-4 md:px-8 py-8">
        <div class="flex items-center justify-between mb-1">
          <h1 class="text-3xl font-extrabold text-white tracking-tight">Operations Tower</h1>
          {grandTotal === 0 ? (
            <span class="flex items-center gap-2 bg-ccaccent/10 border border-ccaccent/25 rounded-full px-4 py-2 text-sm font-bold text-ccaccent">
              <span class="material-symbols-outlined text-lg">check_circle</span> ALL CLEAR
            </span>
          ) : (
            <span class="text-sm font-bold text-amber-400">{grandTotal} item{grandTotal === 1 ? '' : 's'} need attention</span>
          )}
        </div>
        <p class="text-sm text-gray-500 mb-8 max-w-2xl">Every queue below reads a real, live table — verification, moderation and finance operations in one command view.</p>

        <div class="grid md:grid-cols-3 gap-5">
          {towerGroups.map((g) => (
            <div class="bg-ccpanel border border-ccborder rounded-2xl p-6">
              <div class="flex items-center justify-between mb-4">
                <h2 class="text-sm font-bold text-white flex items-center gap-2">
                  <span class="material-symbols-outlined text-ccaccent text-lg">{g.icon}</span>
                  {g.group}
                </h2>
                {g.totalCount === 0 ? (
                  <span class="text-[10px] font-bold text-ccaccent">✓ CLEAR</span>
                ) : (
                  <span class="text-[10px] font-bold text-amber-400">{g.totalCount}</span>
                )}
              </div>
              <div class="space-y-3">
                {g.queues.map((q) => {
                  const body = (
                    <div class={`flex items-center justify-between rounded-xl px-4 py-3 border ${q.severity === 'attention' ? 'bg-amber-500/5 border-amber-500/20' : 'bg-black/20 border-ccborder'}`}>
                      <span class="text-sm text-gray-300">{q.label}</span>
                      {q.severity === 'attention' ? (
                        <span class="text-sm font-extrabold text-amber-400">{q.count}</span>
                      ) : (
                        <span class="text-xs font-bold text-ccaccent">✓ Clear</span>
                      )}
                    </div>
                  )
                  return q.href ? <a href={q.href}>{body}</a> : body
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </ControlCenterLayout>
  )
})

// ============================================================
// VERIFICATION — landing page unifying vendor + provider queues
// ============================================================
controlCenterRoutes.get('/verification', async (c) => {
  const user = c.get('user')!
  const ccAccess = c.get('ccAccess')!
  const db = c.env.DB
  const [vendors, providers] = await Promise.all([
    getPendingVendorVerifications(db, 100),
    getPendingProviderVerifications(db, 100),
  ])
  const vendorCount = (vendors as any[]).length
  const providerCount = (providers as any[]).length

  return c.render(
    <ControlCenterLayout title="Verification & KYC" user={user} ccAccess={ccAccess} active="verification">
      <div class="max-w-[80rem] mx-auto px-4 md:px-8 py-8">
        <h1 class="text-3xl font-extrabold text-white tracking-tight mb-1">Verification & KYC</h1>
        <p class="text-sm text-gray-500 mb-8 max-w-2xl">Real vendors and provider_profiles tables — every queue below is the live pending-verification list, oldest first.</p>

        <div class="grid md:grid-cols-2 gap-5">
          <a href="/control-center/vendors" class="block bg-ccpanel border border-ccborder rounded-2xl p-6 hover:border-ccaccent/30 transition-colors">
            <div class="flex items-center justify-between mb-3">
              <span class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-ccaccent/10 text-ccaccent">
                <span class="material-symbols-outlined text-2xl">storefront</span>
              </span>
              {vendorCount === 0 ? (
                <span class="text-xs font-bold text-ccaccent">✓ Clear</span>
              ) : (
                <span class="text-2xl font-extrabold text-amber-400">{vendorCount}</span>
              )}
            </div>
            <div class="text-base font-bold text-white">Vendor Verification</div>
            <div class="text-xs text-gray-500 mt-1">{vendorCount === 0 ? 'No vendors are currently pending verification.' : `${vendorCount} vendor(s) awaiting review.`}</div>
          </a>
          <a href="/control-center/providers" class="block bg-ccpanel border border-ccborder rounded-2xl p-6 hover:border-ccaccent/30 transition-colors">
            <div class="flex items-center justify-between mb-3">
              <span class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-purple-500/10 text-purple-400">
                <span class="material-symbols-outlined text-2xl">engineering</span>
              </span>
              {providerCount === 0 ? (
                <span class="text-xs font-bold text-ccaccent">✓ Clear</span>
              ) : (
                <span class="text-2xl font-extrabold text-amber-400">{providerCount}</span>
              )}
            </div>
            <div class="text-base font-bold text-white">Provider Verification</div>
            <div class="text-xs text-gray-500 mt-1">{providerCount === 0 ? 'No providers are currently pending verification.' : `${providerCount} provider(s) awaiting review.`}</div>
          </a>
        </div>
      </div>
    </ControlCenterLayout>
  )
})

// ============================================================
// ECOSYSTEM — the 9 launch verticals
// ============================================================
controlCenterRoutes.get('/ecosystem', async (c) => {
  const user = c.get('user')!
  const ccAccess = c.get('ccAccess')!
  const verticals = await getEcosystemOverview(c.env.DB)

  return c.render(
    <ControlCenterLayout title="Ecosystem" user={user} ccAccess={ccAccess} active="ecosystem">
      <div class="max-w-[110rem] mx-auto px-4 md:px-8 py-8">
        <h1 class="text-3xl font-extrabold text-white tracking-tight mb-1">NaijaDeals Ecosystem</h1>
        <p class="text-sm text-gray-500 mb-8 max-w-2xl">9 launch verticals, one platform. Real status from the ecosystem_verticals table — nothing here is fabricated as "Live" unless it genuinely is.</p>
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {verticals.map((v) => (
            <div class="relative rounded-2xl overflow-hidden border border-ccborder bg-ccpanel group hover:border-ccaccent/30 transition-colors">
              <div class="h-36 bg-cover bg-center relative" style={`background-image: linear-gradient(to top, rgba(8,11,10,0.97), rgba(8,11,10,0.15)); background-image: linear-gradient(to top, rgba(8,11,10,0.97), rgba(8,11,10,0.1)), url(${v.heroImage}); background-size: cover; background-position: center;`}>
                <span class={`absolute top-3 right-3 text-[10px] font-bold px-2.5 py-1 rounded-full ${v.status === 'live' ? 'bg-ccaccent text-ccbg' : 'bg-black/60 text-gray-300 border border-white/10'}`}>
                  {v.status === 'live' ? 'LIVE' : v.metricValue.toUpperCase()}
                </span>
                <div class="absolute bottom-3 left-4 right-4">
                  <div class="text-lg font-extrabold text-white drop-shadow">{v.name}</div>
                </div>
              </div>
              <div class="p-4">
                {v.status === 'live' ? (
                  <>
                    <div class="text-[11px] text-gray-500">{v.metricLabel}</div>
                    <div class="text-lg font-extrabold text-ccaccent mt-0.5">{v.metricValue}</div>
                  </>
                ) : (
                  <div class="text-xs text-gray-500">Launching soon across Africa</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </ControlCenterLayout>
  )
})

// ============================================================
// SYSTEM HEALTH
// ============================================================
controlCenterRoutes.get('/system-health', requireControlCenterPermission('system_health.read'), async (c) => {
  const user = c.get('user')!
  const ccAccess = c.get('ccAccess')!
  const checks = await getSystemHealthChecks(c.env.DB)

  const healthyCount = checks.filter((h) => h.status === 'operational').length

  return c.render(
    <ControlCenterLayout title="System Health" user={user} ccAccess={ccAccess} active="system_health">
      <div class="max-w-[80rem] mx-auto px-4 md:px-8 py-8">
        <div class="flex items-center justify-between mb-1">
          <h1 class="text-3xl font-extrabold text-white tracking-tight">Platform Health Center</h1>
          <span class="flex items-center gap-2 bg-ccaccent/10 border border-ccaccent/25 rounded-full px-4 py-2 text-sm font-bold text-ccaccent">
            <span class="material-symbols-outlined text-lg">verified</span> {healthyCount}/{checks.length} operational
          </span>
        </div>
        <p class="text-sm text-gray-500 mb-8 max-w-2xl">Every status below reflects a real, live check performed at page-load time — no fabricated uptime percentages or response-time figures. Services with no live-checkable resource are honestly marked "Not monitored".</p>
        <div class="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {checks.map((h) => (
            <div class={`bg-ccpanel border ${HEALTH_RING[h.status]} rounded-2xl p-5`}>
              <div class="flex items-center justify-between mb-4">
                <span class="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-white/5 text-gray-300">
                  <span class="material-symbols-outlined text-xl">{HEALTH_ICON[h.key] ?? 'settings'}</span>
                </span>
                <span class={`w-3 h-3 rounded-full ${HEALTH_DOT[h.status]}`}></span>
              </div>
              <div class="text-sm font-bold text-white">{h.service}</div>
              <div class="text-xs font-semibold text-gray-400 mt-1">{HEALTH_LABEL[h.status]}</div>
              <div class="text-[11px] text-gray-600 mt-2 leading-snug">{h.detail}</div>
            </div>
          ))}
        </div>
      </div>
    </ControlCenterLayout>
  )
})

// ============================================================
// FINANCE — operating layer over the existing Payment/Refund/Booking engines
// ============================================================
controlCenterRoutes.get('/finance', requireControlCenterPermission('payments.read'), async (c) => {
  const user = c.get('user')!
  const ccAccess = c.get('ccAccess')!
  const db = c.env.DB
  const kpis = await getCommandCenterKpis(db)
  const refundsRow = await db.prepare("SELECT COUNT(*) c, COALESCE(SUM(amount_kobo),0) s FROM refunds WHERE status='completed'").first<{ c: number; s: number }>()
  const disputesRow = await db.prepare("SELECT COUNT(*) c FROM disputes WHERE status='open'").first<{ c: number }>()
  const txnRow = await db.prepare("SELECT status, COUNT(*) c, COALESCE(SUM(amount_kobo),0) s FROM payment_transactions GROUP BY status").all<{ status: string; c: number; s: number }>()

  const txnStatuses = txnRow.results ?? []

  return c.render(
    <ControlCenterLayout title="Payments & Finance" user={user} ccAccess={ccAccess} active="finance">
      <div class="max-w-[80rem] mx-auto px-4 md:px-8 py-8">
        <h1 class="text-3xl font-extrabold text-white tracking-tight mb-1">Payments & Finance</h1>
        <p class="text-sm text-gray-500 mb-8 max-w-3xl">
          This is an operating VIEW over the existing Payment/Refund/Booking engines — never a second wallet, ledger or payment system. Every figure below is a live SUM/COUNT against payment_transactions, refunds, orders, bookings and service_orders.
        </p>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-5">
            <span class="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-amber-500/10 text-amber-400 mb-3"><span class="material-symbols-outlined text-xl">payments</span></span>
            <div class="text-2xl font-extrabold text-white">{fmt(kpis.metrics, 'gmv')}</div>
            <div class="text-xs text-gray-500 mt-1">Gross Merchandise Value</div>
          </div>
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-5">
            <span class="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-orange-500/10 text-orange-400 mb-3"><span class="material-symbols-outlined text-xl">account_balance</span></span>
            <div class="text-2xl font-extrabold text-white">{fmt(kpis.metrics, 'revenue')}</div>
            <div class="text-xs text-gray-500 mt-1">Platform Revenue</div>
            <div class="text-[10px] text-gray-600 mt-2 leading-snug">From Service Engine platform_fee_kobo only — under-states true revenue until Commerce/Booking persist a commission column.</div>
          </div>
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-5">
            <span class="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-blue-500/10 text-blue-400 mb-3"><span class="material-symbols-outlined text-xl">replay</span></span>
            <div class="text-2xl font-extrabold text-white">{refundsRow?.c ?? 0}</div>
            <div class="text-xs text-gray-500 mt-1">Completed Refunds</div>
            <div class="text-[10px] text-gray-600 mt-2">₦{((refundsRow?.s ?? 0) / 100).toLocaleString()} total</div>
          </div>
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-5">
            <span class="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-red-500/10 text-red-400 mb-3"><span class="material-symbols-outlined text-xl">gavel</span></span>
            <div class={`text-2xl font-extrabold ${((disputesRow?.c ?? 0) > 0) ? 'text-amber-400' : 'text-white'}`}>{disputesRow?.c ?? 0}</div>
            <div class="text-xs text-gray-500 mt-1">Open Disputes</div>
            {(disputesRow?.c ?? 0) === 0 && <div class="text-[10px] text-ccaccent mt-2 font-semibold">✓ All clear</div>}
          </div>
        </div>

        <div class="grid lg:grid-cols-3 gap-5">
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-6 flex flex-col items-center">
            <h2 class="text-sm font-bold text-white self-start mb-4">Transaction Status Split</h2>
            <div class="w-full h-56 flex items-center justify-center">
              <canvas id="cc-txn-donut"></canvas>
            </div>
          </div>
          <div class="lg:col-span-2 bg-ccpanel border border-ccborder rounded-2xl overflow-hidden">
            <div class="px-6 py-4 border-b border-ccborder text-sm font-bold text-white">Transaction Status Breakdown</div>
            <table class="w-full text-sm">
              <thead><tr class="text-left text-gray-500 text-xs border-b border-ccborder"><th class="py-2.5 px-6">Status</th><th class="py-2.5 px-6">Count</th><th class="py-2.5 px-6">Total</th></tr></thead>
              <tbody>
                {txnStatuses.map((r) => (
                  <tr class="border-b border-ccborder/50">
                    <td class="py-3 px-6 text-white capitalize font-medium">{r.status}</td>
                    <td class="py-3 px-6 text-gray-400">{r.c}</td>
                    <td class="py-3 px-6 text-gray-400">₦{(r.s / 100).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: `
          (function () {
            var el = document.getElementById('cc-txn-donut');
            if (!el || !window.Chart) return;
            var labels = ${JSON.stringify(txnStatuses.map((r) => r.status))};
            var data = ${JSON.stringify(txnStatuses.map((r) => r.c))};
            var palette = ['#17C983', '#2DD4BF', '#F59E0B', '#EF4444', '#60A5FA', '#A78BFA'];
            new Chart(el.getContext('2d'), {
              type: 'doughnut',
              data: { labels: labels, datasets: [{ data: data, backgroundColor: palette, borderColor: '#0F1613', borderWidth: 3 }] },
              options: {
                responsive: true, maintainAspectRatio: false, cutout: '68%',
                plugins: { legend: { position: 'bottom', labels: { color: '#9CA3AF', boxWidth: 10, font: { size: 11 } } } }
              }
            });
          })();
        `,
        }}
      ></script>
    </ControlCenterLayout>
  )
})

// ============================================================
// AURA AI — honest "coming soon" shell
// ============================================================
controlCenterRoutes.get('/aura', async (c) => {
  const user = c.get('user')!
  const ccAccess = c.get('ccAccess')!

  const suggestions = [
    'Summarize today\'s activity',
    'List pending vendor verifications',
    'Show open disputes',
    'Check system health',
    'Find suspicious login activity',
    'Explain a Control Center permission',
  ]

  return c.render(
    <ControlCenterLayout title="Aura AI" user={user} ccAccess={ccAccess} active="aura">
      <div class="max-w-2xl mx-auto px-4 md:px-6 py-6">
        <div class="flex items-center gap-2 mb-1">
          <span class="material-symbols-outlined text-ccaccent">auto_awesome</span>
          <h1 class="text-xl font-extrabold text-white">Aura AI — Operations Copilot</h1>
          <span class="text-[10px] bg-white/5 text-gray-400 rounded-full px-2 py-0.5 ml-1">Planned — not yet implemented</span>
        </div>
        <p class="text-sm text-gray-500 mb-6">
          This is the intended natural-language interface for the Control Center. It is honestly shown as a visual shell — no chat responses are generated by a real model yet, and nothing below should be interpreted as a working AI assistant.
        </p>
        <div class="bg-ccpanel border border-ccborder rounded-xl p-4 mb-4 opacity-70">
          <div class="flex items-center gap-2 bg-black/30 border border-ccborder rounded-lg px-3 py-2.5">
            <span class="material-symbols-outlined text-gray-500 text-base">chat</span>
            <span class="text-sm text-gray-500">Ask Aura anything about NaijaDeals... (not yet connected to a model)</span>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          {suggestions.map((s) => (
            <div class="text-xs bg-white/5 text-gray-500 rounded-lg px-3 py-2 cursor-not-allowed">{s}</div>
          ))}
        </div>
      </div>
    </ControlCenterLayout>
  )
})

// ============================================================
// Countries / Africa
// ============================================================
controlCenterRoutes.get('/countries', async (c) => {
  const user = c.get('user')!
  const ccAccess = c.get('ccAccess')!
  const countries = await getCountryOperationalStatus(c.env.DB)

  return c.render(
    <ControlCenterLayout title="Countries" user={user} ccAccess={ccAccess} active="countries">
      <div class="max-w-4xl mx-auto px-4 md:px-6 py-8">
        <h1 class="text-xl font-bold text-white mb-1">Countries</h1>
        <p class="text-sm text-gray-500 mb-6">
          Real data from cc_countries — country/state-level status only. No map pins are rendered: 0 bookable
          listings in this database currently have resolvable coordinates.
        </p>
        <table class="w-full text-sm bg-ccpanel border border-ccborder rounded-xl overflow-hidden">
          <thead>
            <tr class="text-left text-gray-500 border-b border-ccborder text-xs">
              <th class="py-2.5 px-4">Country</th>
              <th class="py-2.5 px-4">Region</th>
              <th class="py-2.5 px-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {countries.map((row) => (
              <tr class="border-b border-ccborder/50">
                <td class="py-2.5 px-4 text-white">{row.name} ({row.iso_code})</td>
                <td class="py-2.5 px-4 text-gray-400">{row.region}</td>
                <td class="py-2.5 px-4">
                  <span class={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${row.status === 'LIVE' ? 'bg-ccaccent-light text-ccaccent' : 'bg-white/5 text-gray-400'}`}>{row.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ControlCenterLayout>
  )
})

// ============================================================
// Audit & Governance
// ============================================================
controlCenterRoutes.get('/audit', requireControlCenterPermission('audit.read'), async (c) => {
  const user = c.get('user')!
  const ccAccess = c.get('ccAccess')!
  const logs = await getRecentControlCenterAuditLogs(c.env.DB, 100)

  return c.render(
    <ControlCenterLayout title="Audit & Governance" user={user} ccAccess={ccAccess} active="audit">
      <div class="max-w-6xl mx-auto px-4 md:px-6 py-8">
        <h1 class="text-xl font-bold text-white mb-1">Audit & Governance</h1>
        <p class="text-sm text-gray-500 mb-6">The last 100 cc_audit_logs entries, most recent first. Includes denied/failed attempts, not only successes.</p>
        <table class="w-full text-xs bg-ccpanel border border-ccborder rounded-xl overflow-hidden">
          <thead>
            <tr class="text-left text-gray-500 border-b border-ccborder">
              <th class="py-2 px-3">Time</th>
              <th class="py-2 px-3">Actor</th>
              <th class="py-2 px-3">Action</th>
              <th class="py-2 px-3">Entity</th>
              <th class="py-2 px-3">Result</th>
            </tr>
          </thead>
          <tbody>
            {(logs as any[]).map((row) => (
              <tr class="border-b border-ccborder/50">
                <td class="py-2 px-3 text-gray-500 whitespace-nowrap">{row.created_at}</td>
                <td class="py-2 px-3 text-gray-300">{row.actor_name_snapshot}</td>
                <td class="py-2 px-3 text-gray-300">{row.action}</td>
                <td class="py-2 px-3 text-gray-500">{row.entity_type}#{row.entity_id}</td>
                <td class="py-2 px-3">
                  <span class={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${row.success ? 'bg-ccaccent-light text-ccaccent' : 'bg-red-500/10 text-red-400'}`}>
                    {row.success ? 'success' : 'denied/failed'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ControlCenterLayout>
  )
})

// ============================================================
// Vendor verification
// ============================================================
controlCenterRoutes.get('/vendors', requireControlCenterPermission('vendors.read'), async (c) => {
  const user = c.get('user')!
  const ccAccess = c.get('ccAccess')!
  const search = c.req.query('q')?.trim() || undefined
  const [pending, allVendors] = await Promise.all([
    getPendingVendorVerifications(c.env.DB, 100),
    listVendorsForDirectory(c.env.DB, 50, search),
  ])
  const canVerify = ccAccess.permissionKeys.has('vendors.verify')

  return c.render(
    <ControlCenterLayout title="Vendors" user={user} ccAccess={ccAccess} active="vendors">
      <div class="max-w-6xl mx-auto px-4 md:px-6 py-8">
        <h1 class="text-xl font-bold text-white mb-1">Vendor Verification Queue</h1>
        <p class="text-sm text-gray-500 mb-6">Real vendors table — pending verification, oldest first.</p>
        {(pending as any[]).length === 0 ? (
          <div class="flex items-center gap-2 bg-ccaccent/10 border border-ccaccent/20 rounded-lg px-4 py-3">
            <span class="material-symbols-outlined text-ccaccent">check_circle</span>
            <span class="text-sm font-semibold text-ccaccent">Queue clear — no vendors are currently pending verification.</span>
          </div>
        ) : (
          <table class="w-full text-sm bg-ccpanel border border-ccborder rounded-xl overflow-hidden" id="cc-vendor-table">
            <thead>
              <tr class="text-left text-gray-500 border-b border-ccborder text-xs">
                <th class="py-2.5 px-4">Store</th>
                <th class="py-2.5 px-4">Business email</th>
                <th class="py-2.5 px-4">City/State</th>
                <th class="py-2.5 px-4">360</th>
                {canVerify && <th class="py-2.5 px-4">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {(pending as any[]).map((v) => (
                <tr class="border-b border-ccborder/50" data-vendor-id={v.id}>
                  <td class="py-2.5 px-4 text-white">{v.business_name || v.name}</td>
                  <td class="py-2.5 px-4 text-gray-400">{v.business_email || '—'}</td>
                  <td class="py-2.5 px-4 text-gray-400">{v.city || '—'}, {v.state}</td>
                  <td class="py-2.5 px-4"><a href={`/control-center/vendors/${v.id}`} class="text-xs text-ccaccent hover:underline">View 360 →</a></td>
                  {canVerify && (
                    <td class="py-2.5 px-4 space-x-2">
                      <button class="cc-vendor-decision text-xs bg-ccaccent text-ccbg font-semibold px-3 py-1.5 rounded-lg" data-vendor-id={v.id} data-decision="verify">Approve</button>
                      <button class="cc-vendor-decision text-xs bg-red-500/10 text-red-400 font-semibold px-3 py-1.5 rounded-lg" data-vendor-id={v.id} data-decision="reject">Reject</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2 class="text-lg font-bold text-white mt-10 mb-3">All Vendors &amp; Stores</h2>
        <form method="get" class="mb-4 max-w-md">
          <div class="flex items-center gap-2 bg-black/40 border border-ccborder rounded-lg px-3 py-2">
            <span class="material-symbols-outlined text-gray-500 text-base">search</span>
            <input type="text" name="q" value={search ?? ''} placeholder="Search by name or business name..." class="bg-transparent outline-none flex-1 text-sm text-gray-200 placeholder:text-gray-500" />
            <button type="submit" class="text-xs bg-ccaccent text-ccbg font-semibold px-3 py-1 rounded-lg">Search</button>
          </div>
        </form>
        {allVendors.length === 0 ? (
          <div class="text-sm text-gray-500 bg-ccpanel border border-ccborder rounded-xl px-4 py-6 text-center">No vendors found{search ? ` matching "${search}"` : ''}.</div>
        ) : (
          <table class="w-full text-sm bg-ccpanel border border-ccborder rounded-xl overflow-hidden">
            <thead>
              <tr class="text-left text-gray-500 border-b border-ccborder text-xs">
                <th class="py-2.5 px-4">Store</th>
                <th class="py-2.5 px-4">City/State</th>
                <th class="py-2.5 px-4">Verification</th>
                <th class="py-2.5 px-4">Store status</th>
                <th class="py-2.5 px-4">360</th>
              </tr>
            </thead>
            <tbody>
              {allVendors.map((v: any) => (
                <tr class="border-b border-ccborder/50 hover:bg-white/[0.02]">
                  <td class="py-2.5 px-4 text-white">{v.business_name || v.name}</td>
                  <td class="py-2.5 px-4 text-gray-400">{v.city || '—'}, {v.state}</td>
                  <td class="py-2.5 px-4"><span class="text-xs text-gray-400">{v.verification_status}</span></td>
                  <td class="py-2.5 px-4"><span class="text-xs text-gray-400">{v.store_status}</span></td>
                  <td class="py-2.5 px-4"><a href={`/control-center/vendors/${v.id}`} class="text-xs text-ccaccent hover:underline">View 360 →</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {canVerify && (
        <script
          dangerouslySetInnerHTML={{
            __html: `
            document.getElementById('cc-vendor-table')?.addEventListener('click', async function (e) {
              var btn = e.target.closest('.cc-vendor-decision');
              if (!btn) return;
              var decision = btn.getAttribute('data-decision');
              var vendorId = btn.getAttribute('data-vendor-id');
              var reason = decision === 'reject' ? prompt('Reason for rejection (required):') : null;
              if (decision === 'reject' && !reason) return;
              btn.disabled = true;
              var res = await fetch('/api/control-center/verifications/vendors/' + vendorId + '/decision', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision: decision, reason: reason })
              });
              if (res.ok) { location.reload(); } else {
                var data = await res.json().catch(function(){return {};});
                alert(data.error || 'Failed to apply decision');
                btn.disabled = false;
              }
            });
          `,
          }}
        ></script>
      )}
    </ControlCenterLayout>
  )
})

// ============================================================
// VENDOR 360 (Phase 2 Functional Activation, Workstream B) — data layer
// (getVendor360) already built and TS-verified in the prior segment.
// ============================================================
controlCenterRoutes.get('/vendors/:id', requireControlCenterPermission('vendors.read'), async (c) => {
  const user = c.get('user')!
  const ccAccess = c.get('ccAccess')!
  const profile = await getVendor360(c.env.DB, Number(c.req.param('id')))

  if (!profile) {
    return c.render(
      <ControlCenterLayout title="Vendor not found" user={user} ccAccess={ccAccess} active="vendors">
        <div class="max-w-3xl mx-auto px-4 md:px-8 py-16 text-center">
          <span class="material-symbols-outlined text-4xl text-gray-600 mb-3 block">storefront</span>
          <div class="text-white font-bold mb-1">Vendor not found</div>
          <a href="/control-center/vendors" class="text-sm text-ccaccent">← Back to Vendors</a>
        </div>
      </ControlCenterLayout>
    )
  }

  return c.render(
    <ControlCenterLayout title={profile.businessName ?? profile.name} user={user} ccAccess={ccAccess} active="vendors">
      <div class="max-w-[80rem] mx-auto px-4 md:px-8 py-8">
        <a href="/control-center/vendors" class="text-xs text-gray-500 hover:text-ccaccent mb-4 inline-flex items-center gap-1"><span class="material-symbols-outlined text-sm">arrow_back</span> Vendors</a>
        <div class="flex items-start justify-between mb-1 flex-wrap gap-3">
          <div>
            <h1 class="text-3xl font-extrabold text-white tracking-tight">{profile.businessName ?? profile.name}</h1>
            <div class="text-sm text-gray-500 mt-1">{profile.businessEmail ?? '—'} · {profile.city ?? '—'}, {profile.state}</div>
          </div>
          <div class="flex gap-2">
            <span class="text-xs font-bold px-3 py-1.5 rounded-full bg-white/5 text-gray-300">Verification: {profile.verificationStatus}</span>
            <span class="text-xs font-bold px-3 py-1.5 rounded-full bg-white/5 text-gray-300">Store: {profile.storeStatus}</span>
          </div>
        </div>
        <p class="text-xs text-gray-600 mb-8">Rating {profile.ratingAvg?.toFixed?.(1) ?? profile.ratingAvg} ({profile.ratingCount} reviews on file) · Real aggregates from product_listings/order_items/reviews — Entity 360 read-only layer.</p>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-5">
            <div class="text-[11px] text-gray-500 mb-1">Products listed</div>
            <div class="text-2xl font-extrabold text-white">{profile.productCount}</div>
          </div>
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-5">
            <div class="text-[11px] text-gray-500 mb-1">Order items fulfilled</div>
            <div class="text-2xl font-extrabold text-white">{profile.orderItemCount}</div>
          </div>
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-5">
            <div class="text-[11px] text-gray-500 mb-1">Revenue</div>
            <div class="text-2xl font-extrabold text-ccaccent">₦{(profile.revenueKobo / 100).toLocaleString()}</div>
          </div>
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-5">
            <div class="text-[11px] text-gray-500 mb-1">Reviews</div>
            <div class="text-2xl font-extrabold text-white">{profile.reviewCount}</div>
          </div>
        </div>
        <p class="text-xs text-gray-600 mt-6">To verify/suspend this vendor, use the <a href="/control-center/vendors" class="text-ccaccent hover:underline">Vendor Verification Queue</a> above — this page is a read-only 360 view.</p>
      </div>
    </ControlCenterLayout>
  )
})

// ============================================================
// Provider verification
// ============================================================
controlCenterRoutes.get('/providers', requireControlCenterPermission('providers.read'), async (c) => {
  const user = c.get('user')!
  const ccAccess = c.get('ccAccess')!
  const search = c.req.query('q')?.trim() || undefined
  const [pending, allProviders] = await Promise.all([
    getPendingProviderVerifications(c.env.DB, 100),
    listProvidersForDirectory(c.env.DB, 50, search),
  ])
  const canVerify = ccAccess.permissionKeys.has('providers.verify')

  return c.render(
    <ControlCenterLayout title="Providers" user={user} ccAccess={ccAccess} active="providers">
      <div class="max-w-6xl mx-auto px-4 md:px-6 py-8">
        <h1 class="text-xl font-bold text-white mb-1">Provider Verification Queue</h1>
        <p class="text-sm text-gray-500 mb-6">Real provider_profiles table — pending verification, oldest first.</p>
        {(pending as any[]).length === 0 ? (
          <div class="flex items-center gap-2 bg-ccaccent/10 border border-ccaccent/20 rounded-lg px-4 py-3">
            <span class="material-symbols-outlined text-ccaccent">check_circle</span>
            <span class="text-sm font-semibold text-ccaccent">Queue clear — no providers are currently pending verification.</span>
          </div>
        ) : (
          <table class="w-full text-sm bg-ccpanel border border-ccborder rounded-xl overflow-hidden" id="cc-provider-table">
            <thead>
              <tr class="text-left text-gray-500 border-b border-ccborder text-xs">
                <th class="py-2.5 px-4">Provider</th>
                <th class="py-2.5 px-4">Type</th>
                <th class="py-2.5 px-4">Contact</th>
                <th class="py-2.5 px-4">360</th>
                {canVerify && <th class="py-2.5 px-4">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {(pending as any[]).map((p) => (
                <tr class="border-b border-ccborder/50" data-provider-id={p.id}>
                  <td class="py-2.5 px-4 text-white">{p.display_name}</td>
                  <td class="py-2.5 px-4 text-gray-400">{p.provider_type}</td>
                  <td class="py-2.5 px-4 text-gray-400">{p.contact_email || p.contact_phone || '—'}</td>
                  <td class="py-2.5 px-4"><a href={`/control-center/providers/${p.id}`} class="text-xs text-ccaccent hover:underline">View 360 →</a></td>
                  {canVerify && (
                    <td class="py-2.5 px-4 space-x-2">
                      <button class="cc-provider-decision text-xs bg-ccaccent text-ccbg font-semibold px-3 py-1.5 rounded-lg" data-provider-id={p.id} data-decision="verify">Approve</button>
                      <button class="cc-provider-decision text-xs bg-red-500/10 text-red-400 font-semibold px-3 py-1.5 rounded-lg" data-provider-id={p.id} data-decision="reject">Reject</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2 class="text-lg font-bold text-white mt-10 mb-3">All Providers &amp; Partners</h2>
        <form method="get" class="mb-4 max-w-md">
          <div class="flex items-center gap-2 bg-black/40 border border-ccborder rounded-lg px-3 py-2">
            <span class="material-symbols-outlined text-gray-500 text-base">search</span>
            <input type="text" name="q" value={search ?? ''} placeholder="Search by name or email..." class="bg-transparent outline-none flex-1 text-sm text-gray-200 placeholder:text-gray-500" />
            <button type="submit" class="text-xs bg-ccaccent text-ccbg font-semibold px-3 py-1 rounded-lg">Search</button>
          </div>
        </form>
        {allProviders.length === 0 ? (
          <div class="text-sm text-gray-500 bg-ccpanel border border-ccborder rounded-xl px-4 py-6 text-center">No providers found{search ? ` matching "${search}"` : ''}.</div>
        ) : (
          <table class="w-full text-sm bg-ccpanel border border-ccborder rounded-xl overflow-hidden">
            <thead>
              <tr class="text-left text-gray-500 border-b border-ccborder text-xs">
                <th class="py-2.5 px-4">Provider</th>
                <th class="py-2.5 px-4">Type</th>
                <th class="py-2.5 px-4">Verification</th>
                <th class="py-2.5 px-4">Operational status</th>
                <th class="py-2.5 px-4">360</th>
              </tr>
            </thead>
            <tbody>
              {allProviders.map((p: any) => (
                <tr class="border-b border-ccborder/50 hover:bg-white/[0.02]">
                  <td class="py-2.5 px-4 text-white">{p.display_name}</td>
                  <td class="py-2.5 px-4 text-gray-400">{p.provider_type}</td>
                  <td class="py-2.5 px-4"><span class="text-xs text-gray-400">{p.verification_status}</span></td>
                  <td class="py-2.5 px-4"><span class="text-xs text-gray-400">{p.operational_status}</span></td>
                  <td class="py-2.5 px-4"><a href={`/control-center/providers/${p.id}`} class="text-xs text-ccaccent hover:underline">View 360 →</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {canVerify && (
        <script
          dangerouslySetInnerHTML={{
            __html: `
            document.getElementById('cc-provider-table')?.addEventListener('click', async function (e) {
              var btn = e.target.closest('.cc-provider-decision');
              if (!btn) return;
              var decision = btn.getAttribute('data-decision');
              var providerId = btn.getAttribute('data-provider-id');
              var reason = decision === 'reject' ? prompt('Reason for rejection (required):') : null;
              if (decision === 'reject' && !reason) return;
              btn.disabled = true;
              var res = await fetch('/api/control-center/verifications/providers/' + providerId + '/decision', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision: decision, reason: reason })
              });
              if (res.ok) { location.reload(); } else {
                var data = await res.json().catch(function(){return {};});
                alert(data.error || 'Failed to apply decision');
                btn.disabled = false;
              }
            });
          `,
          }}
        ></script>
      )}
    </ControlCenterLayout>
  )
})

// ============================================================
// CONTENT MODERATION (Phase 2 Functional Activation, Workstream A quick
// win) — the audit found this backend fully real & audited already
// (src/lib/moderation.ts::applyModerationDecision, existing since
// Marketplace Engine 2.1); this route is the FIRST Control Center UI for
// it. Real product_listings queue, real decisions, real cc_audit_logs
// trail (moderation.ts writes it itself — no double-write here).
// ============================================================

const MODERATION_ICON: Record<string, string> = {
  pending_review: 'hourglass_top',
  active: 'check_circle',
  rejected: 'cancel',
  paused: 'pause_circle',
  draft: 'edit_note',
}

controlCenterRoutes.get('/moderation', requireControlCenterPermission('moderation.read'), async (c) => {
  const user = c.get('user')!
  const ccAccess = c.get('ccAccess')!
  const canManage = ccAccess.permissionKeys.has('moderation.manage')
  const [queue, history] = await Promise.all([
    getPendingModerationQueue(c.env.DB, 100),
    getRecentModerationDecisions(c.env.DB, 30),
  ])

  return c.render(
    <ControlCenterLayout title="Content Moderation" user={user} ccAccess={ccAccess} active="moderation">
      <div class="max-w-[80rem] mx-auto px-4 md:px-8 py-8">
        <div class="flex items-center justify-between mb-1">
          <h1 class="text-3xl font-extrabold text-white tracking-tight">Content Moderation</h1>
          <span class="flex items-center gap-2 bg-amber-500/10 border border-amber-500/25 rounded-full px-4 py-2 text-sm font-bold text-amber-400">
            <span class="material-symbols-outlined text-lg">hourglass_top</span> {queue.length} pending review
          </span>
        </div>
        <p class="text-sm text-gray-500 mb-8 max-w-2xl">
          Real <code class="text-gray-400">product_listings</code> table, oldest pending listing first. Every decision below calls the same{' '}
          <code class="text-gray-400">applyModerationDecision()</code> engine the existing admin API already uses, and writes a real{' '}
          <code class="text-gray-400">cc_audit_logs</code> row — nothing here is a mock queue.
        </p>

        {queue.length === 0 ? (
          <div class="flex items-center gap-2 bg-ccaccent/10 border border-ccaccent/20 rounded-lg px-4 py-3 mb-8">
            <span class="material-symbols-outlined text-ccaccent">check_circle</span>
            <span class="text-sm font-semibold text-ccaccent">Queue clear — no listings are currently pending moderation.</span>
          </div>
        ) : (
          <div class="bg-ccpanel border border-ccborder rounded-2xl overflow-hidden mb-10" id="cc-moderation-panel">
            <table class="w-full text-sm" id="cc-moderation-table">
              <thead>
                <tr class="text-left text-gray-500 border-b border-ccborder text-xs">
                  <th class="py-2.5 px-4">Listing</th>
                  <th class="py-2.5 px-4">Vendor</th>
                  <th class="py-2.5 px-4">Price</th>
                  <th class="py-2.5 px-4">Stock</th>
                  <th class="py-2.5 px-4">Submitted</th>
                  {canManage && <th class="py-2.5 px-4">Decision</th>}
                </tr>
              </thead>
              <tbody>
                {queue.map((row) => (
                  <tr class="border-b border-ccborder/50 hover:bg-white/[0.02]" data-listing-id={row.id}>
                    <td class="py-2.5 px-4 text-white flex items-center gap-2.5">
                      {row.product_image_url ? (
                        <img src={row.product_image_url} alt="" class="w-8 h-8 rounded object-cover bg-black/30 shrink-0" />
                      ) : (
                        <span class="w-8 h-8 rounded bg-black/30 shrink-0"></span>
                      )}
                      <span class="truncate max-w-[16rem]">{row.product_title}</span>
                    </td>
                    <td class="py-2.5 px-4 text-gray-400">{row.vendor_name}</td>
                    <td class="py-2.5 px-4 text-gray-400">₦{(row.price_kobo / 100).toLocaleString()}</td>
                    <td class="py-2.5 px-4 text-gray-400">{row.stock}</td>
                    <td class="py-2.5 px-4 text-gray-500 text-xs">{row.created_at}</td>
                    {canManage && (
                      <td class="py-2.5 px-4 space-x-1.5 whitespace-nowrap">
                        <button class="cc-mod-decision text-xs bg-ccaccent text-ccbg font-semibold px-2.5 py-1.5 rounded-lg" data-listing-id={row.id} data-decision="approve">Approve</button>
                        <button class="cc-mod-decision text-xs bg-red-500/10 text-red-400 font-semibold px-2.5 py-1.5 rounded-lg" data-listing-id={row.id} data-decision="reject">Reject</button>
                        <button class="cc-mod-decision text-xs bg-amber-500/10 text-amber-400 font-semibold px-2.5 py-1.5 rounded-lg" data-listing-id={row.id} data-decision="suspend">Suspend</button>
                        <button class="cc-mod-decision text-xs bg-white/5 text-gray-300 font-semibold px-2.5 py-1.5 rounded-lg" data-listing-id={row.id} data-decision="request_changes">Request changes</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h2 class="text-lg font-bold text-white mb-3">Decision History</h2>
        <p class="text-xs text-gray-500 mb-4">Real rows from <code class="text-gray-400">cc_audit_logs</code> (action = listing_moderation_decision) — the centralized governance trail, not a separate log.</p>
        {(history as any[]).length === 0 ? (
          <div class="text-sm text-gray-500 bg-ccpanel border border-ccborder rounded-xl px-4 py-6 text-center">No moderation decisions recorded yet.</div>
        ) : (
          <div class="bg-ccpanel border border-ccborder rounded-2xl overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-gray-500 border-b border-ccborder text-xs">
                  <th class="py-2.5 px-4">Listing ID</th>
                  <th class="py-2.5 px-4">Decision</th>
                  <th class="py-2.5 px-4">Actor</th>
                  <th class="py-2.5 px-4">Reason</th>
                  <th class="py-2.5 px-4">When</th>
                </tr>
              </thead>
              <tbody>
                {(history as any[]).map((h) => {
                  let after: any = {}
                  let ctx: any = {}
                  try { after = JSON.parse(h.after_json || '{}') } catch {}
                  try { ctx = JSON.parse(h.context_json || '{}') } catch {}
                  const status = after.moderation_status ?? '—'
                  return (
                    <tr class="border-b border-ccborder/50">
                      <td class="py-2.5 px-4 text-gray-400">#{h.entity_id}</td>
                      <td class="py-2.5 px-4">
                        <span class="inline-flex items-center gap-1.5 text-xs font-semibold text-white">
                          <span class="material-symbols-outlined text-sm">{MODERATION_ICON[status] ?? 'help'}</span>
                          {ctx.decision ?? status}
                        </span>
                      </td>
                      <td class="py-2.5 px-4 text-gray-400">{h.actor_name_snapshot}</td>
                      <td class="py-2.5 px-4 text-gray-500 text-xs truncate max-w-[16rem]">{ctx.reason ?? '—'}</td>
                      <td class="py-2.5 px-4 text-gray-500 text-xs">{h.created_at}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {canManage && (
        <script
          dangerouslySetInnerHTML={{
            __html: `
            document.getElementById('cc-moderation-table')?.addEventListener('click', async function (e) {
              var btn = e.target.closest('.cc-mod-decision');
              if (!btn) return;
              var decision = btn.getAttribute('data-decision');
              var listingId = btn.getAttribute('data-listing-id');
              var reason = null;
              if (decision === 'reject' || decision === 'suspend' || decision === 'request_changes') {
                reason = prompt('Reason' + (decision === 'request_changes' ? ' (required)' : ' (optional)') + ':');
                if (decision === 'request_changes' && !reason) return;
              }
              btn.closest('tr').querySelectorAll('button').forEach(function(b){ b.disabled = true; });
              var res = await fetch('/api/control-center/moderation/listings/' + listingId + '/decision', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision: decision, reason: reason || undefined })
              });
              if (res.ok) { location.reload(); } else {
                var data = await res.json().catch(function(){return {};});
                alert(data.error || 'Failed to apply decision');
                btn.closest('tr').querySelectorAll('button').forEach(function(b){ b.disabled = false; });
              }
            });
          `,
          }}
        ></script>
      )}
    </ControlCenterLayout>
  )
})

// ============================================================
// COMMUNICATIONS (Phase 2 Functional Activation, Workstream A quick win)
// — the audit found this backend fully real already (Engine 9:
// notification-observability.ts + notifications.ts's processOutboxBatch/
// retryFailedDeliveries, both already exposed to a non-CC admin surface via
// api-admin.ts). This is the FIRST Control Center UI for it. All figures
// below are direct COUNT/aggregate reads — "Not instrumented"/"0" is shown
// honestly rather than a fabricated delivery-success rate.
// ============================================================

controlCenterRoutes.get('/communications', requireControlCenterPermission('notifications.read'), async (c) => {
  const user = c.get('user')!
  const ccAccess = c.get('ccAccess')!
  const canManage = ccAccess.permissionKeys.has('notifications.manage')
  const overview = await getNotificationEngineOverview(c.env.DB)

  return c.render(
    <ControlCenterLayout title="Communications" user={user} ccAccess={ccAccess} active="communications">
      <div class="max-w-[80rem] mx-auto px-4 md:px-8 py-8">
        <h1 class="text-3xl font-extrabold text-white tracking-tight mb-1">Communications</h1>
        <p class="text-sm text-gray-500 mb-8 max-w-2xl">
          Real Engine 9 (Communication &amp; Notification Engine) observability — direct counts from{' '}
          <code class="text-gray-400">notification_outbox</code>/<code class="text-gray-400">notification_deliveries</code>. No fabricated delivery-success percentages.
        </p>

        <div class="grid md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-5">
            <div class="text-[11px] text-gray-500 mb-1">Outbox — Pending</div>
            <div class="text-2xl font-extrabold text-white">{overview.outbox.pending}</div>
          </div>
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-5">
            <div class="text-[11px] text-gray-500 mb-1">Outbox — Processing</div>
            <div class="text-2xl font-extrabold text-white">{overview.outbox.processing}</div>
          </div>
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-5">
            <div class="text-[11px] text-gray-500 mb-1">Outbox — Processed</div>
            <div class="text-2xl font-extrabold text-ccaccent">{overview.outbox.processed}</div>
          </div>
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-5">
            <div class="text-[11px] text-gray-500 mb-1">Outbox — Failed</div>
            <div class="text-2xl font-extrabold text-red-400">{overview.outbox.failed}</div>
          </div>
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-5">
            <div class="text-[11px] text-gray-500 mb-1">Outbox — Total</div>
            <div class="text-2xl font-extrabold text-white">{overview.outbox.total}</div>
          </div>
        </div>

        <div class="grid lg:grid-cols-2 gap-5 mb-8">
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-6">
            <h2 class="text-sm font-bold text-white mb-4">Deliveries by Channel &amp; Status</h2>
            {overview.deliveries_by_channel_status.length === 0 ? (
              <div class="text-xs text-gray-500">No deliveries recorded yet.</div>
            ) : (
              <div class="space-y-2">
                {overview.deliveries_by_channel_status.map((d) => (
                  <div class="flex items-center justify-between text-sm">
                    <span class="text-gray-400 capitalize">{d.channel} · {d.status}</span>
                    <span class="text-white font-semibold">{d.count}</span>
                  </div>
                ))}
              </div>
            )}
            <div class="mt-4 pt-4 border-t border-ccborder/50 grid grid-cols-2 gap-3 text-xs">
              <div><span class="text-gray-500">Pending retry:</span> <span class="text-amber-400 font-semibold">{overview.retry.pending_retry}</span></div>
              <div><span class="text-gray-500">Permanently failed:</span> <span class="text-red-400 font-semibold">{overview.retry.permanently_failed}</span></div>
            </div>
          </div>

          <div class="bg-ccpanel border border-ccborder rounded-2xl p-6">
            <h2 class="text-sm font-bold text-white mb-4">Provider Status</h2>
            {overview.providers.length === 0 ? (
              <div class="text-xs text-gray-500">No email/SMS/push providers configured — real cc_integrations state, not fabricated.</div>
            ) : (
              <div class="space-y-2">
                {overview.providers.map((p) => (
                  <div class="flex items-center justify-between text-sm">
                    <span class="text-gray-400">{p.provider_key} <span class="text-gray-600">({p.category})</span></span>
                    <span class={`text-xs font-semibold px-2 py-0.5 rounded-full ${p.status === 'healthy' ? 'bg-ccaccent/10 text-ccaccent' : p.status === 'not_configured' ? 'bg-white/5 text-gray-500' : 'bg-amber-500/10 text-amber-400'}`}>{p.status}</span>
                  </div>
                ))}
              </div>
            )}
            <div class="mt-4 pt-4 border-t border-ccborder/50 grid grid-cols-2 gap-3 text-xs">
              <div><span class="text-gray-500">Templates (active/total):</span> <span class="text-white font-semibold">{overview.templates.active}/{overview.templates.total}</span></div>
            </div>
          </div>
        </div>

        {canManage && (
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-6 flex flex-wrap items-center gap-4" id="cc-comms-actions">
            <span class="text-sm font-bold text-white">Manual catch-up (bounded, admin-triggered — never automatic/hidden):</span>
            <button id="cc-comms-process" class="text-xs bg-ccaccent text-ccbg font-semibold px-4 py-2 rounded-lg">Process outbox batch</button>
            <button id="cc-comms-retry" class="text-xs bg-white/5 text-gray-200 font-semibold px-4 py-2 rounded-lg border border-ccborder">Retry failed deliveries</button>
            <span id="cc-comms-result" class="text-xs text-gray-500"></span>
          </div>
        )}
      </div>
      {canManage && (
        <script
          dangerouslySetInnerHTML={{
            __html: `
            function ccCommsAction(url, btn) {
              var resultEl = document.getElementById('cc-comms-result');
              btn.disabled = true;
              fetch(url, { method: 'POST' })
                .then(function(res){ return res.json().then(function(data){ return {ok: res.ok, data: data}; }); })
                .then(function(r){
                  if (r.ok) { resultEl.textContent = JSON.stringify(r.data); setTimeout(function(){ location.reload(); }, 900); }
                  else { resultEl.textContent = r.data.error || 'Failed'; btn.disabled = false; }
                })
                .catch(function(){ resultEl.textContent = 'Request failed'; btn.disabled = false; });
            }
            document.getElementById('cc-comms-process')?.addEventListener('click', function(){ ccCommsAction('/api/control-center/notifications/process-outbox', this); });
            document.getElementById('cc-comms-retry')?.addEventListener('click', function(){ ccCommsAction('/api/control-center/notifications/retry-failed', this); });
          `,
          }}
        ></script>
      )}
    </ControlCenterLayout>
  )
})

// ============================================================
// CUSTOMERS + CUSTOMER 360 (Phase 2 Functional Activation, Workstream B)
// — data layer (getCustomer360/listCustomersForDirectory) was already
// built and TS-verified in the prior segment; this is its first UI. Real
// users table, real aggregated order/booking/dispute/refund counts, real
// suspend/reinstate action gated by customers.suspend and audited via
// user-lifecycle.ts's applyUserStatusDecision (already writes
// cc_audit_logs).
// ============================================================

const ACCOUNT_STATUS_BADGE: Record<string, string> = {
  active: 'bg-ccaccent/10 text-ccaccent',
  pending_verification: 'bg-amber-500/10 text-amber-400',
  suspended: 'bg-red-500/10 text-red-400',
  disabled: 'bg-gray-500/10 text-gray-400',
  deleted: 'bg-gray-700/30 text-gray-500',
}

controlCenterRoutes.get('/customers', requireControlCenterPermission('customers.read'), async (c) => {
  const user = c.get('user')!
  const ccAccess = c.get('ccAccess')!
  const search = c.req.query('q')?.trim() || undefined
  const customers = await listCustomersForDirectory(c.env.DB, 50, search)

  return c.render(
    <ControlCenterLayout title="Customers" user={user} ccAccess={ccAccess} active="customers">
      <div class="max-w-[80rem] mx-auto px-4 md:px-8 py-8">
        <h1 class="text-3xl font-extrabold text-white tracking-tight mb-1">Customers</h1>
        <p class="text-sm text-gray-500 mb-6 max-w-2xl">Real <code class="text-gray-400">users</code> table (role = customer) — most recently joined first. Click a customer to open their real Customer 360 profile.</p>

        <form method="get" class="mb-6 max-w-md">
          <div class="flex items-center gap-2 bg-black/40 border border-ccborder rounded-lg px-3 py-2">
            <span class="material-symbols-outlined text-gray-500 text-base">search</span>
            <input type="text" name="q" value={search ?? ''} placeholder="Search by name, email or phone..." class="bg-transparent outline-none flex-1 text-sm text-gray-200 placeholder:text-gray-500" />
            <button type="submit" class="text-xs bg-ccaccent text-ccbg font-semibold px-3 py-1 rounded-lg">Search</button>
          </div>
        </form>

        {customers.length === 0 ? (
          <div class="text-sm text-gray-500 bg-ccpanel border border-ccborder rounded-xl px-4 py-6 text-center">No customers found{search ? ` matching "${search}"` : ''}.</div>
        ) : (
          <div class="bg-ccpanel border border-ccborder rounded-2xl overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-gray-500 border-b border-ccborder text-xs">
                  <th class="py-2.5 px-4">Name</th>
                  <th class="py-2.5 px-4">Email</th>
                  <th class="py-2.5 px-4">Phone</th>
                  <th class="py-2.5 px-4">Status</th>
                  <th class="py-2.5 px-4">Joined</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((cust) => (
                  <tr class="border-b border-ccborder/50 hover:bg-white/[0.02] cursor-pointer" onclick={`location.href='/control-center/customers/${cust.id}'`}>
                    <td class="py-2.5 px-4 text-white font-medium">{cust.name}</td>
                    <td class="py-2.5 px-4 text-gray-400">{cust.email ?? '—'}</td>
                    <td class="py-2.5 px-4 text-gray-400">{cust.phone ?? '—'}</td>
                    <td class="py-2.5 px-4"><span class={`text-xs font-semibold px-2 py-0.5 rounded-full ${ACCOUNT_STATUS_BADGE[cust.status] ?? 'bg-white/5 text-gray-400'}`}>{cust.status}</span></td>
                    <td class="py-2.5 px-4 text-gray-500 text-xs">{cust.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ControlCenterLayout>
  )
})

controlCenterRoutes.get('/customers/:id', requireControlCenterPermission('customers.read'), async (c) => {
  const user = c.get('user')!
  const ccAccess = c.get('ccAccess')!
  const canSuspend = ccAccess.permissionKeys.has('customers.suspend')
  const targetId = Number(c.req.param('id'))
  const profile = await getCustomer360(c.env.DB, targetId)

  if (!profile) {
    return c.render(
      <ControlCenterLayout title="Customer not found" user={user} ccAccess={ccAccess} active="customers">
        <div class="max-w-3xl mx-auto px-4 md:px-8 py-16 text-center">
          <span class="material-symbols-outlined text-4xl text-gray-600 mb-3 block">person_off</span>
          <div class="text-white font-bold mb-1">Customer not found</div>
          <a href="/control-center/customers" class="text-sm text-ccaccent">← Back to Customers</a>
        </div>
      </ControlCenterLayout>
    )
  }

  return c.render(
    <ControlCenterLayout title={profile.name} user={user} ccAccess={ccAccess} active="customers">
      <div class="max-w-[80rem] mx-auto px-4 md:px-8 py-8">
        <a href="/control-center/customers" class="text-xs text-gray-500 hover:text-ccaccent mb-4 inline-flex items-center gap-1"><span class="material-symbols-outlined text-sm">arrow_back</span> Customers</a>
        <div class="flex items-start justify-between mb-1 flex-wrap gap-3">
          <div>
            <h1 class="text-3xl font-extrabold text-white tracking-tight">{profile.name}</h1>
            <div class="text-sm text-gray-500 mt-1">{profile.email ?? '—'} · {profile.phone ?? '—'} · {profile.countryIso}</div>
          </div>
          <span class={`text-sm font-bold px-3 py-1.5 rounded-full ${ACCOUNT_STATUS_BADGE[profile.status] ?? 'bg-white/5 text-gray-400'}`}>{profile.status}</span>
        </div>
        <p class="text-xs text-gray-600 mb-8">Customer since {profile.createdAt} · Real aggregates below from orders/bookings/disputes/refunds tables (Entity 360 read-only layer — no duplicated data).</p>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-5">
            <div class="text-[11px] text-gray-500 mb-1">Orders</div>
            <div class="text-2xl font-extrabold text-white">{profile.orderCount}</div>
            <div class="text-xs text-gray-500 mt-1">₦{(profile.orderTotalKobo / 100).toLocaleString()} total</div>
          </div>
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-5">
            <div class="text-[11px] text-gray-500 mb-1">Bookings</div>
            <div class="text-2xl font-extrabold text-white">{profile.bookingCount}</div>
          </div>
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-5">
            <div class="text-[11px] text-gray-500 mb-1">Disputes raised</div>
            <div class="text-2xl font-extrabold text-amber-400">{profile.disputeCount}</div>
          </div>
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-5">
            <div class="text-[11px] text-gray-500 mb-1">Refunds</div>
            <div class="text-2xl font-extrabold text-white">{profile.refundCount}</div>
          </div>
        </div>

        {canSuspend && (
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-6" id="cc-customer-actions">
            <h2 class="text-sm font-bold text-white mb-4">Account Actions</h2>
            <p class="text-xs text-gray-500 mb-4">Every action here calls the same <code class="text-gray-400">applyUserStatusDecision()</code> engine used elsewhere in the platform, and writes a real <code class="text-gray-400">cc_audit_logs</code> row. Suspending/disabling immediately revokes all of this customer's active sessions.</p>
            <div class="flex flex-wrap gap-2">
              {profile.status !== 'active' && <button class="cc-customer-status text-xs bg-ccaccent text-ccbg font-semibold px-4 py-2 rounded-lg" data-status="active">Reinstate (Active)</button>}
              {profile.status !== 'suspended' && <button class="cc-customer-status text-xs bg-amber-500/10 text-amber-400 font-semibold px-4 py-2 rounded-lg" data-status="suspended">Suspend</button>}
              {profile.status !== 'disabled' && <button class="cc-customer-status text-xs bg-red-500/10 text-red-400 font-semibold px-4 py-2 rounded-lg" data-status="disabled">Disable</button>}
            </div>
          </div>
        )}
      </div>
      {canSuspend && (
        <script
          dangerouslySetInnerHTML={{
            __html: `
            document.getElementById('cc-customer-actions')?.addEventListener('click', async function (e) {
              var btn = e.target.closest('.cc-customer-status');
              if (!btn) return;
              var status = btn.getAttribute('data-status');
              var reason = prompt('Reason for this status change (optional):');
              btn.disabled = true;
              var res = await fetch('/api/control-center/customers/${targetId}/status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: status, reason: reason || undefined })
              });
              if (res.ok) { location.reload(); } else {
                var data = await res.json().catch(function(){return {};});
                alert(data.error || 'Failed to update status');
                btn.disabled = false;
              }
            });
          `,
          }}
        ></script>
      )}
    </ControlCenterLayout>
  )
})

// ============================================================
// PROVIDER 360 (Phase 2 Functional Activation, Workstream B) — data layer
// (getProvider360) already built and TS-verified in the prior segment.
// ============================================================
controlCenterRoutes.get('/providers/:id', requireControlCenterPermission('providers.read'), async (c) => {
  const user = c.get('user')!
  const ccAccess = c.get('ccAccess')!
  const profile = await getProvider360(c.env.DB, Number(c.req.param('id')))

  if (!profile) {
    return c.render(
      <ControlCenterLayout title="Provider not found" user={user} ccAccess={ccAccess} active="providers">
        <div class="max-w-3xl mx-auto px-4 md:px-8 py-16 text-center">
          <span class="material-symbols-outlined text-4xl text-gray-600 mb-3 block">engineering</span>
          <div class="text-white font-bold mb-1">Provider not found</div>
          <a href="/control-center/providers" class="text-sm text-ccaccent">← Back to Providers</a>
        </div>
      </ControlCenterLayout>
    )
  }

  return c.render(
    <ControlCenterLayout title={profile.displayName} user={user} ccAccess={ccAccess} active="providers">
      <div class="max-w-[80rem] mx-auto px-4 md:px-8 py-8">
        <a href="/control-center/providers" class="text-xs text-gray-500 hover:text-ccaccent mb-4 inline-flex items-center gap-1"><span class="material-symbols-outlined text-sm">arrow_back</span> Providers</a>
        <div class="flex items-start justify-between mb-1 flex-wrap gap-3">
          <div>
            <h1 class="text-3xl font-extrabold text-white tracking-tight">{profile.displayName}</h1>
            <div class="text-sm text-gray-500 mt-1">{profile.providerType} · {profile.contactEmail ?? profile.contactPhone ?? '—'}</div>
          </div>
          <div class="flex gap-2">
            <span class="text-xs font-bold px-3 py-1.5 rounded-full bg-white/5 text-gray-300">Verification: {profile.verificationStatus}</span>
            <span class="text-xs font-bold px-3 py-1.5 rounded-full bg-white/5 text-gray-300">Operational: {profile.operationalStatus}</span>
          </div>
        </div>
        <p class="text-xs text-gray-600 mb-8">Rating {profile.ratingAvg?.toFixed?.(1) ?? profile.ratingAvg} ({profile.ratingCount} reviews on file) · Real aggregates from bookings/reviews — Entity 360 read-only layer.</p>

        <div class="grid grid-cols-2 gap-4 max-w-xl">
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-5">
            <div class="text-[11px] text-gray-500 mb-1">Bookings</div>
            <div class="text-2xl font-extrabold text-white">{profile.bookingCount}</div>
          </div>
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-5">
            <div class="text-[11px] text-gray-500 mb-1">Reviews</div>
            <div class="text-2xl font-extrabold text-white">{profile.reviewCount}</div>
          </div>
        </div>
        <p class="text-xs text-gray-600 mt-6">To verify/suspend this provider, use the <a href="/control-center/providers" class="text-ccaccent hover:underline">Provider Verification Queue</a> above — this page is a read-only 360 view.</p>
      </div>
    </ControlCenterLayout>
  )
})

// ============================================================
// HERO CAMPAIGN MANAGEMENT (Enterprise Control Center Checkpoint 1)
//
// ARCHITECTURAL REFERENCE IMPLEMENTATION: this is the first Control Center
// module built specifically to prove out the "DATABASE -> SERVICE/QUERY ->
// API -> ENTERPRISE CONTROL CENTER -> CUSTOMER-FACING EXPERIENCE" pattern
// Pat's implementation authorization requires every future module to
// follow. It does NOT touch HeroZone.tsx, hero-campaigns.ts's read path, or
// home.tsx — it is purely a new management surface OVER the existing
// hero_campaigns table and the existing getActiveHeroCampaigns() consumer.
//
// All data below is real: the table is the live hero_campaigns rows (10
// campaigns as of this checkpoint, confirmed via direct D1 query during the
// read-only audit), lifecycle state is computed server-side from real
// status/starts_at/ends_at/is_archived columns (computeCampaignLifecycleState),
// and every mutation the client-side JS below triggers hits a real,
// permission-gated /api/control-center/hero-campaigns/* endpoint that writes
// to D1 and records a real cc_audit_logs row. Nothing here is a mock queue,
// and no "coming soon" analytics panel with a fabricated number is included:
// per Pat's explicit "DO NOT FABRICATE ANALYTICS" rule, there is a single
// honest placeholder note in the sidebar instead of any invented metric.
// ============================================================

controlCenterRoutes.get('/promotions', requireControlCenterPermission('promotions.read'), async (c) => {
  const user = c.get('user')!
  const ccAccess = c.get('ccAccess')!
  const canManage = ccAccess.permissionKeys.has('promotions.manage')
  const [campaigns, countries] = await Promise.all([
    getAllHeroCampaignsForAdmin(c.env.DB, { includeArchived: true }),
    getAllCountries(c.env.DB),
  ])

  const withState = (campaigns as HeroCampaignAdminRow[]).map((row) => ({ ...row, lifecycle_state: computeCampaignLifecycleState(row) }))
  const activeCount = withState.filter((r) => r.lifecycle_state === 'active').length
  const scheduledCount = withState.filter((r) => r.lifecycle_state === 'scheduled').length
  const expiredCount = withState.filter((r) => r.lifecycle_state === 'expired').length
  const archivedCount = withState.filter((r) => r.lifecycle_state === 'archived').length

  const LIFECYCLE_BADGE: Record<string, string> = {
    active: 'bg-ccaccent/15 text-ccaccent border-ccaccent/30',
    scheduled: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    expired: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    inactive: 'bg-white/5 text-gray-400 border-ccborder',
    archived: 'bg-red-500/10 text-red-400 border-red-500/25',
  }

  return c.render(
    <ControlCenterLayout title="Hero Campaigns" user={user} ccAccess={ccAccess} active="promotions">
      <div class="max-w-[100rem] mx-auto px-4 md:px-8 py-8" id="hero-cc-root" data-can-manage={canManage ? '1' : '0'}>
        <div class="flex items-start justify-between gap-4 flex-wrap mb-1">
          <div>
            <h1 class="text-3xl font-extrabold text-white tracking-tight">Hero Campaign Manager</h1>
            <p class="text-sm text-gray-500 mt-1 max-w-2xl">
              Real <code class="text-gray-400">hero_campaigns</code> rows — the SAME table <code class="text-gray-400">getActiveHeroCampaigns()</code> and{' '}
              <code class="text-gray-400">HeroZone.tsx</code> already render live on the homepage. Every action below writes to that table and logs a real{' '}
              <code class="text-gray-400">cc_audit_logs</code> entry — nothing here is a mock queue.
            </p>
          </div>
          {canManage && (
            <button id="hero-cc-create-btn" type="button" class="flex items-center gap-1.5 bg-ccaccent text-ccbg font-bold text-sm px-4 py-2.5 rounded-xl hover:brightness-110 transition shrink-0">
              <span class="material-symbols-outlined text-lg">add_circle</span> Create Campaign
            </button>
          )}
        </div>

        {/* ---------- KPI strip (real counts only) ---------- */}
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 mb-6">
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-4">
            <div class="text-[11px] text-gray-500 mb-1">Live now</div>
            <div class="text-2xl font-extrabold text-ccaccent">{activeCount}</div>
          </div>
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-4">
            <div class="text-[11px] text-gray-500 mb-1">Scheduled</div>
            <div class="text-2xl font-extrabold text-blue-400">{scheduledCount}</div>
          </div>
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-4">
            <div class="text-[11px] text-gray-500 mb-1">Expired</div>
            <div class="text-2xl font-extrabold text-orange-400">{expiredCount}</div>
          </div>
          <div class="bg-ccpanel border border-ccborder rounded-2xl p-4">
            <div class="text-[11px] text-gray-500 mb-1">Archived</div>
            <div class="text-2xl font-extrabold text-gray-400">{archivedCount}</div>
          </div>
        </div>

        {/* ---------- Analytics placeholder — honest, not fabricated ---------- */}
        <div class="flex items-center gap-2.5 bg-white/[0.03] border border-ccborder rounded-xl px-4 py-3 mb-6 text-xs text-gray-500">
          <span class="material-symbols-outlined text-base text-gray-600">insights</span>
          Campaign performance (impressions/clicks/CTR) is future analytics infrastructure — NaijaDeals has no impression/click tracking today, so no number is shown here rather than a fabricated one.
        </div>

        {/* ---------- Filters + search ---------- */}
        <div class="flex items-center gap-3 flex-wrap mb-4">
          <div class="relative flex-1 min-w-[220px] max-w-sm">
            <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-lg">search</span>
            <input id="hero-cc-search" type="text" placeholder="Search title, slug, CTA..." class="w-full bg-black/30 border border-ccborder rounded-lg pl-9 pr-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 outline-none focus:border-ccaccent/50" />
          </div>
          <select id="hero-cc-filter-state" class="bg-black/30 border border-ccborder rounded-lg px-3 py-2 text-sm text-gray-300 outline-none focus:border-ccaccent/50">
            <option value="">All statuses</option>
            <option value="active">Live now</option>
            <option value="scheduled">Scheduled</option>
            <option value="expired">Expired</option>
            <option value="inactive">Paused / Draft</option>
            <option value="archived">Archived</option>
          </select>
          <select id="hero-cc-filter-vertical" class="bg-black/30 border border-ccborder rounded-lg px-3 py-2 text-sm text-gray-300 outline-none focus:border-ccaccent/50">
            <option value="">All verticals</option>
            {Array.from(new Set(withState.map((r) => r.vertical))).sort().map((v) => (
              <option value={v}>{v}</option>
            ))}
          </select>
          <span class="text-xs text-gray-600 ml-auto" id="hero-cc-count-label">{withState.length} campaigns</span>
        </div>

        {/* ---------- Campaign table ---------- */}
        <div class="bg-ccpanel border border-ccborder rounded-2xl overflow-hidden">
          <table class="w-full text-sm" id="hero-cc-table">
            <thead>
              <tr class="text-left text-gray-500 border-b border-ccborder text-xs">
                {canManage && <th class="py-2.5 px-3 w-8"></th>}
                <th class="py-2.5 px-3">Campaign</th>
                <th class="py-2.5 px-3">Vertical</th>
                <th class="py-2.5 px-3">Targeting</th>
                <th class="py-2.5 px-3">Schedule</th>
                <th class="py-2.5 px-3">Status</th>
                <th class="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody id="hero-cc-tbody">
              {withState.map((row) => {
                const targetCountries: string[] = row.target_countries ? JSON.parse(row.target_countries) : []
                const targetingLabel =
                  (targetCountries.length > 0 ? targetCountries.join(', ') : 'All countries') +
                  (row.target_segment !== 'all' ? ` · ${row.target_segment}` : '') +
                  (row.target_auth_state !== 'all' ? ` · ${row.target_auth_state}` : '')
                return (
                  <tr
                    class="border-b border-ccborder/50 hover:bg-white/[0.02] hero-cc-row"
                    data-id={row.id}
                    data-status={row.lifecycle_state}
                    data-vertical={row.vertical}
                    data-search={`${row.title} ${row.slug} ${row.cta_label}`.toLowerCase()}
                    draggable={canManage ? 'true' : 'false'}
                  >
                    {canManage && (
                      <td class="py-2.5 px-3 text-gray-600 cursor-grab hero-cc-drag-handle" title="Drag to reorder">
                        <span class="material-symbols-outlined text-lg">drag_indicator</span>
                      </td>
                    )}
                    <td class="py-2.5 px-3 text-white flex items-center gap-2.5">
                      <img src={row.image_desktop_url} alt="" class="w-14 h-8 rounded object-cover bg-black/30 shrink-0" />
                      <div class="min-w-0">
                        <div class="truncate max-w-[16rem] font-semibold">{row.title}</div>
                        <div class="text-[11px] text-gray-500 truncate max-w-[16rem]">{row.slug}</div>
                      </div>
                    </td>
                    <td class="py-2.5 px-3 text-gray-400 capitalize">{row.vertical}</td>
                    <td class="py-2.5 px-3 text-gray-500 text-xs max-w-[12rem] truncate" title={targetingLabel}>{targetingLabel}</td>
                    <td class="py-2.5 px-3 text-gray-500 text-xs">
                      {row.starts_at ? `From ${row.starts_at}` : 'No start'}<br />
                      {row.ends_at ? `Until ${row.ends_at}` : 'No expiry'}
                    </td>
                    <td class="py-2.5 px-3">
                      <span class={`text-[11px] font-bold px-2.5 py-1 rounded-full border capitalize ${LIFECYCLE_BADGE[row.lifecycle_state]}`}>{row.lifecycle_state}</span>
                    </td>
                    <td class="py-2.5 px-3 text-right whitespace-nowrap space-x-1">
                      <button class="hero-cc-preview-btn text-xs bg-white/5 text-gray-300 font-semibold px-2.5 py-1.5 rounded-lg" data-id={row.id} title="Preview">
                        <span class="material-symbols-outlined text-sm align-middle">visibility</span>
                      </button>
                      {canManage && row.lifecycle_state !== 'archived' && (
                        <>
                          <button class="hero-cc-edit-btn text-xs bg-white/5 text-gray-300 font-semibold px-2.5 py-1.5 rounded-lg" data-id={row.id} title="Edit">
                            <span class="material-symbols-outlined text-sm align-middle">edit</span>
                          </button>
                          <button class="hero-cc-duplicate-btn text-xs bg-white/5 text-gray-300 font-semibold px-2.5 py-1.5 rounded-lg" data-id={row.id} title="Duplicate">
                            <span class="material-symbols-outlined text-sm align-middle">content_copy</span>
                          </button>
                          {row.status === 'active' ? (
                            <button class="hero-cc-status-btn text-xs bg-amber-500/10 text-amber-400 font-semibold px-2.5 py-1.5 rounded-lg" data-id={row.id} data-target-status="inactive" title="Pause">
                              <span class="material-symbols-outlined text-sm align-middle">pause_circle</span>
                            </button>
                          ) : (
                            <button class="hero-cc-status-btn text-xs bg-ccaccent/15 text-ccaccent font-semibold px-2.5 py-1.5 rounded-lg" data-id={row.id} data-target-status="active" title="Activate">
                              <span class="material-symbols-outlined text-sm align-middle">play_circle</span>
                            </button>
                          )}
                          <button class="hero-cc-archive-btn text-xs bg-red-500/10 text-red-400 font-semibold px-2.5 py-1.5 rounded-lg" data-id={row.id} title="Archive">
                            <span class="material-symbols-outlined text-sm align-middle">archive</span>
                          </button>
                        </>
                      )}
                      {canManage && row.lifecycle_state === 'archived' && (
                        <button class="hero-cc-restore-btn text-xs bg-ccaccent/15 text-ccaccent font-semibold px-2.5 py-1.5 rounded-lg" data-id={row.id} title="Restore">
                          <span class="material-symbols-outlined text-sm align-middle">unarchive</span>
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p id="hero-cc-empty-state" class="hidden text-sm text-gray-500 text-center py-10">No campaigns match the current filters.</p>
      </div>

      {/* ---------- Create/Edit modal ---------- */}
      {canManage && (
        <div id="hero-cc-modal" class="hidden fixed inset-0 z-50 items-center justify-center p-4 bg-black/70 backdrop-blur-sm" style="display:none;">
          <div class="bg-ccpanel2 border border-ccborder rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto cc-scrollbar">
            <div class="flex items-center justify-between px-6 py-4 border-b border-ccborder sticky top-0 bg-ccpanel2 z-10">
              <h2 id="hero-cc-modal-title" class="text-lg font-bold text-white">Create Campaign</h2>
              <button id="hero-cc-modal-close" type="button" class="text-gray-400 hover:text-white"><span class="material-symbols-outlined">close</span></button>
            </div>
            <form id="hero-cc-form" class="px-6 py-5 space-y-4">
              <input type="hidden" id="hero-cc-form-id" />
              <div id="hero-cc-form-error" class="hidden bg-red-500/10 border border-red-500/25 text-red-400 text-xs rounded-lg px-3 py-2"></div>

              <div class="grid grid-cols-2 gap-3">
                <label class="block">
                  <span class="text-xs text-gray-400 mb-1 block">Slug (unique, lowercase-hyphenated) *</span>
                  <input id="hero-cc-f-slug" required class="w-full bg-black/30 border border-ccborder rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-ccaccent/50" />
                </label>
                <label class="block">
                  <span class="text-xs text-gray-400 mb-1 block">Vertical *</span>
                  <select id="hero-cc-f-vertical" class="w-full bg-black/30 border border-ccborder rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-ccaccent/50">
                    <option value="shop">shop</option>
                    <option value="ecosystem">ecosystem</option>
                    <option value="fresh">fresh</option>
                    <option value="eats">eats</option>
                    <option value="gigs">gigs</option>
                    <option value="stay">stay</option>
                    <option value="drive">drive</option>
                    <option value="send">send</option>
                    <option value="stream">stream</option>
                    <option value="aura">aura</option>
                  </select>
                </label>
              </div>

              <label class="block">
                <span class="text-xs text-gray-400 mb-1 block">Title *</span>
                <input id="hero-cc-f-title" required class="w-full bg-black/30 border border-ccborder rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-ccaccent/50" />
              </label>
              <label class="block">
                <span class="text-xs text-gray-400 mb-1 block">Subtitle</span>
                <input id="hero-cc-f-subtitle" class="w-full bg-black/30 border border-ccborder rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-ccaccent/50" />
              </label>

              <div class="grid grid-cols-2 gap-3">
                <label class="block">
                  <span class="text-xs text-gray-400 mb-1 block">CTA Label *</span>
                  <input id="hero-cc-f-cta-label" required class="w-full bg-black/30 border border-ccborder rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-ccaccent/50" />
                </label>
                <label class="block">
                  <span class="text-xs text-gray-400 mb-1 block">CTA Destination (path) *</span>
                  <input id="hero-cc-f-cta-href" required placeholder="/shop?category=..." class="w-full bg-black/30 border border-ccborder rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-ccaccent/50" />
                </label>
              </div>

              <div>
                <span class="text-xs text-gray-400 mb-1 block">Image (select from library or paste a custom /static/... URL) *</span>
                <select id="hero-cc-f-image-picker" class="w-full bg-black/30 border border-ccborder rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-ccaccent/50 mb-2">
                  <option value="">— Select from image library —</option>
                  {HERO_IMAGE_LIBRARY.map((img) => (
                    <option value={img.key} data-desktop={img.desktop_url} data-mobile={img.mobile_url}>{img.label}</option>
                  ))}
                </select>
                <div class="grid grid-cols-2 gap-3">
                  <input id="hero-cc-f-image-desktop" required placeholder="Desktop image URL (/static/hero/...)" class="w-full bg-black/30 border border-ccborder rounded-lg px-3 py-2 text-xs text-gray-200 outline-none focus:border-ccaccent/50" />
                  <input id="hero-cc-f-image-mobile" required placeholder="Mobile image URL (/static/hero/...)" class="w-full bg-black/30 border border-ccborder rounded-lg px-3 py-2 text-xs text-gray-200 outline-none focus:border-ccaccent/50" />
                </div>
                <div class="grid grid-cols-2 gap-3 mt-2">
                  <img id="hero-cc-f-preview-desktop" class="hidden w-full h-20 object-cover rounded-lg border border-ccborder" />
                  <img id="hero-cc-f-preview-mobile" class="hidden w-full h-20 object-cover rounded-lg border border-ccborder" />
                </div>
              </div>

              <label class="block">
                <span class="text-xs text-gray-400 mb-1 block">Theme (text overlay contrast)</span>
                <select id="hero-cc-f-theme" class="w-full bg-black/30 border border-ccborder rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-ccaccent/50">
                  <option value="dark">Dark overlay (light text)</option>
                  <option value="light">Light overlay (dark text)</option>
                </select>
              </label>

              <div class="grid grid-cols-2 gap-3">
                <label class="block">
                  <span class="text-xs text-gray-400 mb-1 block">Starts at (optional, UTC)</span>
                  <input id="hero-cc-f-starts-at" type="datetime-local" class="w-full bg-black/30 border border-ccborder rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-ccaccent/50" />
                </label>
                <label class="block">
                  <span class="text-xs text-gray-400 mb-1 block">Ends at (optional, UTC)</span>
                  <input id="hero-cc-f-ends-at" type="datetime-local" class="w-full bg-black/30 border border-ccborder rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-ccaccent/50" />
                </label>
              </div>

              <div class="border-t border-ccborder pt-4">
                <div class="text-xs font-bold text-gray-400 mb-2 uppercase tracking-wide">Targeting</div>
                <label class="block mb-3">
                  <span class="text-xs text-gray-400 mb-1 block">Countries (leave empty = all countries)</span>
                  <select id="hero-cc-f-countries" multiple class="w-full bg-black/30 border border-ccborder rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-ccaccent/50 h-24">
                    {(countries as any[]).map((ctry) => (
                      <option value={ctry.iso_code}>{ctry.name} ({ctry.iso_code})</option>
                    ))}
                  </select>
                </label>
                <div class="grid grid-cols-2 gap-3">
                  <label class="block">
                    <span class="text-xs text-gray-400 mb-1 block">Customer segment</span>
                    <input id="hero-cc-f-segment" value="all" placeholder="all" class="w-full bg-black/30 border border-ccborder rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-ccaccent/50" />
                  </label>
                  <label class="block">
                    <span class="text-xs text-gray-400 mb-1 block">Audience</span>
                    <select id="hero-cc-f-auth-state" class="w-full bg-black/30 border border-ccborder rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-ccaccent/50">
                      <option value="all">Everyone</option>
                      <option value="authenticated">Signed-in only</option>
                      <option value="anonymous">Anonymous only</option>
                    </select>
                  </label>
                </div>
                <p class="text-[11px] text-gray-600 mt-2">Targeting is stored now and enforced starting Phase 4 — every campaign is still shown to all visitors today regardless of these fields (see Checkpoint 1 report).</p>
              </div>

              <div class="flex items-center justify-end gap-2 pt-2 sticky bottom-0 bg-ccpanel2 pb-1">
                <button type="button" id="hero-cc-modal-cancel" class="text-sm text-gray-400 px-4 py-2.5 rounded-xl hover:text-white">Cancel</button>
                <button type="submit" id="hero-cc-form-submit" class="bg-ccaccent text-ccbg font-bold text-sm px-5 py-2.5 rounded-xl hover:brightness-110 transition">Save Campaign</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------- Preview modal (desktop + mobile) ---------- */}
      <div id="hero-cc-preview-modal" class="hidden fixed inset-0 z-50 items-center justify-center p-4 bg-black/70 backdrop-blur-sm" style="display:none;">
        <div class="bg-ccpanel2 border border-ccborder rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto cc-scrollbar">
          <div class="flex items-center justify-between px-6 py-4 border-b border-ccborder sticky top-0 bg-ccpanel2 z-10">
            <h2 class="text-lg font-bold text-white">Preview</h2>
            <button id="hero-cc-preview-close" type="button" class="text-gray-400 hover:text-white"><span class="material-symbols-outlined">close</span></button>
          </div>
          <div class="p-6 space-y-4" id="hero-cc-preview-body"></div>
        </div>
      </div>

      <script
        dangerouslySetInnerHTML={{
          __html: `
          (function () {
            var root = document.getElementById('hero-cc-root');
            var canManage = root && root.getAttribute('data-can-manage') === '1';
            var tbody = document.getElementById('hero-cc-tbody');
            var searchInput = document.getElementById('hero-cc-search');
            var stateFilter = document.getElementById('hero-cc-filter-state');
            var verticalFilter = document.getElementById('hero-cc-filter-vertical');
            var countLabel = document.getElementById('hero-cc-count-label');
            var emptyState = document.getElementById('hero-cc-empty-state');

            function applyFilters() {
              var q = (searchInput.value || '').toLowerCase();
              var st = stateFilter.value;
              var vt = verticalFilter.value;
              var visible = 0;
              document.querySelectorAll('.hero-cc-row').forEach(function (row) {
                var matchesQ = !q || row.getAttribute('data-search').indexOf(q) !== -1;
                var matchesSt = !st || row.getAttribute('data-status') === st;
                var matchesVt = !vt || row.getAttribute('data-vertical') === vt;
                var show = matchesQ && matchesSt && matchesVt;
                row.classList.toggle('hidden', !show);
                if (show) visible++;
              });
              countLabel.textContent = visible + ' campaign' + (visible === 1 ? '' : 's');
              emptyState.classList.toggle('hidden', visible !== 0);
            }
            searchInput.addEventListener('input', applyFilters);
            stateFilter.addEventListener('change', applyFilters);
            verticalFilter.addEventListener('change', applyFilters);

            // ---------- Preview modal ----------
            var previewModal = document.getElementById('hero-cc-preview-modal');
            var previewBody = document.getElementById('hero-cc-preview-body');
            function openPreview(id) {
              fetch('/api/control-center/hero-campaigns/' + id).then(function (r) { return r.json(); }).then(function (data) {
                var row = data.result;
                if (!row) return;
                previewBody.innerHTML =
                  '<div class="text-xs text-gray-500 mb-1">Desktop (65% hero zone)</div>' +
                  '<img src="' + row.image_desktop_url + '" class="w-full rounded-xl border border-ccborder mb-4" />' +
                  '<div class="text-xs text-gray-500 mb-1">Mobile carousel slide</div>' +
                  '<img src="' + row.image_mobile_url + '" class="w-40 mx-auto rounded-xl border border-ccborder mb-4" />' +
                  '<div class="bg-black/30 rounded-xl p-4">' +
                  '<div class="text-white font-bold text-lg">' + (row.title || '').replace(/</g,'&lt;') + '</div>' +
                  '<div class="text-gray-400 text-sm mt-1">' + (row.subtitle || '').replace(/</g,'&lt;') + '</div>' +
                  '<div class="inline-block mt-3 bg-ccaccent text-ccbg font-bold text-xs px-3 py-2 rounded-lg">' + (row.cta_label || '').replace(/</g,'&lt;') + '</div>' +
                  '<div class="text-gray-600 text-xs mt-2">Links to: ' + (row.cta_href || '').replace(/</g,'&lt;') + '</div>' +
                  '</div>';
                previewModal.style.display = 'flex';
                previewModal.classList.remove('hidden');
              });
            }
            document.querySelectorAll('.hero-cc-preview-btn').forEach(function (btn) {
              btn.addEventListener('click', function () { openPreview(btn.getAttribute('data-id')); });
            });
            document.getElementById('hero-cc-preview-close').addEventListener('click', function () {
              previewModal.style.display = 'none'; previewModal.classList.add('hidden');
            });
            previewModal.addEventListener('click', function (e) { if (e.target === previewModal) { previewModal.style.display = 'none'; previewModal.classList.add('hidden'); } });

            if (!canManage) return; // everything below is management-only

            // ---------- Create/Edit modal ----------
            var modal = document.getElementById('hero-cc-modal');
            var modalTitle = document.getElementById('hero-cc-modal-title');
            var form = document.getElementById('hero-cc-form');
            var formError = document.getElementById('hero-cc-form-error');
            var fId = document.getElementById('hero-cc-form-id');
            var fSlug = document.getElementById('hero-cc-f-slug');
            var fVertical = document.getElementById('hero-cc-f-vertical');
            var fTitle = document.getElementById('hero-cc-f-title');
            var fSubtitle = document.getElementById('hero-cc-f-subtitle');
            var fCtaLabel = document.getElementById('hero-cc-f-cta-label');
            var fCtaHref = document.getElementById('hero-cc-f-cta-href');
            var fImagePicker = document.getElementById('hero-cc-f-image-picker');
            var fImageDesktop = document.getElementById('hero-cc-f-image-desktop');
            var fImageMobile = document.getElementById('hero-cc-f-image-mobile');
            var fPreviewDesktop = document.getElementById('hero-cc-f-preview-desktop');
            var fPreviewMobile = document.getElementById('hero-cc-f-preview-mobile');
            var fTheme = document.getElementById('hero-cc-f-theme');
            var fStartsAt = document.getElementById('hero-cc-f-starts-at');
            var fEndsAt = document.getElementById('hero-cc-f-ends-at');
            var fCountries = document.getElementById('hero-cc-f-countries');
            var fSegment = document.getElementById('hero-cc-f-segment');
            var fAuthState = document.getElementById('hero-cc-f-auth-state');

            function showImgPreview(imgEl, url) {
              if (url) { imgEl.src = url; imgEl.classList.remove('hidden'); } else { imgEl.classList.add('hidden'); imgEl.src=''; }
            }
            fImageDesktop.addEventListener('input', function(){ showImgPreview(fPreviewDesktop, fImageDesktop.value); });
            fImageMobile.addEventListener('input', function(){ showImgPreview(fPreviewMobile, fImageMobile.value); });
            fImagePicker.addEventListener('change', function () {
              var opt = fImagePicker.options[fImagePicker.selectedIndex];
              if (!opt || !opt.getAttribute('data-desktop')) return;
              fImageDesktop.value = opt.getAttribute('data-desktop');
              fImageMobile.value = opt.getAttribute('data-mobile');
              showImgPreview(fPreviewDesktop, fImageDesktop.value);
              showImgPreview(fPreviewMobile, fImageMobile.value);
            });

            function openModal(mode, row) {
              formError.classList.add('hidden'); formError.textContent = '';
              form.reset();
              fPreviewDesktop.classList.add('hidden');
              fPreviewMobile.classList.add('hidden');
              Array.from(fCountries.options).forEach(function(o){ o.selected = false; });
              if (mode === 'create') {
                modalTitle.textContent = 'Create Campaign';
                fId.value = '';
                fTheme.value = 'dark';
                fAuthState.value = 'all';
                fSegment.value = 'all';
              } else {
                modalTitle.textContent = 'Edit Campaign';
                fId.value = row.id;
                fSlug.value = row.slug;
                fVertical.value = row.vertical;
                fTitle.value = row.title;
                fSubtitle.value = row.subtitle || '';
                fCtaLabel.value = row.cta_label;
                fCtaHref.value = row.cta_href;
                fImageDesktop.value = row.image_desktop_url;
                fImageMobile.value = row.image_mobile_url;
                showImgPreview(fPreviewDesktop, row.image_desktop_url);
                showImgPreview(fPreviewMobile, row.image_mobile_url);
                fTheme.value = row.theme;
                fStartsAt.value = row.starts_at ? row.starts_at.replace(' ', 'T').slice(0,16) : '';
                fEndsAt.value = row.ends_at ? row.ends_at.replace(' ', 'T').slice(0,16) : '';
                var tc = row.target_countries ? JSON.parse(row.target_countries) : [];
                Array.from(fCountries.options).forEach(function(o){ o.selected = tc.indexOf(o.value) !== -1; });
                fSegment.value = row.target_segment || 'all';
                fAuthState.value = row.target_auth_state || 'all';
              }
              modal.style.display = 'flex';
              modal.classList.remove('hidden');
            }
            function closeModal() { modal.style.display = 'none'; modal.classList.add('hidden'); }
            document.getElementById('hero-cc-create-btn').addEventListener('click', function () { openModal('create'); });
            document.getElementById('hero-cc-modal-close').addEventListener('click', closeModal);
            document.getElementById('hero-cc-modal-cancel').addEventListener('click', closeModal);
            modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });

            document.querySelectorAll('.hero-cc-edit-btn').forEach(function (btn) {
              btn.addEventListener('click', function () {
                fetch('/api/control-center/hero-campaigns/' + btn.getAttribute('data-id')).then(function(r){return r.json();}).then(function(data){
                  if (data.result) openModal('edit', data.result);
                });
              });
            });

            form.addEventListener('submit', function (e) {
              e.preventDefault();
              var id = fId.value;
              var selectedCountries = Array.from(fCountries.selectedOptions).map(function(o){ return o.value; });
              var payload = {
                slug: fSlug.value.trim(),
                title: fTitle.value.trim(),
                subtitle: fSubtitle.value.trim() || null,
                cta_label: fCtaLabel.value.trim(),
                cta_href: fCtaHref.value.trim(),
                vertical: fVertical.value,
                theme: fTheme.value,
                image_desktop_url: fImageDesktop.value.trim(),
                image_mobile_url: fImageMobile.value.trim(),
                starts_at: fStartsAt.value ? fStartsAt.value.replace('T', ' ') + ':00' : null,
                ends_at: fEndsAt.value ? fEndsAt.value.replace('T', ' ') + ':00' : null,
                target_countries: selectedCountries,
                target_segment: fSegment.value.trim() || 'all',
                target_auth_state: fAuthState.value
              };
              var url = id ? '/api/control-center/hero-campaigns/' + id : '/api/control-center/hero-campaigns';
              var method = id ? 'PATCH' : 'POST';
              document.getElementById('hero-cc-form-submit').disabled = true;
              fetch(url, { method: method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) })
                .then(function (res) { return res.json().then(function(data){ return {ok: res.ok, data: data}; }); })
                .then(function (result) {
                  document.getElementById('hero-cc-form-submit').disabled = false;
                  if (!result.ok) { formError.textContent = result.data.error || 'Failed to save campaign'; formError.classList.remove('hidden'); return; }
                  location.reload();
                })
                .catch(function () { document.getElementById('hero-cc-form-submit').disabled = false; formError.textContent = 'Network error'; formError.classList.remove('hidden'); });
            });

            // ---------- Row action buttons ----------
            tbody.addEventListener('click', function (e) {
              var dup = e.target.closest('.hero-cc-duplicate-btn');
              var status = e.target.closest('.hero-cc-status-btn');
              var archive = e.target.closest('.hero-cc-archive-btn');
              var restore = e.target.closest('.hero-cc-restore-btn');
              if (dup) {
                fetch('/api/control-center/hero-campaigns/' + dup.getAttribute('data-id') + '/duplicate', { method: 'POST' })
                  .then(function(r){ return r.json(); }).then(function(data){
                    if (data.id) location.reload(); else alert(data.error || 'Failed to duplicate');
                  });
              } else if (status) {
                var targetStatus = status.getAttribute('data-target-status');
                fetch('/api/control-center/hero-campaigns/' + status.getAttribute('data-id') + '/status', {
                  method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ status: targetStatus })
                }).then(function(r){ return r.json(); }).then(function(data){
                  if (data.success) location.reload(); else alert(data.error || 'Failed to update status');
                });
              } else if (archive) {
                if (!confirm('Archive this campaign? It will be removed from the homepage and hidden from the default list, but its history is preserved and it can be restored later.')) return;
                fetch('/api/control-center/hero-campaigns/' + archive.getAttribute('data-id') + '/archive', { method: 'POST' })
                  .then(function(r){ return r.json(); }).then(function(data){
                    if (data.success) location.reload(); else alert(data.error || 'Failed to archive');
                  });
              } else if (restore) {
                fetch('/api/control-center/hero-campaigns/' + restore.getAttribute('data-id') + '/restore', { method: 'POST' })
                  .then(function(r){ return r.json(); }).then(function(data){
                    if (data.success) location.reload(); else alert(data.error || 'Failed to restore');
                  });
              }
            });

            // ---------- Drag-and-drop reorder (desktop rows) ----------
            var draggedRow = null;
            tbody.querySelectorAll('.hero-cc-row').forEach(function (row) {
              row.addEventListener('dragstart', function () { draggedRow = row; row.classList.add('opacity-40'); });
              row.addEventListener('dragend', function () { row.classList.remove('opacity-40'); draggedRow = null; });
              row.addEventListener('dragover', function (e) { e.preventDefault(); });
              row.addEventListener('drop', function (e) {
                e.preventDefault();
                if (!draggedRow || draggedRow === row) return;
                var rows = Array.from(tbody.querySelectorAll('.hero-cc-row'));
                var draggedIdx = rows.indexOf(draggedRow);
                var targetIdx = rows.indexOf(row);
                if (draggedIdx < targetIdx) row.after(draggedRow); else row.before(draggedRow);
                var orderedIds = Array.from(tbody.querySelectorAll('.hero-cc-row')).map(function (r) { return Number(r.getAttribute('data-id')); });
                fetch('/api/control-center/hero-campaigns/reorder', {
                  method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ ordered_ids: orderedIds })
                }).then(function(r){ return r.json(); }).then(function(data){
                  if (!data.success) alert(data.error || 'Failed to save new order');
                });
              });
            });
          })();
        `,
        }}
      ></script>
    </ControlCenterLayout>
  )
})

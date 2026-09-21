/**
 * Aura Experience Engine — resolver + real-data aggregation layer.
 *
 * ARCHITECTURE (Pat's explicit mandate, 2026-09-21 "FINAL DIRECTIVE" —
 * "ONE AURA BRAIN -> MANY AURA EXPERIENCES -> DIFFERENT USERS -> DIFFERENT
 * INTERFACES"): this file is the ONE place that decides which visual
 * "experience" (Aura Classic / Aura Luxe / Aura Pulse / Aura Executive) a
 * given request should render, and the ONE place that assembles the real
 * account data every experience is allowed to show. It does NOT contain any
 * AI/LLM logic — Aura's actual intelligence layer is Phase 3 (deferred);
 * every experience shares that single future brain identically. Nothing
 * here duplicates a "backend per experience".
 *
 * RESOLUTION CHAIN implemented (Section 7 of the directive):
 *   User -> Identity -> User Preference -> Account Type -> Experience
 *   Assignment -> Experiment Assignment -> Context -> Time Rules -> Aura
 *   Experience.
 *
 * Phase 1 implements the two ends of that chain that have a real data
 * source today (explicit per-user assignment via aura_experience_assignments,
 * and the is_default fallback on aura_experiences) plus a guest fallback.
 * The middle links (account-type rules, A/B "experiment" rollout percentages,
 * context/time-of-day rules) are INTENTIONALLY represented only as documented
 * no-op steps below, not as speculative columns/tables — Section 16 of the
 * directive is explicit that those rules should be added when Classic/Pulse/
 * Executive actually exist and need real distribution logic, not modeled
 * ahead of time against a registry that (for now) has exactly one active
 * row. Adding them later is a new nullable column/table layered on top of
 * this function's signature, never a breaking change to it — see this
 * function's inline comments for exactly where each future link plugs in.
 *
 * DEV/TEST OVERRIDE: per Section 7 ("For Phase 1, Aura Luxe can be the
 * development/test experience"), an unauthenticated or unassigned visitor
 * still resolves to Luxe for now (via aura_experiences.is_default being
 * temporarily NOT what Phase 1 wants live) — see resolveAuraExperience()'s
 * DEV_DEFAULT_SLUG constant, which is the single line to flip to 'classic'
 * once Aura Classic has its own real visual implementation (Phase 4).
 */

import type { D1Database } from '@cloudflare/workers-types'
import { getWalletBalance } from './wallet'
import { getBookingsForCustomer } from './booking-lifecycle'
import type { AuthUser } from '../types'

// ---------------------------------------------------------------------------
// Experience registry types + resolver
// ---------------------------------------------------------------------------

export type AuraExperienceSlug = 'classic' | 'luxe' | 'pulse' | 'executive'

export interface AuraExperienceRow {
  id: number
  slug: AuraExperienceSlug
  name: string
  tagline: string
  description: string
  theme_primary_color: string
  theme_dark_color: string
  theme_accent_color: string
  status: 'draft' | 'active' | 'paused' | 'retired'
  is_default: number
  display_order: number
}

/**
 * Phase 1 dev/test default (Section 7). Flip to 'classic' in Phase 4 when
 * Aura Classic ships its own visual implementation and should become the
 * true default fallback for unassigned users, matching the eventual
 * production intent documented in migration 0074's seed data comment.
 */
const DEV_DEFAULT_SLUG: AuraExperienceSlug = 'luxe'

export async function getAuraExperienceBySlug(db: D1Database, slug: AuraExperienceSlug): Promise<AuraExperienceRow | null> {
  return db.prepare('SELECT * FROM aura_experiences WHERE slug = ?').bind(slug).first<AuraExperienceRow>()
}

export async function getAllAuraExperiences(db: D1Database): Promise<AuraExperienceRow[]> {
  const { results } = await db.prepare('SELECT * FROM aura_experiences ORDER BY display_order ASC').all<AuraExperienceRow>()
  return results
}

/**
 * Deterministic experience resolver.
 *
 * Step-by-step, mapped to the directive's chain:
 *   1. Identity          — no user (guest) -> DEV_DEFAULT_SLUG immediately.
 *   2. Experience Assignment — aura_experience_assignments row for this
 *                            user_id, if present, WINS (explicit override).
 *   3. User Preference / Account Type / Experiment Assignment / Context /
 *      Time Rules — NOT YET MODELED (Section 16: deferred to Phase 4 when
 *      Classic/Pulse/Executive exist to actually distribute between).
 *      Documented as explicit pass-through no-ops so the NEXT engineer
 *      touching this function sees exactly where each one plugs in rather
 *      than reverse-engineering it from a blank gap.
 *   4. Default fallback  — aura_experiences.is_default row, else DEV_DEFAULT_SLUG.
 */
export async function resolveAuraExperience(db: D1Database, user: AuthUser | null): Promise<AuraExperienceRow> {
  // Step 1: Identity
  if (!user) {
    const fallback = await getAuraExperienceBySlug(db, DEV_DEFAULT_SLUG)
    if (fallback) return fallback
    return HARDCODED_LUXE_FALLBACK
  }

  // Step 2: explicit per-user Experience Assignment (the only populated
  // link in the chain today — see aura_experience_assignments, migration 0074).
  const assignment = await db
    .prepare(
      `SELECT ae.* FROM aura_experience_assignments aea
       JOIN aura_experiences ae ON ae.id = aea.experience_id
       WHERE aea.user_id = ?`
    )
    .bind(user.id)
    .first<AuraExperienceRow>()
  if (assignment) return assignment

  // Step 3: User Preference — PLUG IN HERE when account_preferences gains
  // an aura_experience_preference column (Phase 4).
  // Step 3: Account Type — PLUG IN HERE to branch on user.role /
  // organization membership once account-type-based rules are designed (Phase 4).
  // Step 3: Experiment Assignment — PLUG IN HERE for A/B rollout-percentage
  // bucketing once more than one experience is `status = 'active'` (Phase 4).
  // Step 3: Context — PLUG IN HERE for device/locale-based rules (Phase 4).
  // Step 3: Time Rules — PLUG IN HERE for time-of-day/seasonal campaign
  // rules once there is a second real experience to switch into (Phase 4).

  // Step 4: default fallback
  const fallback = await getAuraExperienceBySlug(db, DEV_DEFAULT_SLUG)
  if (fallback) return fallback
  return HARDCODED_LUXE_FALLBACK
}

/** Last-resort literal fallback if migration 0074 somehow hasn't been applied — keeps /aura from ever hard-crashing on a missing table. */
const HARDCODED_LUXE_FALLBACK: AuraExperienceRow = {
  id: 0,
  slug: 'luxe',
  name: 'Aura Luxe',
  tagline: 'Ask Aura. Find it. Do it.',
  description: 'African luxury concierge experience.',
  theme_primary_color: '#008753',
  theme_dark_color: '#021F13',
  theme_accent_color: '#CCA43B',
  status: 'active',
  is_default: 0,
  display_order: 20,
}

/**
 * Explicitly assigns a user to an experience (manual override). Exists now
 * so the future Aura Experience Manager admin UI (Section 17) has a real
 * function to call — not wired to any UI yet in Phase 1.
 */
export async function assignUserToExperience(
  db: D1Database,
  userId: number,
  experienceSlug: AuraExperienceSlug,
  reason: 'manual' | 'default_fallback' | 'segment' | 'ab_test' | 'preference' = 'manual',
  assignedByUserId: number | null = null
): Promise<void> {
  const experience = await getAuraExperienceBySlug(db, experienceSlug)
  if (!experience) throw new Error(`Unknown Aura experience slug: ${experienceSlug}`)
  await db
    .prepare(
      `INSERT INTO aura_experience_assignments (user_id, experience_id, assignment_reason, assigned_by_user_id, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET experience_id = excluded.experience_id, assignment_reason = excluded.assignment_reason, assigned_by_user_id = excluded.assigned_by_user_id, updated_at = datetime('now')`
    )
    .bind(userId, experience.id, reason, assignedByUserId)
    .run()
}

// ---------------------------------------------------------------------------
// Real-data aggregation for the Aura Luxe dashboard (Section 8: "use real
// data wherever it exists ... never fabricate real account information").
//
// Deliberately reuses the SAME primitives every other authenticated page
// already reads (getWalletBalance from wallet.ts, getBookingsForCustomer
// from booking-lifecycle.ts, direct COUNT queries against orders/shipments/
// notifications matching personalization.ts's own established pattern) —
// no new "Aura data engine", no fabricated numbers anywhere in this file.
// ---------------------------------------------------------------------------

export interface AuraUpcomingActivityItem {
  kind: 'delivery' | 'booking' | 'ride'
  icon: string
  title: string
  subtitle: string
  href: string | null
}

export interface AuraDashboardSnapshot {
  walletBalanceKobo: number
  activeOrdersCount: number
  upcomingBookingsCount: number
  ongoingDeliveriesCount: number
  savedItemsCount: number
  unreadNotificationsCount: number
  upcomingActivity: AuraUpcomingActivityItem[]
  recentOrdersCount: number
}

/** Order statuses that count as "active" for the dashboard stat tile — mirrors orders.tsx's own definition of an in-flight order (not yet delivered/cancelled). */
const ACTIVE_ORDER_STATUSES = ['pending_payment', 'processing', 'shipped', 'out_for_delivery']
const UPCOMING_BOOKING_STATUSES = ['held', 'confirmed']
const ONGOING_SHIPMENT_STATUSES = ['booked', 'pickup_assigned', 'picked_up', 'in_transit', 'out_for_delivery']

export async function getAuraDashboardSnapshot(db: D1Database, userId: number): Promise<AuraDashboardSnapshot> {
  const [
    walletBalanceKobo,
    activeOrdersRow,
    bookings,
    ongoingShipments,
    wishlistCountRow,
    unreadNotificationsRow,
  ] = await Promise.all([
    getWalletBalance(db, userId),
    db
      .prepare(`SELECT COUNT(*) as n FROM orders WHERE user_id = ? AND status IN (${ACTIVE_ORDER_STATUSES.map(() => '?').join(',')})`)
      .bind(userId, ...ACTIVE_ORDER_STATUSES)
      .first<{ n: number }>(),
    getBookingsForCustomer(db, userId, { limit: 5 }),
    db
      .prepare(`SELECT * FROM shipments WHERE customer_user_id = ? AND status IN (${ONGOING_SHIPMENT_STATUSES.map(() => '?').join(',')}) ORDER BY updated_at DESC LIMIT 3`)
      .bind(userId, ...ONGOING_SHIPMENT_STATUSES)
      .all<{ id: number; tracking_number: string; status: string; destination_country_iso: string }>(),
    db.prepare('SELECT COUNT(*) as n FROM wishlists WHERE user_id = ?').bind(userId).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) as n FROM notifications WHERE user_id = ? AND is_read = 0').bind(userId).first<{ n: number }>(),
  ])

  const upcomingBookings = (bookings as any[]).filter((b) => UPCOMING_BOOKING_STATUSES.includes(b.status))

  const upcomingActivity: AuraUpcomingActivityItem[] = []
  for (const s of ongoingShipments.results) {
    upcomingActivity.push({
      kind: 'delivery',
      icon: 'local_shipping',
      title: 'Out for delivery',
      subtitle: `NaijaSend · ${s.tracking_number}`,
      // /send is still a coming-soon preview page (no dedicated per-shipment
      // tracking route exists yet) — link there honestly rather than to a
      // URL that doesn't resolve.
      href: `/send`,
    })
  }
  for (const b of upcomingBookings.slice(0, 3)) {
    upcomingActivity.push({
      kind: 'booking',
      icon: b.listing_type === 'stay_unit' ? 'hotel' : 'event_available',
      title: b.status === 'confirmed' ? 'Booking confirmed' : 'Booking held',
      subtitle: `${b.listing_title} · ${new Date(b.starts_at).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}`,
      href: `/account`,
    })
  }

  return {
    walletBalanceKobo,
    activeOrdersCount: activeOrdersRow?.n ?? 0,
    upcomingBookingsCount: upcomingBookings.length,
    ongoingDeliveriesCount: ongoingShipments.results.length,
    savedItemsCount: wishlistCountRow?.n ?? 0,
    unreadNotificationsCount: unreadNotificationsRow?.n ?? 0,
    upcomingActivity: upcomingActivity.slice(0, 3),
    recentOrdersCount: activeOrdersRow?.n ?? 0,
  }
}

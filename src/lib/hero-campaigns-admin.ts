/**
 * Enterprise Control Center — Hero Campaign Management (Checkpoint 1).
 *
 * Extends the existing READ-ONLY src/lib/hero-campaigns.ts (getActiveHeroCampaigns
 * — untouched by this file, still the sole read path HeroZone.tsx/home.tsx depend
 * on) with the create/edit/duplicate/schedule/activate/pause/archive/reorder
 * capability the read-only forensic audit confirmed did not exist anywhere in this
 * codebase (zero INSERT/UPDATE/DELETE against hero_campaigns prior to this file).
 *
 * ARCHITECTURAL PATTERN — this file is the reference implementation every future
 * Control Center management module (categories, recommendations, etc.) should
 * copy: thin, typed input interfaces; every write function takes the acting
 * admin's user id explicitly (never trusts a client-supplied actor); no route-layer
 * authorization logic lives here (that belongs in api-control-center.ts via
 * requireControlCenterPermission — this module is called only after that gate
 * passes); every mutating function returns enough information for the caller to
 * build a correct audit-log entry (see src/lib/control-center-audit.ts).
 *
 * SOFT DELETE: deleteHeroCampaign() below NEVER issues a hard SQL DELETE. It sets
 * is_archived = 1 (migration 0061). An archived campaign is excluded from both the
 * admin list (by default) and the public getActiveHeroCampaigns() query (belt-and-
 * suspenders — see hero-campaigns.ts's own updated WHERE clause), but its row and
 * audit history survive indefinitely for compliance/reuse, exactly as Pat's spec's
 * "Delete/Archive" (not "Delete") capability requires.
 */

export interface HeroCampaignAdminRow {
  id: number
  slug: string
  title: string
  subtitle: string | null
  image_desktop_url: string
  image_mobile_url: string
  cta_label: string
  cta_href: string
  vertical: string
  theme: 'dark' | 'light'
  display_order: number
  status: 'active' | 'inactive'
  starts_at: string | null
  ends_at: string | null
  target_countries: string | null
  target_segment: string
  target_auth_state: 'all' | 'authenticated' | 'anonymous'
  priority: number | null
  created_by_user_id: number | null
  updated_by_user_id: number | null
  is_archived: number
  created_at: string
  updated_at: string
}

export interface HeroCampaignInput {
  slug: string
  title: string
  subtitle?: string | null
  image_desktop_url: string
  image_mobile_url: string
  cta_label: string
  cta_href: string
  vertical: string
  theme?: 'dark' | 'light'
  display_order?: number
  starts_at?: string | null
  ends_at?: string | null
  target_countries?: string[] | null
  target_segment?: string
  target_auth_state?: 'all' | 'authenticated' | 'anonymous'
}

const REQUIRED_FIELDS: (keyof HeroCampaignInput)[] = ['slug', 'title', 'image_desktop_url', 'image_mobile_url', 'cta_label', 'cta_href', 'vertical']

function validateInput(input: Partial<HeroCampaignInput>, isCreate: boolean) {
  if (isCreate) {
    for (const field of REQUIRED_FIELDS) {
      if (!input[field] || String(input[field]).trim() === '') {
        throw new Error(`Field "${field}" is required`)
      }
    }
  }
  if (input.slug !== undefined && !/^[a-z0-9-]+$/.test(input.slug)) {
    throw new Error('Slug must contain only lowercase letters, numbers and hyphens')
  }
  if (input.theme !== undefined && input.theme !== 'dark' && input.theme !== 'light') {
    throw new Error('Theme must be "dark" or "light"')
  }
  if (input.target_auth_state !== undefined && !['all', 'authenticated', 'anonymous'].includes(input.target_auth_state)) {
    throw new Error('target_auth_state must be "all", "authenticated" or "anonymous"')
  }
  if (input.starts_at && input.ends_at) {
    if (new Date(input.ends_at).getTime() <= new Date(input.starts_at).getTime()) {
      throw new Error('End date/time must be after start date/time')
    }
  }
}

/** Every campaign for the admin list view — including inactive/archived (admin explicitly asks for archived via includeArchived). The public getActiveHeroCampaigns() in hero-campaigns.ts is unrelated and unaffected. */
export async function getAllHeroCampaignsForAdmin(db: D1Database, opts: { includeArchived?: boolean } = {}): Promise<HeroCampaignAdminRow[]> {
  const sql = opts.includeArchived
    ? 'SELECT * FROM hero_campaigns ORDER BY display_order ASC, id ASC'
    : 'SELECT * FROM hero_campaigns WHERE is_archived = 0 ORDER BY display_order ASC, id ASC'
  const { results } = await db.prepare(sql).all<HeroCampaignAdminRow>()
  return results
}

export async function getHeroCampaignById(db: D1Database, id: number): Promise<HeroCampaignAdminRow | null> {
  return db.prepare('SELECT * FROM hero_campaigns WHERE id = ?').bind(id).first<HeroCampaignAdminRow>()
}

export async function createHeroCampaign(db: D1Database, adminUserId: number, input: HeroCampaignInput): Promise<number> {
  validateInput(input, true)

  const existing = await db.prepare('SELECT id FROM hero_campaigns WHERE slug = ?').bind(input.slug).first()
  if (existing) throw new Error(`A campaign with slug "${input.slug}" already exists`)

  let displayOrder = input.display_order
  if (displayOrder === undefined) {
    const maxRow = await db.prepare('SELECT COALESCE(MAX(display_order), 0) AS max_order FROM hero_campaigns').first<{ max_order: number }>()
    displayOrder = (maxRow?.max_order ?? 0) + 1
  }

  const targetCountriesJson = input.target_countries && input.target_countries.length > 0 ? JSON.stringify(input.target_countries) : null

  const result = await db
    .prepare(
      `INSERT INTO hero_campaigns
        (slug, title, subtitle, image_desktop_url, image_mobile_url, cta_label, cta_href, vertical, theme,
         display_order, status, starts_at, ends_at, target_countries, target_segment, target_auth_state,
         priority, created_by_user_id, updated_by_user_id, is_archived)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'inactive', ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    )
    .bind(
      input.slug,
      input.title,
      input.subtitle ?? null,
      input.image_desktop_url,
      input.image_mobile_url,
      input.cta_label,
      input.cta_href,
      input.vertical,
      input.theme ?? 'dark',
      displayOrder,
      input.starts_at ?? null,
      input.ends_at ?? null,
      targetCountriesJson,
      input.target_segment ?? 'all',
      input.target_auth_state ?? 'all',
      displayOrder,
      adminUserId,
      adminUserId
    )
    .run()

  return Number(result.meta.last_row_id)
  // NOTE: new campaigns are created with status='inactive' by design — an admin
  // must explicitly Activate a campaign (see setHeroCampaignStatus below) rather
  // than a freshly-created, possibly-incomplete campaign silently going live the
  // instant it's saved. This mirrors collections-admin.ts's own is_active=1
  // default being the ONE deliberate divergence: hero campaigns are customer-
  // facing homepage content, so "create" and "publish" are intentionally two
  // separate, auditable actions here.
}

export async function updateHeroCampaign(db: D1Database, id: number, adminUserId: number, input: Partial<HeroCampaignInput>): Promise<boolean> {
  validateInput(input, false)

  if (input.slug !== undefined) {
    const clash = await db.prepare('SELECT id FROM hero_campaigns WHERE slug = ? AND id != ?').bind(input.slug, id).first()
    if (clash) throw new Error(`A campaign with slug "${input.slug}" already exists`)
  }

  const fields: string[] = []
  const binds: unknown[] = []
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    if (key === 'target_countries') {
      fields.push('target_countries = ?')
      binds.push(Array.isArray(value) && value.length > 0 ? JSON.stringify(value) : null)
      continue
    }
    fields.push(`${key} = ?`)
    binds.push(value)
  }
  if (fields.length === 0) return true

  fields.push('updated_by_user_id = ?', "updated_at = datetime('now')")
  binds.push(adminUserId)

  const result = await db.prepare(`UPDATE hero_campaigns SET ${fields.join(', ')} WHERE id = ?`).bind(...binds, id).run()
  return (result.meta.rows_written ?? 0) > 0
}

/** Real Activate/Pause — flips status between 'active' and 'inactive'. Distinct from archive: a paused campaign keeps its slug/data and can be re-activated any time. */
export async function setHeroCampaignStatus(db: D1Database, id: number, adminUserId: number, status: 'active' | 'inactive'): Promise<boolean> {
  const result = await db
    .prepare("UPDATE hero_campaigns SET status = ?, updated_by_user_id = ?, updated_at = datetime('now') WHERE id = ? AND is_archived = 0")
    .bind(status, adminUserId, id)
    .run()
  return (result.meta.rows_written ?? 0) > 0
}

/** Soft delete — see file header. Also force-deactivates so an archived-but-still-'active' row can never slip past the belt-and-suspenders WHERE clause in getActiveHeroCampaigns(). */
export async function archiveHeroCampaign(db: D1Database, id: number, adminUserId: number): Promise<boolean> {
  const result = await db
    .prepare("UPDATE hero_campaigns SET is_archived = 1, status = 'inactive', updated_by_user_id = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(adminUserId, id)
    .run()
  return (result.meta.rows_written ?? 0) > 0
}

export async function restoreHeroCampaign(db: D1Database, id: number, adminUserId: number): Promise<boolean> {
  const result = await db
    .prepare("UPDATE hero_campaigns SET is_archived = 0, updated_by_user_id = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(adminUserId, id)
    .run()
  return (result.meta.rows_written ?? 0) > 0
}

/**
 * Duplicate an existing campaign as a new draft (status='inactive', is_archived=0)
 * with a guaranteed-unique slug (`<original>-copy`, `<original>-copy-2`, ...).
 * Lets marketing quickly spin up a seasonal variant of a proven campaign without
 * re-typing every field.
 */
export async function duplicateHeroCampaign(db: D1Database, id: number, adminUserId: number): Promise<number> {
  const original = await getHeroCampaignById(db, id)
  if (!original) throw new Error('Campaign not found')

  let candidateSlug = `${original.slug}-copy`
  let suffix = 2
  while (await db.prepare('SELECT id FROM hero_campaigns WHERE slug = ?').bind(candidateSlug).first()) {
    candidateSlug = `${original.slug}-copy-${suffix}`
    suffix += 1
  }

  const maxRow = await db.prepare('SELECT COALESCE(MAX(display_order), 0) AS max_order FROM hero_campaigns').first<{ max_order: number }>()
  const newOrder = (maxRow?.max_order ?? 0) + 1

  const result = await db
    .prepare(
      `INSERT INTO hero_campaigns
        (slug, title, subtitle, image_desktop_url, image_mobile_url, cta_label, cta_href, vertical, theme,
         display_order, status, starts_at, ends_at, target_countries, target_segment, target_auth_state,
         priority, created_by_user_id, updated_by_user_id, is_archived)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'inactive', NULL, NULL, ?, ?, ?, ?, ?, ?, 0)`
    )
    .bind(
      candidateSlug,
      `${original.title} (Copy)`,
      original.subtitle,
      original.image_desktop_url,
      original.image_mobile_url,
      original.cta_label,
      original.cta_href,
      original.vertical,
      original.theme,
      newOrder,
      original.target_countries,
      original.target_segment,
      original.target_auth_state,
      newOrder,
      adminUserId,
      adminUserId
    )
    .run()

  return Number(result.meta.last_row_id)
}

/** Reorders every non-archived campaign in one batch — `orderedIds` is the FULL new order (index = new display_order/priority). Ids not found are silently ignored (no WHERE-less UPDATE risk). */
export async function reorderHeroCampaigns(db: D1Database, adminUserId: number, orderedIds: number[]): Promise<void> {
  const statements = orderedIds.map((id, index) =>
    db
      .prepare("UPDATE hero_campaigns SET display_order = ?, priority = ?, updated_by_user_id = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(index + 1, index + 1, adminUserId, id)
  )
  if (statements.length > 0) await db.batch(statements)
}

/**
 * Real, derived status label for the admin table — distinguishes "Active" (currently
 * live) from "Scheduled" (active but starts_at is in the future) and "Expired"
 * (active but ends_at has passed) from the raw status column alone, without needing
 * a cron job (Cloudflare hosted-deploy has no cron triggers — see project README).
 *
 * starts_at/ends_at are stored as SQLite datetime('now')-style strings
 * ("YYYY-MM-DD HH:MM:SS", UTC, no "T"/"Z"). Comparing those lexicographically
 * against a JS Date.toISOString() ("YYYY-MM-DDTHH:MM:SS.sssZ") is unsafe — the
 * "T"/space and millisecond suffix break simple string comparison right at the
 * boundary of a day. Both sides are normalized to epoch milliseconds instead.
 */
function parseSqliteDatetime(value: string): number {
  // New Date() parses "YYYY-MM-DD HH:MM:SS" inconsistently across environments —
  // force it into an unambiguous ISO string first.
  return new Date(value.replace(' ', 'T') + 'Z').getTime()
}

export function computeCampaignLifecycleState(row: HeroCampaignAdminRow, now: Date = new Date()): 'archived' | 'inactive' | 'scheduled' | 'expired' | 'active' {
  if (row.is_archived) return 'archived'
  if (row.status !== 'active') return 'inactive'
  const nowMs = now.getTime()
  if (row.starts_at && parseSqliteDatetime(row.starts_at) > nowMs) return 'scheduled'
  if (row.ends_at && parseSqliteDatetime(row.ends_at) <= nowMs) return 'expired'
  return 'active'
}

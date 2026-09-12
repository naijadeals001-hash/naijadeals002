/**
 * Engine 9 — Template rendering with SAFE interpolation only.
 *
 * SECURITY (Phase 19's mandate — template injection / unsafe HTML email /
 * SMS injection): rendering NEVER evaluates arbitrary expressions. It is a
 * single-pass `{{key}}` token replacement against the payload object,
 * where:
 *   - unknown keys render as empty string (never throw, never leak
 *     "undefined"/stack traces into a user-facing message)
 *   - every interpolated VALUE is HTML-escaped before insertion (closes
 *     the "unsafe HTML email" / stored-XSS-via-notification vector — a
 *     malicious order note or product title could otherwise inject
 *     <script> into an email body or the in-app notification body,
 *     which is later likely rendered as HTML in some future UI)
 *   - the template STRING itself comes only from notification_templates
 *     rows (author-controlled, not user-controlled) — payload values are
 *     the only user-influenceable input, and those are always escaped
 *   - no `eval`, no `Function()`, no nested/recursive interpolation
 *
 * If no active template row exists for (event_type, channel, locale), a
 * template-less fallback is used (event_type as the title, empty body) —
 * this MUST NOT throw and block delivery of an otherwise-legitimate
 * notification just because a template hasn't been authored yet for a
 * niche event/channel/locale combination.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Renders `{{key}}` tokens against `payload`, HTML-escaping every substituted value. Unknown keys become ''. */
export function interpolate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = payload[key]
    if (value === undefined || value === null) return ''
    return escapeHtml(String(value))
  })
}

export interface RenderedNotification {
  subject: string | null
  body: string
  actionUrl: string | null
}

interface TemplateRow {
  subject_template: string | null
  body_template: string
  action_url_template: string | null
}

/** Looks up the active template for (eventType, channel, locale='en' — the only locale seeded so far, per Phase 8's "data model without implementing every country now" instruction), renders it against payload, and returns the result. Falls back to an honest minimal rendering if no template row exists — never throws. */
export async function renderTemplate(db: D1Database, eventType: string, channel: string, payload: Record<string, unknown>, locale = 'en'): Promise<RenderedNotification> {
  const row = await db
    .prepare(
      `SELECT subject_template, body_template, action_url_template FROM notification_templates
       WHERE event_type = ? AND channel = ? AND locale = ? AND is_active = 1
       ORDER BY version DESC LIMIT 1`
    )
    .bind(eventType, channel, locale)
    .first<TemplateRow>()

  if (!row) {
    // Honest fallback — no template authored yet for this combination.
    // Does not fabricate rich content; a plain, safe, minimal message.
    return { subject: eventType.replace(/_/g, ' '), body: '', actionUrl: null }
  }

  return {
    subject: row.subject_template ? interpolate(row.subject_template, payload) : null,
    body: interpolate(row.body_template, payload),
    actionUrl: row.action_url_template ? interpolate(row.action_url_template, payload) : null,
  }
}

export interface TemplateInput {
  eventType: string
  channel: 'in_app' | 'email' | 'sms' | 'push'
  locale?: string
  subjectTemplate?: string | null
  bodyTemplate: string
  actionUrlTemplate?: string | null
}

/** Admin-only: registers a new template VERSION (never mutates an existing version in place — see the table's UNIQUE(event_type, channel, locale, version) and is_active semantics in the migration). */
export async function createTemplateVersion(db: D1Database, input: TemplateInput): Promise<number> {
  const latest = await db
    .prepare('SELECT MAX(version) as v FROM notification_templates WHERE event_type = ? AND channel = ? AND locale = ?')
    .bind(input.eventType, input.channel, input.locale ?? 'en')
    .first<{ v: number | null }>()
  const nextVersion = (latest?.v ?? 0) + 1

  const result = await db
    .prepare(
      `INSERT INTO notification_templates (event_type, channel, locale, version, subject_template, body_template, action_url_template, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .bind(input.eventType, input.channel, input.locale ?? 'en', nextVersion, input.subjectTemplate ?? null, input.bodyTemplate, input.actionUrlTemplate ?? null)
    .run()
  return Number(result.meta.last_row_id)
}

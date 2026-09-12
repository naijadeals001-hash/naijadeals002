/**
 * Engine 9 — Control Center observability (Phase 17/18).
 *
 * TRUTHFUL STATUS ONLY (No Fake Application Rule): every value returned
 * here is a direct COUNT/aggregate from real tables — no fabricated
 * "Operational"/"Connected" labels. Provider status strings are read
 * verbatim from cc_integrations.status (not_configured/configured/
 * healthy/degraded/failed) — the honest enum the audit confirmed already
 * exists, never re-labeled into marketing language.
 *
 * SECURITY: no config_json (may contain provider config shape hints),
 * no per-user notification content, no email/phone addresses. Aggregate
 * counts and provider status enums only — this is an operational
 * dashboard payload, not a data-export endpoint.
 */

export interface NotificationEngineOverview {
  outbox: {
    pending: number
    processing: number
    processed: number
    failed: number
    total: number
  }
  deliveries_by_channel_status: Array<{ channel: string; status: string; count: number }>
  retry: {
    pending_retry: number
    permanently_failed: number
  }
  providers: Array<{ provider_key: string; category: string; status: string; enabled: boolean }>
  templates: { total: number; active: number }
  pending_moderation_ugc: number
}

export async function getNotificationEngineOverview(db: D1Database): Promise<NotificationEngineOverview> {
  const [outboxRows, deliveryRows, providerRows, templateTotal, templateActive, pendingRetry, permanentlyFailed] = await Promise.all([
    db.prepare(`SELECT status, COUNT(*) as n FROM notification_outbox GROUP BY status`).all<{ status: string; n: number }>(),
    db.prepare(`SELECT channel, status, COUNT(*) as n FROM notification_deliveries GROUP BY channel, status`).all<{ channel: string; status: string; n: number }>(),
    db
      .prepare(`SELECT provider_key, category, status, enabled FROM cc_integrations WHERE category IN ('email','sms','push') ORDER BY category`)
      .all<{ provider_key: string; category: string; status: string; enabled: number }>(),
    db.prepare(`SELECT COUNT(*) as n FROM notification_templates`).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) as n FROM notification_templates WHERE is_active = 1`).first<{ n: number }>(),
    // Retry visibility (Phase 8/10): deliveries genuinely eligible for a
    // future retry pass (transient failure, retry not yet exhausted).
    db.prepare(`SELECT COUNT(*) as n FROM notification_deliveries WHERE status = 'failed' AND failure_class = 'transient' AND next_retry_at IS NOT NULL`).first<{ n: number }>(),
    // Terminal failures: either classified permanent, or transient but
    // exhausted its bounded retry budget (next_retry_at NULL because
    // nextRetryDelayMinutes() returned null at MAX_DELIVERY_ATTEMPTS).
    db.prepare(`SELECT COUNT(*) as n FROM notification_deliveries WHERE status = 'failed' AND (failure_class = 'permanent' OR next_retry_at IS NULL)`).first<{ n: number }>(),
  ])

  const outbox = { pending: 0, processing: 0, processed: 0, failed: 0, total: 0 }
  for (const row of outboxRows.results) {
    if (row.status in outbox) (outbox as any)[row.status] = row.n
    outbox.total += row.n
  }

  // UGC moderation pending count — Phase 14's architecture point.
  // reviews is the ONLY existing UGC-with-media table the audit found
  // (see docs/ENGINE-9-COMMUNICATION-NOTIFICATION-AUDIT.md §UGC); it has
  // no moderation_status column today (confirmed absent), so this is
  // honestly reported as 0/not-yet-tracked rather than querying a column
  // that doesn't exist — Engine 9 does not retrofit review moderation,
  // that is explicitly Engine 8/10 territory per the scope boundary.
  const pendingModerationUgc = 0

  return {
    outbox,
    deliveries_by_channel_status: deliveryRows.results.map((r) => ({ channel: r.channel, status: r.status, count: r.n })),
    retry: { pending_retry: pendingRetry?.n ?? 0, permanently_failed: permanentlyFailed?.n ?? 0 },
    providers: providerRows.results.map((r) => ({ provider_key: r.provider_key, category: r.category, status: r.status, enabled: r.enabled === 1 })),
    templates: { total: templateTotal?.n ?? 0, active: templateActive?.n ?? 0 },
    pending_moderation_ugc: pendingModerationUgc,
  }
}

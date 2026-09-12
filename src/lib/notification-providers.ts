/**
 * Engine 9 — Integration Hub provider abstraction for email/SMS/push.
 *
 * NO FAKE PROVIDERS (non-negotiable, per the Engine 9 prompt's explicit
 * mandate): this repository has ZERO real email/SMS/push provider
 * credentials configured anywhere (confirmed via the Phase 1 forensic
 * audit — no resend/sendgrid/twilio/africastalking/firebase in
 * package.json, no matching secret in .dev.vars, nothing in wrangler.jsonc
 * bindings). Every dispatch in local/dev therefore goes through a
 * DETERMINISTIC TEST ADAPTER that truthfully records what it did — it
 * NEVER calls a real network endpoint, and NEVER reports 'delivered'
 * unless the adapter's own (test-only, in-process) delivery step actually
 * ran. This module's job is the ABSTRACTION (so a real provider can be
 * dropped in later without touching notifications.ts's dispatch logic),
 * not the fabrication of a real integration that does not exist.
 *
 * Provider selection is driven by the Integration Hub's existing
 * `cc_integrations` table (migration 0023, seeded by migration 0045 with
 * 'test_email_adapter' / 'test_sms_adapter' / 'test_push_adapter', status
 * 'configured' — meaning "a test adapter is wired", NOT "a real provider
 * is live"). If cc_integrations reports a channel's provider as anything
 * other than 'configured'/'healthy', dispatch honestly returns
 * 'not_configured' rather than silently falling back to pretending
 * delivery happened.
 *
 * TO ADD A REAL PROVIDER LATER: implement the same
 * `dispatchViaProvider`-shaped call for the new provider_key, add it to
 * PROVIDER_IMPLEMENTATIONS below, and flip that provider_key's
 * cc_integrations.status to 'configured'/'healthy' with real
 * config_json/secrets (via wrangler secret, never committed to source).
 * Zero changes required in notifications.ts.
 */
import type { NotificationChannel } from './notifications'

export type DeliveryStatus = 'queued' | 'attempted' | 'accepted' | 'delivered' | 'failed' | 'unavailable' | 'not_configured' | 'skipped'
export type FailureClass = 'transient' | 'permanent'

export interface DispatchInput {
  recipientUserId: number
  subject: string | null
  body: string
  actionUrl: string | null
}

export interface DispatchOutcome {
  status: DeliveryStatus
  providerKey: string | null
  error: string | null
  failureClass: FailureClass | null
  raw: Record<string, unknown>
}

const CHANNEL_TO_CATEGORY: Record<'email' | 'sms' | 'push', string> = {
  email: 'email',
  sms: 'sms',
  push: 'push',
}

const CHANNEL_TO_TEST_PROVIDER_KEY: Record<'email' | 'sms' | 'push', string> = {
  email: 'test_email_adapter',
  sms: 'test_sms_adapter',
  push: 'test_push_adapter',
}

interface IntegrationRow {
  provider_key: string
  status: string
  enabled: number
}

/** Looks up cc_integrations for the given category's currently-selected/available provider. Returns null if nothing is registered at all (a genuinely absent integration, distinct from a registered-but-not-configured one). */
async function resolveActiveProvider(db: D1Database, category: 'email' | 'sms' | 'push'): Promise<IntegrationRow | null> {
  const row = await db
    .prepare(`SELECT provider_key, status, enabled FROM cc_integrations WHERE category = ? AND enabled = 1 ORDER BY priority ASC LIMIT 1`)
    .bind(category)
    .first<IntegrationRow>()
  return row ?? null
}

/**
 * Deterministic test adapter: does NOT call any network. Its "delivery"
 * is the act of durably recording the attempt with a synthetic-but-
 * honestly-labeled provider response. Always returns 'delivered' for a
 * well-formed input (there is nothing that can fail locally — no network,
 * no real recipient address requirement) EXCEPT when explicitly asked to
 * simulate a failure via payload.body containing the sentinel string
 * '__SIMULATE_PROVIDER_FAILURE__' (used ONLY by the test suite to exercise
 * the retry/failure-classification path without needing a real flaky
 * provider).
 */
function runTestAdapter(channel: 'email' | 'sms' | 'push', input: DispatchInput): DispatchOutcome {
  const providerKey = CHANNEL_TO_TEST_PROVIDER_KEY[channel]

  if (input.body.includes('__SIMULATE_TRANSIENT_FAILURE__')) {
    return { status: 'failed', providerKey, error: 'Simulated transient provider timeout (test adapter)', failureClass: 'transient', raw: { simulated: true, kind: 'transient' } }
  }
  if (input.body.includes('__SIMULATE_PERMANENT_FAILURE__')) {
    return { status: 'failed', providerKey, error: 'Simulated permanent rejection: invalid recipient (test adapter)', failureClass: 'permanent', raw: { simulated: true, kind: 'permanent' } }
  }

  return {
    status: 'delivered',
    providerKey,
    error: null,
    failureClass: null,
    raw: { adapter: 'test', channel, recorded_at: new Date().toISOString(), note: 'No real provider configured — this is a deterministic local test adapter, not a real delivery.' },
  }
}

/**
 * Dispatches one channel's notification through the Integration Hub.
 * `channel` here is always 'email' | 'sms' | 'push' — 'in_app' is
 * dispatched directly in notifications.ts (it has no external provider
 * concept). Never throws — every failure mode is returned as a
 * DispatchOutcome for the caller to record on the delivery row.
 */
export async function dispatchViaProvider(db: D1Database, channel: NotificationChannel, input: DispatchInput): Promise<DispatchOutcome> {
  if (channel === 'in_app') {
    // Should never be called this way — in_app is handled directly by
    // notifications.ts. Defensive guard, not a real code path.
    return { status: 'skipped', providerKey: null, error: 'in_app channel does not use the provider abstraction', failureClass: null, raw: {} }
  }

  const category = CHANNEL_TO_CATEGORY[channel]
  const active = await resolveActiveProvider(db, category as 'email' | 'sms' | 'push')

  if (!active) {
    return { status: 'not_configured', providerKey: null, error: `No integration registered for category "${category}"`, failureClass: null, raw: {} }
  }
  if (active.status !== 'configured' && active.status !== 'healthy') {
    // Registered, but honestly not usable yet (e.g. 'not_configured',
    // 'degraded', 'failed') — never silently treated as available.
    return { status: 'unavailable', providerKey: active.provider_key, error: `Provider "${active.provider_key}" status is "${active.status}"`, failureClass: null, raw: {} }
  }

  // Only the deterministic test adapters exist in this environment
  // (confirmed by audit — see module doc comment). A real provider_key
  // would be dispatched to its own real implementation here.
  if (active.provider_key.startsWith('test_')) {
    return runTestAdapter(channel as 'email' | 'sms' | 'push', input)
  }

  return { status: 'not_configured', providerKey: active.provider_key, error: `Provider "${active.provider_key}" has no real implementation wired — no real credentials exist in this environment`, failureClass: null, raw: {} }
}

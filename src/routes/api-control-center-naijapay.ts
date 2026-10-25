import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireControlCenterApiAuth, requireControlCenterPermission } from '../lib/control-center-rbac'
import { getClientIp } from '../lib/login-throttle'
import { recordControlCenterAction } from '../lib/control-center-audit'
import { getNaijaPayProvider, listNaijaPayProviders, listNaijaPayTransactions } from '../lib/naijapay-data'

export const naijaPayControlCenterApi = new Hono<AppEnv>()
naijaPayControlCenterApi.use('*', requireControlCenterApiAuth)

naijaPayControlCenterApi.get('/providers', requireControlCenterPermission('payments.read'), async (c) => {
  return c.json({ providers: await listNaijaPayProviders(c.env.DB) })
})

naijaPayControlCenterApi.get('/transactions', requireControlCenterPermission('payments.read'), async (c) => {
  const page = Math.min(Math.max(Number(c.req.query('page') || 1), 1), 100000)
  const pageSize = Math.min(Math.max(Number(c.req.query('page_size') || 50), 1), 100)
  if (!Number.isInteger(page) || !Number.isInteger(pageSize)) return c.json({ error: 'Invalid pagination' }, 400)
  const result = await listNaijaPayTransactions(c.env.DB, { page, pageSize, status: c.req.query('status'), category: c.req.query('category'), currency: c.req.query('currency') })
  return c.json({ ...result, total_pages: Math.max(1, Math.ceil(result.total / result.pageSize)) })
})

naijaPayControlCenterApi.get('/providers/:providerKey', requireControlCenterPermission('payments.read'), async (c) => {
  const providerKey = c.req.param('providerKey')
  if (!providerKey) return c.json({ error: 'Provider key is required' }, 400)
  const provider = await getNaijaPayProvider(c.env.DB, providerKey)
  if (!provider) return c.json({ error: 'Provider not found' }, 404)
  return c.json({ provider })
})

naijaPayControlCenterApi.patch('/providers/:providerKey/status', requireControlCenterPermission('payments.manage'), async (c) => {
  const admin = c.get('user')!
  const body = await c.req.json<{ operational_status?: string; reason?: string }>().catch(() => null)
  const allowed = new Set(['disabled', 'sandbox', 'pending_authorization', 'operational', 'suspended'])
  if (!body?.operational_status || !allowed.has(body.operational_status)) return c.json({ error: 'Invalid operational_status' }, 400)
  const providerKey = c.req.param('providerKey')
  if (!providerKey) return c.json({ error: 'Provider key is required' }, 400)
  const provider = await getNaijaPayProvider(c.env.DB, providerKey)
  if (!provider) return c.json({ error: 'Provider not found' }, 404)
  // Operational status never bypasses prerequisites. A provider may only be
  // marked operational when it is configured, authorized, live, and healthy.
  if (body.operational_status === 'operational' && (provider.configuration_status !== 'verified' || provider.authorization_status !== 'authorized' || provider.environment !== 'live' || provider.health_status !== 'healthy')) {
    return c.json({ error: 'Provider prerequisites are not satisfied', code: 'PROVIDER_NOT_READY', prerequisites: { configuration_status: provider.configuration_status, authorization_status: provider.authorization_status, environment: provider.environment, health_status: provider.health_status } }, 409)
  }
  await c.env.DB.prepare("UPDATE naijapay_providers SET operational_status = ?, is_active = ?, updated_at = datetime('now') WHERE provider_key = ?")
    .bind(body.operational_status, body.operational_status === 'disabled' || body.operational_status === 'suspended' ? 0 : 1, providerKey).run()
  await recordControlCenterAction(c.env.DB, { actorUserId: admin.id, actorName: admin.name, action: 'naijapay_provider_status_changed', entityType: 'naijapay_provider', entityId: String(provider.id), beforeState: { operational_status: provider.operational_status }, afterState: { operational_status: body.operational_status }, context: { reason: body.reason ?? null, permission_used: 'payments.manage' }, success: true, ipAddress: getClientIp(c.req.header('cf-connecting-ip') ?? null) })
  return c.json({ success: true, provider_key: providerKey, operational_status: body.operational_status })
})

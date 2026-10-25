import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth } from '../lib/auth'

export const freightApi = new Hono<AppEnv>()
function json(value: unknown, fallback: unknown) {
  try { return JSON.stringify(value ?? fallback) } catch { return JSON.stringify(fallback) }
}

freightApi.post('/loads', requireAuth, async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<any>().catch(() => null)
  if (!body?.origin_country_iso || !body?.destination_country_iso || !body?.pickup_address || !body?.delivery_address || !body?.transport_mode || !body?.cargo_category || !body?.cargo_description || !Number.isFinite(Number(body.weight_kg)) || Number(body.weight_kg) <= 0) {
    return c.json({ error: 'origin/destination, transport_mode, cargo details and positive weight_kg are required' }, 400)
  }
  if (body.is_hazardous && !Array.isArray(body.required_equipment)) return c.json({ error: 'hazardous cargo requires explicit equipment declaration' }, 400)
  const result = await c.env.DB.prepare(
    `INSERT INTO freight_loads (customer_user_id, status, dispatch_method, transport_mode, origin_country_iso, destination_country_iso, pickup_address_json, delivery_address_json, pickup_window_start, pickup_window_end, delivery_window_start, delivery_window_end, cargo_category, cargo_description, quantity, weight_kg, volume_m3, declared_value_kobo, is_fragile, is_perishable, is_hazardous, required_equipment_json)
     VALUES (?, 'open_for_bids', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(user.id, body.dispatch_method ?? 'competitive_bidding', body.transport_mode, body.origin_country_iso, body.destination_country_iso, json(body.pickup_address, {}), json(body.delivery_address, {}), body.pickup_window_start ?? null, body.pickup_window_end ?? null, body.delivery_window_start ?? null, body.delivery_window_end ?? null, body.cargo_category, body.cargo_description.trim(), Math.max(1, Number(body.quantity ?? 1)), Number(body.weight_kg), body.volume_m3 ?? null, body.declared_value_kobo ?? null, body.is_fragile ? 1 : 0, body.is_perishable ? 1 : 0, body.is_hazardous ? 1 : 0, json(body.required_equipment, [])).run()
  return c.json({ id: Number(result.meta.last_row_id), status: 'open_for_bids' }, 201)
})

freightApi.get('/loads/open', requireAuth, async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT fl.*, COUNT(fb.id) AS bid_count FROM freight_loads fl LEFT JOIN freight_bids fb ON fb.load_id = fl.id AND fb.status = 'submitted' WHERE fl.status = 'open_for_bids' GROUP BY fl.id ORDER BY fl.created_at DESC LIMIT 100`).all()
  return c.json({ loads: results })
})

freightApi.post('/loads/:id/bids', requireAuth, async (c) => {
  const user = c.get('user')!
  const loadId = Number(c.req.param('id'))
  const body = await c.req.json<any>().catch(() => null)
  const provider = await c.env.DB.prepare(`SELECT id FROM logistics_providers WHERE user_id = ? AND status = 'active'`).bind(user.id).first<{ id: number }>()
  if (!provider) return c.json({ error: 'An active logistics provider profile is required; carrier eligibility is not inferred from a form submission' }, 403)
  const load = await c.env.DB.prepare(`SELECT id, status, customer_user_id FROM freight_loads WHERE id = ?`).bind(loadId).first<any>()
  if (!load || load.status !== 'open_for_bids') return c.json({ error: 'Load is not open for bids' }, 409)
  if (load.customer_user_id === user.id) return c.json({ error: 'Customers cannot bid on their own load' }, 403)
  if (!body?.price_kobo || Number(body.price_kobo) <= 0) return c.json({ error: 'A positive price_kobo is required' }, 400)
  try {
    const result = await c.env.DB.prepare(`INSERT INTO freight_bids (load_id, logistics_provider_id, carrier_user_id, price_kobo, pickup_eta, delivery_eta, equipment_json, terms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(loadId, provider.id, user.id, Number(body.price_kobo), body.pickup_eta ?? null, body.delivery_eta ?? null, json(body.equipment, []), body.terms ?? null).run()
    return c.json({ id: Number(result.meta.last_row_id), status: 'submitted' }, 201)
  } catch (error) {
    if (String(error).toLowerCase().includes('unique')) return c.json({ error: 'This carrier already has a bid on the load' }, 409)
    throw error
  }
})

freightApi.get('/loads/:id/bids', requireAuth, async (c) => {
  const user = c.get('user')!
  const loadId = Number(c.req.param('id'))
  const owned = await c.env.DB.prepare('SELECT id FROM freight_loads WHERE id = ? AND customer_user_id = ?').bind(loadId, user.id).first()
  if (!owned) return c.json({ error: 'Load not found' }, 404)
  const { results } = await c.env.DB.prepare(`SELECT fb.id, fb.load_id, fb.price_kobo, fb.currency, fb.pickup_eta, fb.delivery_eta, fb.equipment_json, fb.terms, fb.status, lp.provider_name, lp.rating_avg FROM freight_bids fb JOIN logistics_providers lp ON lp.id = fb.logistics_provider_id WHERE fb.load_id = ? ORDER BY fb.price_kobo ASC, fb.created_at ASC`).bind(loadId).all()
  return c.json({ bids: results })
})

freightApi.post('/loads/:id/award', requireAuth, async (c) => {
  const user = c.get('user')!
  const loadId = Number(c.req.param('id'))
  const body = await c.req.json<{ bid_id?: number }>().catch(() => null)
  if (!body?.bid_id) return c.json({ error: 'bid_id is required' }, 400)
  const load = await c.env.DB.prepare(`SELECT id, status FROM freight_loads WHERE id = ? AND customer_user_id = ?`).bind(loadId, user.id).first<any>()
  if (!load) return c.json({ error: 'Load not found' }, 404)
  const bid = await c.env.DB.prepare(`SELECT id FROM freight_bids WHERE id = ? AND load_id = ? AND status = 'submitted'`).bind(body.bid_id, loadId).first()
  if (!bid) return c.json({ error: 'Submitted bid not found' }, 404)
  const [updated] = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE freight_loads SET status = 'awarded', awarded_bid_id = ?, updated_at = datetime('now') WHERE id = ? AND status = 'open_for_bids'`).bind(body.bid_id, loadId),
    c.env.DB.prepare(`UPDATE freight_bids SET status = CASE WHEN id = ? THEN 'awarded' ELSE 'rejected' END, updated_at = datetime('now') WHERE load_id = ? AND status = 'submitted'`).bind(body.bid_id, loadId),
  ])
  if (!updated.meta.rows_written) return c.json({ error: 'Load changed before award; reload and retry' }, 409)
  return c.json({ success: true, load_id: loadId, awarded_bid_id: body.bid_id, status: 'awarded' })
})

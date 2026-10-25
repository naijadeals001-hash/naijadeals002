import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth } from '../lib/auth'

export const carpoolApi = new Hono<AppEnv>()
carpoolApi.post('/trips', requireAuth, async (c) => {
  const user = c.get('user')!
  const body = await c.req.json<any>().catch(() => null)
  const seats = Number(body?.seats_total)
  const contribution = Number(body?.contribution_kobo ?? 0)
  if (!body?.origin?.trim() || !body?.destination?.trim() || !body?.departure_at || !Number.isInteger(seats) || seats < 1 || !Number.isInteger(contribution) || contribution < 0) {
    return c.json({ error: 'origin, destination, departure_at, positive seats_total and non-negative contribution_kobo are required' }, 400)
  }
  const result = await c.env.DB.prepare(`INSERT INTO carpool_trips (driver_user_id, origin, destination, departure_at, seats_total, seats_available, contribution_kobo, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(user.id, body.origin.trim(), body.destination.trim(), body.departure_at, seats, seats, contribution, body.notes?.trim() || null).run()
  return c.json({ id: Number(result.meta.last_row_id), status: 'published', seats_available: seats }, 201)
})

carpoolApi.get('/trips', requireAuth, async (c) => {
  const origin = c.req.query('origin')?.trim()
  const destination = c.req.query('destination')?.trim()
  const clauses = [`status = 'published'`, 'seats_available > 0', 'departure_at >= datetime(\'now\')']
  const binds: unknown[] = []
  if (origin) { clauses.push('LOWER(origin) LIKE ?'); binds.push(`%${origin.toLowerCase()}%`) }
  if (destination) { clauses.push('LOWER(destination) LIKE ?'); binds.push(`%${destination.toLowerCase()}%`) }
  const { results } = await c.env.DB.prepare(`SELECT id, origin, destination, departure_at, seats_available, contribution_kobo, notes FROM carpool_trips WHERE ${clauses.join(' AND ')} ORDER BY departure_at ASC LIMIT 100`).bind(...binds).all()
  return c.json({ trips: results })
})

carpoolApi.post('/trips/:id/requests', requireAuth, async (c) => {
  const user = c.get('user')!
  const tripId = Number(c.req.param('id'))
  const body = await c.req.json<{ seats?: number }>().catch(() => null)
  const seats = Number(body?.seats ?? 1)
  const trip = await c.env.DB.prepare('SELECT driver_user_id FROM carpool_trips WHERE id = ? AND status = \'published\'').bind(tripId).first<{ driver_user_id: number }>()
  if (!trip) return c.json({ error: 'Published carpool trip not found' }, 404)
  if (trip.driver_user_id === user.id) return c.json({ error: 'Drivers cannot request their own trip' }, 400)
  if (!Number.isInteger(seats) || seats < 1) return c.json({ error: 'seats must be a positive integer' }, 400)
  try {
    const [updated, request] = await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE carpool_trips SET seats_available = seats_available - ?, status = CASE WHEN seats_available - ? = 0 THEN 'full' ELSE status END, updated_at = datetime('now') WHERE id = ? AND status = 'published' AND seats_available >= ?`).bind(seats, seats, tripId, seats),
      c.env.DB.prepare('INSERT INTO carpool_requests (trip_id, passenger_user_id, seats_requested) VALUES (?, ?, ?)').bind(tripId, user.id, seats),
    ])
    if (!updated.meta.rows_written) return c.json({ error: 'Not enough seats remain' }, 409)
    return c.json({ id: Number(request.meta.last_row_id), status: 'requested', trip_id: tripId, seats_requested: seats }, 201)
  } catch (error) {
    if (String(error).toLowerCase().includes('unique')) return c.json({ error: 'You already requested a seat on this trip' }, 409)
    throw error
  }
})

carpoolApi.get('/driver/requests', requireAuth, async (c) => {
  const user = c.get('user')!
  const { results } = await c.env.DB.prepare(`SELECT cr.id, cr.status, cr.seats_requested, cr.created_at, ct.id AS trip_id, ct.origin, ct.destination, ct.departure_at, u.name AS passenger_name FROM carpool_requests cr JOIN carpool_trips ct ON ct.id = cr.trip_id JOIN users u ON u.id = cr.passenger_user_id WHERE ct.driver_user_id = ? ORDER BY cr.created_at DESC LIMIT 100`).bind(user.id).all()
  return c.json({ requests: results })
})

carpoolApi.post('/requests/:id/cancel', requireAuth, async (c) => {
  const user = c.get('user')!
  const requestId = Number(c.req.param('id'))
  const request = await c.env.DB.prepare(`SELECT cr.id, cr.status, cr.seats_requested, cr.trip_id, ct.status AS trip_status FROM carpool_requests cr JOIN carpool_trips ct ON ct.id = cr.trip_id WHERE cr.id = ? AND cr.passenger_user_id = ?`).bind(requestId, user.id).first<any>()
  if (!request) return c.json({ error: 'Request not found or not owned by this passenger' }, 404)
  if (!['requested', 'accepted'].includes(request.status)) return c.json({ error: 'Request is no longer cancellable' }, 409)
  const changed = await c.env.DB.prepare(`UPDATE carpool_requests SET status='cancelled', updated_at=datetime('now') WHERE id=? AND passenger_user_id=? AND status=?`).bind(requestId, user.id, request.status).run()
  if (!changed.meta.rows_written) return c.json({ error: 'Request changed concurrently; retry' }, 409)
  const restored = await c.env.DB.prepare(`UPDATE carpool_trips SET seats_available=seats_available + ?, status='published', updated_at=datetime('now') WHERE id=? AND status IN ('full','published') AND seats_available + ? <= seats_total`).bind(request.seats_requested, request.trip_id, request.seats_requested).run()
  if (!restored.meta.rows_written) {
    await c.env.DB.prepare(`UPDATE carpool_requests SET status=? WHERE id=? AND status='cancelled'`).bind(request.status, requestId).run()
    return c.json({ error: 'Trip inventory changed concurrently; cancellation was not applied' }, 409)
  }
  return c.json({ success: true, id: requestId, status: 'cancelled', trip_id: request.trip_id })
})

carpoolApi.post('/requests/:id/decision', requireAuth, async (c) => {
  const user = c.get('user')!
  const requestId = Number(c.req.param('id'))
  const body = await c.req.json<{ status?: 'accepted' | 'rejected' }>().catch(() => null)
  if (!body?.status || !['accepted', 'rejected'].includes(body.status)) return c.json({ error: 'status must be accepted or rejected' }, 400)
  const request = await c.env.DB.prepare(`SELECT cr.id, cr.status, cr.seats_requested, ct.driver_user_id, ct.id AS trip_id FROM carpool_requests cr JOIN carpool_trips ct ON ct.id = cr.trip_id WHERE cr.id = ? AND ct.driver_user_id = ?`).bind(requestId, user.id).first<any>()
  if (!request) return c.json({ error: 'Request not found or not owned by this driver' }, 404)
  if (request.status !== 'requested') return c.json({ error: 'Request has already been decided' }, 409)
  await c.env.DB.prepare(`UPDATE carpool_requests SET status = ?, updated_at = datetime('now') WHERE id = ? AND status = 'requested'`).bind(body.status, requestId).run()
  if (body.status === 'rejected') await c.env.DB.prepare(`UPDATE carpool_trips SET seats_available = seats_available + ?, status = 'published', updated_at = datetime('now') WHERE id = ? AND status IN ('full','published') AND seats_available + ? <= seats_total`).bind(request.seats_requested, request.trip_id, request.seats_requested).run()
  return c.json({ success: true, id: requestId, status: body.status })
})

import { Hono } from 'hono'
import type { AppEnv } from '../types'

export const drivePreviewApi = new Hono<AppEnv>()

const ACTIVE_ZONES = new Set(['abuja-central', 'gwarinpa', 'lokogoma'])

/**
 * This endpoint is intentionally honest: it validates the preview form but
 * refuses to create a ride because the Cloudflare Worker does not own the
 * PostgreSQL/PostGIS/Redis NaijaDrive runtime. A future authenticated bridge
 * must replace this 503 with a real NestJS request.
 */
drivePreviewApi.post('/preview-booking', async (c) => {
  const body = await c.req.json<{ pickupZone?: string; dropoffZone?: string; vehicleCategory?: string }>().catch(() => null)
  if (!body?.pickupZone || !body.dropoffZone) {
    return c.json({ error: 'Choose both a pickup and destination zone.' }, 400)
  }
  if (!ACTIVE_ZONES.has(body.pickupZone) || !ACTIVE_ZONES.has(body.dropoffZone)) {
    return c.json({ error: 'That location is outside the active Abuja pilot zones.' }, 400)
  }
  return c.json({
    error: 'No booking was created. NaijaDrive dispatch is not connected to this Worker preview yet; the NestJS runtime still requires a persistent authorized host.',
    code: 'NAIJADRIVE_RUNTIME_UNAVAILABLE',
  }, 503)
})

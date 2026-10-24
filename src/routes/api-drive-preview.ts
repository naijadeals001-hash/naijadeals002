import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { validateDrivePreviewBooking } from '../lib/drive-preview'

export const drivePreviewApi = new Hono<AppEnv>()

/**
 * This endpoint is intentionally honest: it validates the preview form but
 * refuses to create a ride because the Cloudflare Worker does not own the
 * PostgreSQL/PostGIS/Redis NaijaDrive runtime. A future authenticated bridge
 * must replace this 503 with a real NestJS request.
 */
drivePreviewApi.post('/preview-booking', async (c) => {
  const body = await c.req.json<{ pickupZone?: string; dropoffZone?: string; vehicleCategory?: string }>().catch(() => null)
  const validation = validateDrivePreviewBooking(body)
  if (!validation.ok) return c.json({ error: validation.error }, validation.status)
  return c.json({
    error: 'No booking was created. NaijaDrive dispatch is not connected to this Worker preview yet; the NestJS runtime still requires a persistent authorized host.',
    code: 'NAIJADRIVE_RUNTIME_UNAVAILABLE',
  }, 503)
})

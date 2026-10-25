import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { estimateDrivePreviewFare, type FareEstimateMode } from '../lib/drive-preview-fare'
import { validateDrivePreviewBooking } from '../lib/drive-preview'

export const drivePreviewApi = new Hono<AppEnv>()

/**
 * Fare estimate endpoint. Routed mode is strict: it never falls back to the
 * development fixture when a provider is unavailable.
 */
drivePreviewApi.post('/fare-estimate', async (c) => {
  const body = await c.req.json<{ pickupZone?: string; dropoffZone?: string; vehicleCategory?: string; mode?: FareEstimateMode }>().catch(() => null)
  if (body?.mode !== 'routed' && body?.mode !== 'simulated') {
    return c.json({ error: 'Choose an explicit routed or simulated estimate mode.', code: 'INVALID_ESTIMATE_MODE' }, 400)
  }
  const result = await estimateDrivePreviewFare(body, body.mode, c.env)
  if (!result.ok) return c.json({ error: result.error, code: result.code }, result.status)
  return c.json(result)
})

/**
 * This endpoint remains intentionally honest: it validates the preview form but
 * refuses to create a ride because the Cloudflare Worker does not own the
 * PostgreSQL/PostGIS/Redis NaijaDrive runtime.
 */
drivePreviewApi.post('/preview-booking', async (c) => {
  const body = await c.req.json<{ pickupZone?: string; dropoffZone?: string; vehicleCategory?: string }>().catch(() => null)
  const validation = validateDrivePreviewBooking(body)
  if (!validation.ok) return c.json({ error: validation.error, code: validation.code }, validation.status)
  return c.json({
    error: 'No booking was created. NaijaDrive dispatch is not connected to this Worker preview yet; the NestJS runtime still requires a persistent authorized host.',
    code: 'NAIJADRIVE_RUNTIME_UNAVAILABLE',
  }, 503)
})

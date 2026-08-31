import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { getVerticalByRoute, addToVerticalWaitlist } from '../lib/ecosystem-verticals'

/**
 * /api/ecosystem/* — supports the waitlist form on every Ecosystem Preview
 * page (src/components/EcosystemPreview.tsx). Deliberately separate from
 * /api/catalog/newsletter — see migration 0010's header comment for why a
 * per-vertical waitlist table exists instead of reusing newsletter_subscribers.
 */
export const ecosystemApi = new Hono<AppEnv>()

ecosystemApi.post('/:slug/waitlist', async (c) => {
  const slug = c.req.param('slug')
  const body = await c.req.json<{ email: string }>().catch(() => null)
  if (!body?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return c.json({ error: 'Valid email required' }, 400)
  }

  // Look the vertical up by its route (/<slug>) rather than trusting a raw id
  // from the client — this doubles as validation that `slug` maps to a real,
  // configured vertical, not an arbitrary/spoofed value.
  const vertical = await getVerticalByRoute(c.env.DB, `/${slug}`)
  if (!vertical) {
    return c.json({ error: 'Unknown vertical' }, 404)
  }

  const user = c.get('user')
  await addToVerticalWaitlist(c.env.DB, vertical.id, body.email, user?.id ?? null)
  return c.json({ success: true })
})

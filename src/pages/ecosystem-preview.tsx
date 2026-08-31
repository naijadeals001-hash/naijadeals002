import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import { EcosystemPreview } from '../components/EcosystemPreview'
import type { AppEnv } from '../types'
import { getVerticalByRoute, getFeaturesForVertical } from '../lib/ecosystem-verticals'

/**
 * ecosystemPreviewPage — the ONE handler registered for all 8 planned
 * vertical routes (/fresh, /eats, /gigs, /stay, /drive, /send, /stream,
 * /aura — see src/index.tsx). The route path itself IS the lookup key into
 * ecosystem_verticals (migration 0010) via getVerticalByRoute, so this
 * function has zero per-vertical branching.
 *
 * If a route is ever registered here without a matching DB row (shouldn't
 * happen given the seed data, but must never silently break), this falls
 * through to Hono's genuine 404 rather than rendering a broken/blank page —
 * an unconfigured vertical is a real 404, not a lie dressed up as a preview.
 */
export async function ecosystemPreviewPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')

  const vertical = await getVerticalByRoute(db, c.req.path)
  if (!vertical) {
    return c.notFound()
  }

  const features = await getFeaturesForVertical(db, vertical.id)

  return c.render(
    <Layout title={vertical.seo_title} description={vertical.seo_description} user={user}>
      <EcosystemPreview vertical={vertical} features={features} />
    </Layout>
  )
}

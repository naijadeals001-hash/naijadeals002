import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { getVerticalByRoute, addToVerticalWaitlist } from '../lib/ecosystem-verticals'
import { validateWaitlistSubmission, upsertWaitlistSignup, getWaitlistSignupByEmail } from '../lib/ecosystem-waitlist'
import { getNigerianStates } from '../lib/addresses'

/**
 * /api/ecosystem/* — supports the Ecosystem Preview pages and their waitlist
 * experiences. Two generations of waitlist coexist here on purpose:
 *
 *   POST /:slug/waitlist  — LEGACY (migration 0010). Backs the original
 *     single-email inline "Notify me" form that still renders further down
 *     each vertical page (EcosystemPreview.tsx's #waitlist-form-{slug}
 *     section). Left fully intact/untouched — do not remove without a
 *     separate, explicit decision, since it is already deployed and may
 *     already hold real visitor emails in production.
 *
 *   POST /waitlist        — NEW (migration 0011). Backs the real modal/
 *     bottom-sheet waitlist experience (EcosystemWaitlistModal.tsx) that the
 *     "Join the waitlist" CTA now opens. Collects full name, email, phone,
 *     city, state, and multi-service selection. This is the endpoint Pat's
 *     fix-task requires — no :slug in the path because one submission can
 *     name multiple services at once.
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

/**
 * DB-sourced Nigerian states list for the waitlist modal's state <select> —
 * same reference table (nigerian_states, migration 0007) already used by
 * the Account Address Book, exposed here too since EcosystemWaitlistModal
 * can render on pages a guest visitor (not signed in) is browsing, and
 * /api/addresses/meta/states sits behind requireAuth. No PII, no auth
 * required — this is a static reference list.
 */
ecosystemApi.get('/meta/states', async (c) => {
  const states = await getNigerianStates(c.env.DB)
  return c.json({ states })
})

/**
 * POST /api/ecosystem/waitlist — the real, functional waitlist submission
 * endpoint. Full server-side validation (never trust the client): required
 * fields, email format, at least one service selected, email normalized to
 * lowercase, all text fields sanitized. Duplicate emails UPSERT-merge rather
 * than error or silently duplicate — see upsertWaitlistSignup for why.
 */
ecosystemApi.post('/waitlist', async (c) => {
  const body = await c.req.json().catch(() => null)
  const result = validateWaitlistSubmission(body)
  if (!result.valid || !result.input) {
    return c.json({ error: result.error || 'Invalid submission' }, 400)
  }

  try {
    const { isNewSignup } = await upsertWaitlistSignup(c.env.DB, result.input)
    // Read the merged record back so the response always reflects the TRUE
    // persisted state (e.g. a returning email that already had NaijaEats
    // checked, now also checking NaijaGigs, must show BOTH as selected —
    // not just the one service submitted in this particular request).
    const saved = await getWaitlistSignupByEmail(c.env.DB, result.input.email)
    return c.json({
      success: true,
      isNewSignup,
      services: saved
        ? {
            naijaEats: Boolean(saved.naija_eats),
            naijaGigs: Boolean(saved.naija_gigs),
            naijaStay: Boolean(saved.naija_stay),
            allServices: Boolean(saved.all_services)
          }
        : {
            naijaEats: result.input.naijaEats,
            naijaGigs: result.input.naijaGigs,
            naijaStay: result.input.naijaStay,
            allServices: result.input.allServices
          }
    })
  } catch (err) {
    // A real, logged failure — never a fake success. D1 write errors (e.g.
    // transient network issue to the edge DB) surface as a genuine 500 so
    // the modal's error state (with retry) fires, per Pat's explicit ban on
    // silent/fake success.
    console.error('ecosystem_waitlist_signups insert failed:', err)
    return c.json({ error: 'Could not save your submission right now. Please try again.' }, 500)
  }
})

import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { LANGUAGES, COUNTRIES } from '../i18n'

// This route exists so the language engine is consumable by clients that
// aren't this SSR app — most concretely, "future mobile applications" per
// TASK N's explicit "must be reusable by ... future mobile applications"
// requirement. The SSR pages themselves render the selector directly from
// LANGUAGES (see Layout.tsx) and never need to call this over HTTP — this
// is metadata-only, read-only, and touches no user data.
export const i18nApi = new Hono<AppEnv>()

i18nApi.get('/languages', (c) => {
  return c.json({
    languages: Object.values(LANGUAGES),
    current: c.get('locale')
  })
})

i18nApi.get('/countries', (c) => {
  return c.json({ countries: Object.values(COUNTRIES) })
})

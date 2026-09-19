import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth } from '../lib/auth'
import {
  getAddressesForUser,
  getAddress,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  getNigerianStates,
  getRegionsForCountry,
  ADDRESS_SUPPORTED_COUNTRIES,
  type AddressInput
} from '../lib/addresses'

export const addressesApi = new Hono<AppEnv>()

addressesApi.use('*', requireAuth)

const SUPPORTED_COUNTRY_ISOS = new Set(ADDRESS_SUPPORTED_COUNTRIES.map((c) => c.iso))

function validateInput(body: any): { valid: boolean; error?: string; input?: AddressInput } {
  if (!body?.label || !body?.recipient_name || !body?.phone || !body?.line1 || !body?.city || !body?.state) {
    return { valid: false, error: 'label, recipient_name, phone, line1, city and state are all required' }
  }
  // Default to 'NG' when omitted (existing clients that haven't added a country
  // field yet keep working unchanged) — but a client that DOES send a country
  // must send one this platform's address book actually supports, so a non-NG
  // address can never silently fall through to Nigerian-state validation/logic.
  const countryIso = body.country_iso ? String(body.country_iso).trim().toUpperCase() : 'NG'
  if (!SUPPORTED_COUNTRY_ISOS.has(countryIso)) {
    return { valid: false, error: `Addresses are not yet supported for country "${countryIso}"` }
  }
  return {
    valid: true,
    input: {
      label: String(body.label).trim(),
      recipient_name: String(body.recipient_name).trim(),
      phone: String(body.phone).trim(),
      line1: String(body.line1).trim(),
      city: String(body.city).trim(),
      state: String(body.state).trim(),
      country_iso: countryIso,
      delivery_instructions: body.delivery_instructions ? String(body.delivery_instructions).trim() : null,
      is_default: Boolean(body.is_default)
    }
  }
}

addressesApi.get('/', async (c) => {
  const user = c.get('user')!
  const addresses = await getAddressesForUser(c.env.DB, user.id)
  return c.json({ addresses })
})

/** DB-sourced Nigerian states list for the state <select> — never hardcoded in a page/component. */
addressesApi.get('/meta/states', async (c) => {
  const states = await getNigerianStates(c.env.DB)
  return c.json({ states })
})

/** Stage 2C: country-parameterized region list + the countries the address book currently supports. */
addressesApi.get('/meta/countries', async (c) => {
  return c.json({ countries: ADDRESS_SUPPORTED_COUNTRIES })
})

addressesApi.get('/meta/regions', async (c) => {
  const countryIso = (c.req.query('country') || 'NG').toUpperCase()
  if (!SUPPORTED_COUNTRY_ISOS.has(countryIso)) return c.json({ error: `Addresses are not yet supported for country "${countryIso}"` }, 400)
  const regions = await getRegionsForCountry(c.env.DB, countryIso)
  return c.json({ regions })
})

addressesApi.get('/:addressId', async (c) => {
  const user = c.get('user')!
  const address = await getAddress(c.env.DB, user.id, Number(c.req.param('addressId')))
  if (!address) return c.json({ error: 'Address not found' }, 404)
  return c.json({ address })
})

addressesApi.post('/', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => null)
  const validation = validateInput(body)
  if (!validation.valid) return c.json({ error: validation.error }, 400)

  const addressId = await createAddress(c.env.DB, user.id, validation.input!)
  const addresses = await getAddressesForUser(c.env.DB, user.id)
  return c.json({ success: true, addressId, addresses })
})

addressesApi.put('/:addressId', async (c) => {
  const user = c.get('user')!
  const addressId = Number(c.req.param('addressId'))
  const existing = await getAddress(c.env.DB, user.id, addressId)
  if (!existing) return c.json({ error: 'Address not found' }, 404)

  const body = await c.req.json().catch(() => null)
  const validation = validateInput(body)
  if (!validation.valid) return c.json({ error: validation.error }, 400)

  await updateAddress(c.env.DB, user.id, addressId, validation.input!)
  const addresses = await getAddressesForUser(c.env.DB, user.id)
  return c.json({ success: true, addresses })
})

addressesApi.delete('/:addressId', async (c) => {
  const user = c.get('user')!
  const addressId = Number(c.req.param('addressId'))
  const existing = await getAddress(c.env.DB, user.id, addressId)
  if (!existing) return c.json({ error: 'Address not found' }, 404)

  await deleteAddress(c.env.DB, user.id, addressId)
  const addresses = await getAddressesForUser(c.env.DB, user.id)
  return c.json({ success: true, addresses })
})

addressesApi.post('/:addressId/default', async (c) => {
  const user = c.get('user')!
  const addressId = Number(c.req.param('addressId'))
  const existing = await getAddress(c.env.DB, user.id, addressId)
  if (!existing) return c.json({ error: 'Address not found' }, 404)

  await setDefaultAddress(c.env.DB, user.id, addressId)
  const addresses = await getAddressesForUser(c.env.DB, user.id)
  return c.json({ success: true, addresses })
})

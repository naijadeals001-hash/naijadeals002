/**
 * Enterprise Control Center — global command search.
 *
 * Real, live search across customers/vendors/providers/orders/bookings —
 * simple LIKE queries against canonical tables (no dedicated search index
 * exists for these entities yet, so this is honest about being a basic
 * substring search, not a ranked/fuzzy engine). This directly replaces the
 * Phase 1 shell's "Global search — not yet available" placeholder with a
 * genuinely working feature, scoped to what the operator's permissions
 * already allow them to see (a Vendors-only admin should not be able to
 * discover customer PII through global search).
 */

export interface SearchResult {
  type: 'customer' | 'vendor' | 'provider' | 'order' | 'booking'
  id: number
  title: string
  subtitle: string
  href: string | null
}

export async function runControlCenterSearch(db: D1Database, query: string, permissionKeys: Set<string>): Promise<SearchResult[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const like = `%${q}%`
  const results: SearchResult[] = []

  if (permissionKeys.has('customers.read')) {
    const { results: rows } = await db
      .prepare("SELECT id, name, email, phone FROM users WHERE role='customer' AND (name LIKE ? OR email LIKE ? OR phone LIKE ?) LIMIT 5")
      .bind(like, like, like)
      .all<{ id: number; name: string; email: string; phone: string }>()
    for (const r of rows ?? []) {
      results.push({ type: 'customer', id: r.id, title: r.name, subtitle: r.email || r.phone || '', href: null })
    }
  }

  if (permissionKeys.has('vendors.read')) {
    const { results: rows } = await db
      .prepare("SELECT id, business_name, name, business_email, city FROM vendors WHERE user_id IS NOT NULL AND (business_name LIKE ? OR name LIKE ? OR business_email LIKE ?) LIMIT 5")
      .bind(like, like, like)
      .all<{ id: number; business_name: string; name: string; business_email: string; city: string }>()
    for (const r of rows ?? []) {
      results.push({ type: 'vendor', id: r.id, title: r.business_name || r.name, subtitle: `${r.business_email || ''} ${r.city ? '· ' + r.city : ''}`.trim(), href: '/control-center/vendors' })
    }
  }

  if (permissionKeys.has('providers.read')) {
    const { results: rows } = await db
      .prepare("SELECT id, display_name, provider_type, contact_email FROM provider_profiles WHERE display_name LIKE ? OR contact_email LIKE ? LIMIT 5")
      .bind(like, like)
      .all<{ id: number; display_name: string; provider_type: string; contact_email: string }>()
    for (const r of rows ?? []) {
      results.push({ type: 'provider', id: r.id, title: r.display_name, subtitle: `${r.provider_type} ${r.contact_email ? '· ' + r.contact_email : ''}`.trim(), href: '/control-center/providers' })
    }
  }

  if (permissionKeys.has('orders.read')) {
    const { results: rows } = await db
      .prepare("SELECT id, order_number, status, total_kobo FROM orders WHERE order_number LIKE ? LIMIT 5")
      .bind(like)
      .all<{ id: number; order_number: string; status: string; total_kobo: number }>()
    for (const r of rows ?? []) {
      results.push({ type: 'order', id: r.id, title: `Order ${r.order_number}`, subtitle: `${r.status} · ₦${(r.total_kobo / 100).toLocaleString()}`, href: null })
    }
  }

  if (permissionKeys.has('bookings.read')) {
    const { results: rows } = await db
      .prepare("SELECT id, booking_number, status FROM bookings WHERE booking_number LIKE ? LIMIT 5")
      .bind(like)
      .all<{ id: number; booking_number: string; status: string }>()
    for (const r of rows ?? []) {
      results.push({ type: 'booking', id: r.id, title: `Booking ${r.booking_number}`, subtitle: r.status, href: null })
    }
  }

  return results
}

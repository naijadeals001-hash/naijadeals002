/**
 * NaijaEats — cart + order-creation data layer.
 *
 * Cart resolution mirrors src/lib/cart.ts's getOrCreateCartId() exactly
 * (user_id XOR guest_token lookup-or-insert against eats_carts, the
 * dedicated NaijaEats table confirmed via schema inspection this session —
 * NOT the product cart's `carts` table). getOrSetGuestToken() from
 * src/lib/guest.ts is reused as-is at the call site; this module only
 * touches eats_carts/eats_cart_items.
 *
 * DESIGN DECISION (single-restaurant cart): unlike the product marketplace
 * cart (which can legitimately hold items from many vendors, split into
 * per-vendor shipments at checkout — src/lib/orders.ts's
 * countDistinctVendors/calculateDeliveryFeeKobo), a NaijaEats cart is
 * scoped to exactly ONE restaurant at a time. This matches standard
 * food-delivery UX (Uber Eats/Jumia Food: adding an item from a different
 * restaurant replaces the cart, since eats_orders.restaurant_id is a single
 * FK — an order can never span two kitchens) and keeps Phase 1 checkout
 * simple (one order, one delivery fee, one restaurant's min_order_kobo
 * check) rather than inventing a multi-order-split flow the user never
 * asked for. addToEatsCart() enforces this explicitly below.
 */
import type { EatsCartItemRow, EatsSelectedOption } from '../types'
import { debitWallet, InsufficientFundsError } from './wallet'

export { InsufficientFundsError }

/** Resolves (or creates) the NaijaEats cart id for a logged-in user or a guest token. Mirrors cart.ts's getOrCreateCartId() exactly, scoped to eats_carts. */
export async function getOrCreateEatsCartId(db: D1Database, userId: number | null, guestToken: string | null): Promise<number> {
  if (userId) {
    const existing = await db.prepare('SELECT id FROM eats_carts WHERE user_id = ?').bind(userId).first<{ id: number }>()
    if (existing) return existing.id
    const inserted = await db.prepare('INSERT INTO eats_carts (user_id) VALUES (?)').bind(userId).run()
    return inserted.meta.last_row_id as number
  }

  if (guestToken) {
    const existing = await db.prepare('SELECT id FROM eats_carts WHERE guest_token = ?').bind(guestToken).first<{ id: number }>()
    if (existing) return existing.id
  }

  const inserted = await db.prepare('INSERT INTO eats_carts (guest_token) VALUES (?)').bind(guestToken).run()
  return inserted.meta.last_row_id as number
}

/** When a guest logs in, merge their guest eats-cart into their user eats-cart. Mirrors cart.ts's mergeGuestCartIntoUser(). Not wired into the login flow in Phase 1 (out of the locked route scope) but provided so a future login-flow change has a ready-made, correctly-shaped helper rather than inventing one under time pressure. */
export async function mergeGuestEatsCartIntoUser(db: D1Database, guestToken: string, userId: number): Promise<void> {
  const guestCart = await db.prepare('SELECT id FROM eats_carts WHERE guest_token = ?').bind(guestToken).first<{ id: number }>()
  if (!guestCart) return

  const userCartId = await getOrCreateEatsCartId(db, userId, null)
  const guestItems = await db
    .prepare('SELECT menu_item_id, restaurant_id, quantity, selected_options_json, special_instructions FROM eats_cart_items WHERE cart_id = ?')
    .bind(guestCart.id)
    .all<{ menu_item_id: number; restaurant_id: number; quantity: number; selected_options_json: string; special_instructions: string | null }>()

  for (const item of guestItems.results) {
    await db
      .prepare('INSERT INTO eats_cart_items (cart_id, menu_item_id, restaurant_id, quantity, selected_options_json, special_instructions) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(userCartId, item.menu_item_id, item.restaurant_id, item.quantity, item.selected_options_json, item.special_instructions)
      .run()
  }

  await db.prepare('DELETE FROM eats_carts WHERE id = ?').bind(guestCart.id).run()
}

/** Cart items joined with menu_item/dish-image/restaurant context — the shape rendered on /eats/cart and used to build the checkout summary. */
export async function getEatsCartItems(db: D1Database, cartId: number): Promise<EatsCartItemRow[]> {
  const { results } = await db
    .prepare(
      `SELECT eci.id, eci.cart_id, eci.menu_item_id, eci.restaurant_id, eci.quantity,
              eci.selected_options_json, eci.special_instructions, eci.created_at,
              mi.name, COALESCE(mi.image_url, d.image_url) AS image_url, mi.base_price_kobo, mi.is_available,
              r.name AS restaurant_name, r.slug AS restaurant_slug,
              r.delivery_fee_kobo AS restaurant_delivery_fee_kobo, r.min_order_kobo AS restaurant_min_order_kobo
       FROM eats_cart_items eci
       JOIN menu_items mi ON mi.id = eci.menu_item_id
       LEFT JOIN dishes d ON d.id = mi.dish_id
       JOIN restaurants r ON r.id = eci.restaurant_id
       WHERE eci.cart_id = ?
       ORDER BY eci.id ASC`
    )
    .bind(cartId)
    .all<EatsCartItemRow>()
  return results
}

/** Sum of one cart item's price: base price + every selected option's price_delta, times quantity. */
export function eatsCartItemLineTotalKobo(item: EatsCartItemRow): number {
  const options: EatsSelectedOption[] = JSON.parse(item.selected_options_json || '[]')
  const unitPrice = item.base_price_kobo + options.reduce((sum, o) => sum + o.price_delta_kobo, 0)
  return unitPrice * item.quantity
}

export class DifferentRestaurantCartError extends Error {
  constructor(public existingRestaurantName: string) {
    super(`Your cart already has items from ${existingRestaurantName}. Clear your cart to order from a different restaurant.`)
  }
}

/**
 * Adds a menu item + selected options to the cart. Enforces the
 * single-restaurant-cart rule (see module header) — if the cart already
 * has items from a DIFFERENT restaurant, throws DifferentRestaurantCartError
 * rather than silently mixing two kitchens into one order. The caller (the
 * /api/eats/cart route) is expected to surface this as a "clear cart?"
 * confirmation, mirroring how food-delivery apps handle this case.
 */
export async function addToEatsCart(
  db: D1Database,
  cartId: number,
  menuItemId: number,
  restaurantId: number,
  quantity: number,
  selectedOptions: EatsSelectedOption[],
  specialInstructions: string | null
): Promise<void> {
  const existingRestaurant = await db
    .prepare(
      `SELECT r.id, r.name FROM eats_cart_items eci JOIN restaurants r ON r.id = eci.restaurant_id
       WHERE eci.cart_id = ? LIMIT 1`
    )
    .bind(cartId)
    .first<{ id: number; name: string }>()
  if (existingRestaurant && existingRestaurant.id !== restaurantId) {
    throw new DifferentRestaurantCartError(existingRestaurant.name)
  }

  const optionsJson = JSON.stringify(selectedOptions)

  // If an identical line (same menu item + same exact option selection) already exists, bump its quantity
  // rather than inserting a duplicate row — mirrors typical add-to-cart UX ("add another") without a
  // separate merge step. Selection equality is a straight string compare on the canonical JSON — good
  // enough for Phase 1 since selectedOptions is always built server-side/client-side in a stable order.
  const existingLine = await db
    .prepare('SELECT id, quantity FROM eats_cart_items WHERE cart_id = ? AND menu_item_id = ? AND selected_options_json = ?')
    .bind(cartId, menuItemId, optionsJson)
    .first<{ id: number; quantity: number }>()

  if (existingLine) {
    await db.prepare('UPDATE eats_cart_items SET quantity = ? WHERE id = ?').bind(existingLine.quantity + quantity, existingLine.id).run()
    return
  }

  await db
    .prepare('INSERT INTO eats_cart_items (cart_id, menu_item_id, restaurant_id, quantity, selected_options_json, special_instructions) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(cartId, menuItemId, restaurantId, quantity, optionsJson, specialInstructions)
    .run()
}

/** Ownership-scoped by cart_id in the WHERE clause — never trust a client-claimed cart_item_id without also matching cart_id. */
export async function updateEatsCartItemQuantity(db: D1Database, cartId: number, cartItemId: number, quantity: number): Promise<void> {
  if (quantity <= 0) {
    await db.prepare('DELETE FROM eats_cart_items WHERE id = ? AND cart_id = ?').bind(cartItemId, cartId).run()
    return
  }
  await db.prepare('UPDATE eats_cart_items SET quantity = ? WHERE id = ? AND cart_id = ?').bind(quantity, cartItemId, cartId).run()
}

export async function removeFromEatsCart(db: D1Database, cartId: number, cartItemId: number): Promise<void> {
  await db.prepare('DELETE FROM eats_cart_items WHERE id = ? AND cart_id = ?').bind(cartItemId, cartId).run()
}

export async function clearEatsCart(db: D1Database, cartId: number): Promise<void> {
  await db.prepare('DELETE FROM eats_cart_items WHERE cart_id = ?').bind(cartId).run()
}

export interface EatsShippingDetails {
  name: string
  phone: string
  address: string
  city: string
  state: string
  country?: string
}

function generateEatsOrderNumber(): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  // NE- prefix (NaijaEats) rather than orders.ts's ND- (NaijaDeals product orders) — deliberately
  // distinct so an order number alone tells you which engine created it, avoiding any confusion
  // between the two parallel order tables (orders vs eats_orders) in support/ops tooling later.
  return `NE-${ts}-${rand}`
}

export class EatsCheckoutError extends Error {}

/**
 * Creates a pending eats_order + eats_order_items(+options) from the
 * cart's current items — modeled directly on orders.ts's
 * createPendingOrder() (order-number generation, item snapshotting at
 * time-of-purchase, db.batch() for the item-insert array), adapted to
 * eats_orders' single-restaurant shape (no per-vendor delivery-fee
 * splitting needed — the restaurant's own delivery_fee_kobo is the whole
 * order's delivery fee) and to snapshotting the CHOSEN options
 * (eats_order_item_options) rather than a plain variant string.
 *
 * Validates: cart is non-empty, all items belong to the SAME restaurant
 * (should already be guaranteed by addToEatsCart's guard, re-checked here
 * defensively), all items are still available, and the order subtotal
 * meets the restaurant's min_order_kobo — never silently waives it.
 */
export async function createPendingEatsOrder(
  db: D1Database,
  customerUserId: number,
  cartItems: EatsCartItemRow[],
  shipping: EatsShippingDetails,
  specialInstructions: string | null
): Promise<{ orderId: number; orderNumber: string; totalKobo: number }> {
  if (cartItems.length === 0) throw new EatsCheckoutError('Your cart is empty')

  const restaurantIds = new Set(cartItems.map((i) => i.restaurant_id))
  if (restaurantIds.size > 1) throw new EatsCheckoutError('Cart contains items from more than one restaurant')

  const unavailable = cartItems.find((i) => i.is_available !== 1)
  if (unavailable) throw new EatsCheckoutError(`"${unavailable.name}" is no longer available`)

  const restaurantId = cartItems[0].restaurant_id
  const deliveryFeeKobo = cartItems[0].restaurant_delivery_fee_kobo
  const minOrderKobo = cartItems[0].restaurant_min_order_kobo

  const subtotalKobo = cartItems.reduce((sum, item) => sum + eatsCartItemLineTotalKobo(item), 0)
  if (subtotalKobo < minOrderKobo) {
    throw new EatsCheckoutError(`This restaurant requires a minimum order — add more items to reach the minimum`)
  }

  const totalKobo = subtotalKobo + deliveryFeeKobo
  const orderNumber = generateEatsOrderNumber()

  const orderInsert = await db
    .prepare(
      `INSERT INTO eats_orders (order_number, customer_user_id, restaurant_id, status, payment_status,
                                 subtotal_kobo, delivery_fee_kobo, total_kobo, currency,
                                 shipping_name, shipping_phone, shipping_address, shipping_city, shipping_state,
                                 special_instructions)
       VALUES (?, ?, ?, 'new', 'unpaid', ?, ?, ?, 'NGN', ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      orderNumber, customerUserId, restaurantId,
      subtotalKobo, deliveryFeeKobo, totalKobo,
      shipping.name, shipping.phone, shipping.address, shipping.city, shipping.state,
      specialInstructions
    )
    .run()

  const orderId = orderInsert.meta.last_row_id as number

  const statements: D1PreparedStatement[] = []
  for (const item of cartItems) {
    const options: EatsSelectedOption[] = JSON.parse(item.selected_options_json || '[]')
    const optionsTotal = options.reduce((sum, o) => sum + o.price_delta_kobo, 0)
    const unitPrice = item.base_price_kobo + optionsTotal
    const itemInsert = db
      .prepare(
        `INSERT INTO eats_order_items (order_id, menu_item_id, name_snapshot, image_snapshot, unit_price_kobo, quantity, line_total_kobo, special_instructions)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(orderId, item.menu_item_id, item.name, item.image_url, unitPrice, item.quantity, unitPrice * item.quantity, item.special_instructions)
    statements.push(itemInsert)
  }
  const itemInsertResults = await db.batch(statements)

  // Option snapshots — one insert per (order_item, selected option) pair. Requires each
  // order_item's own last_row_id, so this runs as a SECOND batch after the item inserts above,
  // matched back up positionally (cartItems and itemInsertResults share the same index order).
  const optionStatements: D1PreparedStatement[] = []
  cartItems.forEach((item, idx) => {
    const orderItemId = itemInsertResults[idx].meta.last_row_id as number
    const options: EatsSelectedOption[] = JSON.parse(item.selected_options_json || '[]')
    for (const opt of options) {
      optionStatements.push(
        db
          .prepare('INSERT INTO eats_order_item_options (order_item_id, option_name_snapshot, price_delta_kobo_snapshot) VALUES (?, ?, ?)')
          .bind(orderItemId, opt.name, opt.price_delta_kobo)
      )
    }
  })
  if (optionStatements.length > 0) await db.batch(optionStatements)

  await db.prepare(`INSERT INTO eats_order_status_events (order_id, status, note) VALUES (?, 'new', 'Order placed by customer')`).bind(orderId).run()

  return { orderId, orderNumber, totalKobo }
}

/** Ownership-scoped lookup — never trust an order_number alone without also matching customer_user_id, mirroring api-orders.ts's `WHERE order_number = ? AND user_id = ?` pattern. */
export async function getOwnedEatsOrder(db: D1Database, customerUserId: number, orderNumber: string) {
  return db
    .prepare(
      `SELECT eo.*, r.name AS restaurant_name, r.slug AS restaurant_slug, r.logo_url AS restaurant_logo_url
       FROM eats_orders eo JOIN restaurants r ON r.id = eo.restaurant_id
       WHERE eo.order_number = ? AND eo.customer_user_id = ?`
    )
    .bind(orderNumber, customerUserId)
    .first<any>()
}

export async function getEatsOrderItems(db: D1Database, orderId: number) {
  const items = await db.prepare('SELECT * FROM eats_order_items WHERE order_id = ?').bind(orderId).all<any>()
  const itemIds = items.results.map((i) => i.id)
  if (itemIds.length === 0) return items.results.map((i: any) => ({ ...i, options: [] }))
  const options = await db
    .prepare(`SELECT * FROM eats_order_item_options WHERE order_item_id IN (${itemIds.map(() => '?').join(',')})`)
    .bind(...itemIds)
    .all<any>()
  const byItem = new Map<number, any[]>()
  for (const opt of options.results) {
    const list = byItem.get(opt.order_item_id) ?? []
    list.push(opt)
    byItem.set(opt.order_item_id, list)
  }
  return items.results.map((i: any) => ({ ...i, options: byItem.get(i.id) ?? [] }))
}

export async function getEatsOrderStatusEvents(db: D1Database, orderId: number) {
  const { results } = await db.prepare('SELECT * FROM eats_order_status_events WHERE order_id = ? ORDER BY created_at ASC, id ASC').bind(orderId).all<any>()
  return results
}

export class EatsOrderPaymentError extends Error {}

/**
 * ATOMIC CLAIM (compare-and-swap), mirroring orders.ts's claimOrderForPayment()
 * exactly — `WHERE id = ? AND payment_status = 'unpaid'` re-checks the guard
 * AT WRITE TIME, so only one concurrent/duplicate caller for the same
 * eats order can ever win. Returns true iff THIS call won the claim.
 */
export async function claimEatsOrderForPayment(db: D1Database, orderId: number, provider: 'wallet' | 'paystack', providerReference: string): Promise<boolean> {
  const claim = await db
    .prepare(
      `UPDATE eats_orders SET payment_status = 'escrow_held', payment_provider = ?, payment_reference = ?, updated_at = datetime('now')
       WHERE id = ? AND payment_status = 'unpaid'`
    )
    .bind(provider, providerReference, orderId)
    .run()
  return (claim.meta.rows_written ?? 0) > 0
}

/**
 * Pays for a NaijaEats order directly from the customer's NaijaDeals
 * wallet — mirrors orders.ts's payOrderFromWallet() exactly (claim-before-debit
 * ordering, rollback on insufficient funds so the order never gets stuck
 * claimed-but-unpaid).
 */
export async function payEatsOrderFromWallet(db: D1Database, orderId: number, userId: number, totalKobo: number): Promise<void> {
  const order = await db.prepare('SELECT id FROM eats_orders WHERE id = ? AND customer_user_id = ?').bind(orderId, userId).first<{ id: number }>()
  if (!order) throw new EatsOrderPaymentError('Order not found or not owned by this customer')

  const paymentReference = `EATS-WALLET-${orderId}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

  const won = await claimEatsOrderForPayment(db, orderId, 'wallet', paymentReference)
  if (!won) throw new EatsOrderPaymentError('This order has already been paid')

  try {
    await debitWallet(db, userId, totalKobo, 'eats_order_payment', String(orderId), 'Payment for NaijaEats order')
  } catch (err) {
    await db
      .prepare(
        `UPDATE eats_orders SET payment_status = 'unpaid', payment_provider = NULL, payment_reference = NULL
         WHERE id = ? AND payment_status = 'escrow_held' AND payment_reference = ?`
      )
      .bind(orderId, paymentReference)
      .run()
    throw err
  }

  // Payment confirmed does NOT change eats_orders.status (still 'new' — the restaurant hasn't
  // accepted it yet, that's a separate, out-of-scope-for-Phase-1 vendor-side action). Logged as
  // a 'new'-status event with a payment-specific note so the timeline shows exactly when payment
  // cleared without inventing a status value that doesn't exist in the CHECK constraint.
  await db.prepare(`INSERT INTO eats_order_status_events (order_id, status, note) VALUES (?, 'new', 'Payment received — awaiting restaurant confirmation')`).bind(orderId).run()
}

export class EatsOrderNotFoundError extends Error {}

/**
 * Parses the eats-order id out of a `provider_reference` string generated by
 * THIS codebase's own eats-checkout Paystack-initiate path (api-eats.ts's
 * `EATS-PAY-${orderId}-${Date.now()}`). Used by the shared Paystack webhook
 * (api-webhooks.ts) to discriminate a NaijaEats payment_transactions row
 * from a NaijaShop order-payment row or a wallet top-up row — WITHOUT ever
 * trusting anything from the webhook EVENT PAYLOAD (Paystack's `event.data`).
 * The string being parsed here is `tx.provider_reference`, i.e. the value
 * THIS SERVER generated and wrote to `payment_transactions` at checkout
 * time (before the customer ever reached Paystack) — not attacker/
 * webhook-controlled input. Returns null for anything that doesn't match
 * the exact `EATS-PAY-<digits>-` prefix shape (defensive — a non-match
 * safely falls through to the existing wallet-topup branch rather than
 * ever being misinterpreted as an eats order id).
 */
export function parseEatsPaymentReference(reference: string): number | null {
  const match = /^EATS-PAY-(\d+)-/.exec(reference)
  if (!match) return null
  const orderId = Number(match[1])
  return Number.isInteger(orderId) && orderId > 0 ? orderId : null
}

/**
 * TASK A FIX (Paystack/table-mismatch defect — see
 * NAIJAEATS_PRODUCTION_READINESS_GATE.md / NAIJAEATS_PAYMENT_REFUND_OPERATIONS_REPORT.md
 * for the full defect writeup). This is the NaijaEats-exclusive counterpart
 * to orders.ts's confirmOrderPayment() — same claim-then-side-effects shape
 * (self-contained CAS claim via claimEatsOrderForPayment, so it's safe to
 * call from any current or future caller without depending on an upstream
 * caller's own idempotency guard), but it ONLY ever reads/writes
 * `eats_orders` / `eats_order_status_events`. It is IMPOSSIBLE for this
 * function to mutate a NaijaShop `orders` row, regardless of numeric-id
 * collisions between the two tables, because it never references the
 * `orders` table at all.
 *
 * Root-cause fix pairs with api-eats.ts's checkout route no longer writing
 * `eats_orders.id` into `payment_transactions.order_id` (that column has a
 * hard FK to `orders(id)` — see migrations/0001_initial_schema.sql — so
 * writing an eats order id there either throws SQLITE_CONSTRAINT_FOREIGNKEY
 * outright, or, if a NaijaShop order genuinely exists at that same numeric
 * id, would satisfy the FK and let the OLD buggy webhook dispatch silently
 * mutate that unrelated NaijaShop order). With `order_id` left NULL for
 * eats transactions, the webhook instead discriminates via
 * parseEatsPaymentReference() against `tx.provider_reference` — a value
 * this server generated itself at checkout, never trusted from the webhook
 * payload.
 */
export async function confirmEatsOrderPayment(
  db: D1Database,
  orderId: number,
  provider: 'paystack' | 'wallet',
  providerReference: string
): Promise<void> {
  const order = await db.prepare('SELECT id FROM eats_orders WHERE id = ?').bind(orderId).first<{ id: number }>()
  if (!order) throw new EatsOrderNotFoundError(`NaijaEats order ${orderId} not found — cannot confirm payment (reference ${providerReference})`)

  const won = await claimEatsOrderForPayment(db, orderId, provider, providerReference)
  if (!won) return // idempotent — already processed (or lost a concurrent race) — never re-run the payment-confirmed side effect twice

  // Mirrors payEatsOrderFromWallet()'s status-event note exactly — payment
  // confirmed does NOT change eats_orders.status (still 'new' — the
  // restaurant hasn't accepted it yet, that's the Task C operator action).
  await db.prepare(`INSERT INTO eats_order_status_events (order_id, status, note) VALUES (?, 'new', 'Payment received — awaiting restaurant confirmation')`).bind(orderId).run()
}

export class EatsOrderCancellationError extends Error {}

/**
 * Customer-initiated cancellation — mirrors orders.ts's cancelOrder()
 * ownership-scoping pattern (`WHERE id = ? AND customer_user_id = ?`), only
 * permitted while status is still 'new' (order placed, not yet accepted by
 * the restaurant) since Phase 1 has no refund/dispute engine wired up for
 * an order already in preparation. A paid-but-cancelled order's escrow
 * release/refund path is an explicitly documented remaining gap (same
 * "not built here" boundary as the rest of vendor/admin tooling).
 */
export async function cancelEatsOrder(db: D1Database, userId: number, orderId: number, reason: string): Promise<void> {
  const order = await db.prepare('SELECT id, status FROM eats_orders WHERE id = ? AND customer_user_id = ?').bind(orderId, userId).first<{ id: number; status: string }>()
  if (!order) throw new EatsOrderCancellationError('Order not found')
  if (order.status !== 'new') {
    throw new EatsOrderCancellationError(`Order in status "${order.status}" can no longer be cancelled`)
  }

  await db.batch([
    db.prepare(`UPDATE eats_orders SET status = 'cancelled', cancelled_reason = ?, updated_at = datetime('now') WHERE id = ?`).bind(reason, orderId),
    db.prepare(`INSERT INTO eats_order_status_events (order_id, status, actor_user_id, note) VALUES (?, 'cancelled', ?, ?)`).bind(orderId, userId, reason),
  ])
}

/** All of one customer's NaijaEats orders, newest first — the /eats/account/orders list. */
export async function getEatsOrdersForCustomer(db: D1Database, customerUserId: number) {
  const { results } = await db
    .prepare(
      `SELECT eo.*, r.name AS restaurant_name, r.slug AS restaurant_slug, r.logo_url AS restaurant_logo_url
       FROM eats_orders eo JOIN restaurants r ON r.id = eo.restaurant_id
       WHERE eo.customer_user_id = ?
       ORDER BY eo.id DESC`
    )
    .bind(customerUserId)
    .all<any>()
  return results
}

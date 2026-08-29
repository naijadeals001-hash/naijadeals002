import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import type { AppEnv, OrderRow, OrderItemRow } from '../types'
import { formatNaira } from '../lib/money'

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending_payment: { label: 'Awaiting payment', color: 'text-amber-600 bg-amber-50' },
  processing: { label: 'Processing', color: 'text-blue-600 bg-blue-50' },
  shipped: { label: 'Shipped', color: 'text-indigo-600 bg-indigo-50' },
  delivered: { label: 'Delivered', color: 'text-primary bg-primary-light' },
  completed: { label: 'Completed', color: 'text-primary bg-primary-light' },
  cancelled: { label: 'Cancelled', color: 'text-gray-500 bg-gray-100' },
  refunded: { label: 'Refunded', color: 'text-red-600 bg-red-50' }
}

export async function ordersListPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')!

  const { results: orders } = await db
    .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC')
    .bind(user.id)
    .all<OrderRow>()

  return c.render(
    <Layout title="Your Orders" user={user}>
      <div class="max-w-4xl mx-auto px-6 lg:px-8 py-6">
        <h1 class="text-2xl font-bold text-gray-800 mb-6">Your Orders</h1>

        {orders.length === 0 ? (
          <div class="text-center py-20">
            <span class="material-symbols-outlined text-5xl text-gray-300">receipt_long</span>
            <p class="text-gray-500 mt-3">You haven't placed any orders yet.</p>
            <a href="/shop" class="inline-block mt-4 bg-primary text-white font-semibold px-6 py-2.5 rounded-lg hover:bg-primary-dark transition">
              Start shopping
            </a>
          </div>
        ) : (
          <div class="space-y-3">
            {orders.map((order) => {
              const status = STATUS_LABEL[order.status] || { label: order.status, color: 'text-gray-500 bg-gray-100' }
              return (
                <a href={`/orders/${order.order_number}`} class="block bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition">
                  <div class="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <p class="text-sm font-semibold text-gray-800">{order.order_number}</p>
                      <p class="text-xs text-gray-500 mt-0.5">{new Date(order.created_at).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' })}</p>
                    </div>
                    <span class={`text-xs font-semibold px-2.5 py-1 rounded-full ${status.color}`}>{status.label}</span>
                    <span class="text-sm font-bold text-gray-900">{formatNaira(order.total_kobo)}</span>
                  </div>
                </a>
              )
            })}
          </div>
        )}
      </div>
    </Layout>
  )
}

export async function orderDetailPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')!
  const orderNumber = c.req.param('orderNumber')

  const order = await db.prepare('SELECT * FROM orders WHERE order_number = ? AND user_id = ?')
    .bind(orderNumber, user.id)
    .first<OrderRow>()

  if (!order) {
    return c.render(
      <Layout title="Order not found" user={user}>
        <div class="max-w-2xl mx-auto text-center py-20">
          <span class="material-symbols-outlined text-5xl text-gray-300">search_off</span>
          <h1 class="text-xl font-bold mt-4">Order not found</h1>
          <a href="/orders" class="text-primary font-semibold hover:underline mt-2 inline-block">Back to orders</a>
        </div>
      </Layout>,
      404
    )
  }

  const { results: items } = await db.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(order.id).all<OrderItemRow>()
  const status = STATUS_LABEL[order.status] || { label: order.status, color: 'text-gray-500 bg-gray-100' }

  return c.render(
    <Layout title={order.order_number} user={user}>
      <div class="max-w-4xl mx-auto px-6 lg:px-8 py-6">
        <a href="/orders" class="text-sm text-primary font-medium hover:underline flex items-center gap-1 mb-4">
          <span class="material-symbols-outlined text-base">arrow_back</span>Back to orders
        </a>

        <div class="flex items-center justify-between flex-wrap gap-2 mb-6">
          <div>
            <h1 class="text-xl font-bold text-gray-800">{order.order_number}</h1>
            <p class="text-sm text-gray-500">Placed on {new Date(order.created_at).toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
          <span class={`text-sm font-semibold px-3 py-1.5 rounded-full ${status.color}`}>{status.label}</span>
        </div>

        <div class="grid md:grid-cols-3 gap-6">
          <div class="md:col-span-2 space-y-3">
            {items.map((item) => (
              <div class="flex gap-4 bg-white border border-gray-200 rounded-xl p-4">
                <div class="w-16 h-16 shrink-0 rounded-lg bg-gray-100 overflow-hidden">
                  <img src={item.image_snapshot} alt={item.title_snapshot} class="w-full h-full object-cover" />
                </div>
                <div class="flex-1">
                  <p class="text-sm font-medium text-gray-800 line-clamp-2">{item.title_snapshot}</p>
                  <p class="text-xs text-gray-500 mt-1">Qty: {item.quantity} × {formatNaira(item.unit_price_kobo)}</p>
                </div>
                <p class="text-sm font-bold text-gray-900 shrink-0">{formatNaira(item.line_total_kobo)}</p>
              </div>
            ))}
          </div>

          <div class="space-y-4">
            <div class="bg-white border border-gray-200 rounded-xl p-4">
              <h2 class="font-bold text-gray-800 mb-2 text-sm">Delivery address</h2>
              <p class="text-sm text-gray-600">{order.shipping_name}</p>
              <p class="text-sm text-gray-600">{order.shipping_phone}</p>
              <p class="text-sm text-gray-600">{order.shipping_address}, {order.shipping_city}, {order.shipping_state}</p>
            </div>
            <div class="bg-white border border-gray-200 rounded-xl p-4">
              <h2 class="font-bold text-gray-800 mb-2 text-sm">Payment summary</h2>
              <div class="flex justify-between text-sm text-gray-600 mb-1">
                <span>Subtotal</span><span>{formatNaira(order.subtotal_kobo)}</span>
              </div>
              <div class="flex justify-between text-sm text-gray-600 mb-1">
                <span>Delivery fee</span><span>{formatNaira(order.delivery_fee_kobo)}</span>
              </div>
              <div class="flex justify-between text-sm font-bold text-gray-900 pt-1.5 border-t border-gray-100">
                <span>Total</span><span>{formatNaira(order.total_kobo)}</span>
              </div>
              {order.payment_provider && (
                <p class="text-xs text-gray-400 mt-2">Paid via {order.payment_provider === 'wallet' ? 'NaijaDeals Wallet' : 'Paystack'}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}

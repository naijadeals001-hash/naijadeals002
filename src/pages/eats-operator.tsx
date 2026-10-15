import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import type { AppEnv } from '../types'
import {
  getEatsOrdersForOperator,
  getEatsOrderItemsForOperator,
  getEatsOperatorOrderEvents,
  getOwnedEatsOrderForOperator,
  getOwnedEatsRestaurants,
  resolveEatsOperatorProfile,
  isEatsOperatorStatus,
  type EatsOperatorStatus,
} from '../lib/eats-operator'

const STATUS_LABELS: Record<string, string> = {
  new: 'New', accepted: 'Accepted', preparing: 'Preparing', ready: 'Ready',
  handoff: 'Ready for handoff', completed: 'Completed', declined: 'Declined', cancelled: 'Cancelled',
}

const NEXT_ACTIONS: Record<string, EatsOperatorStatus[]> = {
  new: ['accepted', 'declined'],
  accepted: ['preparing'],
  preparing: ['ready'],
  ready: ['handoff'],
  handoff: ['completed'],
}

const formatMoney = (kobo: number, currency: string) => new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(kobo / 100)

export async function eatsOperatorOrdersPage(c: Context<AppEnv>) {
  const user = c.get('user')!
  const locale = c.get('locale')
  const profile = await resolveEatsOperatorProfile(c.env.DB, user.id)
  if (!profile) {
    c.status(403)
    return c.render(<Layout title="Restaurant operator access" user={user} locale={locale}><div class="max-w-2xl mx-auto px-4 py-20 text-center"><span class="material-symbols-outlined text-5xl text-gray-300">lock</span><h1 class="text-2xl font-bold mt-4">Restaurant operator access required</h1><p class="text-gray-600 mt-2">Your account does not have an active, verified restaurant-operator profile.</p></div></Layout>)
  }

  const restaurantId = c.req.query('restaurant_id') ? Number(c.req.query('restaurant_id')) : undefined
  const status = c.req.query('status') || undefined
  const [restaurants, orders] = await Promise.all([
    getOwnedEatsRestaurants(c.env.DB, profile.id),
    getEatsOrdersForOperator(c.env.DB, profile.id, { restaurantId, status }),
  ])

  return c.render(
    <Layout title="Restaurant orders — NaijaEats" user={user} locale={locale}>
      <div class="max-w-6xl mx-auto px-4 md:px-6 lg:px-8 py-8" id="eats-operator-orders-page">
        <div class="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
          <div><p class="text-xs font-semibold uppercase tracking-wider text-primary">NaijaEats operator</p><h1 class="text-2xl font-bold text-gray-900">Restaurant orders</h1><p class="text-sm text-gray-500 mt-1">Manage only the restaurants assigned to your operator profile.</p></div>
          <a href="/eats" class="text-sm font-semibold text-primary hover:underline">View customer experience</a>
        </div>
        <form method="get" class="bg-white border border-gray-200 rounded-xl p-4 mb-5 flex flex-col sm:flex-row gap-3">
          <label class="text-sm text-gray-600 flex-1">Restaurant<select name="restaurant_id" class="mt-1 block w-full rounded-lg border-gray-300 text-sm"><option value="">All my restaurants</option>{(restaurants as any[]).map((r) => <option value={r.id} selected={restaurantId === r.id}>{r.name}</option>)}</select></label>
          <label class="text-sm text-gray-600 flex-1">Status<select name="status" class="mt-1 block w-full rounded-lg border-gray-300 text-sm"><option value="">All statuses</option>{['new', 'accepted', 'preparing', 'ready', 'handoff', 'completed', 'declined', 'cancelled'].map((s) => <option value={s} selected={status === s}>{STATUS_LABELS[s]}</option>)}</select></label>
          <button class="self-end bg-primary text-white font-semibold px-5 py-2 rounded-lg text-sm hover:bg-primary-dark" type="submit">Filter</button>
        </form>
        <div id="eats-operator-action-message" class="hidden rounded-lg px-4 py-3 mb-4 text-sm"></div>
        <section class="space-y-3" aria-label="Restaurant orders">
          {(orders as any[]).length === 0 ? <div class="bg-white border border-gray-200 rounded-xl p-12 text-center text-gray-500">No orders match this filter.</div> : (orders as any[]).map((order) => {
            const actions = NEXT_ACTIONS[order.status] ?? []
            return <article class="bg-white border border-gray-200 rounded-xl p-5" data-order-id={order.id}>
              <div class="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div><div class="flex items-center gap-2"><h2 class="font-bold text-gray-900">{order.order_number}</h2><span class="text-xs font-semibold rounded-full px-2 py-1 bg-primary-light text-primary-dark">{STATUS_LABELS[order.status] ?? order.status}</span></div><p class="text-sm text-gray-600 mt-1">{order.restaurant_name} · {order.customer_name} · {order.item_count} item(s)</p><p class="text-xs text-gray-400 mt-1">{order.shipping_city}, {order.shipping_state} · {new Date(order.created_at).toLocaleString('en-NG')}</p></div>
                <div class="text-left lg:text-right"><p class="font-bold text-gray-900">{formatMoney(order.total_kobo, order.currency)}</p><p class="text-xs text-gray-500">Payment: {order.payment_status.replace('_', ' ')}</p></div>
              </div>
              <div class="mt-4 flex flex-wrap gap-2">{actions.map((action) => <button type="button" class="eats-operator-transition text-xs font-semibold rounded-lg border border-primary/30 text-primary px-3 py-2 hover:bg-primary-light" data-order-id={order.id} data-status={action}>{action === 'declined' ? 'Decline' : `Mark ${STATUS_LABELS[action]}`}</button>)}<a class="text-xs font-semibold text-gray-600 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50" href={`/eats/operator/orders/${order.id}`}>Order details</a></div>
            </article>
          })}
        </section>
      </div>
      <script dangerouslySetInnerHTML={{ __html: `
        document.querySelectorAll('.eats-operator-transition').forEach((button) => button.addEventListener('click', async () => {
          const message = document.getElementById('eats-operator-action-message');
          button.disabled = true;
          try {
            const response = await fetch('/api/eats/operator/orders/' + button.dataset.orderId + '/transition', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({status: button.dataset.status}) });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || 'Could not update order');
            window.location.reload();
          } catch (error) {
            message.textContent = error.message;
            message.className = 'rounded-lg px-4 py-3 mb-4 text-sm bg-red-50 text-red-700';
            button.disabled = false;
          }
        }));
      ` }}></script>
    </Layout>
  )
}

export async function eatsOperatorOrderDetailPage(c: Context<AppEnv>) {
  const user = c.get('user')!
  const locale = c.get('locale')
  const profile = await resolveEatsOperatorProfile(c.env.DB, user.id)
  const orderId = Number(c.req.param('id'))
  const order = (profile && Number.isInteger(orderId) ? await getOwnedEatsOrderForOperator(c.env.DB, profile.id, orderId) : null) as any
  if (!profile || !order) {
    c.status(404)
    return c.render(<Layout title="Operator order not found" user={user} locale={locale}><div class="max-w-2xl mx-auto px-4 py-20 text-center"><h1 class="text-2xl font-bold">Order not found</h1><a href="/eats/operator/orders" class="text-primary font-semibold hover:underline mt-3 inline-block">Back to restaurant orders</a></div></Layout>)
  }
  const [items, events] = await Promise.all([
    getEatsOrderItemsForOperator(c.env.DB, profile.id, orderId),
    getEatsOperatorOrderEvents(c.env.DB, profile.id, orderId),
  ])
  const actions = NEXT_ACTIONS[order.status] ?? []
  return c.render(<Layout title={`Operator order ${order.order_number}`} user={user} locale={locale}>
    <div class="max-w-4xl mx-auto px-4 md:px-6 lg:px-8 py-8" id="eats-operator-order-detail" data-order-id={order.id}>
      <a href="/eats/operator/orders" class="text-sm text-primary font-semibold hover:underline">← Back to restaurant orders</a>
      <div class="flex flex-col md:flex-row md:items-start justify-between gap-4 mt-5 mb-6"><div><p class="text-xs uppercase tracking-wider text-primary font-semibold">{order.restaurant_name}</p><h1 class="text-2xl font-bold">{order.order_number}</h1><p class="text-sm text-gray-500 mt-1">Customer: {order.customer_name} · {order.customer_phone || 'No phone recorded'}</p></div><span class="rounded-full px-3 py-1.5 bg-primary-light text-primary-dark text-sm font-semibold">{STATUS_LABELS[order.status] ?? order.status}</span></div>
      <div id="eats-operator-detail-message" class="hidden rounded-lg px-4 py-3 mb-4 text-sm"></div>
      <div class="grid lg:grid-cols-3 gap-5">
        <section class="lg:col-span-2 bg-white border border-gray-200 rounded-xl p-5"><h2 class="font-bold mb-4">Order items</h2><div class="divide-y divide-gray-100">{(items ?? []).map((item: any) => <div class="py-3 flex justify-between gap-4"><div><p class="font-medium text-sm">{item.quantity}× {item.name_snapshot}</p><p class="text-xs text-gray-500">{item.special_instructions || 'No item instructions'}</p></div><p class="font-semibold text-sm">{formatMoney(item.line_total_kobo, order.currency)}</p></div>)}</div><div class="border-t border-gray-200 pt-3 mt-3 flex justify-between font-bold"><span>Total</span><span>{formatMoney(order.total_kobo, order.currency)}</span></div></section>
        <aside class="space-y-5"><section class="bg-white border border-gray-200 rounded-xl p-5"><h2 class="font-bold mb-3">Delivery</h2><p class="text-sm text-gray-700">{order.shipping_name} · {order.shipping_phone}</p><p class="text-sm text-gray-600 mt-1">{order.shipping_address}, {order.shipping_city}, {order.shipping_state}</p>{order.special_instructions && <p class="text-sm text-gray-600 mt-3"><strong>Instructions:</strong> {order.special_instructions}</p>}</section><section class="bg-white border border-gray-200 rounded-xl p-5"><h2 class="font-bold mb-3">Next action</h2><div class="flex flex-wrap gap-2">{actions.length === 0 ? <p class="text-sm text-gray-500">No further operator action is available.</p> : actions.map((action) => <button type="button" class="eats-operator-detail-transition text-xs font-semibold rounded-lg border border-primary/30 text-primary px-3 py-2 hover:bg-primary-light" data-status={action}>{action === 'declined' ? 'Decline' : `Mark ${STATUS_LABELS[action]}`}</button>)}</div></section></aside>
      </div>
      <section class="bg-white border border-gray-200 rounded-xl p-5 mt-5"><h2 class="font-bold mb-4">Status history</h2><div class="space-y-3">{(events ?? []).map((event: any) => <div class="flex gap-3 text-sm"><span class="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0"></span><div><p class="font-medium">{STATUS_LABELS[event.status] ?? event.status}</p><p class="text-xs text-gray-500">{event.note || 'Status updated'} · {event.actor_name || 'System'} · {new Date(event.created_at).toLocaleString('en-NG')}</p></div></div>)}</div></section>
    </div>
    <script dangerouslySetInnerHTML={{ __html: `document.querySelectorAll('.eats-operator-detail-transition').forEach((button) => button.addEventListener('click', async () => { const message = document.getElementById('eats-operator-detail-message'); button.disabled = true; const response = await fetch('/api/eats/operator/orders/${order.id}/transition', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status:button.dataset.status})}); const body = await response.json(); if (!response.ok) { message.textContent = body.error || 'Could not update order'; message.className = 'rounded-lg px-4 py-3 mb-4 text-sm bg-red-50 text-red-700'; button.disabled = false; return; } window.location.reload(); }));` }}></script>
  </Layout>)
}

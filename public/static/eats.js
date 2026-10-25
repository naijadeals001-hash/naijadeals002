// NaijaEats — cart/item/checkout client behaviour (vanilla JS, no build step).
// Loaded only on NaijaEats pages (restaurant profile, item detail, cart, checkout,
// order detail) via an explicit <script src="/static/eats.js"> tag on those pages —
// mirrors app.js's own guard-on-presence convention so this file is safe even if a
// future page includes it without every target element present.
(function () {
  'use strict';

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  async function api(path, options) {
    const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options));
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    return { ok: res.ok, status: res.status, data };
  }

  function money(kobo) {
    return '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: (kobo % 100 === 0) ? 0 : 2, maximumFractionDigits: 2 });
  }

  // ---------- Item detail page: quantity stepper + option selection + add to cart ----------
  (function initItemPage() {
    const page = qs('#eats-item-page');
    if (!page) return;

    const basePriceKobo = Number(page.getAttribute('data-base-price-kobo') || '0');
    const restaurantId = Number(page.getAttribute('data-restaurant-id'));
    const menuItemId = Number(page.getAttribute('data-menu-item-id'));
    const qtyValueEl = qs('#eats-qty-value');
    const totalEl = qs('#eats-add-to-cart-total');
    const errorEl = qs('#eats-add-to-cart-error');

    function currentQty() { return parseInt(qtyValueEl.textContent, 10) || 1; }

    function recomputeTotal() {
      let unit = basePriceKobo;
      qsa('.eats-option-input:checked').forEach(function (input) {
        unit += Number(input.getAttribute('data-price-delta-kobo') || '0');
      });
      totalEl.textContent = money(unit * currentQty());
    }

    const minusBtn = qs('#eats-qty-minus');
    const plusBtn = qs('#eats-qty-plus');
    if (minusBtn) minusBtn.addEventListener('click', function () {
      const v = Math.max(1, currentQty() - 1);
      qtyValueEl.textContent = String(v);
      recomputeTotal();
    });
    if (plusBtn) plusBtn.addEventListener('click', function () {
      qtyValueEl.textContent = String(currentQty() + 1);
      recomputeTotal();
    });
    qsa('.eats-option-input').forEach(function (input) { input.addEventListener('change', recomputeTotal); });

    const addBtn = qs('#eats-add-to-cart-btn');
    if (addBtn) addBtn.addEventListener('click', async function () {
      errorEl.classList.add('hidden');

      // Validate required option groups have at least min_select choices.
      for (const group of qsa('[data-option-group]')) {
        const required = group.getAttribute('data-required') === '1';
        const minSelect = Number(group.getAttribute('data-min-select') || '0');
        const checkedCount = qsa('.eats-option-input:checked', group).length;
        if ((required || minSelect > 0) && checkedCount < Math.max(minSelect, required ? 1 : 0)) {
          errorEl.textContent = 'Please choose an option for "' + group.getAttribute('data-group-name') + '"';
          errorEl.classList.remove('hidden');
          return;
        }
      }

      const selectedOptions = qsa('.eats-option-input:checked').map(function (input) {
        const group = input.closest('[data-option-group]');
        return {
          option_group_id: Number(group.getAttribute('data-option-group-id')),
          option_id: Number(input.getAttribute('data-option-id')),
          name: input.getAttribute('data-option-name'),
          price_delta_kobo: Number(input.getAttribute('data-price-delta-kobo') || '0')
        };
      });

      const specialInstructions = (qs('#eats-item-special-instructions') || {}).value || '';

      addBtn.disabled = true;
      const res = await api('/api/eats/cart/items', {
        method: 'POST',
        body: JSON.stringify({
          restaurant_id: restaurantId,
          menu_item_id: menuItemId,
          quantity: currentQty(),
          selected_options: selectedOptions,
          special_instructions: specialInstructions
        })
      });
      addBtn.disabled = false;

      if (!res.ok) {
        if (res.data && res.data.code === 'different_restaurant') {
          if (confirm(res.data.error + ' Clear your cart and add this item instead?')) {
            await api('/api/eats/cart', { method: 'DELETE' });
            addBtn.click();
          }
          return;
        }
        errorEl.textContent = (res.data && res.data.error) || 'Could not add this item to your cart.';
        errorEl.classList.remove('hidden');
        return;
      }
      window.location.href = '/eats/cart';
    });
  })();

  // ---------- Cart page: quantity steppers, remove, live summary refresh ----------
  (function initCartPage() {
    const page = qs('#eats-cart-page');
    if (!page) return;
    const list = qs('#eats-cart-items-list');
    if (!list) return;

    function applySummary(data) {
      const countEl = qs('#eats-cart-summary-count');
      const subtotalEl = qs('#eats-cart-summary-subtotal');
      if (countEl) countEl.textContent = String(data.count);
      if (subtotalEl) subtotalEl.textContent = money(data.subtotal_kobo);
      if (data.count === 0) { window.location.reload(); }
    }

    list.addEventListener('click', async function (e) {
      const minusBtn = e.target.closest('.eats-cart-qty-minus');
      const plusBtn = e.target.closest('.eats-cart-qty-plus');
      const removeBtn = e.target.closest('.eats-cart-remove-btn');
      if (!minusBtn && !plusBtn && !removeBtn) return;

      const btn = minusBtn || plusBtn || removeBtn;
      const cartItemId = btn.getAttribute('data-cart-item-id');
      const row = btn.closest('[data-eats-cart-item]');
      const valueEl = qs('.eats-cart-qty-value', row);

      if (removeBtn) {
        const res = await api('/api/eats/cart/items/' + cartItemId, { method: 'DELETE' });
        if (res.ok) { row.remove(); applySummary(res.data); }
        return;
      }

      const current = parseInt(valueEl.textContent, 10);
      const next = minusBtn ? Math.max(0, current - 1) : current + 1;
      const res = await api('/api/eats/cart/items/' + cartItemId, { method: 'PUT', body: JSON.stringify({ quantity: next }) });
      if (res.ok) {
        if (next === 0) { row.remove(); } else { valueEl.textContent = String(next); }
        applySummary(res.data);
      }
    });
  })();

  // ---------- Checkout page: address form + wallet/paystack place-order ----------
  (function initCheckoutPage() {
    const page = qs('#eats-checkout-page');
    if (!page) return;

    const showNewAddrBtn = qs('#eats-show-new-address-btn');
    const newAddrForm = qs('#eats-new-address-form');
    const cancelNewAddrBtn = qs('#eats-cancel-new-address-btn');
    if (showNewAddrBtn) showNewAddrBtn.addEventListener('click', function () { newAddrForm.classList.remove('hidden'); });
    if (cancelNewAddrBtn) cancelNewAddrBtn.addEventListener('click', function () { newAddrForm.classList.add('hidden'); });

    const saveNewAddrBtn = qs('#eats-save-new-address-btn');
    if (saveNewAddrBtn) saveNewAddrBtn.addEventListener('click', async function () {
      const errEl = qs('#eats-new-address-error');
      errEl.classList.add('hidden');
      const payload = {
        label: qs('#eats-na-label').value.trim() || 'Delivery address',
        recipient_name: qs('#eats-na-recipient').value.trim(),
        phone: qs('#eats-na-phone').value.trim(),
        line1: qs('#eats-na-line1').value.trim(),
        city: qs('#eats-na-city').value.trim(),
        state: qs('#eats-na-state').value,
      };
      if (!payload.recipient_name || !payload.phone || !payload.line1 || !payload.city || !payload.state) {
        errEl.textContent = 'Please fill in every field.';
        errEl.classList.remove('hidden');
        return;
      }
      const res = await api('/api/addresses', { method: 'POST', body: JSON.stringify(payload) });
      if (!res.ok) {
        errEl.textContent = (res.data && res.data.error) || 'Could not save address.';
        errEl.classList.remove('hidden');
        return;
      }
      window.location.reload();
    });

    const errorEl = qs('#eats-checkout-error');
    const placeOrderBtn = qs('#eats-place-order-btn');
    if (placeOrderBtn) placeOrderBtn.addEventListener('click', async function () {
      errorEl.classList.add('hidden');
      const addressOption = qs('input[name="address_id"]:checked');
      if (!addressOption) {
        errorEl.textContent = 'Please select or add a delivery address.';
        errorEl.classList.remove('hidden');
        return;
      }
      const paymentMethod = qs('input[name="payment_method"]:checked').value;
      const specialInstructions = (qs('#eats-order-special-instructions') || {}).value || '';

      placeOrderBtn.disabled = true;
      const res = await api('/api/eats/checkout', {
        method: 'POST',
        body: JSON.stringify({
          address_id: Number(addressOption.value),
          payment_method: paymentMethod,
          special_instructions: specialInstructions
        })
      });
      placeOrderBtn.disabled = false;

      if (!res.ok || !res.data || !res.data.success) {
        errorEl.textContent = (res.data && res.data.error) || 'Could not place your order. Please try again.';
        errorEl.classList.remove('hidden');
        return;
      }
      if (res.data.authorization_url) {
        window.location.href = res.data.authorization_url;
        return;
      }
      if (res.data.error === 'insufficient_wallet_balance') {
        errorEl.textContent = 'Insufficient wallet balance — please top up or pay by card.';
        errorEl.classList.remove('hidden');
        return;
      }
      window.location.href = '/eats/orders/' + res.data.orderNumber;
    });
  })();

  // ---------- Order detail page: persisted fulfillment refresh ----------
  (function initFulfillmentPanel() {
    const panel = qs('#eats-fulfillment-panel');
    if (!panel) return;
    const orderNumber = panel.getAttribute('data-order-number');
    const statusEl = qs('#eats-fulfillment-status', panel);
    const detailsEl = qs('#eats-fulfillment-details', panel);
    async function refresh() {
      const res = await api('/api/eats/orders/' + encodeURIComponent(orderNumber) + '/fulfillment');
      if (res.status === 404) { statusEl.textContent = 'Fulfillment has not been dispatched yet. Restaurant preparation and courier assignment remain separate persisted steps.'; detailsEl.classList.add('hidden'); return; }
      if (!res.ok) { statusEl.textContent = (res.data && res.data.error) || 'Fulfillment status unavailable.'; return; }
      const f = res.data;
      statusEl.textContent = 'Fulfillment: ' + (f.dispatch_status || 'dispatch_requested').replaceAll('_', ' ');
      detailsEl.innerHTML = '<div>Shipment: ' + (f.shipment_status || 'not created') + '</div><div>Pickup job: ' + (f.pickup_job_status || 'unassigned') + '</div><div>Delivery job: ' + (f.delivery_job_status || 'unassigned') + '</div>';
      detailsEl.classList.remove('hidden');
    }
    qs('#eats-fulfillment-refresh', panel)?.addEventListener('click', refresh);
    refresh();
  })();

  // ---------- Order detail page: cancel action ----------
  (function initOrderDetailPage() {
    const page = qs('#eats-order-detail-page');
    if (!page) return;
    const cancelBtn = qs('#eats-order-cancel-btn');
    if (!cancelBtn) return;
    cancelBtn.addEventListener('click', async function () {
      if (!confirm('Cancel this order?')) return;
      const errorEl = qs('#eats-order-action-error');
      const res = await api('/api/eats/orders/' + window.location.pathname.split('/').pop() + '/cancel', { method: 'POST', body: JSON.stringify({}) });
      if (!res.ok) {
        errorEl.textContent = (res.data && res.data.error) || 'Could not cancel this order.';
        errorEl.classList.remove('hidden');
        return;
      }
      window.location.reload();
    });
  })();
})();

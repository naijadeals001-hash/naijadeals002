// Seller Center — Marketplace Engine 2.0 client-side wiring for the real
// (non-fake) product/listing/inventory/order pages. Every call below hits
// /api/seller/* which resolves the acting vendor SERVER-SIDE from the
// session — this file never sends a vendor_id.
(function () {
  'use strict';
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  async function api(path, options) {
    const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options));
    let data = null;
    try { data = await res.json(); } catch (e) {}
    return { ok: res.ok, status: res.status, data };
  }

  function showErr(el, msg) { if (el) { el.textContent = msg; el.classList.remove('hidden'); } }

  // ---------- Create Product & Listing modal (seller-products.tsx) ----------
  var modal = qs('#create-product-modal');
  var openBtn = qs('#open-create-product');
  var cancelBtn = qs('#cancel-create-product');
  var addTierBtn = qs('#add-tier-row');
  var tiersContainer = qs('#pricing-tiers-rows');
  var form = qs('#create-product-form');
  var errEl = qs('#seller-products-error');

  if (openBtn && modal) openBtn.addEventListener('click', function () { modal.classList.remove('hidden'); });
  if (cancelBtn && modal) cancelBtn.addEventListener('click', function () { modal.classList.add('hidden'); });

  if (addTierBtn && tiersContainer) {
    addTierBtn.addEventListener('click', function () {
      var row = document.createElement('div');
      row.className = 'grid grid-cols-3 gap-2 tier-row';
      row.innerHTML =
        '<input type="number" min="1" placeholder="Min qty" class="tier-min border border-gray-300 rounded px-2 py-1 text-xs">' +
        '<input type="number" min="1" placeholder="Max qty (blank=+)" class="tier-max border border-gray-300 rounded px-2 py-1 text-xs">' +
        '<input type="number" min="1" placeholder="Price/unit (₦)" class="tier-price border border-gray-300 rounded px-2 py-1 text-xs">';
      tiersContainer.appendChild(row);
    });
  }

  if (form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (errEl) errEl.classList.add('hidden');
      var fd = new FormData(form);
      var priceNaira = Number(fd.get('price_naira'));

      var productRes = await api('/api/seller/products', {
        method: 'POST',
        body: JSON.stringify({
          title: fd.get('title'),
          category_id: Number(fd.get('category_id')),
          image_url: fd.get('image_url'),
          description: fd.get('description') || ''
        })
      });
      if (!productRes.ok) { showErr(errEl, (productRes.data && productRes.data.error) || 'Failed to create product'); return; }

      var tiers = qsa('.tier-row').map(function (row) {
        var min = Number(qs('.tier-min', row).value);
        var maxRaw = qs('.tier-max', row).value;
        var priceN = Number(qs('.tier-price', row).value);
        if (!min || !priceN) return null;
        return { min_quantity: min, max_quantity: maxRaw ? Number(maxRaw) : null, unit_price_kobo: Math.round(priceN * 100) };
      }).filter(Boolean);

      var listingRes = await api('/api/seller/listings', {
        method: 'POST',
        body: JSON.stringify({
          product_id: productRes.data.id,
          price_kobo: Math.round(priceNaira * 100),
          stock: Number(fd.get('stock')),
          unit_of_measure: fd.get('unit_of_measure'),
          unit_quantity: Number(fd.get('unit_quantity') || 1),
          is_variable_weight: !!fd.get('is_variable_weight'),
          pricing_tiers: tiers
        })
      });
      if (!listingRes.ok) { showErr(errEl, (listingRes.data && listingRes.data.error) || 'Failed to create listing'); return; }

      window.location.reload();
    });
  }

  // ---------- Orders page: load this seller's items for an order ----------
  qsa('.load-order-items-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var orderId = btn.getAttribute('data-order-id');
      var panel = qs('.order-items-panel[data-order-id="' + orderId + '"]');
      if (!panel) return;
      if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
      var res = await api('/api/seller/orders/' + orderId);
      if (!res.ok) { panel.innerHTML = '<div class="text-xs text-red-600">Failed to load items</div>'; panel.classList.remove('hidden'); return; }
      panel.innerHTML = res.data.items.map(function (it) {
        return '<div class="flex items-center justify-between text-xs">' +
          '<span>' + it.title_snapshot + ' × ' + it.quantity + '</span>' +
          '<span class="font-semibold">' + it.item_status + '</span>' +
          '<div class="flex gap-1">' +
            '<button class="fulfill-btn text-primary font-semibold" data-item-id="' + it.id + '">Mark fulfilled</button>' +
          '</div>' +
        '</div>';
      }).join('');
      qsa('.fulfill-btn', panel).forEach(function (fb) {
        fb.addEventListener('click', async function () {
          await api('/api/seller/orders/items/' + fb.getAttribute('data-item-id'), {
            method: 'PATCH',
            body: JSON.stringify({ action: 'fulfilled' })
          });
          window.location.reload();
        });
      });
      panel.classList.remove('hidden');
    });
  });

  // ---------- Inventory page: manual adjustment ----------
  qsa('.adjust-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var listingId = btn.getAttribute('data-listing-id');
      var row = qs('tr[data-listing-id="' + listingId + '"]');
      var input = qs('.adjust-input', row);
      var delta = Number(input.value);
      if (!delta) return;
      var res = await api('/api/seller/inventory/' + listingId + '/adjust', {
        method: 'POST',
        body: JSON.stringify({ delta: delta, note: 'Manual seller adjustment' })
      });
      var errEl2 = qs('#seller-inventory-error');
      if (!res.ok) { showErr(errEl2, (res.data && res.data.error) || 'Adjustment failed'); return; }
      window.location.reload();
    });
  });
})();

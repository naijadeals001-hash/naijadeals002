// NaijaDeals — shared frontend behaviour (vanilla JS, no build step).
// Every page includes this file via Layout.tsx. Each block below guards on the
// presence of its target element(s), so this single file is safe to load on every page.

(function () {
  'use strict';

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function showError(el, message) {
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
  }
  function hideError(el) {
    if (!el) return;
    el.classList.add('hidden');
  }

  async function api(path, options) {
    const res = await fetch(path, Object.assign({
      headers: { 'Content-Type': 'application/json' }
    }, options));
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    return { ok: res.ok, status: res.status, data };
  }

  function updateCartBadges(count) {
    ['cart-count-badge-desktop', 'cart-count-badge-mobile'].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = String(count);
      el.classList.toggle('hidden', !count);
    });
  }

  // ---------- Wallet balance in header nav ----------
  (function initWalletNav() {
    const el = document.getElementById('wallet-balance-nav');
    if (!el) return;
    api('/api/wallet').then(function (res) {
      if (res.ok && res.data) {
        el.textContent = formatNaira(res.data.balance_kobo);
      } else {
        el.textContent = '₦0'; // not signed in, or no wallet yet
      }
    }).catch(function () { el.textContent = '--'; });
  })();

  function formatNaira(kobo) {
    const naira = kobo / 100;
    return '₦' + naira.toLocaleString('en-NG', { maximumFractionDigits: naira % 1 === 0 ? 0 : 2 });
  }

  // ---------- Cart count on initial load (covers guest + logged-in) ----------
  (function initCartCount() {
    api('/api/cart').then(function (res) {
      if (res.ok && res.data) updateCartBadges(res.data.count);
    }).catch(function () {});
  })();

  // ---------- Newsletter signup (footer) ----------
  (function initNewsletter() {
    const form = document.getElementById('newsletter-form');
    const msg = document.getElementById('newsletter-msg');
    if (!form) return;
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const email = form.querySelector('input[name="email"]').value.trim();
      if (!email) return;
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      const res = await api('/api/catalog/newsletter', { method: 'POST', body: JSON.stringify({ email: email }) });
      if (submitBtn) submitBtn.disabled = false;
      if (res.ok) {
        form.reset();
        if (msg) { msg.textContent = "You're subscribed! Watch your inbox for NaijaDeals updates."; msg.classList.remove('text-white/50'); msg.classList.add('text-primary-fixed', 'font-medium'); }
      } else if (msg) {
        msg.textContent = (res.data && res.data.error) || 'Something went wrong. Please try again.';
      }
    });
  })();

  // ---------- Product Detail Page: quantity stepper + add to cart ----------
  (function initPDP() {
    const qtyInput = document.getElementById('qty-input');
    const qtyMinus = document.getElementById('qty-minus');
    const qtyPlus = document.getElementById('qty-plus');
    if (qtyInput && qtyMinus && qtyPlus) {
      qtyMinus.addEventListener('click', function () {
        const v = Math.max(1, (parseInt(qtyInput.value, 10) || 1) - 1);
        qtyInput.value = String(v);
      });
      qtyPlus.addEventListener('click', function () {
        const max = parseInt(qtyInput.getAttribute('max') || '999', 10);
        const v = Math.min(max, (parseInt(qtyInput.value, 10) || 1) + 1);
        qtyInput.value = String(v);
      });
    }

    const addBtn = document.getElementById('add-to-cart-btn');
    if (addBtn) {
      addBtn.addEventListener('click', async function () {
        const productId = Number(addBtn.getAttribute('data-product-id'));
        const quantity = qtyInput ? parseInt(qtyInput.value, 10) || 1 : 1;
        const originalText = addBtn.innerHTML;
        addBtn.disabled = true;
        addBtn.textContent = 'Adding...';
        const res = await api('/api/cart/items', { method: 'POST', body: JSON.stringify({ product_id: productId, quantity: quantity }) });
        addBtn.disabled = false;
        addBtn.innerHTML = originalText;
        if (res.ok) {
          updateCartBadges(res.data.count);
          addBtn.textContent = 'Added ✓';
          setTimeout(function () { addBtn.innerHTML = originalText; }, 1500);
        } else {
          alert((res.data && res.data.error) || 'Could not add to cart. Please try again.');
        }
      });
    }
  })();

  // ---------- Product carousels: desktop prev/next buttons scroll the track ----------
  (function initCarouselNav() {
    qsa('.carousel-nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const track = document.getElementById(btn.getAttribute('data-target'));
        if (!track) return;
        const dir = Number(btn.getAttribute('data-dir'));
        const card = track.querySelector(':scope > a');
        const step = card ? card.getBoundingClientRect().width + 16 : 300;
        track.scrollBy({ left: dir * step * 2, behavior: 'smooth' });
      });
    });
  })();

  // ---------- Recently Viewed: track visited PDPs in localStorage + hydrate homepage section ----------
  (function trackRecentlyViewed() {
    var pid = document.body.getAttribute('data-product-id');
    if (!pid) return;
    try {
      var KEY = 'nd_recently_viewed';
      var ids = JSON.parse(localStorage.getItem(KEY) || '[]').filter(function (id) { return id !== Number(pid); });
      ids.unshift(Number(pid));
      localStorage.setItem(KEY, JSON.stringify(ids.slice(0, 20)));
    } catch (e) { /* localStorage unavailable — skip silently */ }
  })();

  (function hydrateRecentlyViewed() {
    var section = document.getElementById('recently-viewed-section');
    if (!section) return;
    var currentPid = Number(document.body.getAttribute('data-product-id') || '0');
    try {
      var ids = JSON.parse(localStorage.getItem('nd_recently_viewed') || '[]').filter(function (id) { return id !== currentPid; });
      if (ids.length === 0) { section.remove(); return; }
      api('/api/catalog/products/by-ids?ids=' + ids.slice(0, 12).join(',')).then(function (res) {
        if (!res.ok || !res.data || !res.data.products || res.data.products.length === 0) { section.remove(); return; }
        var track = section.querySelector('.rv-track');
        if (!track) { section.remove(); return; }
        track.innerHTML = res.data.products.map(function (p) {
          var discountBadge = (p.compare_at_price_kobo && p.compare_at_price_kobo > p.price_kobo)
            ? '<span class="absolute top-2 left-2 bg-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded">-' + Math.round((p.compare_at_price_kobo - p.price_kobo) / p.compare_at_price_kobo * 100) + '%</span>'
            : '';
          var compareHtml = p.compare_at_price_kobo ? '<span class="text-xs text-gray-400 line-through">' + formatNaira(p.compare_at_price_kobo) + '</span>' : '';
          return '<a href="/shop/' + p.slug + '" class="group flex flex-col bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-md transition-shadow w-[42vw] sm:w-44 md:w-52 lg:w-56 shrink-0 snap-start">' +
            '<div class="relative aspect-square bg-gray-100 overflow-hidden"><img src="' + p.image_url + '" alt="' + p.title.replace(/"/g, '&quot;') + '" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">' + discountBadge + '</div>' +
            '<div class="p-3 flex flex-col gap-1 flex-1"><h3 class="text-sm text-gray-800 line-clamp-2 min-h-[2.5rem]">' + p.title + '</h3>' +
            '<div class="flex items-baseline gap-2 mt-1"><span class="text-base font-bold text-gray-900">' + formatNaira(p.price_kobo) + '</span>' + compareHtml + '</div></div></a>';
        }).join('');
        section.classList.remove('hidden');
      }).catch(function () { section.remove(); });
    } catch (e) { section.remove(); }
  })();

  // ---------- City selector: persist choice to a cookie, then reload so the server can re-render "Deals Near You" ----------
  (function initCitySelector() {
    qsa('#city-selector').forEach(function (sel) {
      sel.addEventListener('change', function () {
        document.cookie = 'nd_city=' + encodeURIComponent(sel.value) + ';path=/;max-age=' + (60 * 60 * 24 * 365);
        location.reload();
      });
    });
  })();

  // ---------- Home page: flash deal countdown (visual only, resets each load) ----------
  (function initFlashTimer() {
    const el = document.getElementById('flash-timer-value');
    if (!el) return;
    let seconds = 3 * 60 * 60 - 5; // ~03:00:00, matches the server-rendered starting value
    function tick() {
      if (seconds <= 0) { seconds = 3 * 60 * 60; }
      const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
      const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
      const s = String(seconds % 60).padStart(2, '0');
      el.textContent = h + ':' + m + ':' + s;
      seconds--;
    }
    tick();
    setInterval(tick, 1000);
  })();

  // ---------- Cart page: quantity +/-, remove ----------
  (function initCartPage() {
    const list = document.getElementById('cart-items-list');
    if (!list) return;

    function rowEl(productId) {
      return list.querySelector('[data-cart-item][data-product-id="' + productId + '"]');
    }

    async function applyCartResponse(data) {
      updateCartBadges(data.count);
      const countEl = document.getElementById('cart-summary-count');
      const subtotalEl = document.getElementById('cart-summary-subtotal');
      if (countEl) countEl.textContent = String(data.count);
      if (subtotalEl) subtotalEl.textContent = formatNaira(data.subtotal_kobo);
    }

    async function changeQuantity(productId, newQty) {
      const res = await api('/api/cart/items/' + productId, { method: 'PUT', body: JSON.stringify({ quantity: newQty }) });
      if (!res.ok) { alert((res.data && res.data.error) || 'Could not update cart.'); return; }
      if (newQty <= 0) {
        const row = rowEl(productId);
        if (row) row.remove();
      } else {
        const row = rowEl(productId);
        if (row) {
          const valueEl = row.querySelector('.cart-qty-value');
          if (valueEl) valueEl.textContent = String(newQty);
          const item = res.data.items.find(function (i) { return i.product_id === productId; });
          const lineTotalEl = row.querySelector('.line-total');
          if (lineTotalEl && item) lineTotalEl.textContent = formatNaira(item.price_kobo * item.quantity);
        }
      }
      applyCartResponse(res.data);
      if (res.data.items.length === 0) location.reload();
    }

    list.addEventListener('click', function (e) {
      const minusBtn = e.target.closest('.cart-qty-minus');
      const plusBtn = e.target.closest('.cart-qty-plus');
      const removeBtn = e.target.closest('.cart-remove-btn');

      if (minusBtn) {
        const productId = Number(minusBtn.getAttribute('data-product-id'));
        const row = rowEl(productId);
        const current = parseInt(row.querySelector('.cart-qty-value').textContent, 10);
        changeQuantity(productId, current - 1);
      } else if (plusBtn) {
        const productId = Number(plusBtn.getAttribute('data-product-id'));
        const row = rowEl(productId);
        const current = parseInt(row.querySelector('.cart-qty-value').textContent, 10);
        changeQuantity(productId, current + 1);
      } else if (removeBtn) {
        const productId = Number(removeBtn.getAttribute('data-product-id'));
        changeQuantity(productId, 0);
      }
    });
  })();

  // ---------- Login / Register ----------
  (function initAuthForms() {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const errorEl = document.getElementById('auth-error');

    if (loginForm) {
      loginForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        hideError(errorEl);
        const fd = new FormData(loginForm);
        const btn = loginForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        const res = await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ identifier: fd.get('identifier'), password: fd.get('password') })
        });
        btn.disabled = false;
        if (res.ok) {
          location.href = fd.get('next') || '/';
        } else {
          showError(errorEl, (res.data && res.data.error) || 'Sign in failed. Please try again.');
        }
      });
    }

    if (registerForm) {
      registerForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        hideError(errorEl);
        const fd = new FormData(registerForm);
        const btn = registerForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        const res = await api('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            name: fd.get('name'),
            email: fd.get('email') || undefined,
            phone: fd.get('phone') || undefined,
            password: fd.get('password')
          })
        });
        btn.disabled = false;
        if (res.ok) {
          location.href = fd.get('next') || '/';
        } else {
          showError(errorEl, (res.data && res.data.error) || 'Could not create account. Please try again.');
        }
      });
    }
  })();

  // ---------- Checkout ----------
  (function initCheckout() {
    const form = document.getElementById('checkout-form');
    if (!form) return;
    const errorEl = document.getElementById('checkout-error');

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      hideError(errorEl);
      const fd = new FormData(form);
      const btn = document.getElementById('place-order-btn');
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Placing order...';

      const res = await api('/api/orders/checkout', {
        method: 'POST',
        body: JSON.stringify({
          name: fd.get('name'),
          phone: fd.get('phone'),
          address: fd.get('address'),
          city: fd.get('city'),
          state: fd.get('state'),
          payment_method: fd.get('payment_method')
        })
      });

      btn.disabled = false;
      btn.textContent = originalText;

      if (!res.ok) {
        showError(errorEl, (res.data && res.data.error) || 'Checkout failed. Please try again.');
        return;
      }

      if (res.data.authorization_url) {
        // Paystack flow — hand off to their checkout page.
        location.href = res.data.authorization_url;
        return;
      }

      if (res.data.paid) {
        location.href = '/orders/' + res.data.orderNumber;
        return;
      }

      if (res.data.error === 'insufficient_wallet_balance') {
        showError(errorEl, 'Insufficient wallet balance. Please top up your wallet or choose card/bank transfer.');
        return;
      }

      // Fallback
      location.href = '/orders/' + res.data.orderNumber;
    });
  })();

  // ---------- Checkout callback (return from Paystack after order payment) ----------
  (function initCheckoutCallback() {
    const el = document.getElementById('checkout-callback-status');
    if (!el) return;
    const params = new URLSearchParams(location.search);
    const reference = params.get('reference') || params.get('trxref');
    const orderNumber = params.get('order');

    if (!reference) {
      el.textContent = 'Missing payment reference.';
      return;
    }

    api('/api/orders/verify-payment', { method: 'POST', body: JSON.stringify({ reference: reference }) })
      .then(function (res) {
        if (res.ok && res.data.success) {
          location.href = '/orders/' + orderNumber;
        } else {
          el.textContent = 'We could not confirm your payment yet. If you were charged, it will reflect shortly — check your Orders page.';
        }
      })
      .catch(function () {
        el.textContent = 'Something went wrong verifying your payment. Please check your Orders page.';
      });
  })();

  // ---------- Wallet page: top-up + return-from-Paystack verification ----------
  (function initWalletPage() {
    const topupBtn = document.getElementById('topup-btn');
    if (!topupBtn) return;

    const errorEl = document.getElementById('topup-error');
    const customInput = document.getElementById('topup-custom-amount');
    let selectedAmountKobo = null;

    qsa('.topup-quick-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectedAmountKobo = Number(btn.getAttribute('data-amount-kobo'));
        if (customInput) customInput.value = '';
        qsa('.topup-quick-btn').forEach(function (b) { b.classList.remove('border-primary', 'bg-primary-light'); });
        btn.classList.add('border-primary', 'bg-primary-light');
      });
    });

    async function startTopup() {
      hideError(errorEl);
      let amountKobo = selectedAmountKobo;
      if (customInput && customInput.value) {
        amountKobo = Math.round(parseFloat(customInput.value) * 100);
      }
      if (!amountKobo || amountKobo < 10000) {
        showError(errorEl, 'Please select or enter an amount of at least ₦100.');
        return;
      }
      topupBtn.disabled = true;
      const res = await api('/api/wallet/topup/initialize', { method: 'POST', body: JSON.stringify({ amount_kobo: amountKobo }) });
      topupBtn.disabled = false;
      if (res.ok && res.data.authorization_url) {
        location.href = res.data.authorization_url;
      } else {
        showError(errorEl, (res.data && res.data.error) || 'Could not start top-up. Please try again.');
      }
    }
    topupBtn.addEventListener('click', startTopup);

    // Returning from Paystack after a wallet top-up
    const params = new URLSearchParams(location.search);
    const topupRef = params.get('topup_ref');
    if (topupRef) {
      api('/api/wallet/topup/verify', { method: 'POST', body: JSON.stringify({ reference: topupRef }) })
        .then(function (res) {
          if (res.ok && res.data.success) {
            location.href = '/wallet'; // strip query params, reload balance server-side
          }
        });
    }
  })();
})();

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

  // ---------- Wishlist: nav badge count + sitewide toggle button on every ProductCard ----------
  // wishlistIds mirrors the logged-in user's current wishlist product_ids. Populated once on load
  // (guests / logged-out get an empty set — /api/wishlist/ids requires auth and returns 401, which
  // we treat the same as "no wishlist yet" for badge/button purposes, no error surfaced to the user).
  var wishlistIds = null;

  function updateWishlistBadge(count) {
    var el = document.getElementById('wishlist-count-badge');
    if (!el) return;
    el.textContent = String(count);
    el.classList.toggle('hidden', !count);
  }

  function markWishlistButtons() {
    if (!wishlistIds) return;
    qsa('.wishlist-toggle-btn').forEach(function (btn) {
      var pid = Number(btn.getAttribute('data-product-id'));
      var active = wishlistIds.has(pid);
      btn.setAttribute('data-active', active ? '1' : '0');
      btn.classList.toggle('text-red-500', active);
      var icon = btn.querySelector('.material-symbols-outlined');
      if (icon) icon.style.fontVariationSettings = "'FILL' " + (active ? 1 : 0);
    });
  }

  (function initWishlistNav() {
    api('/api/wishlist/ids').then(function (res) {
      wishlistIds = new Set((res.ok && res.data && res.data.product_ids) || []);
      updateWishlistBadge(wishlistIds.size);
      markWishlistButtons();
    }).catch(function () { wishlistIds = new Set(); });
  })();

  // Delegated at document level so it covers every ProductCard on every page (home carousels,
  // shop grid, PDP related-products row) without needing per-page wiring. The button itself
  // already carries onclick="event.preventDefault()" to stop the surrounding <a> navigating to
  // the PDP; we additionally stop propagation so nothing else on the card reacts to this click.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.wishlist-toggle-btn');
    if (!btn || btn.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    if (!wishlistIds) return; // initial fetch hasn't resolved yet — ignore this click rather than guess state

    var pid = Number(btn.getAttribute('data-product-id'));
    var wasActive = wishlistIds.has(pid);
    btn.disabled = true;
    var req = wasActive
      ? api('/api/wishlist/' + pid, { method: 'DELETE' })
      : api('/api/wishlist', { method: 'POST', body: JSON.stringify({ product_id: pid }) });
    req.then(function (res) {
      btn.disabled = false;
      if (res.status === 401) { location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search); return; }
      if (!res.ok) { alert((res.data && res.data.error) || 'Could not update your wishlist.'); return; }
      if (wasActive) wishlistIds.delete(pid); else wishlistIds.add(pid);
      updateWishlistBadge(wishlistIds.size);
      markWishlistButtons();
    }).catch(function () { btn.disabled = false; });
  });

  // ---------- Dedicated Wishlist page (/account/wishlist): remove + move-to-cart ----------
  (function initWishlistPage() {
    const grid = document.getElementById('wishlist-grid');
    if (!grid) return;

    grid.addEventListener('click', function (e) {
      const removeBtn = e.target.closest('.wishlist-remove-btn');
      const moveBtn = e.target.closest('.wishlist-move-to-cart-btn');

      if (removeBtn) {
        e.preventDefault();
        const pid = Number(removeBtn.getAttribute('data-product-id'));
        removeBtn.disabled = true;
        api('/api/wishlist/' + pid, { method: 'DELETE' }).then(function (res) {
          if (!res.ok) { removeBtn.disabled = false; alert((res.data && res.data.error) || 'Could not remove item.'); return; }
          location.reload(); // simplest correct way to re-render the grid + empty state + nav badge
        });
      } else if (moveBtn) {
        e.preventDefault();
        const pid = Number(moveBtn.getAttribute('data-product-id'));
        moveBtn.disabled = true;
        api('/api/wishlist/' + pid + '/move-to-cart', { method: 'POST' }).then(function (res) {
          moveBtn.disabled = false;
          if (!res.ok) { alert((res.data && res.data.error) || 'Could not move item to cart.'); return; }
          location.reload(); // re-syncs wishlist grid, wishlist badge AND cart badge from fresh server state
        });
      }
    });
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

  // ---------- Product Detail Page: quantity stepper, variant selection, add to cart ----------
  // BUY-BOX RULE: every add-to-cart call on this page (main buy box AND each Compare Sellers row)
  // must send listing_id, never product_id — a product can have several sellers/listings, and the
  // customer must get exactly the seller/price/stock they selected, never a different seller's offer.
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

    // Track the currently-selected variant (if this listing has variants). Starts as whichever
    // variant-option button is rendered active (server marks the first one), null if no variants.
    let selectedVariantId = null;
    const activeVariantBtn = qs('.variant-option.border-primary');
    if (activeVariantBtn) selectedVariantId = Number(activeVariantBtn.getAttribute('data-variant-id'));

    qsa('.variant-option').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectedVariantId = Number(btn.getAttribute('data-variant-id'));
        qsa('.variant-option').forEach(function (b) {
          b.classList.remove('border-primary', 'bg-primary-light', 'text-primary-dark', 'font-semibold');
          b.classList.add('border-gray-300', 'text-gray-600');
        });
        btn.classList.remove('border-gray-300', 'text-gray-600');
        btn.classList.add('border-primary', 'bg-primary-light', 'text-primary-dark', 'font-semibold');
      });
    });

    async function addListingToCart(btn, listingId, quantity, variantId) {
      const originalHTML = btn.innerHTML;
      btn.disabled = true;
      btn.textContent = 'Adding...';
      const res = await api('/api/cart/items', {
        method: 'POST',
        body: JSON.stringify({ listing_id: listingId, quantity: quantity, variant_id: variantId || undefined })
      });
      btn.disabled = false;
      if (res.ok) {
        updateCartBadges(res.data.count);
        btn.innerHTML = originalHTML;
        btn.textContent = 'Added ✓';
        setTimeout(function () { btn.innerHTML = originalHTML; }, 1500);
      } else {
        btn.innerHTML = originalHTML;
        alert((res.data && res.data.error) || 'Could not add to cart. Please try again.');
      }
    }

    // Main buy-box "Add to cart" button
    const addBtn = document.getElementById('add-to-cart-btn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        const listingId = Number(addBtn.getAttribute('data-listing-id'));
        const quantity = qtyInput ? parseInt(qtyInput.value, 10) || 1 : 1;
        addListingToCart(addBtn, listingId, quantity, selectedVariantId);
      });
    }

    // Compare Sellers table: each row has its own listing_id — adds THAT seller's offer specifically,
    // completely independent of whichever listing is shown in the main buy box above.
    qsa('.add-listing-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const listingId = Number(btn.getAttribute('data-listing-id'));
        addListingToCart(btn, listingId, 1, null);
      });
    });
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

  // ---------- Cart page: quantity +/-, remove, save-for-later, move-to-cart ----------
  // BUY-BOX RULE: every row is keyed by cart_items.id (data-cart-item-id), never by product_id —
  // two rows can legitimately share the same product_id (same product, two different sellers), so
  // product_id would be ambiguous as a row key here.
  (function initCartPage() {
    const list = document.getElementById('cart-items-list');
    const savedList = document.getElementById('saved-items-list');
    if (!list && !savedList) return;

    function cartRowEl(cartItemId) {
      return document.querySelector('[data-cart-item][data-cart-item-id="' + cartItemId + '"]');
    }
    function savedRowEl(cartItemId) {
      return document.querySelector('[data-saved-item][data-cart-item-id="' + cartItemId + '"]');
    }

    function applyCartSummary(data) {
      updateCartBadges(data.count);
      const countEl = document.getElementById('cart-summary-count');
      const subtotalEl = document.getElementById('cart-summary-subtotal');
      if (countEl) countEl.textContent = String(data.count);
      if (subtotalEl) subtotalEl.textContent = formatNaira(data.subtotal_kobo);
    }

    async function changeQuantity(cartItemId, newQty) {
      const res = await api('/api/cart/items/' + cartItemId, { method: 'PUT', body: JSON.stringify({ quantity: newQty }) });
      if (!res.ok) { alert((res.data && res.data.error) || 'Could not update cart.'); return; }
      if (newQty <= 0) {
        location.reload(); // seller-group headers may need to disappear if this was the last item from that seller
        return;
      }
      const row = cartRowEl(cartItemId);
      if (row) {
        const valueEl = row.querySelector('.cart-qty-value');
        if (valueEl) valueEl.textContent = String(newQty);
        const item = res.data.items.find(function (i) { return i.id === cartItemId; });
        const lineTotalEl = row.querySelector('.line-total');
        if (lineTotalEl && item) lineTotalEl.textContent = formatNaira(item.price_kobo * item.quantity);
      }
      applyCartSummary(res.data);
    }

    async function removeItem(cartItemId) {
      const res = await api('/api/cart/items/' + cartItemId, { method: 'DELETE' });
      if (!res.ok) { alert((res.data && res.data.error) || 'Could not remove item.'); return; }
      location.reload(); // simplest correct way to re-render seller grouping after a removal
    }

    async function saveForLater(cartItemId) {
      const res = await api('/api/cart/items/' + cartItemId + '/save-for-later', { method: 'POST' });
      if (!res.ok) { alert((res.data && res.data.error) || 'Could not save item for later.'); return; }
      location.reload();
    }

    async function moveToCart(cartItemId) {
      const res = await api('/api/cart/items/' + cartItemId + '/move-to-cart', { method: 'POST' });
      if (!res.ok) { alert((res.data && res.data.error) || 'Could not move item to cart.'); return; }
      location.reload();
    }

    async function removeSaved(cartItemId) {
      const res = await api('/api/cart/items/' + cartItemId + '/saved', { method: 'DELETE' });
      if (!res.ok) { alert((res.data && res.data.error) || 'Could not remove item.'); return; }
      const row = savedRowEl(cartItemId);
      if (row) row.remove();
    }

    if (list) {
      list.addEventListener('click', function (e) {
        const minusBtn = e.target.closest('.cart-qty-minus');
        const plusBtn = e.target.closest('.cart-qty-plus');
        const removeBtn = e.target.closest('.cart-remove-btn');
        const saveBtn = e.target.closest('.cart-save-later-btn');

        if (minusBtn) {
          const cartItemId = Number(minusBtn.getAttribute('data-cart-item-id'));
          const row = cartRowEl(cartItemId);
          const current = parseInt(row.querySelector('.cart-qty-value').textContent, 10);
          changeQuantity(cartItemId, current - 1);
        } else if (plusBtn) {
          const cartItemId = Number(plusBtn.getAttribute('data-cart-item-id'));
          const row = cartRowEl(cartItemId);
          const current = parseInt(row.querySelector('.cart-qty-value').textContent, 10);
          changeQuantity(cartItemId, current + 1);
        } else if (removeBtn) {
          removeItem(Number(removeBtn.getAttribute('data-cart-item-id')));
        } else if (saveBtn) {
          saveForLater(Number(saveBtn.getAttribute('data-cart-item-id')));
        }
      });
    }

    if (savedList) {
      savedList.addEventListener('click', function (e) {
        const moveBtn = e.target.closest('.saved-move-to-cart-btn');
        const removeBtn = e.target.closest('.saved-remove-btn');
        if (moveBtn) {
          moveToCart(Number(moveBtn.getAttribute('data-cart-item-id')));
        } else if (removeBtn) {
          removeSaved(Number(removeBtn.getAttribute('data-cart-item-id')));
        }
      });
    }
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

  // ---------- Checkout: real multi-step UI (address -> delivery -> review/coupon -> payment) ----------
  (function initCheckout() {
    const stepper = document.getElementById('checkout-stepper');
    const initDataEl = document.getElementById('checkout-init-data');
    if (!stepper || !initDataEl) return;

    const initData = JSON.parse(initDataEl.textContent || '{}');
    const errorEl = document.getElementById('checkout-error');
    let currentStep = 1;
    let appliedCouponCode = null;
    let deliveryMethod = 'standard';

    // ---------- Step navigation ----------
    function goToStep(n) {
      currentStep = n;
      qsa('.checkout-step').forEach(function (sec) {
        sec.classList.toggle('hidden', Number(sec.getAttribute('data-step')) !== n);
      });
      qsa('.checkout-step-tab').forEach(function (tab) {
        const tabStep = Number(tab.getAttribute('data-step-tab'));
        if (tabStep === n) {
          tab.classList.add('bg-primary', 'text-white', 'border-primary');
          tab.classList.remove('border-gray-200', 'text-gray-500');
        } else {
          tab.classList.remove('bg-primary', 'text-white', 'border-primary');
          tab.classList.add('border-gray-200', 'text-gray-500');
        }
      });
      window.scrollTo({ top: stepper.getBoundingClientRect().top + window.scrollY - 90, behavior: 'smooth' });
    }

    qsa('.checkout-next-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { goToStep(Number(btn.getAttribute('data-next-step'))); });
    });
    qsa('.checkout-back-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { goToStep(Number(btn.getAttribute('data-back-step'))); });
    });
    qsa('.checkout-step-tab').forEach(function (tab) {
      tab.addEventListener('click', function () { goToStep(Number(tab.getAttribute('data-step-tab'))); });
    });

    // ---------- New address form (address book) ----------
    const showNewAddrBtn = document.getElementById('show-new-address-btn');
    const newAddrForm = document.getElementById('new-address-form');
    const cancelNewAddrBtn = document.getElementById('cancel-new-address-btn');
    const saveNewAddrBtn = document.getElementById('save-new-address-btn');
    const newAddrError = document.getElementById('new-address-error');

    if (showNewAddrBtn && newAddrForm) {
      showNewAddrBtn.addEventListener('click', function () { newAddrForm.classList.remove('hidden'); });
    }
    if (cancelNewAddrBtn && newAddrForm) {
      cancelNewAddrBtn.addEventListener('click', function () { newAddrForm.classList.add('hidden'); });
    }
    if (saveNewAddrBtn) {
      saveNewAddrBtn.addEventListener('click', async function () {
        hideError(newAddrError);
        const payload = {
          label: (document.getElementById('na-label') || {}).value || '',
          recipient_name: (document.getElementById('na-recipient') || {}).value || '',
          phone: (document.getElementById('na-phone') || {}).value || '',
          line1: (document.getElementById('na-line1') || {}).value || '',
          city: (document.getElementById('na-city') || {}).value || '',
          state: (document.getElementById('na-state') || {}).value || ''
        };
        if (!payload.label || !payload.recipient_name || !payload.phone || !payload.line1 || !payload.city || !payload.state) {
          showError(newAddrError, 'Please fill in every field.');
          return;
        }
        saveNewAddrBtn.disabled = true;
        const res = await api('/api/addresses', { method: 'POST', body: JSON.stringify(payload) });
        saveNewAddrBtn.disabled = false;
        if (!res.ok) { showError(newAddrError, (res.data && res.data.error) || 'Could not save address.'); return; }
        location.reload(); // simplest correct way to re-render the address list with the new entry selected
      });
    }

    // ---------- Live summary recalculation (delivery method + coupon) via /api/cart/preview ----------
    const summarySubtotalEl = document.getElementById('summary-subtotal');
    const summaryDeliveryFeeEl = document.getElementById('summary-delivery-fee');
    const summarySellerCountEl = document.getElementById('summary-seller-count');
    const summaryDiscountRow = document.getElementById('summary-discount-row');
    const summaryDiscountEl = document.getElementById('summary-discount');
    const summaryTotalEl = document.getElementById('summary-total');
    const placeOrderTotalEl = document.getElementById('place-order-total');
    const walletRadio = document.getElementById('payment-wallet-radio');
    const paystackRadio = document.getElementById('payment-paystack-radio');
    const walletBalanceNote = document.getElementById('wallet-balance-note');
    const couponFeedback = document.getElementById('coupon-feedback');

    async function refreshSummary() {
      const body = { delivery_method: deliveryMethod };
      if (appliedCouponCode) body.coupon_code = appliedCouponCode;
      if (initData.isBuyNow && initData.buyNow) body.buy_now = initData.buyNow;

      const res = await api('/api/cart/preview', { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) return;
      const d = res.data;

      if (summarySubtotalEl) summarySubtotalEl.textContent = formatNaira(d.subtotal_kobo);
      if (summaryDeliveryFeeEl) summaryDeliveryFeeEl.textContent = formatNaira(d.delivery_fee_kobo);
      if (summarySellerCountEl) summarySellerCountEl.textContent = String(d.seller_count);
      if (summaryTotalEl) summaryTotalEl.textContent = formatNaira(d.total_kobo);
      if (placeOrderTotalEl) placeOrderTotalEl.textContent = formatNaira(d.total_kobo);

      if (d.discount_kobo > 0) {
        if (summaryDiscountRow) summaryDiscountRow.classList.remove('hidden');
        if (summaryDiscountEl) summaryDiscountEl.textContent = '-' + formatNaira(d.discount_kobo);
      } else if (summaryDiscountRow) {
        summaryDiscountRow.classList.add('hidden');
      }

      // Wallet affordability re-check now that delivery/coupon changed the total
      const canPayWallet = initData.walletBalanceKobo >= d.total_kobo;
      if (walletRadio) {
        walletRadio.disabled = !canPayWallet;
        if (!canPayWallet && walletRadio.checked && paystackRadio) paystackRadio.checked = true;
      }
      if (walletBalanceNote) {
        walletBalanceNote.textContent = 'Balance: ' + formatNaira(initData.walletBalanceKobo) + (canPayWallet ? '' : ' — insufficient, top up or pay by card');
      }
    }

    qsa('input[name="delivery_method"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (radio.checked) { deliveryMethod = radio.value; refreshSummary(); }
      });
    });

    // ---------- Coupon apply ----------
    const applyCouponBtn = document.getElementById('apply-coupon-btn');
    const couponInput = document.getElementById('coupon-input');
    if (applyCouponBtn && couponInput) {
      applyCouponBtn.addEventListener('click', async function () {
        const code = couponInput.value.trim();
        if (!code) return;
        applyCouponBtn.disabled = true;
        const body = { delivery_method: deliveryMethod, coupon_code: code };
        if (initData.isBuyNow && initData.buyNow) body.buy_now = initData.buyNow;
        const res = await api('/api/cart/preview', { method: 'POST', body: JSON.stringify(body) });
        applyCouponBtn.disabled = false;
        if (res.ok && res.data.coupon_valid) {
          appliedCouponCode = code;
          if (couponFeedback) { couponFeedback.textContent = 'Coupon applied — you saved ' + formatNaira(res.data.discount_kobo) + '!'; couponFeedback.className = 'text-xs mt-1.5 text-primary font-medium'; }
        } else {
          appliedCouponCode = null;
          if (couponFeedback) { couponFeedback.textContent = (res.data && res.data.coupon_error) || 'Invalid coupon code.'; couponFeedback.className = 'text-xs mt-1.5 text-red-600 font-medium'; }
        }
        refreshSummary();
      });
    }

    // ---------- Place order ----------
    const placeOrderBtn = document.getElementById('place-order-btn');
    if (placeOrderBtn) {
      placeOrderBtn.addEventListener('click', async function () {
        hideError(errorEl);
        const addressRadio = document.querySelector('input[name="address_id"]:checked');
        if (!addressRadio) {
          showError(errorEl, 'Please select a delivery address.');
          goToStep(1);
          return;
        }
        const paymentRadio = document.querySelector('input[name="payment_method"]:checked');
        const originalText = placeOrderBtn.textContent;
        placeOrderBtn.disabled = true;
        placeOrderBtn.textContent = 'Placing order...';

        const payload = {
          address_id: Number(addressRadio.value),
          delivery_method: deliveryMethod,
          payment_method: paymentRadio ? paymentRadio.value : 'wallet'
        };
        if (appliedCouponCode) payload.coupon_code = appliedCouponCode;
        if (initData.isBuyNow && initData.buyNow) payload.buy_now = initData.buyNow;

        const res = await api('/api/orders/checkout', { method: 'POST', body: JSON.stringify(payload) });

        placeOrderBtn.disabled = false;
        placeOrderBtn.textContent = originalText;

        if (!res.ok) {
          showError(errorEl, (res.data && res.data.error) || 'Checkout failed. Please try again.');
          return;
        }

        if (res.data.authorization_url) {
          // Paystack flow — hand off to their hosted checkout page.
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
    }
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

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

  // ---------- Mobile nav drawer (hamburger menu) ----------
  // Root cause of the ORIGINAL bug: the button/drawer markup existed but NO
  // event handler was ever attached anywhere in this file. This block is that
  // handler — a single source of truth for open/close state, driven purely by
  // toggling classes on the drawer/backdrop elements (no framework, no hidden
  // duplicate instances, since getElementById only ever finds the one drawer
  // Layout.tsx renders).
  //
  // A SECOND, subtler bug surfaced during real click-testing: #site-header and
  // the drawer/backdrop are all `fixed`/`sticky` at `top:0`, so they spatially
  // overlap in the same top band. Whichever one has the higher z-index there
  // "wins" ALL clicks in that band — including clicks meant for the OTHER
  // element. There is no z-index value that lets both #mobile-menu-btn (inside
  // the header) AND #mobile-nav-close-btn (inside the drawer's own top strip)
  // be independently clickable while they occupy the same pixels; one always
  // shadows the other. The fix is spatial, not z-order: the drawer/backdrop
  // are shifted to start BELOW the header's actual rendered height (measured
  // at runtime via getBoundingClientRect — the mobile header is a variable-
  // height 3-row stack, not a fixed constant), so they never occupy the same
  // pixels as the header in the first place. z-index is still kept sane
  // (header > drawer > backdrop > the sticky bottom nav bar) purely as a
  // defensive fallback, not as the primary fix.
  (function initMobileNavDrawer() {
    const openBtn = document.getElementById('mobile-menu-btn');
    const closeBtn = document.getElementById('mobile-nav-close-btn');
    const drawer = document.getElementById('mobile-nav-drawer');
    const backdrop = document.getElementById('mobile-nav-backdrop');
    const header = document.getElementById('site-header');
    if (!openBtn || !drawer || !backdrop) return; // guard: page doesn't render Layout's mobile header

    let isOpen = false;

    // Positions drawer/backdrop to start exactly below the header's current
    // rendered height, so they never spatially overlap it. Re-run on resize/
    // orientation change (header height can change) and right before opening
    // (covers any late reflow, e.g. web font swap, that happened after load).
    function syncHeaderOffset() {
      const h = header ? Math.ceil(header.getBoundingClientRect().height) : 0;
      drawer.style.top = h + 'px';
      drawer.style.height = 'calc(100% - ' + h + 'px)';
      backdrop.style.top = h + 'px';
      backdrop.style.height = 'calc(100% - ' + h + 'px)';
    }
    syncHeaderOffset();
    window.addEventListener('resize', syncHeaderOffset);
    window.addEventListener('orientationchange', syncHeaderOffset);

    function openDrawer() {
      if (isOpen) return;
      isOpen = true;
      syncHeaderOffset(); // re-measure in case header height drifted since load
      drawer.classList.remove('-translate-x-full');
      drawer.setAttribute('aria-hidden', 'false');
      backdrop.classList.remove('opacity-0', 'pointer-events-none');
      backdrop.setAttribute('aria-hidden', 'false');
      document.body.classList.add('overflow-hidden'); // scroll lock
      openBtn.setAttribute('aria-expanded', 'true');
    }

    function closeDrawer() {
      if (!isOpen) return;
      isOpen = false;
      drawer.classList.add('-translate-x-full');
      drawer.setAttribute('aria-hidden', 'true');
      backdrop.classList.add('opacity-0', 'pointer-events-none');
      backdrop.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('overflow-hidden'); // release scroll lock
      openBtn.setAttribute('aria-expanded', 'false');
    }

    openBtn.setAttribute('aria-expanded', 'false');
    openBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (isOpen) { closeDrawer(); } else { openDrawer(); }
    });
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
    backdrop.addEventListener('click', closeDrawer); // tap outside
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen) closeDrawer();
    });
    // Close automatically if the viewport grows past the mobile breakpoint
    // (e.g. device rotation / responsive resize) so the drawer never stays
    // "open" with a locked body behind a desktop layout.
    window.addEventListener('resize', function () {
      if (isOpen && window.innerWidth >= 768) closeDrawer();
    });
  })();

  // ---------- All Categories mega-menu (desktop flyout + mobile accordion) ----------
  // Single source of truth for category browsing: GET /api/catalog/categories/tree
  // (src/lib/mega-menu.ts) returns the FULL live taxonomy (departments -> groups ->
  // subcategories -> African/country leaves) as a nested tree. Fetched lazily, once,
  // on first interaction — never server-rendered into every page — same lazy-fetch
  // convention as initWalletNav/initWishlistNav above. Desktop renders it as a
  // department-rail + multi-column flyout panel; mobile renders it as an inline
  // accordion inside the existing off-canvas drawer. Both consume the same cached
  // tree, fetched only once no matter which surface opens first.
  (function initMegaMenu() {
    var desktopBtn = document.getElementById('all-categories-btn');
    var desktopPanel = document.getElementById('mega-menu-panel');
    var desktopDepts = document.getElementById('mega-menu-depts');
    var desktopPanels = document.getElementById('mega-menu-panels');
    var desktopLoading = document.getElementById('mega-menu-loading');

    var mobileBtn = document.getElementById('mobile-all-categories-btn');
    var mobileChevron = document.getElementById('mobile-all-categories-chevron');
    var mobileList = document.getElementById('mobile-mega-menu-list');

    if (!desktopBtn && !mobileBtn) return; // neither surface present on this page

    var tree = null;     // cached GET /api/catalog/categories/tree result
    var fetchPromise = null;
    var activeDeptIndex = 0;

    function fetchTree() {
      if (fetchPromise) return fetchPromise;
      fetchPromise = api('/api/catalog/categories/tree').then(function (res) {
        tree = (res.ok && Array.isArray(res.data)) ? res.data : [];
        return tree;
      }).catch(function () {
        tree = [];
        return tree;
      });
      return fetchPromise;
    }

    // ----- Desktop: department rail (left) + multi-column panel (right) -----
    function renderDeptRail() {
      desktopDepts.innerHTML = '';
      tree.forEach(function (dept, i) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition-colors ' +
          (i === activeDeptIndex ? 'bg-white text-primary font-semibold' : 'text-gray-700 hover:bg-gray-100');
        btn.setAttribute('data-dept-index', String(i));
        btn.innerHTML = '<span class="material-symbols-outlined text-lg shrink-0">' + (dept.icon || 'category') + '</span>' +
          '<span class="truncate">' + dept.name + '</span>';
        btn.addEventListener('mouseenter', function () { setActiveDept(i); });
        btn.addEventListener('click', function () { setActiveDept(i); });
        desktopDepts.appendChild(btn);
      });
    }

    // Recursively renders a <ul> of category links at any nesting depth.
    // Needed because real taxonomy depth varies by branch — most groups are only
    // 1 level deep, but African/country-scoped paths go 2-3 levels deeper (e.g.
    // Fashion -> African Fashion -> Nigerian Fashion -> Nigerian Fabrics ->
    // Ankara Fabric is 5 levels total, 3 below the mega-menu's "group" column).
    // A depth-capped hardcoded renderer would silently truncate exactly those
    // deep African leaves, so this walks `children` all the way down instead.
    function renderLeafList(nodes, depth) {
      var list = document.createElement('ul');
      list.className = depth === 0 ? 'space-y-1.5' : 'pl-3 mt-1 space-y-1 border-l border-gray-100';
      nodes.forEach(function (node) {
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = '/shop?category=' + encodeURIComponent(node.slug);
        a.className = depth === 0
          ? 'text-sm text-gray-600 hover:text-primary hover:underline'
          : 'text-xs text-gray-500 hover:text-primary hover:underline';
        a.textContent = node.name;
        li.appendChild(a);
        if (node.children && node.children.length) {
          li.appendChild(renderLeafList(node.children, depth + 1));
        }
        list.appendChild(li);
      });
      return list;
    }

    function renderDeptPanel(dept) {
      desktopPanels.innerHTML = '';
      if (!dept || !dept.children || !dept.children.length) {
        var empty = document.createElement('p');
        empty.className = 'text-sm text-gray-400';
        empty.textContent = 'No subcategories yet.';
        desktopPanels.appendChild(empty);
        return;
      }
      var grid = document.createElement('div');
      grid.className = 'grid grid-cols-3 gap-x-6 gap-y-5';
      dept.children.forEach(function (group) {
        var col = document.createElement('div');
        var heading = document.createElement('a');
        heading.href = '/shop?category=' + encodeURIComponent(group.slug);
        heading.className = 'block text-sm font-semibold text-gray-900 hover:text-primary mb-2';
        heading.textContent = group.name;
        col.appendChild(heading);

        col.appendChild(renderLeafList(group.children || [], 0));
        grid.appendChild(col);
      });
      desktopPanels.appendChild(grid);
    }

    function setActiveDept(i) {
      activeDeptIndex = i;
      renderDeptRail();
      renderDeptPanel(tree[i]);
    }

    function openDesktopPanel() {
      desktopPanel.classList.remove('hidden');
      desktopBtn.setAttribute('aria-expanded', 'true');
      if (tree) { desktopLoading.classList.add('hidden'); return; }
      desktopLoading.classList.remove('hidden');
      fetchTree().then(function () {
        desktopLoading.classList.add('hidden');
        if (!tree.length) {
          desktopLoading.textContent = 'Categories are unavailable right now.';
          desktopLoading.classList.remove('hidden');
          return;
        }
        renderDeptRail();
        renderDeptPanel(tree[activeDeptIndex]);
      });
    }

    function closeDesktopPanel() {
      desktopPanel.classList.add('hidden');
      desktopBtn.setAttribute('aria-expanded', 'false');
    }

    if (desktopBtn && desktopPanel) {
      desktopBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = !desktopPanel.classList.contains('hidden');
        if (isOpen) { closeDesktopPanel(); } else { openDesktopPanel(); }
      });
      document.addEventListener('click', function (e) {
        if (!desktopPanel.classList.contains('hidden') && !desktopPanel.contains(e.target) && e.target !== desktopBtn) {
          closeDesktopPanel();
        }
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeDesktopPanel();
      });
    }

    // ----- Mobile: inline accordion inside the existing off-canvas drawer -----
    // Same recursion rationale as renderLeafList() above — real African/country
    // branches go deeper than one level below a "group" (e.g. Nigerian Fabrics
    // -> Ankara Fabric), so this must walk `children` fully, not just one hop.
    function renderMobileLeafLinks(nodes, depth) {
      var wrap = document.createElement('div');
      wrap.className = depth > 1 ? 'pl-3 border-l border-gray-100' : '';
      nodes.forEach(function (node) {
        var link = document.createElement('a');
        link.href = '/shop?category=' + encodeURIComponent(node.slug);
        link.className = 'block text-sm text-gray-500 py-1 pl-2';
        link.textContent = node.name;
        wrap.appendChild(link);
        if (node.children && node.children.length) {
          wrap.appendChild(renderMobileLeafLinks(node.children, depth + 1));
        }
      });
      return wrap;
    }

    function renderMobileAccordion() {
      mobileList.innerHTML = '';
      if (!tree.length) {
        var p = document.createElement('p');
        p.className = 'px-3 py-2 text-xs text-gray-400';
        p.textContent = 'Categories are unavailable right now.';
        mobileList.appendChild(p);
        return;
      }
      tree.forEach(function (dept) {
        var details = document.createElement('details');
        details.className = 'border-b border-gray-50 last:border-b-0';

        var summary = document.createElement('summary');
        summary.className = 'flex items-center gap-2.5 py-2 pr-2 text-sm font-medium text-gray-800 cursor-pointer select-none';
        summary.innerHTML = '<span class="material-symbols-outlined text-lg text-gray-500">' + (dept.icon || 'category') + '</span>' + dept.name;
        details.appendChild(summary);

        var body = document.createElement('div');
        body.className = 'pl-8 pb-2 space-y-2';
        (dept.children || []).forEach(function (group) {
          var groupWrap = document.createElement('div');
          var groupLink = document.createElement('a');
          groupLink.href = '/shop?category=' + encodeURIComponent(group.slug);
          groupLink.className = 'block text-sm font-semibold text-gray-700 py-1';
          groupLink.textContent = group.name;
          groupWrap.appendChild(groupLink);
          groupWrap.appendChild(renderMobileLeafLinks(group.children || [], 1));
          body.appendChild(groupWrap);
        });
        details.appendChild(body);
        mobileList.appendChild(details);
      });
    }

    if (mobileBtn && mobileList) {
      mobileBtn.addEventListener('click', function () {
        var isOpen = !mobileList.classList.contains('hidden');
        if (isOpen) {
          mobileList.classList.add('hidden');
          mobileBtn.setAttribute('aria-expanded', 'false');
          if (mobileChevron) mobileChevron.style.transform = '';
          return;
        }
        mobileList.classList.remove('hidden');
        mobileBtn.setAttribute('aria-expanded', 'true');
        if (mobileChevron) mobileChevron.style.transform = 'rotate(180deg)';
        if (tree) { renderMobileAccordion(); return; }
        fetchTree().then(renderMobileAccordion);
      });
    }
  })();

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

  // ---------- In-card "Add to Cart" (ProductCard's full-width gold button, Checkpoint B
  // card-anatomy fix) — a REAL POST to /api/cart/items, not a decorative label. Same
  // document-level delegation pattern as the wishlist button above, so it works on every
  // ProductCard everywhere (home rails, shop grid, PDP related products) with zero per-page
  // wiring. stopPropagation/preventDefault stop the surrounding <a> from navigating to the PDP.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.add-to-cart-card-btn');
    if (!btn || btn.disabled) return;
    e.preventDefault();
    e.stopPropagation();

    var listingId = Number(btn.getAttribute('data-listing-id'));
    if (!listingId) return;
    var originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Adding…';
    api('/api/cart/items', { method: 'POST', body: JSON.stringify({ listing_id: listingId, quantity: 1 }) })
      .then(function (res) {
        if (res.status === 401) { location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search); return; }
        if (!res.ok) {
          btn.disabled = false;
          btn.textContent = originalLabel;
          alert((res.data && res.data.error) || 'Could not add this item to your cart.');
          return;
        }
        updateCartBadges(res.data.count);
        btn.textContent = 'Added ✓';
        setTimeout(function () { btn.disabled = false; btn.textContent = originalLabel; }, 1500);
      })
      .catch(function () { btn.disabled = false; btn.textContent = originalLabel; });
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

  // ---------- Account: Saved Addresses (/account/addresses) ----------
  // Uses the same /api/addresses endpoints as Checkout's address book (lib/addresses.ts) —
  // no separate address store. location.reload() after every mutation is the same
  // "simplest correct way to re-render" pattern used by initWishlistPage/initCheckout above.
  (function initAddressesPage() {
    const listEl = document.getElementById('addresses-list');
    const formSection = document.getElementById('address-form-section');
    if (!listEl || !formSection) return;

    const emptyState = document.getElementById('addresses-empty-state');
    const showAddBtn = document.getElementById('show-add-address-btn');
    const emptyAddBtn = document.getElementById('empty-state-add-btn');
    const cancelBtn = document.getElementById('cancel-address-btn');
    const saveBtn = document.getElementById('save-address-btn');
    const formTitle = document.getElementById('address-form-title');
    const formError = document.getElementById('address-form-error');
    const idField = document.getElementById('af-address-id');

    const fields = {
      label: document.getElementById('af-label'),
      recipient_name: document.getElementById('af-recipient'),
      phone: document.getElementById('af-phone'),
      line1: document.getElementById('af-line1'),
      city: document.getElementById('af-city'),
      state: document.getElementById('af-state'),
      delivery_instructions: document.getElementById('af-instructions'),
      is_default: document.getElementById('af-default')
    };

    function resetForm() {
      idField.value = '';
      fields.label.value = 'Home';
      fields.recipient_name.value = '';
      fields.phone.value = '';
      fields.line1.value = '';
      fields.city.value = '';
      fields.state.value = '';
      fields.delivery_instructions.value = '';
      fields.is_default.checked = false;
      hideError(formError);
    }

    function openForAdd() {
      resetForm();
      formTitle.textContent = 'Add a new address';
      formSection.classList.remove('hidden');
      formSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
      fields.recipient_name.focus();
    }

    function openForEdit(card) {
      resetForm();
      idField.value = card.getAttribute('data-address-id');
      fields.label.value = card.getAttribute('data-label') || 'Home';
      fields.recipient_name.value = card.getAttribute('data-recipient') || '';
      fields.phone.value = card.getAttribute('data-phone') || '';
      fields.line1.value = card.getAttribute('data-line1') || '';
      fields.city.value = card.getAttribute('data-city') || '';
      fields.state.value = card.getAttribute('data-state') || '';
      fields.delivery_instructions.value = card.getAttribute('data-instructions') || '';
      fields.is_default.checked = card.getAttribute('data-is-default') === '1';
      formTitle.textContent = 'Edit address';
      formSection.classList.remove('hidden');
      formSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
      fields.recipient_name.focus();
    }

    function closeForm() {
      formSection.classList.add('hidden');
    }

    if (showAddBtn) showAddBtn.addEventListener('click', openForAdd);
    if (emptyAddBtn) emptyAddBtn.addEventListener('click', openForAdd);
    if (cancelBtn) cancelBtn.addEventListener('click', closeForm);

    if (saveBtn) {
      saveBtn.addEventListener('click', async function () {
        hideError(formError);
        const payload = {
          label: fields.label.value,
          recipient_name: fields.recipient_name.value.trim(),
          phone: fields.phone.value.trim(),
          line1: fields.line1.value.trim(),
          city: fields.city.value.trim(),
          state: fields.state.value,
          delivery_instructions: fields.delivery_instructions.value.trim(),
          is_default: fields.is_default.checked
        };
        if (!payload.recipient_name || !payload.phone || !payload.line1 || !payload.city || !payload.state) {
          showError(formError, 'Please fill in every required field.');
          return;
        }
        const editId = idField.value;
        saveBtn.disabled = true;
        const res = editId
          ? await api('/api/addresses/' + editId, { method: 'PUT', body: JSON.stringify(payload) })
          : await api('/api/addresses', { method: 'POST', body: JSON.stringify(payload) });
        saveBtn.disabled = false;
        if (!res.ok) { showError(formError, (res.data && res.data.error) || 'Could not save address.'); return; }
        location.reload();
      });
    }

    listEl.addEventListener('click', function (e) {
      const editBtn = e.target.closest('.address-edit-btn');
      const deleteBtn = e.target.closest('.address-delete-btn');
      const defaultBtn = e.target.closest('.address-set-default-btn');

      if (editBtn) {
        const card = editBtn.closest('.address-card');
        if (card) openForEdit(card);
      } else if (deleteBtn) {
        openDeleteConfirm(deleteBtn.getAttribute('data-address-id'), deleteBtn.getAttribute('data-address-label'));
      } else if (defaultBtn) {
        e.preventDefault();
        const addressId = defaultBtn.getAttribute('data-address-id');
        defaultBtn.disabled = true;
        api('/api/addresses/' + addressId + '/default', { method: 'POST' }).then(function (res) {
          if (!res.ok) { defaultBtn.disabled = false; alert((res.data && res.data.error) || 'Could not set default address.'); return; }
          location.reload();
        });
      }
    });

    // ---------- Delete confirmation (inline bottom-sheet/modal, not a native confirm()) ----------
    const deleteOverlay = document.getElementById('delete-confirm-overlay');
    const deleteConfirmText = document.getElementById('delete-confirm-text');
    const deleteConfirmBtn = document.getElementById('delete-confirm-btn');
    const deleteCancelBtn = document.getElementById('delete-confirm-cancel-btn');
    let pendingDeleteId = null;

    function openDeleteConfirm(addressId, label) {
      pendingDeleteId = addressId;
      if (deleteConfirmText) {
        deleteConfirmText.textContent = 'This will permanently remove your "' + (label || 'saved') + '" address from your account.';
      }
      if (deleteOverlay) deleteOverlay.classList.remove('hidden');
    }
    function closeDeleteConfirm() {
      pendingDeleteId = null;
      if (deleteOverlay) deleteOverlay.classList.add('hidden');
    }
    if (deleteCancelBtn) deleteCancelBtn.addEventListener('click', closeDeleteConfirm);
    if (deleteOverlay) {
      deleteOverlay.addEventListener('click', function (e) { if (e.target === deleteOverlay) closeDeleteConfirm(); });
    }
    if (deleteConfirmBtn) {
      deleteConfirmBtn.addEventListener('click', async function () {
        if (!pendingDeleteId) return;
        deleteConfirmBtn.disabled = true;
        const res = await api('/api/addresses/' + pendingDeleteId, { method: 'DELETE' });
        deleteConfirmBtn.disabled = false;
        if (!res.ok) { alert((res.data && res.data.error) || 'Could not delete address.'); closeDeleteConfirm(); return; }
        location.reload();
      });
    }
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

  // ---------- Ecosystem Preview waitlist signup (/fresh, /eats, /gigs, /stay, /drive, /send, /stream, /aura) ----------
  (function initEcosystemWaitlist() {
    const form = qs('.ecosystem-waitlist-form');
    if (!form) return;
    const msg = qs('.ecosystem-waitlist-msg');
    const slug = form.getAttribute('data-vertical-slug');
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const emailInput = form.querySelector('input[name="email"]');
      const email = emailInput ? emailInput.value.trim() : '';
      if (!email) return;
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      const res = await api('/api/ecosystem/' + slug + '/waitlist', { method: 'POST', body: JSON.stringify({ email: email }) });
      if (submitBtn) submitBtn.disabled = false;
      if (res.ok) {
        form.reset();
        if (msg) { msg.textContent = "You're on the list! We'll email you the moment this launches."; msg.classList.add('text-primary', 'font-medium'); }
      } else if (msg) {
        msg.textContent = (res.data && res.data.error) || 'Something went wrong. Please try again.';
        msg.classList.add('text-red-500');
      }
    });
  })();

  // ---------- Ecosystem Waitlist Modal v2 (real "Join the waitlist" experience) ----------
  // Backs the modal/bottom-sheet in EcosystemWaitlistModal.tsx, mounted once per page on
  // /ecosystem and every /fresh, /eats, /gigs, /stay, /drive, /send, /stream, /aura preview
  // page. Any element on the page with [data-open-waitlist-modal] opens it; an optional
  // [data-preselect-service] attribute (e.g. "naijaEats") pre-checks that service checkbox.
  (function initEcosystemWaitlistModal() {
    const modal = document.getElementById('ecosystem-waitlist-modal');
    const triggers = qsa('[data-open-waitlist-modal]');
    if (!modal || triggers.length === 0) return;

    const formState = document.getElementById('ewm-form-state');
    const successState = document.getElementById('ewm-success-state');
    const form = document.getElementById('ewm-form');
    const formError = document.getElementById('ewm-form-error');
    const serviceError = document.getElementById('ewm-service-error');
    const closeBtn = document.getElementById('ewm-close-btn');
    const successCloseBtn = document.getElementById('ewm-success-close-btn');
    const stateSelect = document.getElementById('ewm-state');
    const submitBtn = document.getElementById('ewm-submit-btn');
    const successServices = document.getElementById('ewm-success-services');

    const serviceCheckboxIds = { naijaEats: 'ewm-svc-eats', naijaGigs: 'ewm-svc-gigs', naijaStay: 'ewm-svc-stay', allServices: 'ewm-svc-all' };
    const serviceLabels = { naijaEats: 'NaijaEats', naijaGigs: 'NaijaGigs', naijaStay: 'NaijaStay', allServices: 'All upcoming services' };

    let lastFocusedTrigger = null;
    let statesLoaded = false;

    function loadStatesOnce() {
      if (statesLoaded || !stateSelect) return;
      statesLoaded = true;
      api('/api/ecosystem/meta/states').then(function (res) {
        if (!res.ok || !res.data || !Array.isArray(res.data.states)) return;
        res.data.states.forEach(function (s) {
          const opt = document.createElement('option');
          opt.value = s.name;
          opt.textContent = s.name; // nigerian_states.name already reads "Abuja (FCT)" for the FCT row
          stateSelect.appendChild(opt);
        });
      }).catch(function () { statesLoaded = false; /* allow retry on next open */ });
    }

    function resetToFormState() {
      if (formState) formState.classList.remove('hidden');
      if (successState) successState.classList.add('hidden');
    }

    function openModal(preselectService) {
      lastFocusedTrigger = document.activeElement;
      loadStatesOnce();
      resetToFormState();
      hideError(formError);
      if (serviceError) serviceError.classList.add('hidden');

      // Clear all service checkboxes first, then apply this trigger's preselection —
      // every open starts from a clean slate so switching pages never leaves a stale
      // selection from a previous vertical's preselect.
      Object.keys(serviceCheckboxIds).forEach(function (key) {
        const el = document.getElementById(serviceCheckboxIds[key]);
        if (el) el.checked = false;
      });
      if (preselectService && serviceCheckboxIds[preselectService]) {
        const el = document.getElementById(serviceCheckboxIds[preselectService]);
        if (el) el.checked = true;
      }

      modal.classList.remove('hidden');
      document.body.classList.add('overflow-hidden');
      const firstField = document.getElementById('ewm-full-name');
      if (firstField) setTimeout(function () { firstField.focus(); }, 50);
    }

    function closeModal() {
      modal.classList.add('hidden');
      document.body.classList.remove('overflow-hidden');
      if (lastFocusedTrigger && typeof lastFocusedTrigger.focus === 'function') lastFocusedTrigger.focus();
    }

    triggers.forEach(function (trigger) {
      trigger.addEventListener('click', function () {
        openModal(trigger.getAttribute('data-preselect-service'));
      });
    });

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (successCloseBtn) successCloseBtn.addEventListener('click', closeModal);
    // Click on the dark overlay (outside the panel) closes it — click on the panel itself must not.
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
    });

    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        hideError(formError);
        if (serviceError) serviceError.classList.add('hidden');

        const payload = {
          fullName: document.getElementById('ewm-full-name').value.trim(),
          email: document.getElementById('ewm-email').value.trim(),
          phone: document.getElementById('ewm-phone').value.trim(),
          city: document.getElementById('ewm-city').value.trim(),
          state: stateSelect ? stateSelect.value : '',
          naijaEats: document.getElementById('ewm-svc-eats').checked,
          naijaGigs: document.getElementById('ewm-svc-gigs').checked,
          naijaStay: document.getElementById('ewm-svc-stay').checked,
          allServices: document.getElementById('ewm-svc-all').checked
        };

        // Client-side pre-check for a fast, friendly error — the server re-validates
        // everything regardless, since this must never be the only line of defence.
        if (!payload.naijaEats && !payload.naijaGigs && !payload.naijaStay && !payload.allServices) {
          if (serviceError) serviceError.classList.remove('hidden');
          return;
        }

        submitBtn.disabled = true;
        const originalBtnHTML = submitBtn.innerHTML;
        submitBtn.innerHTML = '<span class="material-symbols-outlined text-lg animate-spin">progress_activity</span> Joining...';

        const res = await api('/api/ecosystem/waitlist', { method: 'POST', body: JSON.stringify(payload) });

        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHTML;

        if (!res.ok) {
          // Keep every entered field exactly as-is (no form.reset()) so the visitor
          // never has to retype anything after a failed submission.
          showError(formError, (res.data && res.data.error) || 'Something went wrong. Please try again.');
          return;
        }

        // ---- Success state ----
        if (successServices) {
          successServices.innerHTML = '';
          const selected = res.data && res.data.services ? res.data.services : payload;
          Object.keys(serviceLabels).forEach(function (key) {
            if (!selected[key]) return;
            const chip = document.createElement('span');
            chip.className = 'inline-flex items-center gap-1 text-xs font-semibold bg-primary-light text-primary-dark rounded-full px-3 py-1.5';
            chip.textContent = serviceLabels[key];
            successServices.appendChild(chip);
          });
        }
        if (formState) formState.classList.add('hidden');
        if (successState) successState.classList.remove('hidden');
        form.reset(); // safe to clear now — submission succeeded, nothing to preserve
      });
    }
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

  // ---------- Hero: DESKTOP 5-panel mosaic — rotates campaign CONTENT through fixed
  // panel slots (never removes/hides panels), autoplay, prev/next, indicators, keyboard,
  // hover-pause, reduced-motion, visibility-pause. Mobile carousel is a separate IIFE below. ----------
  (function initHeroGrid() {
    var root = document.getElementById('hero-grid');
    if (!root) return;
    var campaigns = JSON.parse(root.getAttribute('data-campaigns') || '[]');
    var total = campaigns.length;
    if (total === 0) return;
    var panels = qsa('.hero-panel', root); // fixed DOM slots: [0]=primary, [1..n]=support
    var slotCount = panels.length;
    if (slotCount === 0) return;
    var indicators = qsa('.hero-grid-indicator-btn', root);
    var prevBtn = document.getElementById('hero-grid-prev-btn');
    var nextBtn = document.getElementById('hero-grid-next-btn');
    var windowStart = 0; // index into `campaigns` of whichever campaign currently sits in slot 0
    var autoplayMs = Number(root.getAttribute('data-autoplay-ms')) || 6000;
    var timer = null;
    var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function renderPanel(panel, campaign) {
      var img = panel.querySelector('[data-hero-img]');
      var mobileSrc = panel.querySelector('[data-hero-mobile-src]');
      var title = panel.querySelector('[data-hero-title]');
      var subtitle = panel.querySelector('[data-hero-subtitle]');
      var cta = panel.querySelector('[data-hero-cta]');
      var overlay = panel.querySelector('[data-hero-overlay]');
      var textLight = campaign.theme === 'dark';

      panel.setAttribute('href', campaign.cta_href);
      if (img) {
        img.src = campaign.image_desktop_url;
        img.classList.remove('hero-img-failed');
      }
      if (mobileSrc) mobileSrc.setAttribute('srcset', campaign.image_mobile_url);
      if (title) title.textContent = campaign.title;
      if (subtitle) {
        if (campaign.subtitle) { subtitle.textContent = campaign.subtitle; subtitle.classList.remove('hidden'); }
        else { subtitle.classList.add('hidden'); }
      }
      if (cta) {
        // preserve the trailing icon span, only replace the label text node
        var iconSpan = cta.querySelector('.material-symbols-outlined');
        cta.textContent = campaign.cta_label + ' ';
        if (iconSpan) cta.appendChild(iconSpan);
      }
      if (title) title.classList.toggle('text-white', textLight);
      if (title) title.classList.toggle('text-gray-900', !textLight);
      if (subtitle) subtitle.classList.toggle('text-white/85', textLight);
      if (subtitle) subtitle.classList.toggle('text-gray-700', !textLight);
      if (overlay) {
        overlay.classList.toggle('from-black/75', textLight);
        overlay.classList.toggle('via-black/15', textLight);
        overlay.classList.toggle('from-white/80', !textLight);
        overlay.classList.toggle('via-white/25', !textLight);
      }
    }

    function renderWindow() {
      for (var slot = 0; slot < slotCount; slot++) {
        var campaignIndex = (windowStart + slot) % total;
        renderPanel(panels[slot], campaigns[campaignIndex]);
      }
      indicators.forEach(function (btn, i) {
        var active = i === windowStart;
        btn.classList.toggle('w-6', active);
        btn.classList.toggle('bg-white', active);
        btn.classList.toggle('w-2', !active);
        btn.classList.toggle('bg-white/50', !active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }

    function rotateBy(delta) {
      windowStart = ((windowStart + delta) % total + total) % total;
      renderWindow();
    }
    function next() { rotateBy(1); }
    function prev() { rotateBy(-1); }

    function startAutoplay() {
      if (reducedMotion || total < 2) return;
      stopAutoplay();
      timer = window.setInterval(next, autoplayMs);
    }
    function stopAutoplay() {
      if (timer) { window.clearInterval(timer); timer = null; }
    }

    if (total > 1) {
      if (prevBtn) prevBtn.addEventListener('click', function () { prev(); startAutoplay(); });
      if (nextBtn) nextBtn.addEventListener('click', function () { next(); startAutoplay(); });
      indicators.forEach(function (btn) {
        btn.addEventListener('click', function () {
          windowStart = Number(btn.getAttribute('data-window-start'));
          renderWindow();
          startAutoplay();
        });
      });

      root.addEventListener('mouseenter', stopAutoplay);
      root.addEventListener('mouseleave', startAutoplay);

      root.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft') { prev(); startAutoplay(); }
        else if (e.key === 'ArrowRight') { next(); startAutoplay(); }
      });

      startAutoplay();
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) stopAutoplay(); else startAutoplay();
      });
    }
  })();

  // ---------- Hero: MOBILE/TABLET single-campaign carousel — autoplay, prev/next,
  // indicators, swipe, keyboard, hover-pause, reduced-motion, visibility-pause ----------
  (function initHeroMobileCarousel() {
    var root = document.getElementById('hero-mobile-carousel');
    if (!root) return;
    var slides = qsa('.hero-mobile-slide', root);
    if (slides.length === 0) return;
    var indicators = qsa('.hero-mobile-indicator-btn', root);
    var prevBtn = document.getElementById('hero-mobile-prev-btn');
    var nextBtn = document.getElementById('hero-mobile-next-btn');
    var current = 0;
    var autoplayMs = Number(root.getAttribute('data-autoplay-ms')) || 6000;
    var timer = null;
    var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function goTo(index) {
      var next = ((index % slides.length) + slides.length) % slides.length;
      if (next === current) return;
      slides[current].classList.remove('opacity-100', 'z-10');
      slides[current].classList.add('opacity-0', 'z-0', 'pointer-events-none');
      slides[current].setAttribute('aria-hidden', 'true');
      slides[next].classList.remove('opacity-0', 'z-0', 'pointer-events-none');
      slides[next].classList.add('opacity-100', 'z-10');
      slides[next].setAttribute('aria-hidden', 'false');
      if (indicators[current]) {
        indicators[current].classList.remove('w-6', 'bg-white');
        indicators[current].classList.add('w-2', 'bg-white/50');
        indicators[current].setAttribute('aria-selected', 'false');
      }
      if (indicators[next]) {
        indicators[next].classList.remove('w-2', 'bg-white/50');
        indicators[next].classList.add('w-6', 'bg-white');
        indicators[next].setAttribute('aria-selected', 'true');
      }
      current = next;
    }

    function next() { goTo(current + 1); }
    function prev() { goTo(current - 1); }

    function startAutoplay() {
      if (reducedMotion || slides.length < 2) return; // never auto-rotate if the visitor asked for reduced motion
      stopAutoplay();
      timer = window.setInterval(next, autoplayMs);
    }
    function stopAutoplay() {
      if (timer) { window.clearInterval(timer); timer = null; }
    }

    if (slides.length > 1) {
      if (prevBtn) prevBtn.addEventListener('click', function () { prev(); startAutoplay(); });
      if (nextBtn) nextBtn.addEventListener('click', function () { next(); startAutoplay(); });
      indicators.forEach(function (btn) {
        btn.addEventListener('click', function () {
          goTo(Number(btn.getAttribute('data-slide-index')));
          startAutoplay();
        });
      });

      // Desktop hover-pause (harmless no-op on touch-only devices where this carousel is hidden anyway)
      root.addEventListener('mouseenter', stopAutoplay);
      root.addEventListener('mouseleave', startAutoplay);

      // Keyboard accessibility (left/right arrows while the carousel or its controls have focus)
      root.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft') { prev(); startAutoplay(); }
        else if (e.key === 'ArrowRight') { next(); startAutoplay(); }
      });

      // Mobile touch/swipe
      var touchStartX = null;
      root.addEventListener('touchstart', function (e) {
        touchStartX = e.changedTouches[0].clientX;
        stopAutoplay();
      }, { passive: true });
      root.addEventListener('touchend', function (e) {
        if (touchStartX === null) return;
        var dx = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(dx) > 40) { dx < 0 ? next() : prev(); }
        touchStartX = null;
        startAutoplay();
      }, { passive: true });

      startAutoplay();
      // Pause when the tab is backgrounded so we don't burn cycles / jump slides on return
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) stopAutoplay(); else startAutoplay();
      });
    }

    // Graceful failed-image handling: if a slide's image 404s/errors, fall back to a
    // themed gradient (already applied via the img's own class list) so the slide still
    // shows its title/subtitle/CTA instead of a broken-image icon.
  })();

  // ---------- Recently Viewed: track visited PDPs in localStorage + hydrate homepage section ----------
  (function trackRecentlyViewed() {
    var pdpRoot = document.getElementById('pdp-root');
    var pid = pdpRoot && pdpRoot.getAttribute('data-product-id');
    if (!pid) return;
    try {
      var KEY = 'nd_recently_viewed';
      var ids = JSON.parse(localStorage.getItem(KEY) || '[]').filter(function (id) { return id !== Number(pid); });
      ids.unshift(Number(pid));
      localStorage.setItem(KEY, JSON.stringify(ids.slice(0, 20)));
    } catch (e) { /* localStorage unavailable — skip silently */ }
  })();

  (function hydrateRecentlyViewed() {
    // Targets the "Recently Viewed" SIDEBAR card (home.tsx's PairedRailSection
    // next to "Recommended for You"). The card itself is ALWAYS visible (never
    // hidden/removed — required so it never disappears on desktop or mobile);
    // it shows a real, honest empty state by default and swaps to the actual
    // track only once localStorage + the by-ids API resolve real products.
    var card = document.getElementById('continue-shopping-card');
    if (!card) return;
    var emptyState = document.getElementById('recently-viewed-empty');
    var track = document.getElementById('continue-shopping-track');
    if (!track) return;
    var pdpRoot = document.getElementById('pdp-root');
    var currentPid = Number((pdpRoot && pdpRoot.getAttribute('data-product-id')) || '0');
    try {
      var ids = JSON.parse(localStorage.getItem('nd_recently_viewed') || '[]').filter(function (id) { return id !== currentPid; });
      if (ids.length === 0) return; // stays on the empty state — nothing to show yet
      api('/api/catalog/products/by-ids?ids=' + ids.slice(0, 6).join(',')).then(function (res) {
        if (!res.ok || !res.data || !res.data.products || res.data.products.length === 0) return; // stays on empty state
        track.innerHTML = res.data.products.map(function (p) {
          return '<a href="/shop/' + p.slug + '" class="group flex items-center gap-2 hover:bg-gray-50 rounded-lg p-1 -m-1 transition-colors">' +
            '<div class="w-12 h-12 rounded-lg bg-gray-100 overflow-hidden shrink-0"><img src="' + p.image_url + '" alt="' + p.title.replace(/"/g, '&quot;') + '" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"></div>' +
            '<div class="min-w-0 flex-1"><p class="text-xs text-gray-700 line-clamp-2 leading-tight">' + p.title + '</p>' +
            '<p class="text-xs font-bold text-gray-900 mt-0.5">' + formatNaira(p.price_kobo) + '</p></div></a>';
        }).join('');
        if (emptyState) emptyState.classList.add('hidden');
        track.classList.remove('hidden');
      }).catch(function () { /* stays on the honest empty state on failure — no fabricated fallback */ });
    } catch (e) { /* localStorage unavailable — card stays hidden */ }
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

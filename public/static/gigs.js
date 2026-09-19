// NaijaGigs — client-side wiring for real writes against the Service Engine
// 2.0 authenticated API (src/routes/api-service-requests.ts). Every call
// below hits the REAL API — no mock responses, no simulated success states
// (spec section 33AG). Server resolves customer_user_id from the session;
// this file never sends a user id.
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

  function showErr(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
  }
  function hideErr(el) {
    if (!el) return;
    el.classList.add('hidden');
  }

  // ---------- /gigs/request — submit a new service request ----------
  var reqForm = qs('#gigs-request-form');
  if (reqForm) {
    var reqErrEl = qs('#gigs-request-error');
    reqForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      hideErr(reqErrEl);
      var submitBtn = qs('#gigs-request-submit-btn');
      var fd = new FormData(reqForm);
      var categoryId = Number(fd.get('category_id'));
      if (!categoryId) { showErr(reqErrEl, 'Please select a category.'); return; }

      var budgetNaira = fd.get('budget_naira');
      var body = {
        category_id: categoryId,
        service_listing_id: fd.get('service_listing_id') ? Number(fd.get('service_listing_id')) : null,
        title: fd.get('title'),
        description: fd.get('description'),
        city: fd.get('city') || null,
        address_line1: fd.get('address_line1') || null,
        preferred_date: fd.get('preferred_date') || null,
        preferred_time: fd.get('preferred_time') || null,
        budget_kobo: budgetNaira ? Math.round(Number(budgetNaira) * 100) : null,
        urgency: fd.get('urgency') || 'normal'
      };

      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting...'; }
      var res = await api('/api/service-requests', { method: 'POST', body: JSON.stringify(body) });
      if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<span class="material-symbols-outlined">send</span>Submit request'; }

      if (!res.ok) {
        showErr(reqErrEl, (res.data && res.data.error) || 'Failed to submit request. Please try again.');
        return;
      }
      window.location.href = '/gigs/dashboard/requests/' + res.data.id;
    });
  }

  // ---------- Request detail — accept/reject quote ----------
  var acceptBtns = qsa('.gigs-quote-accept-btn');
  var rejectBtns = qsa('.gigs-quote-reject-btn');
  var requestActionErrEl = qs('#gigs-request-action-error');

  acceptBtns.forEach(function (btn) {
    btn.addEventListener('click', async function () {
      hideErr(requestActionErrEl);
      var quoteId = btn.getAttribute('data-quote-id');
      btn.disabled = true;
      btn.textContent = 'Accepting...';
      var res = await api('/api/quotes/' + quoteId + '/accept', { method: 'POST' });
      if (!res.ok) {
        btn.disabled = false;
        btn.textContent = 'Accept quote';
        showErr(requestActionErrEl, (res.data && res.data.error) || 'Failed to accept quote.');
        return;
      }
      window.location.href = '/gigs/dashboard/orders/' + res.data.service_order_id;
    });
  });

  rejectBtns.forEach(function (btn) {
    btn.addEventListener('click', async function () {
      hideErr(requestActionErrEl);
      var quoteId = btn.getAttribute('data-quote-id');
      btn.disabled = true;
      var res = await api('/api/quotes/' + quoteId + '/reject', { method: 'POST' });
      if (!res.ok) {
        btn.disabled = false;
        showErr(requestActionErrEl, (res.data && res.data.error) || 'Failed to decline quote.');
        return;
      }
      window.location.reload();
    });
  });

  // ---------- Order detail — cancel / confirm / dispute ----------
  var orderRoot = qs('[data-order-id]');
  var orderActionErrEl = qs('#gigs-order-action-error');
  if (orderRoot) {
    var orderId = orderRoot.getAttribute('data-order-id');

    var cancelBtn = qs('#gigs-order-cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', async function () {
        if (!window.confirm('Cancel this service order?')) return;
        hideErr(orderActionErrEl);
        cancelBtn.disabled = true;
        var res = await api('/api/service-orders/' + orderId + '/cancel', { method: 'POST', body: JSON.stringify({ reason: 'Cancelled by customer' }) });
        if (!res.ok) {
          cancelBtn.disabled = false;
          showErr(orderActionErrEl, (res.data && res.data.error) || 'Failed to cancel order.');
          return;
        }
        window.location.reload();
      });
    }

    var confirmBtn = qs('#gigs-order-confirm-btn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', async function () {
        hideErr(orderActionErrEl);
        confirmBtn.disabled = true;
        var res = await api('/api/service-orders/' + orderId + '/confirm', { method: 'POST' });
        if (!res.ok) {
          confirmBtn.disabled = false;
          showErr(orderActionErrEl, (res.data && res.data.error) || 'Failed to confirm completion.');
          return;
        }
        window.location.reload();
      });
    }

    var disputeBtn = qs('#gigs-order-dispute-btn');
    if (disputeBtn) {
      disputeBtn.addEventListener('click', async function () {
        var reason = window.prompt('Briefly describe the issue with this order:');
        if (reason === null) return;
        hideErr(orderActionErrEl);
        disputeBtn.disabled = true;
        var res = await api('/api/service-orders/' + orderId + '/dispute', { method: 'POST', body: JSON.stringify({ reason: reason }) });
        if (!res.ok) {
          disputeBtn.disabled = false;
          showErr(orderActionErrEl, (res.data && res.data.error) || 'Failed to raise dispute.');
          return;
        }
        window.location.reload();
      });
    }
  }
})();

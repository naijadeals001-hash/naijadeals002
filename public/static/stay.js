// NaijaStay — client-side wiring for real writes against the Booking
// Engine 2.0 authenticated API (src/routes/api-bookings.ts). Every call
// below hits the REAL API — no mock responses, no simulated success states
// (spec section 33AG). Server resolves customer_user_id from the session;
// this file never sends a user id, and NEVER computes/sends its own price
// (the server is the sole source of truth for total_price_kobo).
(function () {
  'use strict';
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  async function api(path, options) {
    var res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options));
    var data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    return { ok: res.ok, status: res.status, data: data };
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
  function fmtNaira(kobo) {
    return '₦' + (kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 });
  }

  // ---------- /stay home — search form (client-side redirect to filtered browse, no write) ----------
  var searchForm = qs('#stay-search-form');
  if (searchForm) {
    searchForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(searchForm);
      var params = new URLSearchParams();
      var city = fd.get('city');
      if (city) params.set('city', city);
      window.location.href = '/stay' + (params.toString() ? '?' + params.toString() : '');
    });
  }

  // ---------- /stay/book/:listingId — availability -> hold -> confirm -> pay ----------
  var bookRoot = qs('#stay-book-form-root');
  if (bookRoot) {
    var listingId = Number(bookRoot.getAttribute('data-listing-id'));
    var resourceId = Number(bookRoot.getAttribute('data-resource-id'));
    var priceKobo = Number(bookRoot.getAttribute('data-price-kobo'));
    var currency = bookRoot.getAttribute('data-currency') || 'NGN';
    var maxGuests = Number(bookRoot.getAttribute('data-max-guests')) || 1;
    var errEl = qs('#stay-book-error');

    var checkinInput = qs('#stay-book-checkin');
    var checkoutInput = qs('#stay-book-checkout');
    var guestsInput = qs('#stay-book-guests');
    var checkBtn = qs('#stay-book-check-availability-btn');
    var summaryBox = qs('#stay-book-summary');
    var priceBreakdown = qs('#stay-book-price-breakdown');
    var holdBtn = qs('#stay-book-hold-btn');
    var confirmBox = qs('#stay-book-confirm');
    var confirmBtn = qs('#stay-book-confirm-btn');
    var holdTimerEl = qs('#stay-book-hold-timer');
    var payBox = qs('#stay-book-pay');
    var paySummaryEl = qs('#stay-book-pay-summary');
    var payBtn = qs('#stay-book-pay-btn');

    var currentHold = null;
    var currentNights = 0;
    var holdCountdownInterval = null;

    function nightsBetween(checkIn, checkOut) {
      var start = new Date(checkIn + 'T00:00:00Z').getTime();
      var end = new Date(checkOut + 'T00:00:00Z').getTime();
      return Math.max(1, Math.round((end - start) / 86400000));
    }

    checkBtn.addEventListener('click', async function () {
      hideErr(errEl);
      var checkIn = checkinInput.value;
      var checkOut = checkoutInput.value;
      var guests = Number(guestsInput.value) || 1;
      if (!checkIn || !checkOut) { showErr(errEl, 'Please choose both check-in and check-out dates.'); return; }
      if (checkOut <= checkIn) { showErr(errEl, 'Check-out must be after check-in.'); return; }
      if (guests > maxGuests) { showErr(errEl, 'This unit allows a maximum of ' + maxGuests + ' guests.'); return; }

      checkBtn.disabled = true;
      checkBtn.textContent = 'Checking...';
      var startsAt = checkIn + 'T14:00:00.000Z';
      var endsAt = checkOut + 'T11:00:00.000Z';
      var res = await api(
        '/api/bookable-listings/' + listingId + '/availability?resource_id=' + resourceId +
        '&starts_at=' + encodeURIComponent(startsAt) + '&ends_at=' + encodeURIComponent(endsAt) + '&capacity=1'
      );
      checkBtn.disabled = false;
      checkBtn.innerHTML = '<span class="material-symbols-outlined">event_available</span>Check availability';

      if (!res.ok) { showErr(errEl, (res.data && res.data.error) || 'Failed to check availability.'); return; }
      if (!res.data.available) {
        showErr(errEl, 'Not available for those dates (' + (res.data.reason || 'unavailable').replace(/_/g, ' ') + '). Please try different dates.');
        summaryBox.classList.add('hidden');
        return;
      }

      currentNights = nightsBetween(checkIn, checkOut);
      var total = priceKobo * currentNights;
      priceBreakdown.innerHTML =
        '<div class="flex justify-between"><span>' + fmtNaira(priceKobo) + ' x ' + currentNights + ' night' + (currentNights > 1 ? 's' : '') + '</span><span>' + fmtNaira(total) + '</span></div>' +
        '<div class="flex justify-between font-bold text-gray-900 pt-1.5 border-t border-gray-100"><span>Total</span><span>' + fmtNaira(total) + '</span></div>';
      summaryBox.classList.remove('hidden');
      confirmBox.classList.add('hidden');
      payBox.classList.add('hidden');

      holdBtn.onclick = async function () {
        hideErr(errEl);
        holdBtn.disabled = true;
        holdBtn.textContent = 'Holding...';
        var holdRes = await api('/api/booking-holds', {
          method: 'POST',
          body: JSON.stringify({
            listing_id: listingId,
            resource_id: resourceId,
            starts_at: startsAt,
            ends_at: endsAt,
            capacity_requested: 1,
            ttl_minutes: 10
          })
        });
        holdBtn.disabled = false;
        holdBtn.innerHTML = '<span class="material-symbols-outlined">lock_clock</span>Hold this unit (10 min)';
        if (!holdRes.ok) { showErr(errEl, (holdRes.data && holdRes.data.error) || 'This unit is no longer available for those dates.'); return; }

        currentHold = holdRes.data;
        confirmBox.classList.remove('hidden');
        startHoldCountdown(currentHold.expires_at);
      };
    });

    function startHoldCountdown(expiresAtIso) {
      if (holdCountdownInterval) clearInterval(holdCountdownInterval);
      holdCountdownInterval = setInterval(function () {
        var remainingMs = new Date(expiresAtIso).getTime() - Date.now();
        if (remainingMs <= 0) {
          clearInterval(holdCountdownInterval);
          holdTimerEl.textContent = 'Hold expired — please check availability again.';
          confirmBtn.disabled = true;
          return;
        }
        var mins = Math.floor(remainingMs / 60000);
        var secs = Math.floor((remainingMs % 60000) / 1000);
        holdTimerEl.textContent = 'Held for ' + mins + ':' + (secs < 10 ? '0' : '') + secs + ' more';
      }, 1000);
    }

    confirmBtn.addEventListener('click', async function () {
      if (!currentHold) return;
      hideErr(errEl);
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Confirming...';
      var guests = Number(guestsInput.value) || 1;
      var bookRes = await api('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({ hold_id: currentHold.id, guests_count: guests })
      });
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<span class="material-symbols-outlined">check_circle</span>Confirm booking';
      if (!bookRes.ok) { showErr(errEl, (bookRes.data && bookRes.data.error) || 'Failed to confirm booking.'); return; }

      if (holdCountdownInterval) clearInterval(holdCountdownInterval);
      window.location.href = '/stay/dashboard/bookings/' + bookRes.data.id;
    });
  }

  // ---------- Booking detail — pay / cancel ----------
  var bookingRoot = qs('[data-booking-id]');
  var bookingActionErrEl = qs('#stay-booking-action-error');
  if (bookingRoot) {
    var bookingId = bookingRoot.getAttribute('data-booking-id');

    var payBtn2 = qs('#stay-booking-pay-btn');
    if (payBtn2) {
      payBtn2.addEventListener('click', async function () {
        hideErr(bookingActionErrEl);
        payBtn2.disabled = true;
        payBtn2.textContent = 'Processing...';
        var res = await api('/api/bookings/' + bookingId + '/pay', { method: 'POST' });
        payBtn2.disabled = false;
        payBtn2.textContent = 'Pay deposit';
        if (!res.ok) { showErr(bookingActionErrEl, (res.data && res.data.error) || 'Payment failed.'); return; }
        window.location.reload();
      });
    }

    var cancelBtn2 = qs('#stay-booking-cancel-btn');
    if (cancelBtn2) {
      cancelBtn2.addEventListener('click', async function () {
        hideErr(bookingActionErrEl);
        var quoteRes = await api('/api/bookings/' + bookingId + '/cancellation-quote');
        var msg = 'Cancel this booking?';
        if (quoteRes.ok && quoteRes.data) {
          msg = 'Cancel this booking? Refund: ' + fmtNaira(quoteRes.data.refundAmountKobo) + (quoteRes.data.feeAmountKobo > 0 ? (' (fee: ' + fmtNaira(quoteRes.data.feeAmountKobo) + ')') : '');
        }
        if (!window.confirm(msg)) return;
        cancelBtn2.disabled = true;
        var res = await api('/api/bookings/' + bookingId + '/cancel', { method: 'POST', body: JSON.stringify({ reason: 'Cancelled by customer' }) });
        cancelBtn2.disabled = false;
        if (!res.ok) { showErr(bookingActionErrEl, (res.data && res.data.error) || 'Failed to cancel booking.'); return; }
        window.location.reload();
      });
    }
  }
})();

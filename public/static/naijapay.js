/**
 * NaijaPay page JS.
 *
 * "Add Money" reuses the EXACT same real backend calls as the existing
 * /wallet page (see initWalletPage() in app.js): POST /api/wallet/topup/initialize
 * to get a real Paystack authorization_url, redirect the browser there, then
 * on return POST /api/wallet/topup/verify. No fake success state is ever
 * shown — if the API call fails or Paystack isn't configured (503), the real
 * error message from the server is surfaced, never swallowed.
 *
 * "Send Money" / "Withdraw" buttons are intentionally NOT wired to any
 * click handler below — they are rendered `disabled` in naijapay.tsx because
 * no backend exists for either action yet. Do not add a click handler here
 * that fakes a modal/success — see naijapay-experience.ts's header comment.
 */
(function () {
  async function api(path, options) {
    const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options));
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    return { ok: res.ok, status: res.status, data };
  }

  // ---------- Balance visibility toggle ----------
  (function initBalanceToggle() {
    const btn = document.getElementById('np-toggle-balance-btn');
    const display = document.getElementById('np-balance-display');
    if (!btn || !display) return;
    let hidden = false;
    const real = display.getAttribute('data-real-balance') || display.textContent;
    btn.addEventListener('click', function () {
      hidden = !hidden;
      display.textContent = hidden ? '••••••' : real;
      const icon = btn.querySelector('.material-symbols-outlined');
      if (icon) icon.textContent = hidden ? 'visibility_off' : 'visibility';
    });
  })();

  // ---------- Add Money (real Paystack top-up flow, same as /wallet) ----------
  const QUICK_AMOUNTS_KOBO = [500000, 1000000, 2500000, 5000000]; // ₦5k/₦10k/₦25k/₦50k

  function showToast(message, isError) {
    var existing = document.getElementById('np-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.id = 'np-toast';
    toast.className = 'fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-[70] px-4 py-2.5 rounded-lg text-[13px] font-medium shadow-lg ' +
      (isError ? 'bg-red-600 text-white' : 'bg-npDark text-white');
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 4000);
  }

  async function startTopup(amountKobo) {
    if (!amountKobo || amountKobo < 10000) {
      showToast('Minimum top-up is ₦100.', true);
      return;
    }
    const res = await api('/api/wallet/topup/initialize', { method: 'POST', body: JSON.stringify({ amount_kobo: amountKobo }) });
    if (res.ok && res.data && res.data.authorization_url) {
      location.href = res.data.authorization_url;
    } else {
      showToast((res.data && res.data.error) || 'Could not start top-up. Please try again.', true);
    }
  }

  function openAddMoneySheet() {
    if (document.getElementById('np-topup-sheet')) return;
    const sheet = document.createElement('div');
    sheet.id = 'np-topup-sheet';
    sheet.className = 'fixed inset-0 z-[70] flex items-end md:items-center justify-center bg-black/50';
    sheet.innerHTML =
      '<div class="bg-white rounded-t-2xl md:rounded-2xl w-full md:w-[380px] p-5">' +
      '<div class="flex items-center justify-between mb-3">' +
      '<p class="font-bold text-gray-800 text-[15px]">Add Money</p>' +
      '<button id="np-topup-close" class="text-gray-400" aria-label="Close"><span class="material-symbols-outlined">close</span></button>' +
      '</div>' +
      '<div class="flex gap-2 flex-wrap mb-3" id="np-topup-quick"></div>' +
      '<div class="flex gap-2">' +
      '<input type="number" id="np-topup-custom" min="100" placeholder="Custom amount (₦)" class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-npPrimary/30" />' +
      '<button id="np-topup-confirm" class="bg-npPrimary text-white font-semibold px-5 py-2 rounded-lg">Top up</button>' +
      '</div>' +
      '<p class="text-[10.5px] text-gray-400 mt-2">Funded securely via Paystack (card or bank transfer). Minimum ₦100.</p>' +
      '</div>';
    document.body.appendChild(sheet);

    const quickWrap = sheet.querySelector('#np-topup-quick');
    let selected = null;
    QUICK_AMOUNTS_KOBO.forEach(function (amt) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'text-sm border border-gray-300 rounded-lg px-4 py-2 hover:border-npPrimary hover:bg-npPrimary/5 transition';
      b.textContent = '₦' + (amt / 100).toLocaleString('en-NG');
      b.addEventListener('click', function () {
        selected = amt;
        sheet.querySelector('#np-topup-custom').value = '';
        Array.prototype.forEach.call(quickWrap.children, function (c) { c.classList.remove('border-npPrimary', 'bg-npPrimary/5'); });
        b.classList.add('border-npPrimary', 'bg-npPrimary/5');
      });
      quickWrap.appendChild(b);
    });

    sheet.querySelector('#np-topup-close').addEventListener('click', function () { sheet.remove(); });
    sheet.addEventListener('click', function (e) { if (e.target === sheet) sheet.remove(); });
    sheet.querySelector('#np-topup-confirm').addEventListener('click', function () {
      const customVal = sheet.querySelector('#np-topup-custom').value;
      const amountKobo = customVal ? Math.round(parseFloat(customVal) * 100) : selected;
      startTopup(amountKobo);
    });
  }

  const addBtn = document.getElementById('np-add-money-btn');
  const quickAddBtn = document.getElementById('np-quick-add-btn');
  if (addBtn) addBtn.addEventListener('click', openAddMoneySheet);
  if (quickAddBtn) quickAddBtn.addEventListener('click', openAddMoneySheet);

  // Returning from Paystack after a NaijaPay top-up
  (function handleTopupReturn() {
    const params = new URLSearchParams(location.search);
    const topupRef = params.get('topup_ref');
    if (!topupRef) return;
    api('/api/wallet/topup/verify', { method: 'POST', body: JSON.stringify({ reference: topupRef }) })
      .then(function (res) {
        if (res.ok && res.data && res.data.success) {
          location.href = '/naijapay'; // strip query params, reload real balance server-side
        } else {
          showToast((res.data && res.data.error) || 'Could not verify top-up.', true);
        }
      });
  })();

  // ---------- Financial Activity chart (REAL money in/out data injected server-side) ----------
  (function initChart() {
    const canvas = document.getElementById('np-activity-chart');
    const data = window.__NAIJAPAY_CHART_DATA__;
    if (!canvas || !data || typeof Chart === 'undefined') return;
    new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: data.labels,
        datasets: [
          { label: 'Money In', data: data.moneyIn, backgroundColor: '#008753', borderRadius: 3 },
          { label: 'Money Out', data: data.moneyOut, backgroundColor: '#DC2626', borderRadius: 3 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { font: { size: 9 } }, grid: { display: false } },
          y: { ticks: { font: { size: 9 }, callback: function (v) { return '₦' + v.toLocaleString(); } }, grid: { color: '#F3F4F6' } },
        },
      },
    });
  })();

  // ---------- Bottom nav "Pay" quick action (real Add Money entry point, not a fake QR scanner) ----------
  const quickPayBtn = document.getElementById('np-quick-pay-btn');
  if (quickPayBtn) quickPayBtn.addEventListener('click', openAddMoneySheet);
})();

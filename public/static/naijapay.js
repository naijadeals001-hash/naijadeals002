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
    const idempotencyKey = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('topup-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    const res = await api('/api/wallet/topup/initialize', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ amount_kobo: amountKobo }) });
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
  // QA fix: sidebar "Add Money" item (previously mis-rendered as disabled —
  // see naijapay.tsx SIDEBAR_ITEMS fix) now renders as a real <button>; wire
  // it to the same real Add Money flow as the wallet-card and Quick Actions
  // buttons — one real action, three real entry points, no separate logic.
  const sidebarAddBtn = document.getElementById('np-sidebar-add-money-btn');
  if (addBtn) addBtn.addEventListener('click', openAddMoneySheet);
  if (quickAddBtn) quickAddBtn.addEventListener('click', openAddMoneySheet);
  if (sidebarAddBtn) sidebarAddBtn.addEventListener('click', openAddMoneySheet);

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

  // ---------- Shared payment-intent activity (real authenticated API) ----------
  (function initSharedActivity() {
    const state = document.getElementById('np-shared-activity-state');
    const list = document.getElementById('np-shared-activity-list');
    const statusFilter = document.getElementById('np-activity-status');
    const pageLabel = document.getElementById('np-activity-page');
    const prev = document.getElementById('np-activity-prev');
    const next = document.getElementById('np-activity-next');
    const refresh = document.getElementById('np-activity-refresh');
    if (!state || !list) return;
    let page = 1;
    let totalPages = 1;
    const escapeHtml = function (value) { return String(value).replace(/[&<>\"']/g, function (c) { return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', "'":'&#39;' })[c]; }); };
    const load = async function () {
      state.textContent = 'Loading shared activity…'; state.className = 'text-xs text-gray-400 py-5'; list.classList.add('hidden');
      const query = new URLSearchParams({ page: String(page), page_size: '8' });
      if (statusFilter.value) query.set('status', statusFilter.value);
      try {
        const response = await fetch('/api/naijapay/transactions?' + query.toString());
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load activity');
        totalPages = Math.max(1, data.total_pages || 1);
        pageLabel.textContent = 'Page ' + page + ' of ' + totalPages;
        prev.disabled = page <= 1; next.disabled = page >= totalPages;
        if (!data.rows || data.rows.length === 0) { state.textContent = 'No shared payment activity yet.'; state.className = 'text-xs text-gray-400 py-5'; return; }
        list.innerHTML = data.rows.map(function (tx) {
          const amount = Number(tx.amount_minor || 0) / 100;
          const date = new Date(tx.created_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
          return '<a href="/naijapay#payment-intent-' + encodeURIComponent(tx.id) + '" class="flex items-center justify-between gap-3 py-3 hover:bg-npIvory/60 px-2 rounded-lg">' +
            '<span class="min-w-0"><span class="block text-xs font-semibold text-gray-800 truncate">' + escapeHtml(tx.vertical_key) + '</span><span class="block text-[10px] text-gray-400 truncate">' + escapeHtml(tx.transaction_reference) + ' · ' + escapeHtml(date) + '</span></span>' +
            '<span class="shrink-0 text-right"><span class="block text-xs font-bold text-gray-800">' + escapeHtml(tx.currency) + ' ' + amount.toLocaleString('en-NG', { minimumFractionDigits: 2 }) + '</span><span class="inline-block text-[9px] uppercase font-bold text-gray-500">' + escapeHtml(tx.status) + '</span></span></a>';
        }).join('');
        state.classList.add('hidden'); list.classList.remove('hidden');
      } catch (error) { state.textContent = error instanceof Error ? error.message : 'Could not load shared activity'; state.className = 'text-xs text-red-500 py-5'; }
    };
    statusFilter.addEventListener('change', function () { page = 1; load(); });
    refresh.addEventListener('click', load); prev.addEventListener('click', function () { if (page > 1) { page--; load(); } }); next.addEventListener('click', function () { if (page < totalPages) { page++; load(); } }); load();
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

import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import type { AppEnv } from '../types'
import { getAccountPreferences } from '../lib/account'
import { getOrganizationsForUser } from '../lib/organizations'

/**
 * /account — the "My Account" hub (Section 25): Profile, Preferences,
 * Security/Sessions, Organizations, in one page with tab-like sections.
 * Addresses/Wishlist keep their own existing dedicated pages
 * (/account/addresses, /account/wishlist) — linked from here, not duplicated.
 */
export async function accountPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')!
  const locale = c.get('locale')

  const [preferences, organizations] = await Promise.all([
    getAccountPreferences(db, user.id),
    getOrganizationsForUser(db, user.id)
  ])
  const notifPrefs = JSON.parse(preferences.notification_prefs_json || '{}')

  return c.render(
    <Layout title="My Account" user={user} locale={locale}>
      <div class="max-w-4xl mx-auto px-4 md:px-6 lg:px-8 py-6" id="account-page-root">
        <h1 class="text-xl md:text-2xl font-bold text-gray-800 mb-1">My Account</h1>
        <p class="text-sm text-gray-500 mb-6">Manage your profile, security, preferences and organizations.</p>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <a href="/account/addresses" class="flex items-center gap-3 bg-white border border-gray-200 rounded-xl p-4 hover:border-primary/40 transition">
            <span class="material-symbols-outlined text-2xl text-primary">location_on</span>
            <div><p class="font-semibold text-gray-800 text-sm">Saved Addresses</p><p class="text-xs text-gray-500">Manage delivery addresses</p></div>
          </a>
          <a href="/account/wishlist" class="flex items-center gap-3 bg-white border border-gray-200 rounded-xl p-4 hover:border-primary/40 transition">
            <span class="material-symbols-outlined text-2xl text-primary">favorite</span>
            <div><p class="font-semibold text-gray-800 text-sm">Wishlist</p><p class="text-xs text-gray-500">Items you saved for later</p></div>
          </a>
        </div>

        {/* ============ Profile ============ */}
        <section class="bg-white border border-gray-200 rounded-xl p-5 mb-5" id="profile-section">
          <h2 class="font-bold text-gray-800 mb-3 flex items-center gap-2"><span class="material-symbols-outlined text-primary">person</span>Profile</h2>
          <div class="grid sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1" for="acc-name">Full name</label>
              <input id="acc-name" value={user.name} class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Email</label>
              <input disabled value={user.email ?? ''} placeholder="Not set" class="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2.5 text-sm text-gray-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Phone</label>
              <input disabled value={user.phone ?? ''} placeholder="Not set" class="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2.5 text-sm text-gray-500" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1" for="acc-country">Country</label>
              <select id="acc-country" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 bg-white">
                {['NG', 'GH', 'KE', 'ZA', 'RW', 'TZ', 'UG', 'CM', 'SN', 'CI'].map((iso) => (
                  <option value={iso}>{iso}</option>
                ))}
              </select>
            </div>
          </div>
          <div id="profile-msg" class="hidden text-xs mt-2"></div>
          <button type="button" id="save-profile-btn" class="mt-3 bg-primary text-white text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-primary-dark transition">Save profile</button>
        </section>

        {/* ============ Preferences ============ */}
        <section class="bg-white border border-gray-200 rounded-xl p-5 mb-5" id="preferences-section">
          <h2 class="font-bold text-gray-800 mb-3 flex items-center gap-2"><span class="material-symbols-outlined text-primary">tune</span>Preferences</h2>
          <div class="grid sm:grid-cols-3 gap-3 mb-3">
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1" for="pref-language">Language</label>
              <select id="pref-language" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white">
                <option value="en" selected={preferences.language === 'en'}>English</option>
                <option value="pcm" selected={preferences.language === 'pcm'}>Pidgin</option>
                <option value="ha" selected={preferences.language === 'ha'}>Hausa</option>
                <option value="ig" selected={preferences.language === 'ig'}>Igbo</option>
                <option value="yo" selected={preferences.language === 'yo'}>Yoruba</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1" for="pref-currency">Currency</label>
              <select id="pref-currency" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white">
                {['NGN', 'GHS', 'KES', 'ZAR', 'USD'].map((cur) => (
                  <option value={cur} selected={preferences.currency_code === cur}>{cur}</option>
                ))}
              </select>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1" for="pref-timezone">Timezone</label>
              <input id="pref-timezone" value={preferences.timezone} class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm" />
            </div>
          </div>
          <div class="space-y-2 mb-3">
            <label class="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" id="pref-order-updates" checked={!!notifPrefs.order_updates} class="w-4 h-4 rounded border-gray-300 text-primary" />Order updates</label>
            <label class="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" id="pref-promotions" checked={!!notifPrefs.promotions} class="w-4 h-4 rounded border-gray-300 text-primary" />Promotions</label>
            <label class="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" id="pref-marketing" checked={preferences.marketing_opt_in === 1} class="w-4 h-4 rounded border-gray-300 text-primary" />Marketing emails</label>
          </div>
          <div id="preferences-msg" class="hidden text-xs mb-2"></div>
          <button type="button" id="save-preferences-btn" class="bg-primary text-white text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-primary-dark transition">Save preferences</button>
        </section>

        {/* ============ Security / Sessions ============ */}
        <section class="bg-white border border-gray-200 rounded-xl p-5 mb-5" id="sessions-section">
          <h2 class="font-bold text-gray-800 mb-3 flex items-center gap-2"><span class="material-symbols-outlined text-primary">shield</span>Security &amp; Sessions</h2>
          <div id="sessions-list" class="space-y-2 mb-3">
            <p class="text-sm text-gray-400">Loading sessions…</p>
          </div>
          <button type="button" id="revoke-all-btn" class="text-red-600 text-sm font-semibold hover:underline">Log out of all other devices</button>
        </section>

        {/* ============ Organizations ============ */}
        <section class="bg-white border border-gray-200 rounded-xl p-5 mb-5" id="organizations-section">
          <div class="flex items-center justify-between mb-3">
            <h2 class="font-bold text-gray-800 flex items-center gap-2"><span class="material-symbols-outlined text-primary">domain</span>Organizations</h2>
            <button type="button" id="show-create-org-btn" class="text-primary text-sm font-semibold hover:underline flex items-center gap-1">
              <span class="material-symbols-outlined text-base">add</span>Create organization
            </button>
          </div>

          {organizations.length === 0 ? (
            <p class="text-sm text-gray-500" id="org-empty-state">You don't belong to any business organizations yet.</p>
          ) : (
            <div class="space-y-2" id="org-list">
              {organizations.map((org) => (
                <a href={`/organizations/${org.id}`} class="flex items-center justify-between border border-gray-200 rounded-lg p-3 hover:border-primary/40 transition">
                  <div>
                    <p class="font-semibold text-gray-800 text-sm">{org.name}</p>
                    <p class="text-xs text-gray-500">{org.organization_type} · {org.is_owner ? 'Owner' : org.member_role_key}</p>
                  </div>
                  <span class="material-symbols-outlined text-gray-400">chevron_right</span>
                </a>
              ))}
            </div>
          )}

          <div id="create-org-form" class="hidden mt-4 border-t border-gray-100 pt-4 grid sm:grid-cols-2 gap-3">
            <div class="sm:col-span-2">
              <label class="block text-xs font-medium text-gray-700 mb-1" for="new-org-name">Organization name</label>
              <input id="new-org-name" placeholder="e.g. ABC Restaurant Ltd" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1" for="new-org-type">Organization type</label>
              <select id="new-org-type" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white">
                {['business', 'restaurant', 'hotel', 'service_provider', 'fleet', 'creator_company', 'clinic', 'garage', 'event_company', 'merchant', 'logistics_provider'].map((t) => (
                  <option value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1" for="new-org-country">Country</label>
              <select id="new-org-country" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white">
                {['NG', 'GH', 'KE', 'ZA', 'RW', 'TZ', 'UG', 'CM', 'SN', 'CI'].map((iso) => (
                  <option value={iso}>{iso}</option>
                ))}
              </select>
            </div>
            <div id="create-org-msg" class="hidden sm:col-span-2 text-xs"></div>
            <div class="sm:col-span-2 flex gap-2">
              <button type="button" id="create-org-btn" class="bg-primary text-white text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-primary-dark transition">Create</button>
              <button type="button" id="cancel-create-org-btn" class="text-gray-500 text-sm font-medium px-4 py-2.5 hover:bg-gray-50 rounded-lg transition">Cancel</button>
            </div>
          </div>
        </section>
      </div>

      <script dangerouslySetInnerHTML={{ __html: ACCOUNT_PAGE_SCRIPT }} />
    </Layout>
  )
}

const ACCOUNT_PAGE_SCRIPT = `
(function () {
  function showMsg(el, text, ok) {
    el.textContent = text;
    el.className = (ok ? 'text-green-600' : 'text-red-600') + ' text-xs mt-2';
    el.classList.remove('hidden');
  }

  // ---- Profile ----
  var saveProfileBtn = document.getElementById('save-profile-btn');
  if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', async function () {
      var msg = document.getElementById('profile-msg');
      try {
        var res = await fetch('/api/account/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: document.getElementById('acc-name').value,
            country_iso: document.getElementById('acc-country').value
          })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save profile');
        showMsg(msg, 'Profile saved.', true);
      } catch (e) {
        showMsg(msg, e.message, false);
      }
    });
  }

  // ---- Preferences ----
  var savePrefsBtn = document.getElementById('save-preferences-btn');
  if (savePrefsBtn) {
    savePrefsBtn.addEventListener('click', async function () {
      var msg = document.getElementById('preferences-msg');
      try {
        var res = await fetch('/api/account/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            language: document.getElementById('pref-language').value,
            currency_code: document.getElementById('pref-currency').value,
            timezone: document.getElementById('pref-timezone').value,
            marketing_opt_in: document.getElementById('pref-marketing').checked,
            notification_prefs: {
              order_updates: document.getElementById('pref-order-updates').checked,
              promotions: document.getElementById('pref-promotions').checked,
              security_alerts: true
            }
          })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save preferences');
        showMsg(msg, 'Preferences saved.', true);
      } catch (e) {
        showMsg(msg, e.message, false);
      }
    });
  }

  // ---- Sessions ----
  function renderSessions(sessions) {
    var list = document.getElementById('sessions-list');
    if (!sessions.length) { list.innerHTML = '<p class="text-sm text-gray-400">No active sessions.</p>'; return; }
    list.innerHTML = sessions.map(function (s) {
      return '<div class="flex items-center justify-between border border-gray-100 rounded-lg p-2.5">' +
        '<div><p class="text-sm text-gray-800">' + (s.user_agent ? s.user_agent.slice(0, 60) : 'Unknown device') + (s.is_current ? ' <span class=\\'text-[10px] bg-primary text-white px-1.5 py-0.5 rounded font-semibold ml-1\\'>THIS DEVICE</span>' : '') + '</p>' +
        '<p class="text-xs text-gray-500">Signed in ' + new Date(s.created_at).toLocaleString() + '</p></div>' +
        (s.is_current ? '' : '<button data-session-id="' + s.id + '" class="revoke-session-btn text-red-600 text-xs font-semibold hover:underline">Revoke</button>') +
        '</div>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('.revoke-session-btn'), function (btn) {
      btn.addEventListener('click', async function () {
        var res = await fetch('/api/account/sessions/' + btn.getAttribute('data-session-id') + '/revoke', { method: 'POST' });
        var data = await res.json();
        if (res.ok) renderSessions(data.sessions);
      });
    });
  }

  fetch('/api/account/sessions').then(function (r) { return r.json(); }).then(function (data) {
    if (data.sessions) renderSessions(data.sessions);
  }).catch(function () {});

  var revokeAllBtn = document.getElementById('revoke-all-btn');
  if (revokeAllBtn) {
    revokeAllBtn.addEventListener('click', async function () {
      var res = await fetch('/api/account/sessions/revoke-all', { method: 'POST' });
      var data = await res.json();
      if (res.ok) renderSessions(data.sessions);
    });
  }

  // ---- Organizations ----
  var showCreateBtn = document.getElementById('show-create-org-btn');
  var createForm = document.getElementById('create-org-form');
  if (showCreateBtn) {
    showCreateBtn.addEventListener('click', function () { createForm.classList.remove('hidden'); });
  }
  var cancelCreateBtn = document.getElementById('cancel-create-org-btn');
  if (cancelCreateBtn) {
    cancelCreateBtn.addEventListener('click', function () { createForm.classList.add('hidden'); });
  }
  var createOrgBtn = document.getElementById('create-org-btn');
  if (createOrgBtn) {
    createOrgBtn.addEventListener('click', async function () {
      var msg = document.getElementById('create-org-msg');
      var name = document.getElementById('new-org-name').value.trim();
      if (!name) { showMsg(msg, 'Organization name is required.', false); return; }
      try {
        var res = await fetch('/api/organizations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name,
            organization_type: document.getElementById('new-org-type').value,
            country_iso: document.getElementById('new-org-country').value
          })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create organization');
        window.location.href = '/organizations/' + data.organization.id;
      } catch (e) {
        showMsg(msg, e.message, false);
      }
    });
  }
})();
`

import type { Context } from 'hono'
import { Layout } from '../components/Layout'
import type { AppEnv } from '../types'
import { resolveMembership, getOrganizationById, getMembersForOrganization, getRolesForOrganization, getInvitationsForOrganization, getAddressesForOrganization } from '../lib/organizations'

/**
 * /organizations/:id — Business Profile / Team / Roles / Verification /
 * Addresses hub (Section 25). Ownership-resolved server-side via
 * resolveMembership — NEVER trusts the :id path param alone; a non-member
 * gets the same "not found" page a nonexistent org would (no enumeration).
 */
export async function organizationPage(c: Context<AppEnv>) {
  const db = c.env.DB
  const user = c.get('user')!
  const locale = c.get('locale')
  const organizationId = Number(c.req.param('organizationId'))

  const membership = await resolveMembership(db, user.id, organizationId)
  if (!membership) {
    return c.render(
      <Layout title="Organization" user={user} locale={locale}>
        <div class="max-w-2xl mx-auto px-4 py-16 text-center">
          <span class="material-symbols-outlined text-5xl text-gray-300">domain_disabled</span>
          <p class="text-gray-700 font-medium mt-3">Organization not found</p>
          <a href="/account" class="inline-block mt-4 text-primary font-semibold hover:underline">Back to My Account</a>
        </div>
      </Layout>
    )
  }

  const [organization, members, roles, invitations, addresses] = await Promise.all([
    getOrganizationById(db, organizationId),
    getMembersForOrganization(db, organizationId),
    getRolesForOrganization(db, organizationId),
    membership.permissionKeys.has('members.manage') ? getInvitationsForOrganization(db, organizationId) : Promise.resolve([]),
    getAddressesForOrganization(db, organizationId)
  ])

  const canManageMembers = membership.permissionKeys.has('members.manage')
  const canManageOrg = membership.permissionKeys.has('organization.manage')
  const isOwner = membership.role.key === 'owner'

  return c.render(
    <Layout title={organization!.name} user={user} locale={locale}>
      <div class="max-w-4xl mx-auto px-4 md:px-6 lg:px-8 py-6" id="org-page-root" data-organization-id={organizationId}>
        <div class="flex items-center justify-between mb-1">
          <h1 class="text-xl md:text-2xl font-bold text-gray-800">{organization!.name}</h1>
          <a href="/account" class="text-sm text-primary font-medium hover:underline flex items-center gap-1 shrink-0">
            <span class="material-symbols-outlined text-base">arrow_back</span>Account
          </a>
        </div>
        <p class="text-sm text-gray-500 mb-6">
          {organization!.organization_type} · Your role: <span class="font-semibold text-gray-700">{membership.role.name}</span>
          {' '}· Verification: <span class={`font-semibold ${organization!.verification_status === 'verified' ? 'text-green-600' : 'text-amber-600'}`}>{organization!.verification_status}</span>
        </p>

        {/* ============ Business Profile ============ */}
        <section class="bg-white border border-gray-200 rounded-xl p-5 mb-5">
          <h2 class="font-bold text-gray-800 mb-3 flex items-center gap-2"><span class="material-symbols-outlined text-primary">domain</span>Business Profile</h2>
          <div class="grid sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1" for="org-name">Name</label>
              <input id="org-name" value={organization!.name} disabled={!canManageOrg} class={`w-full border rounded-lg px-3 py-2.5 text-sm ${canManageOrg ? 'border-gray-300' : 'border-gray-200 bg-gray-50 text-gray-500'}`} />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1" for="org-display-name">Display name</label>
              <input id="org-display-name" value={organization!.display_name ?? ''} disabled={!canManageOrg} class={`w-full border rounded-lg px-3 py-2.5 text-sm ${canManageOrg ? 'border-gray-300' : 'border-gray-200 bg-gray-50 text-gray-500'}`} />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1" for="org-email">Contact email</label>
              <input id="org-email" value={organization!.contact_email ?? ''} disabled={!canManageOrg} class={`w-full border rounded-lg px-3 py-2.5 text-sm ${canManageOrg ? 'border-gray-300' : 'border-gray-200 bg-gray-50 text-gray-500'}`} />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1" for="org-phone">Contact phone</label>
              <input id="org-phone" value={organization!.contact_phone ?? ''} disabled={!canManageOrg} class={`w-full border rounded-lg px-3 py-2.5 text-sm ${canManageOrg ? 'border-gray-300' : 'border-gray-200 bg-gray-50 text-gray-500'}`} />
            </div>
          </div>
          {canManageOrg && (
            <>
              <div id="org-profile-msg" class="hidden text-xs mt-2"></div>
              <button type="button" id="save-org-profile-btn" class="mt-3 bg-primary text-white text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-primary-dark transition">Save changes</button>
            </>
          )}
        </section>

        {/* ============ Team / Members ============ */}
        <section class="bg-white border border-gray-200 rounded-xl p-5 mb-5">
          <div class="flex items-center justify-between mb-3">
            <h2 class="font-bold text-gray-800 flex items-center gap-2"><span class="material-symbols-outlined text-primary">group</span>Team</h2>
            {canManageMembers && (
              <button type="button" id="show-invite-btn" class="text-primary text-sm font-semibold hover:underline flex items-center gap-1">
                <span class="material-symbols-outlined text-base">person_add</span>Invite member
              </button>
            )}
          </div>

          <div class="space-y-2" id="members-list">
            {members.map((m: any) => (
              <div class="flex items-center justify-between border border-gray-100 rounded-lg p-3" data-member-id={m.id}>
                <div>
                  <p class="text-sm font-semibold text-gray-800">{m.user_name} {m.is_owner ? <span class="text-[10px] bg-primary text-white px-1.5 py-0.5 rounded font-semibold ml-1">OWNER</span> : null}</p>
                  <p class="text-xs text-gray-500">{m.user_email || ''} · {m.role_name} · {m.status}</p>
                </div>
                {canManageMembers && !m.is_owner && (
                  <div class="flex items-center gap-3">
                    {m.status === 'active' ? (
                      <button class="member-suspend-btn text-amber-600 text-xs font-semibold hover:underline" data-member-id={m.id}>Suspend</button>
                    ) : (
                      <button class="member-reactivate-btn text-green-600 text-xs font-semibold hover:underline" data-member-id={m.id}>Reactivate</button>
                    )}
                    <button class="member-remove-btn text-red-600 text-xs font-semibold hover:underline" data-member-id={m.id}>Remove</button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {canManageMembers && (
            <div id="invite-form" class="hidden mt-4 border-t border-gray-100 pt-4 grid sm:grid-cols-3 gap-3">
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1" for="invite-email">Email</label>
                <input id="invite-email" type="email" placeholder="teammate@example.com" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1" for="invite-role">Role</label>
                <select id="invite-role" class="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white">
                  {roles.map((r) => (<option value={r.id}>{r.name}</option>))}
                </select>
              </div>
              <div class="flex items-end gap-2">
                <button type="button" id="send-invite-btn" class="bg-primary text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-primary-dark transition">Send invite</button>
                <button type="button" id="cancel-invite-btn" class="text-gray-500 text-sm font-medium px-3 py-2.5 hover:bg-gray-50 rounded-lg transition">Cancel</button>
              </div>
              <div id="invite-msg" class="hidden sm:col-span-3 text-xs"></div>
            </div>
          )}

          {canManageMembers && invitations.length > 0 && (
            <div class="mt-4 border-t border-gray-100 pt-4">
              <h3 class="text-sm font-semibold text-gray-700 mb-2">Pending invitations</h3>
              <div class="space-y-1.5">
                {invitations.filter((i) => i.status === 'pending').map((inv) => (
                  <div class="flex items-center justify-between text-sm">
                    <span class="text-gray-700">{inv.invited_email || inv.invited_phone} <span class="text-xs text-gray-400">({inv.status})</span></span>
                    <button class="invite-revoke-btn text-red-600 text-xs font-semibold hover:underline" data-invitation-id={inv.id}>Revoke</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ============ Addresses ============ */}
        <section class="bg-white border border-gray-200 rounded-xl p-5 mb-5">
          <h2 class="font-bold text-gray-800 mb-3 flex items-center gap-2"><span class="material-symbols-outlined text-primary">location_on</span>Business Addresses</h2>
          {addresses.length === 0 ? (
            <p class="text-sm text-gray-500">No addresses saved yet.</p>
          ) : (
            <div class="space-y-2">
              {addresses.map((a) => (
                <div class="border border-gray-100 rounded-lg p-3">
                  <p class="text-sm font-semibold text-gray-800">{a.label} <span class="text-xs text-gray-400 font-normal">({a.address_type})</span></p>
                  <p class="text-xs text-gray-600">{a.line1}, {a.city}{a.state_region ? ', ' + a.state_region : ''}, {a.country_iso}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <script dangerouslySetInnerHTML={{ __html: ORG_PAGE_SCRIPT }} />
    </Layout>
  )
}

const ORG_PAGE_SCRIPT = `
(function () {
  var root = document.getElementById('org-page-root');
  var orgId = root.getAttribute('data-organization-id');

  function showMsg(el, text, ok) {
    el.textContent = text;
    el.className = (ok ? 'text-green-600' : 'text-red-600') + ' text-xs mt-2';
    el.classList.remove('hidden');
  }

  var saveBtn = document.getElementById('save-org-profile-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async function () {
      var msg = document.getElementById('org-profile-msg');
      try {
        var res = await fetch('/api/organizations/' + orgId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: document.getElementById('org-name').value,
            display_name: document.getElementById('org-display-name').value,
            contact_email: document.getElementById('org-email').value,
            contact_phone: document.getElementById('org-phone').value
          })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save');
        showMsg(msg, 'Saved.', true);
      } catch (e) { showMsg(msg, e.message, false); }
    });
  }

  var showInviteBtn = document.getElementById('show-invite-btn');
  var inviteForm = document.getElementById('invite-form');
  if (showInviteBtn) showInviteBtn.addEventListener('click', function () { inviteForm.classList.remove('hidden'); });
  var cancelInviteBtn = document.getElementById('cancel-invite-btn');
  if (cancelInviteBtn) cancelInviteBtn.addEventListener('click', function () { inviteForm.classList.add('hidden'); });

  var sendInviteBtn = document.getElementById('send-invite-btn');
  if (sendInviteBtn) {
    sendInviteBtn.addEventListener('click', async function () {
      var msg = document.getElementById('invite-msg');
      var email = document.getElementById('invite-email').value.trim();
      if (!email) { showMsg(msg, 'Email is required.', false); return; }
      try {
        var res = await fetch('/api/organizations/' + orgId + '/invitations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, role_id: Number(document.getElementById('invite-role').value) })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to invite');
        showMsg(msg, 'Invitation sent.', true);
        setTimeout(function () { window.location.reload(); }, 900);
      } catch (e) { showMsg(msg, e.message, false); }
    });
  }

  function bindMemberActions() {
    Array.prototype.forEach.call(document.querySelectorAll('.member-suspend-btn'), function (btn) {
      btn.addEventListener('click', async function () {
        var res = await fetch('/api/organizations/' + orgId + '/members/' + btn.getAttribute('data-member-id'), {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'suspended' })
        });
        if (res.ok) window.location.reload();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.member-reactivate-btn'), function (btn) {
      btn.addEventListener('click', async function () {
        var res = await fetch('/api/organizations/' + orgId + '/members/' + btn.getAttribute('data-member-id'), {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'active' })
        });
        if (res.ok) window.location.reload();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.member-remove-btn'), function (btn) {
      btn.addEventListener('click', async function () {
        if (!confirm('Remove this member?')) return;
        var res = await fetch('/api/organizations/' + orgId + '/members/' + btn.getAttribute('data-member-id'), { method: 'DELETE' });
        if (res.ok) window.location.reload();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.invite-revoke-btn'), function (btn) {
      btn.addEventListener('click', async function () {
        var res = await fetch('/api/organizations/' + orgId + '/invitations/' + btn.getAttribute('data-invitation-id') + '/revoke', { method: 'POST' });
        if (res.ok) window.location.reload();
      });
    });
  }
  bindMemberActions();
})();
`

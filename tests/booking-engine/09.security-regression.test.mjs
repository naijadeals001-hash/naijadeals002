/**
 * Invariant #9: dedicated SECURITY REGRESSION suite for the authorization
 * boundary discovered and fixed under Invariant 7 — permanently protecting
 * against a regression where an organization-owned booking's provider
 * authority is decided by STALE/HISTORICAL identity instead of CURRENT
 * organization membership.
 *
 * RELATIONSHIP TO 07.provider-ownership-isolation.test.mjs: that file
 * contains the original incident's exact regression scenario (test #7,
 * "removed member") and is the authoritative record of the bug + fix. This
 * file is a SEPARATE, INDEPENDENT security-focused suite, per explicit
 * instruction, covering additional angles that file does not:
 *   - SUSPENSION (not just removal) also revokes authority immediately —
 *     genuinely new coverage; Invariant 7 only exercised `removeMember`.
 *   - A denied provider-side attempt must have ZERO side effects — no
 *     booking-state mutation, no payment/ledger mutation — verified via
 *     direct D1 reads, not just the HTTP response code.
 *   - Legitimate customer access is verified UNAFFECTED both before and
 *     after the provider-side member is removed (the fix must never touch
 *     the customer authorization path, which was never broken).
 *   - Unrelated-user/unrelated-org isolation re-verified from a fresh org
 *     pair (cross-org isolation is a security property worth its own
 *     independent proof, not just inherited from Invariant 7's fixture).
 *   - A STATIC, code-level check (not an HTTP fabrication) documenting that
 *     no admin-role HTTP path exists in api-bookings.ts today — see the
 *     ADMIN ACCESS note below for why this is handled this way instead of
 *     a fake admin test.
 *
 * ADMIN ACCESS (checklist item I — "if applicable"): grep of
 * src/routes/api-admin.ts and src/routes/api-bookings.ts (done before
 * writing this file) confirms there is currently NO HTTP-reachable route
 * that constructs a BookingActor with role:'admin' — api-admin.ts has zero
 * booking routes, and every actor built in api-bookings.ts is either
 * 'customer' or 'provider'. transitionBooking() DOES support an 'admin'
 * actor role at the library level (see booking-lifecycle.ts's TRANSITIONS
 * table and its module doc comment: "actorRole='admin' transitions require
 * the route layer to have already passed requirePlatformRole('admin')"),
 * but no route currently wires that up. Per the no-fabrication rule, this
 * file does NOT invent an admin HTTP test for a route that doesn't exist —
 * instead test 6 below is a genuine STATIC regression check: it fails loudly
 * if a future change adds an admin-role booking route WITHOUT the
 * corresponding requirePlatformRole('admin') guard, which is the actual
 * risk worth guarding against here.
 *
 * EXPECTED RESULT (documented honestly, not assumed before running): since
 * Invariant 7's fix (`hasProviderAuthorityOverBooking`) is already the live
 * production code at the start of this unit, this file is expected to PASS
 * immediately with ZERO production changes — it exists to make the
 * boundary's continued correctness a permanent, automated fact rather than
 * a one-time finding. If it does NOT pass, that is itself a critical
 * discovery (a regression since Invariant 7) and must be investigated and
 * fixed, not weakened.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { registerUser, nextFreshWindow } from './helpers/client.mjs'
import { queryD1, queryOneD1 } from './helpers/d1.mjs'

// ---------- local fixture helpers (same shapes as 07's, kept independent/duplicated on purpose so this file has zero import-coupling to 07's helpers and can be modified/extended without touching that file) ----------

async function createOrganization(ownerClient, name) {
  const res = await ownerClient.post('/api/organizations', { name })
  assert.equal(res.status, 200, `createOrganization failed: ${JSON.stringify(res.body)}`)
  const orgId = res.body.organization.id
  const rolesRes = await ownerClient.get(`/api/organizations/${orgId}/roles`)
  assert.equal(rolesRes.status, 200)
  return { orgId, roles: rolesRes.body.roles }
}

async function addMember(ownerClient, orgId, roles, roleKey, memberClient, memberEmail) {
  const role = roles.find((r) => r.key === roleKey)
  assert.ok(role, `no system role found for key '${roleKey}'`)
  const inviteRes = await ownerClient.post(`/api/organizations/${orgId}/invitations`, { email: memberEmail, role_id: role.id })
  assert.equal(inviteRes.status, 200, `invite failed: ${JSON.stringify(inviteRes.body)}`)
  const acceptRes = await memberClient.post('/api/organizations/invitations/accept', { token: inviteRes.body.invite_token })
  assert.equal(acceptRes.status, 200, `accept failed: ${JSON.stringify(acceptRes.body)}`)
  const membersRes = await ownerClient.get(`/api/organizations/${orgId}/members`)
  assert.equal(membersRes.status, 200)
  const memberRow = membersRes.body.members.find((m) => m.user_id === acceptRes.body.member.user_id)
  assert.ok(memberRow, 'member row not found after accepting invitation')
  return memberRow.id // organization_members.id
}

async function createOrgListing(memberClient, orgId, opts = {}) {
  const res = await memberClient.post(`/api/organizations/${orgId}/bookable-listings`, {
    listingType: 'gig_service',
    title: opts.title ?? `SecRegListing ${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    countryIso: 'NG',
    basePriceKobo: opts.basePriceKobo ?? 500000,
    bookingMode: opts.bookingMode ?? 'request',
    capacityModel: 'single',
    resources: [{ name: 'Resource 1', capacityUnits: 1 }],
  })
  assert.equal(res.status, 201, `createOrgListing failed: ${JSON.stringify(res.body)}`)
  const detail = await memberClient.get(`/api/bookable-listings/${res.body.id}`)
  assert.equal(detail.status, 200)
  return { listingId: res.body.id, resourceId: detail.body.resources[0].id }
}

async function bookAsCustomer(customerClient, listingId, resourceId, hoursFromNow) {
  const { startsAt, endsAt } = nextFreshWindow(hoursFromNow)
  const holdRes = await customerClient.post('/api/booking-holds', { listing_id: listingId, resource_id: resourceId, starts_at: startsAt, ends_at: endsAt })
  assert.equal(holdRes.status, 201, `hold failed: ${JSON.stringify(holdRes.body)}`)
  const bookingRes = await customerClient.post('/api/bookings', { hold_id: holdRes.body.id })
  assert.equal(bookingRes.status, 201, `booking failed: ${JSON.stringify(bookingRes.body)}`)
  return bookingRes.body.id
}

// ============================================================
// A. Active member org-owned booking access (positive control)
// ============================================================

test('security regression: an active organization member (manager, bookings.manage) has full provider control over their organization-owned booking', async () => {
  const { client: owner } = await registerUser('secreg_own_1')
  const { orgId, roles } = await createOrganization(owner, 'SecReg Org One')
  const { client: manager, email: managerEmail } = await registerUser('secreg_mgr_1')
  await addMember(owner, orgId, roles, 'manager', manager, managerEmail)
  const { listingId, resourceId } = await createOrgListing(manager, orgId)
  const { client: customer } = await registerUser('secreg_cust_1')
  const bookingId = await bookAsCustomer(customer, listingId, resourceId, 201)

  const readRes = await manager.get(`/api/bookings/${bookingId}`)
  assert.equal(readRes.status, 200, 'active manager must read the org booking')

  const quoteRes = await manager.get(`/api/bookings/${bookingId}/cancellation-quote`)
  assert.equal(quoteRes.status, 200, 'active manager must be able to get a cancellation quote')

  const orgListRes = await manager.get(`/api/organizations/${orgId}/bookings`)
  assert.equal(orgListRes.status, 200)
  assert.ok(orgListRes.body.some((b) => b.id === bookingId), 'org-scoped list must include the booking for an active member')

  const transitionRes = await manager.post(`/api/bookings/${bookingId}/transition`, { status: 'declined' })
  assert.equal(transitionRes.status, 200, `active manager must be able to transition the booking: ${JSON.stringify(transitionRes.body)}`)
  assert.equal(transitionRes.body.status, 'declined')
})

// ============================================================
// B-F, 11-14: CRITICAL — removed member loses ALL provider authority,
// booking state + historical data + payment records unmutated
// ============================================================

test('CRITICAL security regression: a member REMOVED from the organization immediately loses provider authority on every provider-scoped booking endpoint, with zero side effects on booking state or payment records', async () => {
  const { client: owner } = await registerUser('secreg_own_2')
  const { orgId, roles } = await createOrganization(owner, 'SecReg Org Two')
  const { client: member, email: memberEmail } = await registerUser('secreg_mem_2')
  const memberRowId = await addMember(owner, orgId, roles, 'manager', member, memberEmail)
  const { listingId, resourceId } = await createOrgListing(member, orgId, { bookingMode: 'request' })
  const { client: customer, userId: customerUserId } = await registerUser('secreg_cust_2')
  const bookingId = await bookAsCustomer(customer, listingId, resourceId, 202)

  // Positive control: member genuinely has authority before removal.
  const beforeRead = await member.get(`/api/bookings/${bookingId}`)
  assert.equal(beforeRead.status, 200, 'sanity: active member must read the booking before removal')

  // Snapshot ground-truth state BEFORE removal, to prove denied attempts after removal mutate NOTHING.
  const bookingBefore = await queryOneD1(`SELECT status, payment_status, provider_user_id, organization_id FROM bookings WHERE id = ${bookingId}`)
  assert.equal(bookingBefore.status, 'held', 'sanity: request-mode booking starts held')
  const ledgerCountBefore = (await queryD1(`SELECT * FROM wallet_ledger WHERE reference_type = 'booking_payment' AND reference_id = '${bookingId}'`)).length
  assert.equal(ledgerCountBefore, 0, 'sanity: no payment has occurred yet')

  // ---- B: remove the member (soft-delete only — user/org rows untouched) ----
  const removeRes = await owner.delete(`/api/organizations/${orgId}/members/${memberRowId}`)
  assert.equal(removeRes.status, 200, `member removal failed: ${JSON.stringify(removeRes.body)}`)

  // Verify soft-delete semantics directly: the member row still exists with status='removed', not deleted.
  const memberRowAfter = await queryOneD1(`SELECT status FROM organization_members WHERE id = ${memberRowId}`)
  assert.ok(memberRowAfter, 'member row must still physically exist after removal (soft-delete, never a hard delete)')
  assert.equal(memberRowAfter.status, 'removed')

  const orgRowAfter = await queryOneD1(`SELECT id FROM organizations WHERE id = ${orgId}`)
  assert.ok(orgRowAfter, 'the organization itself must never be deleted as a side effect of removing one member')

  // ---- C: direct booking read after revocation — THE original vulnerability ----
  const readAfter = await member.get(`/api/bookings/${bookingId}`)
  assert.equal(readAfter.status, 404, 'CRITICAL: removed member must NOT read the booking via /api/bookings/:id')

  const quoteAfter = await member.get(`/api/bookings/${bookingId}/cancellation-quote`)
  assert.equal(quoteAfter.status, 404, 'CRITICAL: removed member must NOT get a cancellation quote')

  // ---- D: provider transition after revocation — booking state MUST remain unchanged ----
  const transitionAfter = await member.post(`/api/bookings/${bookingId}/transition`, { status: 'confirmed' })
  assert.equal(transitionAfter.status, 403, 'CRITICAL: removed member must NOT be able to transition the booking')
  assert.match(transitionAfter.body.error, /not permitted/i)

  // ---- E: cancellation/control after revocation — booking state MUST remain unchanged ----
  const cancelAfter = await member.post(`/api/bookings/${bookingId}/cancel`, { reason: 'removed member attempting to act' })
  assert.equal(cancelAfter.status, 404, 'CRITICAL: removed member must NOT be able to cancel the booking')

  // ---- F: org-scoped route after revocation ----
  const orgScopedAfter = await member.get(`/api/organizations/${orgId}/bookings`)
  assert.equal(orgScopedAfter.status, 404, 'org-scoped route must deny a removed member')

  // ---- 11-14: verify ZERO mutation occurred as a side effect of any denied attempt ----
  const bookingAfter = await queryOneD1(`SELECT status, payment_status, provider_user_id, organization_id FROM bookings WHERE id = ${bookingId}`)
  assert.equal(bookingAfter.status, bookingBefore.status, 'CRITICAL: booking status must be COMPLETELY UNCHANGED by any of the denied provider attempts above')
  assert.equal(bookingAfter.payment_status, bookingBefore.payment_status, 'payment_status must be unchanged')
  assert.equal(bookingAfter.provider_user_id, bookingBefore.provider_user_id, 'historical provider_user_id must remain intact, unmutated, never rewritten to "fix" authorization')
  assert.equal(bookingAfter.organization_id, bookingBefore.organization_id, 'organization_id (the historical ownership link) must remain intact')

  const ledgerCountAfter = (await queryD1(`SELECT * FROM wallet_ledger WHERE reference_type = 'booking_payment' AND reference_id = '${bookingId}'`)).length
  assert.equal(ledgerCountAfter, ledgerCountBefore, 'CRITICAL: no payment/ledger row must be created as a side effect of a denied provider action')

  // Historical record remains visible to the organization itself (owner), proving "denied to the removed individual" != "erased from history".
  const ownerStillSeesHistory = await owner.get(`/api/organizations/${orgId}/bookings`)
  assert.equal(ownerStillSeesHistory.status, 200)
  assert.ok(ownerStillSeesHistory.body.some((b) => b.id === bookingId), 'the organization (owner) must still see the full historical booking record after the acting member was removed')
})

// ============================================================
// New coverage beyond Invariant 7: SUSPENSION (not removal) also revokes authority immediately
// ============================================================

test('CRITICAL security regression: a member SUSPENDED (not removed) from the organization also immediately loses provider authority — suspension is not merely a softer state that still grants access', async () => {
  const { client: owner } = await registerUser('secreg_own_3')
  const { orgId, roles } = await createOrganization(owner, 'SecReg Org Three')
  const { client: member, email: memberEmail } = await registerUser('secreg_mem_3')
  const memberRowId = await addMember(owner, orgId, roles, 'manager', member, memberEmail)
  const { listingId, resourceId } = await createOrgListing(member, orgId, { bookingMode: 'request' })
  const { client: customer } = await registerUser('secreg_cust_3')
  const bookingId = await bookAsCustomer(customer, listingId, resourceId, 203)

  const beforeRead = await member.get(`/api/bookings/${bookingId}`)
  assert.equal(beforeRead.status, 200, 'sanity: active member must read the booking before suspension')

  const suspendRes = await owner.patch(`/api/organizations/${orgId}/members/${memberRowId}`, { status: 'suspended' })
  assert.equal(suspendRes.status, 200, `member suspension failed: ${JSON.stringify(suspendRes.body)}`)

  const memberRowAfter = await queryOneD1(`SELECT status FROM organization_members WHERE id = ${memberRowId}`)
  assert.equal(memberRowAfter.status, 'suspended', 'member row must reflect suspended status, not removed/active')

  const readAfter = await member.get(`/api/bookings/${bookingId}`)
  assert.equal(readAfter.status, 404, 'CRITICAL: a SUSPENDED member must NOT read the booking (resolveMembership only matches status=active)')

  const transitionAfter = await member.post(`/api/bookings/${bookingId}/transition`, { status: 'confirmed' })
  assert.equal(transitionAfter.status, 403, 'CRITICAL: a SUSPENDED member must NOT be able to transition the booking')

  const orgScopedAfter = await member.get(`/api/organizations/${orgId}/bookings`)
  assert.equal(orgScopedAfter.status, 404, 'org-scoped route must deny a suspended member exactly like a removed one')
})

// ============================================================
// G. Unrelated user / unrelated organization isolation (fresh org pair, independent proof)
// ============================================================

test('security regression: an unrelated individual provider AND a member of a completely unrelated organization both remain denied access to another organization\'s booking', async () => {
  const { client: ownerA } = await registerUser('secreg_ownA_4')
  const { orgId: orgAId, roles: rolesA } = await createOrganization(ownerA, 'SecReg Org A Four')
  const { client: memberA, email: memberAEmail } = await registerUser('secreg_memA_4')
  await addMember(ownerA, orgAId, rolesA, 'manager', memberA, memberAEmail)
  const { listingId, resourceId } = await createOrgListing(memberA, orgAId)
  const { client: customer } = await registerUser('secreg_cust_4')
  const bookingId = await bookAsCustomer(customer, listingId, resourceId, 204)

  // Unrelated individual provider, zero organization membership anywhere.
  const { client: soloProvider } = await registerUser('secreg_solo_4')
  const soloRead = await soloProvider.get(`/api/bookings/${bookingId}`)
  assert.equal(soloRead.status, 404, 'an unrelated individual provider must never read another organization\'s booking')
  const soloTransition = await soloProvider.post(`/api/bookings/${bookingId}/transition`, { status: 'confirmed' })
  assert.equal(soloTransition.status, 403, 'an unrelated individual provider must never transition another organization\'s booking')

  // Unrelated organization + its own legitimate (active, fully-authorized-within-their-own-org) member.
  const { client: ownerB } = await registerUser('secreg_ownB_4')
  const { orgId: orgBId, roles: rolesB } = await createOrganization(ownerB, 'SecReg Org B Four')
  const { client: memberB, email: memberBEmail } = await registerUser('secreg_memB_4')
  await addMember(ownerB, orgBId, rolesB, 'manager', memberB, memberBEmail)

  const crossOrgRead = await memberB.get(`/api/bookings/${bookingId}`)
  assert.equal(crossOrgRead.status, 404, 'a fully-authorized member of an UNRELATED organization must never read Org A\'s booking')
  const crossOrgTransition = await memberB.post(`/api/bookings/${bookingId}/transition`, { status: 'confirmed' })
  assert.equal(crossOrgTransition.status, 403, 'a fully-authorized member of an UNRELATED organization must never transition Org A\'s booking')
  const crossOrgScoped = await memberB.get(`/api/organizations/${orgAId}/bookings`)
  assert.equal(crossOrgScoped.status, 404, 'Org B\'s member must never access Org A\'s org-scoped booking list')
})

// ============================================================
// H. Legitimate customer access remains correct, unaffected by the fix, before AND after provider-side removal
// ============================================================

test('security regression: legitimate customer access to their own booking is completely unaffected by the Invariant 7 fix, both before and after the provider-side member is removed', async () => {
  const { client: owner } = await registerUser('secreg_own_5')
  const { orgId, roles } = await createOrganization(owner, 'SecReg Org Five')
  const { client: member, email: memberEmail } = await registerUser('secreg_mem_5')
  const memberRowId = await addMember(owner, orgId, roles, 'manager', member, memberEmail)
  const { listingId, resourceId } = await createOrgListing(member, orgId, { bookingMode: 'request' })
  const { client: customer } = await registerUser('secreg_cust_5')
  const bookingId = await bookAsCustomer(customer, listingId, resourceId, 205)

  // Customer access BEFORE removal.
  const readBefore = await customer.get(`/api/bookings/${bookingId}`)
  assert.equal(readBefore.status, 200, 'customer must read their own booking before any org membership change')
  const quoteBefore = await customer.get(`/api/bookings/${bookingId}/cancellation-quote`)
  assert.equal(quoteBefore.status, 200, 'customer must get a cancellation quote before any org membership change')
  const listBefore = await customer.get('/api/bookings')
  assert.equal(listBefore.status, 200)
  assert.ok(listBefore.body.some((b) => b.id === bookingId), 'customer\'s own booking list must include this booking before removal')

  // Remove the provider-side member — this must have ZERO effect on the customer's own access.
  const removeRes = await owner.delete(`/api/organizations/${orgId}/members/${memberRowId}`)
  assert.equal(removeRes.status, 200)

  // Customer access AFTER removal — must be identical, unaffected.
  const readAfter = await customer.get(`/api/bookings/${bookingId}`)
  assert.equal(readAfter.status, 200, 'the security fix must NOT accidentally block the legitimate customer after the provider-side member is removed')
  const quoteAfter = await customer.get(`/api/bookings/${bookingId}/cancellation-quote`)
  assert.equal(quoteAfter.status, 200, 'customer cancellation-quote access must remain intact after the provider-side member is removed')
  const listAfter = await customer.get('/api/bookings')
  assert.equal(listAfter.status, 200)
  assert.ok(listAfter.body.some((b) => b.id === bookingId), 'customer\'s own booking list must still include this booking after removal')

  // Customer must still be able to cancel their own booking (customer-role authorization is entirely separate from the provider-role fix).
  const cancelRes = await customer.post(`/api/bookings/${bookingId}/cancel`, { reason: 'customer changed plans' })
  assert.equal(cancelRes.status, 200, `customer must still be able to cancel their own booking after the provider-side member was removed: ${JSON.stringify(cancelRes.body)}`)
})

// ============================================================
// I. Admin access (checklist item, "if applicable") — STATIC code-level regression check, not a fabricated HTTP test
// ============================================================

test('security regression (static): no HTTP route in api-bookings.ts currently grants role:\'admin\' booking authority without requirePlatformRole(\'admin\') — documents the verified absence rather than fabricating a nonexistent admin endpoint', () => {
  const srcPath = fileURLToPath(new URL('../../src/routes/api-bookings.ts', import.meta.url))
  const source = readFileSync(srcPath, 'utf8')

  // If a future change introduces an admin-role actor for booking transitions,
  // it MUST be gated by requirePlatformRole('admin') somewhere in this file —
  // exactly as api-admin.ts's own module comment mandates for every admin
  // route ("Every route here is gated by requirePlatformRole('admin')").
  // This assertion fails loudly if role:'admin' is introduced without that
  // guard present anywhere in the same file, catching an accidental
  // privilege-escalation regression before it ships.
  const hasAdminActorRole = /role\s*:\s*['"]admin['"]/.test(source)
  if (hasAdminActorRole) {
    const hasPlatformRoleGuard = /requirePlatformRole\(\s*['"]admin['"]\s*\)/.test(source)
    assert.ok(hasPlatformRoleGuard, 'a role:\'admin\' actor was introduced in api-bookings.ts WITHOUT a corresponding requirePlatformRole(\'admin\') guard in the same file — this is a privilege-escalation regression, fix before merging')
  } else {
    // Documented, verified state as of this checkpoint: no admin-role HTTP
    // path exists yet, so there is nothing to test at the HTTP level for
    // "legitimate admin access" — honestly recorded as N/A rather than
    // fabricated. transitionBooking() supports actor.role='admin' at the
    // library level (see booking-lifecycle.ts) for a FUTURE route to use.
    assert.equal(hasAdminActorRole, false)
  }
})

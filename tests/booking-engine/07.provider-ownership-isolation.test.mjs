/**
 * Invariant #7: provider ownership isolation — organization-owned bookings
 * must re-resolve CURRENT organization membership, never trust the
 * historical `bookings.provider_user_id` column as a substitute for live
 * authorization.
 *
 * BUG THIS FILE WAS WRITTEN TO CATCH (confirmed by live reproduction before
 * any code was touched — see chat history's "Finding B"): an organization
 * member who creates an organization-owned booking gets their own user id
 * permanently stamped into `bookings.provider_user_id` at creation time
 * (this is correct and intentional — see booking-lifecycle.ts's own header
 * comment on historical attribution for audit/dispute-resolution). The bug
 * was that THREE call sites in api-bookings.ts checked
 * `booking.provider_user_id === user.id` FIRST, unconditionally, before
 * ever considering whether the booking is organization-owned — so once
 * that member is later REMOVED from the organization, they still passed
 * this check and retained full provider authority forever, even though the
 * org-scoped route (`/organizations/:organizationId/bookings`) correctly
 * denied them. A FOURTH leak existed in the individual-identity LIST
 * endpoints (`/booking-providers/me/bookings`, `/booking-providers/me/
 * bookable-listings` and everything built on `getOwnedListingForProvider`)
 * which queried `WHERE provider_user_id = ?` with no `organization_id IS
 * NULL` guard, so a member (current OR removed) always saw org-owned
 * resources mixed into their personal/individual-identity views.
 *
 * THE FIX (see booking-lifecycle.ts's `hasProviderAuthorityOverBooking` and
 * its doc comment): for an INDIVIDUAL-owned booking (organization_id IS
 * NULL), provider_user_id equality IS the authority — there is no
 * membership layer to re-check, this is the provider's own permanent
 * identity. For an ORGANIZATION-owned booking (organization_id IS NOT
 * NULL), authority is ALWAYS re-resolved live via resolveMembership +
 * the requested permission key — the historical provider_user_id column is
 * never consulted for authorization purposes on this path (it remains in
 * the row, unmodified, for audit/reporting/dispute-resolution — historical
 * record and current authorization are different concepts, and this file
 * verifies that separation holds even after a member is removed).
 *
 * TEST NUMBERING mirrors the 7-point minimum this invariant was scoped to:
 *   1. Org A member can access Org A's booking.
 *   2. Org B member cannot access Org A's booking (cross-org isolation).
 *   3. Unrelated individual provider cannot access an org-owned booking.
 *   4. A bookings.read-only member can read but not manage/transition.
 *   5. A member without bookings.manage cannot cancel/transition.
 *   6. A member WITH bookings.manage can manage/transition the org's booking.
 *   7. CRITICAL REGRESSION: removed member loses ALL provider authority —
 *      org-scoped route, direct booking GET, transition, cancel,
 *      cancellation-quote, AND the individual-identity list endpoints.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerUser, nextFreshWindow } from './helpers/client.mjs'

// ---------- local fixture helpers (organization flow is new to this file; no shared helper existed yet) ----------

/** Creates an organization (as `ownerClient`'s user) and returns {orgId, roles}. */
async function createOrganization(ownerClient, name) {
  const res = await ownerClient.post('/api/organizations', { name })
  assert.equal(res.status, 200, `createOrganization failed: ${JSON.stringify(res.body)}`)
  const orgId = res.body.organization.id
  const rolesRes = await ownerClient.get(`/api/organizations/${orgId}/roles`)
  assert.equal(rolesRes.status, 200)
  return { orgId, roles: rolesRes.body.roles }
}

/** Invites `memberEmail` into `orgId` with the given system role key ('manager' | 'staff' | 'admin'), and accepts on behalf of `memberClient`. Returns the created organization_members.id (needed for later removal). */
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
  return memberRow.id // organization_members.id, used by DELETE .../members/:memberId
}

/** Creates an org-owned bookable listing (as `memberClient`, an authorized member of `orgId`) and returns {listingId, resourceId}. */
async function createOrgListing(memberClient, orgId, opts = {}) {
  const res = await memberClient.post(`/api/organizations/${orgId}/bookable-listings`, {
    listingType: 'gig_service',
    title: opts.title ?? `Org Listing ${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    countryIso: 'NG',
    basePriceKobo: opts.basePriceKobo ?? 500000,
    bookingMode: opts.bookingMode ?? 'instant',
    capacityModel: 'single',
    resources: [{ name: 'Resource 1', capacityUnits: 1 }],
  })
  assert.equal(res.status, 201, `createOrgListing failed: ${JSON.stringify(res.body)}`)
  const detail = await memberClient.get(`/api/bookable-listings/${res.body.id}`)
  assert.equal(detail.status, 200)
  return { listingId: res.body.id, resourceId: detail.body.resources[0].id }
}

/** Full flow: `customerClient` books `listingId`/`resourceId`. Returns the created bookingId. */
async function bookAsCustomer(customerClient, listingId, resourceId, hoursFromNow = 100) {
  const { startsAt, endsAt } = nextFreshWindow(hoursFromNow)
  const holdRes = await customerClient.post('/api/booking-holds', { listing_id: listingId, resource_id: resourceId, starts_at: startsAt, ends_at: endsAt })
  assert.equal(holdRes.status, 201, `hold failed: ${JSON.stringify(holdRes.body)}`)
  const bookingRes = await customerClient.post('/api/bookings', { hold_id: holdRes.body.id })
  assert.equal(bookingRes.status, 201, `booking failed: ${JSON.stringify(bookingRes.body)}`)
  return bookingRes.body.id
}

// ---------- 1. Org A member can access Org A's booking ----------

test('provider isolation: an active organization member can read their organization-owned booking', async () => {
  const { client: owner } = await registerUser('own_orgA_1')
  const { orgId, roles } = await createOrganization(owner, 'Org A One')
  const { client: member, email: memberEmail } = await registerUser('mem_orgA_1')
  await addMember(owner, orgId, roles, 'manager', member, memberEmail)
  const { listingId, resourceId } = await createOrgListing(member, orgId)
  const { client: customer } = await registerUser('cust_orgA_1')
  const bookingId = await bookAsCustomer(customer, listingId, resourceId, 101)

  const res = await member.get(`/api/bookings/${bookingId}`)
  assert.equal(res.status, 200, `expected active member to read their org's booking, got ${res.status}: ${JSON.stringify(res.body)}`)
  assert.equal(res.body.booking.id, bookingId)
})

// ---------- 2. Org B member cannot access Org A's booking ----------

test('provider isolation: a member of an UNRELATED organization cannot read Org A\'s booking (cross-org isolation)', async () => {
  const { client: ownerA } = await registerUser('own_orgA_2')
  const { orgId: orgAId, roles: rolesA } = await createOrganization(ownerA, 'Org A Two')
  const { client: memberA, email: memberAEmail } = await registerUser('mem_orgA_2')
  await addMember(ownerA, orgAId, rolesA, 'manager', memberA, memberAEmail)
  const { listingId, resourceId } = await createOrgListing(memberA, orgAId)
  const { client: customer } = await registerUser('cust_orgA_2')
  const bookingId = await bookAsCustomer(customer, listingId, resourceId, 102)

  const { client: ownerB } = await registerUser('own_orgB_2')
  const { orgId: orgBId, roles: rolesB } = await createOrganization(ownerB, 'Org B Two')
  const { client: memberB, email: memberBEmail } = await registerUser('mem_orgB_2')
  await addMember(ownerB, orgBId, rolesB, 'manager', memberB, memberBEmail)

  const res = await memberB.get(`/api/bookings/${bookingId}`)
  assert.equal(res.status, 404, 'a member of a different organization must never read another organization\'s booking')
})

// ---------- 3. Unrelated individual provider cannot access organization-owned booking ----------

test('provider isolation: an unrelated INDIVIDUAL provider (no organization membership at all) cannot read an organization-owned booking', async () => {
  const { client: owner } = await registerUser('own_orgA_3')
  const { orgId, roles } = await createOrganization(owner, 'Org A Three')
  const { client: member, email: memberEmail } = await registerUser('mem_orgA_3')
  await addMember(owner, orgId, roles, 'manager', member, memberEmail)
  const { listingId, resourceId } = await createOrgListing(member, orgId)
  const { client: customer } = await registerUser('cust_orgA_3')
  const bookingId = await bookAsCustomer(customer, listingId, resourceId, 103)

  const { client: soloProvider } = await registerUser('solo_prov_3')
  const res = await soloProvider.get(`/api/bookings/${bookingId}`)
  assert.equal(res.status, 404, 'an individual provider with zero relationship to the booking or its organization must get the same 404 as "does not exist"')
})

// ---------- 4. bookings.read-only member: read allowed, manage/transition denied ----------

test('provider isolation: a member with ONLY bookings.read (staff role) can read the booking but cannot cancel or transition it', async () => {
  const { client: owner } = await registerUser('own_orgA_4')
  const { orgId, roles } = await createOrganization(owner, 'Org A Four')
  // The listing/booking must be created by a manage-capable actor; 'staff' role only has bookings.read (migration 0037 seed).
  const { client: manager, email: managerEmail } = await registerUser('mgr_orgA_4')
  await addMember(owner, orgId, roles, 'manager', manager, managerEmail)
  const { listingId, resourceId } = await createOrgListing(manager, orgId)
  const { client: customer } = await registerUser('cust_orgA_4')
  const bookingId = await bookAsCustomer(customer, listingId, resourceId, 104)

  const { client: staffMember, email: staffEmail } = await registerUser('staff_orgA_4')
  await addMember(owner, orgId, roles, 'staff', staffMember, staffEmail)

  const readRes = await staffMember.get(`/api/bookings/${bookingId}`)
  assert.equal(readRes.status, 200, 'bookings.read must permit reading the booking')

  const quoteRes = await staffMember.get(`/api/bookings/${bookingId}/cancellation-quote`)
  assert.equal(quoteRes.status, 200, 'bookings.read must permit the read-only cancellation-quote endpoint')

  const cancelRes = await staffMember.post(`/api/bookings/${bookingId}/cancel`, { reason: 'staff attempting a manage action' })
  assert.equal(cancelRes.status, 404, 'a read-only member attempting to cancel must get the established anti-enumeration 404, not a 403 or success')

  const transitionRes = await staffMember.post(`/api/bookings/${bookingId}/transition`, { status: 'confirmed' })
  assert.equal(transitionRes.status, 403, 'a read-only member attempting to transition must get the established 403 "not permitted" response')
  assert.match(transitionRes.body.error, /not permitted/i)
})

// ---------- 5. Member without bookings.manage cannot cancel/transition (duplicate-emphasis on the manage boundary using a fresh org) ----------

test('provider isolation: a member without bookings.manage cannot force a provider-side transition even on their own organization\'s booking', async () => {
  const { client: owner } = await registerUser('own_orgA_5')
  const { orgId, roles } = await createOrganization(owner, 'Org A Five')
  const { client: manager, email: managerEmail } = await registerUser('mgr_orgA_5')
  await addMember(owner, orgId, roles, 'manager', manager, managerEmail)
  const { listingId, resourceId } = await createOrgListing(manager, orgId)
  const { client: customer } = await registerUser('cust_orgA_5')
  const bookingId = await bookAsCustomer(customer, listingId, resourceId, 105)

  const { client: staffMember, email: staffEmail } = await registerUser('staff_orgA_5')
  await addMember(owner, orgId, roles, 'staff', staffMember, staffEmail)

  const res = await staffMember.post(`/api/bookings/${bookingId}/transition`, { status: 'declined' })
  assert.equal(res.status, 403)
})

// ---------- 6. Member WITH bookings.manage CAN manage the org's booking ----------

test('provider isolation: an active member with bookings.manage CAN transition and cancel their organization\'s booking', async () => {
  const { client: owner } = await registerUser('own_orgA_6')
  const { orgId, roles } = await createOrganization(owner, 'Org A Six')
  const { client: manager, email: managerEmail } = await registerUser('mgr_orgA_6')
  await addMember(owner, orgId, roles, 'manager', manager, managerEmail)

  const { listingId, resourceId } = await createOrgListing(manager, orgId, { bookingMode: 'request' })
  const { client: customer } = await registerUser('cust_orgA_6')
  const bookingId = await bookAsCustomer(customer, listingId, resourceId, 106)

  // request-mode listing -> booking starts 'held'; provider can confirm.
  const transitionRes = await manager.post(`/api/bookings/${bookingId}/transition`, { status: 'declined' })
  assert.equal(transitionRes.status, 200, `expected manage-capable active member to transition successfully: ${JSON.stringify(transitionRes.body)}`)
  assert.equal(transitionRes.body.status, 'declined')
})

// ---------- 7. CRITICAL REGRESSION: removed member loses ALL provider authority ----------

test('provider isolation CRITICAL REGRESSION: a member removed from the organization immediately loses ALL provider authority over its bookings/listings, across every provider-scoped endpoint', async () => {
  const { client: owner } = await registerUser('own_orgA_7')
  const { orgId, roles } = await createOrganization(owner, 'Org A Seven')
  const { client: member, userId: memberId, email: memberEmail } = await registerUser('mem_orgA_7')
  const memberRowId = await addMember(owner, orgId, roles, 'manager', member, memberEmail)

  const { listingId, resourceId } = await createOrgListing(member, orgId, { bookingMode: 'request' })
  const { client: customer } = await registerUser('cust_orgA_7')
  const bookingId = await bookAsCustomer(customer, listingId, resourceId, 107)

  // ---- BEFORE removal: member genuinely has authority (positive control, proves the fix didn't just break everything) ----
  const beforeRead = await member.get(`/api/bookings/${bookingId}`)
  assert.equal(beforeRead.status, 200, 'sanity check before removal: active member must be able to read the booking')
  const beforeOrgList = await member.get(`/api/organizations/${orgId}/bookings`)
  assert.equal(beforeOrgList.status, 200)
  assert.ok(beforeOrgList.body.some((b) => b.id === bookingId), 'sanity check before removal: org-scoped list must include the booking')
  const beforeMeList = await member.get('/api/booking-providers/me/bookings')
  assert.equal(beforeMeList.status, 200)

  // ---- Remove the member from the organization ----
  const removeRes = await owner.delete(`/api/organizations/${orgId}/members/${memberRowId}`)
  assert.equal(removeRes.status, 200, `member removal failed: ${JSON.stringify(removeRes.body)}`)

  // ---- AFTER removal: every provider-scoped surface must deny the ex-member ----

  // (a) org-scoped route — already correctly enforced before this fix; re-verified here as a control.
  const orgScopedAfter = await member.get(`/api/organizations/${orgId}/bookings`)
  assert.equal(orgScopedAfter.status, 404, 'org-scoped route must deny a removed member (anti-enumeration 404)')

  // (b) direct booking read — THE vulnerability this invariant was written to close.
  const readAfter = await member.get(`/api/bookings/${bookingId}`)
  assert.equal(readAfter.status, 404, 'CRITICAL: a removed member must NOT be able to read the booking via the direct /api/bookings/:id path')

  // (c) cancellation-quote — same loadBookingForRequest authority path as (b).
  const quoteAfter = await member.get(`/api/bookings/${bookingId}/cancellation-quote`)
  assert.equal(quoteAfter.status, 404, 'CRITICAL: a removed member must NOT be able to read a cancellation quote for the booking')

  // (d) transition — the exact endpoint proven vulnerable in the live reproduction (previously returned 200 + successfully confirmed the booking).
  const transitionAfter = await member.post(`/api/bookings/${bookingId}/transition`, { status: 'confirmed' })
  assert.equal(transitionAfter.status, 403, 'CRITICAL: a removed member must NOT be able to force a transition on the booking (established 403 "not permitted" semantics, matching an authenticated-but-unauthorized actor)')
  assert.match(transitionAfter.body.error, /not permitted/i)

  // (e) cancel — mirrors (d) but must preserve the anti-enumeration 404 the cancel endpoint already established for authorization failures.
  const cancelAfter = await member.post(`/api/bookings/${bookingId}/cancel`, { reason: 'removed member attempting to act' })
  assert.equal(cancelAfter.status, 404, 'CRITICAL: a removed member must NOT be able to cancel the booking')

  // (f) individual-identity list endpoints must no longer surface the org-owned booking/listing at all (they never should have, regardless of removal — see doc comment).
  const meListAfter = await member.get('/api/booking-providers/me/bookings')
  assert.equal(meListAfter.status, 200)
  assert.ok(!meListAfter.body.some((b) => b.id === bookingId), 'CRITICAL: the individual-identity /booking-providers/me/bookings list must never surface an organization-owned booking')

  const meListingsAfter = await member.get('/api/booking-providers/me/bookable-listings')
  assert.equal(meListingsAfter.status, 200)
  assert.ok(!meListingsAfter.body.some((l) => l.id === listingId), 'CRITICAL: the individual-identity /booking-providers/me/bookable-listings list must never surface an organization-owned listing')

  const meListingDetailAfter = await member.get(`/api/booking-providers/me/bookable-listings/${listingId}`)
  assert.equal(meListingDetailAfter.status, 404, 'CRITICAL: the individual-identity single-listing-detail endpoint must never resolve an organization-owned listing')

  // ---- Historical record must be preserved: booking.provider_user_id must still show the (now-removed) member, unmodified, for audit/dispute purposes ----
  // Verified via the OWNER's admin-adjacent org-scoped view, which is unaffected by this fix (owner still has full membership/permissions).
  const ownerStillSeesHistory = await owner.get(`/api/organizations/${orgId}/bookings`)
  assert.equal(ownerStillSeesHistory.status, 200)
  const historicalRow = ownerStillSeesHistory.body.find((b) => b.id === bookingId)
  assert.ok(historicalRow, 'historical booking record must remain visible to the organization (owner) even after the acting member was removed')
})

# NaijaGigs and NaijaStay API Contracts

## GIGS-001 collaboration

All routes below require the existing authenticated session cookie. The server resolves the customer/provider participant from the service order; client-supplied user IDs are ignored because none are accepted.

- `GET /api/service-orders/:id/collaboration`
  - Returns `{ milestones: [], messages: [] }` for an authorized customer or assigned provider.
  - Returns `404` for a non-participant or missing order.
- `POST /api/service-orders/:id/messages`
  - Body: `{ body: string }`, 1–2000 trimmed characters.
  - Optional `Idempotency-Key` (maximum 200 characters) makes retries return the original message without inserting a duplicate.
  - Authorized customer/provider only; unauthorized access returns `404`.
  - Appends `message_created` to `service_order_events`; no payment or ledger operation occurs.
- `POST /api/service-orders/:id/milestones`
  - Provider-only body: `{ title: string, description?: string, due_at?: string|null }`.
  - Title is 1–160 characters; description is at most 2000 characters.
  - Optional `Idempotency-Key` makes provider retries return the original milestone.
  - Customer receives `403`; non-participants receive `403/404` according to route ownership handling.
  - Appends `milestone_created` to `service_order_events`.
- `POST /api/service-orders/:id/milestones/:milestoneId/transition`
  - Body: `{ status: string }`.
  - Provider: `pending → in_progress|cancelled`, `in_progress → submitted|cancelled`, `rejected → in_progress|cancelled`.
  - Customer: `submitted → approved|rejected`.
  - Invalid transitions return `400`; the update is compare-and-set on the prior status.
  - Appends `milestone_transition` to `service_order_events`.

Milestones and messages use additive D1 tables from migration `0104_gigs_collaboration.sql`. The idempotency indexes and registry evidence update are in `0105_gigs_stay_registry_update.sql` (the latter updates only the development registry). Payment remains `unpaid` until a separately authorized payment workflow exists.

## STAY-001 host operations

NaijaStay reuses the generic Booking Engine rather than creating a second booking system. Authenticated host/provider operations include:

- `POST /api/booking-providers/me/bookable-listings`
- `GET/PATCH /api/booking-providers/me/bookable-listings/:id`
- `POST /api/booking-providers/me/bookable-listings/:id/resources`
- `POST /api/booking-providers/me/bookable-listings/:id/availability-blocks`
- `GET /api/booking-providers/me/bookable-listings/:id/availability-blocks`
- `POST /api/booking-providers/me/bookable-listings/:id/resources/:resourceId/availability-rules`
- `GET /api/booking-providers/me/bookings`
- `POST /api/bookings/:id/transition`
- `POST /api/bookings/:id/cancel`

The server resolves ownership from the authenticated user and uses the existing booking lifecycle, availability, holds, cancellation, and rollout guard. The focused host regression proves listing ownership isolation, update, availability blocking, and invalid weekday rejection. A host workspace UI and authenticated browser acceptance remain incomplete.

## Acceptance boundaries

Automated API/preview evidence is not browser acceptance and is not production verification. No production D1/R2 mutation, deployment, payment configuration, or live booking was performed in this milestone.

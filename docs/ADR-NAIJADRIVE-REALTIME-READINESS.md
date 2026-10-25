# ADR: NaijaDrive real-time readiness

- **Status:** Accepted for preview foundation; production delivery deferred
- **Date:** 2026-10-25
- **Scope:** Customer ride status, driver offers, availability and carpool decisions in the Cloudflare Pages preview

## Context

NaijaDrive currently persists ride state in local/development D1 and exposes authenticated reads and writes. The preview must not claim live GPS, WebSocket dispatch, external routing or payment success. Browser-authenticated acceptance is currently blocked because no authorized isolated customer/driver session is available.

## Options considered

| Option | Compatibility | Ordering/duplicates | Cost and operational risk | Decision |
|---|---|---|---|---|
| Server-Sent Events | Possible with Worker streaming, but requires connection lifecycle, replay cursor and durable event fan-out | Requires event IDs, reconnect cursors and a durable event source | More moving parts than the current preview proves | Defer |
| WebSockets | Requires a dedicated Durable Object/session design or external runtime for reliable fan-out and presence | Requires connection ownership, replay, backpressure and authorization per message | Not justified for current D1 preview; live presence is explicitly unconfigured | Defer |
| Bounded polling | Uses existing authenticated `GET /api/drive/rides/:id`; naturally re-reads authoritative persisted state | Each response is a fresh snapshot; duplicate reads are harmless and client requests are serialized | Lowest cost, easiest to test, works with Pages/Workers and existing APIs | **Choose for preview** |

## Decision

Implement bounded, visibility-aware polling on the existing customer ride status panel. Polling is a refresh convenience, not a claim of real-time delivery:

- It starts only after the customer has a persisted ride ID.
- It stops for terminal states (`completed`, `cancelled`, `no_driver_available`).
- It pauses when the document is hidden and resumes when visible.
- It uses a conservative interval and a single in-flight request guard.
- The authenticated API remains the authorization boundary and source of truth.
- No event bus, WebSocket, SSE stream, paid dependency, GPS feed or production presence service is introduced.

## Consequences

The preview gives customers bounded status freshness without creating a second state machine. It does not provide sub-second updates, push delivery, offline replay, or live driver location. A future SSE/WebSocket implementation must preserve the same server-side ownership rules and add event IDs, replay/cursor semantics, reconnect backoff, connection limits and authenticated browser acceptance before production enablement.

## Acceptance evidence

- Existing ride status API and lifecycle tests remain authoritative.
- The polling client is covered by build/type checks and uses the existing status endpoint.
- Automated API regression, ownership, concurrency, expiry, availability and carpool checks must pass before commit.
- Authenticated browser acceptance remains an explicit external blocker and is not claimed by this ADR.

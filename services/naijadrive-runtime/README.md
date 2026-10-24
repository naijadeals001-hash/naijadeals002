# NaijaDrive Runtime — Private Ride Foundation

This package is the first production-oriented bounded context for NaijaDrive. It is intentionally separate from the Cloudflare Worker because passenger mobility requires persistent PostgreSQL/PostGIS, Redis, WebSockets, and background processing.

## Implemented in this slice

- Abuja pilot zone configuration.
- Abuja car category enabled; motorcycle, tricycle, van remain disabled pending regulatory/operational approval.
- Integer-kobo fare estimation.
- Private ride lifecycle domain rules.
- Customer cancellation authorization.
- Driver eligibility checks.
- Atomic assignment repository contract and PostgreSQL adapter.
- Ride status audit-event contract.
- NestJS HTTP and WebSocket composition seams.
- PostgreSQL foundation migration.
- Automated domain tests using an in-memory repository.

## Current limitations

- Production NestJS composition still uses an in-memory adapter; PostgreSQL wiring is implemented but not yet connected in `AppModule`.
- Redis presence, GPS ingestion, dispatch scoring, routing, payment authorization, and mobile clients are not part of this first slice.
- Abuja zone boundaries are currently configurable radius records. They are not yet polygonal PostGIS boundaries.
- No vehicle category is enabled until the required Abuja regulatory and operational review is completed. The initial car rule is a development configuration, not an authorization to launch rides.

## Run

```bash
npm install
npm test
npm run build
```

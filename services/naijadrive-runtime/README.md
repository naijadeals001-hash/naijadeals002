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
- PostgreSQL connection pool, transactional migration runner, and startup health checks.
- PostGIS boundary validation and spatial index migration.
- Redis-backed driver presence heartbeats and assignment claims.
- NaijaDeal session introspection bridge and permission-aware NestJS guards.
- Ride status audit-event persistence adapter.
- NestJS HTTP and WebSocket composition using Fastify.
- PostgreSQL foundation migrations.
- Automated domain tests using an explicitly test-only in-memory repository.

## Current limitations

- PostgreSQL, PostGIS, Redis, and the NaijaDeal identity bridge are wired in code but could not be integration-tested in this sandbox because no PostgreSQL/PostGIS or Redis service is provisioned here.
- The production composition fails closed when `DATABASE_URL`, `REDIS_URL`, `NAIJADEAL_IDENTITY_URL`, or `NAIJADEAL_IDENTITY_SERVICE_TOKEN` is missing; it never falls back to the in-memory adapter.
- Redis presence is implemented for heartbeats and assignment claims; GPS WebSocket ingestion, routing, offer expiry workers, payment reconciliation, and customer/driver clients remain incomplete.
- Abuja geometry migration currently uses development circular geometries and must be replaced with approved FCT operating polygons before passenger operations.
- No vehicle category is enabled in the PostgreSQL seed until regulatory and operational approval is recorded. The application-level car fare rule remains development configuration, not launch authorization.
- Dependency audit still reports high-severity Fastify/optional Nest adapter advisories and requires a reviewed compatible upgrade before public exposure.

## Run

```bash
cp .env.example .env
npm install
npm test
npm run build
npm run start:dev
```

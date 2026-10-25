# NaijaDrive preview API contracts

These contracts describe the authenticated D1-backed preview only. They do not authorize production dispatch, GPS, WebSocket presence, external routing or payment settlement.

## Authentication and errors

- Protected endpoints require the existing session cookie and return `401` when unauthenticated.
- Resource ownership is enforced server-side; inaccessible customer resources return `404` rather than leaking existence.
- Invalid payloads return `400`.
- Valid but stale, terminal or concurrent state changes return `409`.
- Successful JSON responses include the persisted status or resource identifier needed for a subsequent refresh.

## Private rides

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/drive/rides` | Create an idempotent customer ride request with validated pilot zones and simulated quote. |
| `GET` | `/api/drive/rides/:id` | Read a customer-owned ride and ordered lifecycle events. |
| `POST` | `/api/drive/rides/:id/cancel` | Cancel a customer-owned ride while the state machine allows it. |
| `GET` | `/api/drive/driver/availability` | Read the authenticated active driver's persisted online state. |
| `POST` | `/api/drive/driver/availability` | Persist an active driver's online/offline state. |
| `POST` | `/api/drive/rides/:id/offers` | Create one persisted offer for an active online driver. |
| `GET` | `/api/drive/driver/offers` | Read the authenticated driver's persisted offers; expiry recovery runs before the read. |
| `POST` | `/api/drive/driver/offers/:id/accept` | Atomically claim an eligible offer and assignment. |
| `POST` | `/api/drive/driver/offers/:id/reject` | Reject an unexpired owned offer and trigger reassignment/no-driver recovery. |
| `POST` | `/api/drive/driver/rides/:id/transition` | Apply an authorized driver lifecycle transition through completion. |

Private ride statuses are persisted as `requested`, `searching`, `offered`, `accepted`, `driver_arriving`, `driver_arrived`, `in_progress`, `completed`, `cancelled`, or `no_driver_available`.

## Carpool

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/carpool/trips` | Publish an authenticated driver's persisted trip and seat inventory. |
| `GET` | `/api/carpool/trips` | Search published trips with available seats. |
| `POST` | `/api/carpool/trips/:id/requests` | Request seats as a passenger with inventory guards. |
| `GET` | `/api/carpool/driver/requests` | Read passenger requests for trips owned by the authenticated driver. |
| `POST` | `/api/carpool/requests/:id/decision` | Accept or reject an owned passenger request. Rejection restores seats. |
| `POST` | `/api/carpool/requests/:id/cancel` | Cancel an owned requested/accepted passenger request and restore seats safely. |

## Integration readiness

The current UI uses authenticated reads and bounded polling for customer status. Browser-authenticated acceptance remains blocked because no authorized isolated session is available. Contract tests run against the local preview and do not imply production availability.

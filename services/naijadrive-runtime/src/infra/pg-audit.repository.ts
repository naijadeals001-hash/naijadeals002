import type { Pool } from 'pg'
import type { AuditPort, RideStatusEvent } from '../domain/types.js'

export class PgAuditPort implements AuditPort {
  constructor(private readonly pool: Pool) {}

  async record(event: RideStatusEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO naijadrive_ride_audit_events
       (ride_id, action, actor_user_id, actor_role, from_status, to_status, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [event.rideId, `${event.fromStatus ?? 'none'}_to_${event.toStatus}`, event.actorUserId, event.actorRole, event.fromStatus, event.toStatus, event.note],
    )
  }
}

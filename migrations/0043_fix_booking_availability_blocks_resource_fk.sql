-- Migration 0043: Fix booking_availability_blocks.resource_id wrong FK target
--
-- BUG (found by the Booking Engine 2.0 permanent regression harness, first
-- run after the 57-check verification gate): migration 0039 (Service Engine
-- 2.0) added `resource_id INTEGER REFERENCES service_resources(id)` to the
-- EXISTING booking_availability_blocks table (migration 0024) so a block
-- could optionally be scoped to one resource. At the time, Service Engine's
-- service_resources was the only "resource" table in the codebase. Migration
-- 0041 (Booking Engine 2.0) then introduced its OWN, separate
-- booking_resources table — but the earlier FK on
-- booking_availability_blocks.resource_id was never updated to match.
--
-- The ONLY writer of this column is src/lib/bookings.ts's
-- createAvailabilityBlock(), and it has always bound a booking_resources.id
-- value (never a service_resources.id) — so every resource-scoped booking
-- availability block insert since Booking Engine 2.0 shipped has been
-- silently at risk of an FK violation, EXCEPT when the numeric id happened
-- to coincidentally also exist as a row in service_resources (which is what
-- made the manual proof-gate's own availability-block test pass: resource_id
-- 2 happened to exist in both tables by coincidence). The regression
-- harness's own fresh-fixture test (which does not share ids with
-- service_resources) hit the real SQLITE_CONSTRAINT_FOREIGNKEY error and
-- leaked it raw to the client as a 400.
--
-- FIX: rebuild booking_availability_blocks with resource_id correctly
-- referencing booking_resources(id) instead. Only 1 existing row at the time
-- of this migration (id=1, resource_id=2, which IS a valid booking_resources
-- row) — carried forward exactly, zero data loss, verified before writing
-- this migration via `SELECT COUNT(*) FROM booking_availability_blocks`.
--
-- Uses the SAME CREATE-rebuild -> INSERT SELECT -> DROP -> RENAME pattern as
-- migrations 0027, 0042 (SQLite cannot ALTER a column's REFERENCES clause
-- in place).

CREATE TABLE booking_availability_blocks__rebuild_0043 (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id           INTEGER NOT NULL REFERENCES bookable_listings(id) ON DELETE CASCADE,
  blocked_from         TEXT NOT NULL,
  blocked_until        TEXT NOT NULL,
  reason               TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  resource_id          INTEGER REFERENCES booking_resources(id) ON DELETE CASCADE
);

INSERT INTO booking_availability_blocks__rebuild_0043
  SELECT id, listing_id, blocked_from, blocked_until, reason, created_at, resource_id
  FROM booking_availability_blocks;

DROP TABLE booking_availability_blocks;
ALTER TABLE booking_availability_blocks__rebuild_0043 RENAME TO booking_availability_blocks;

CREATE INDEX IF NOT EXISTS idx_booking_availability_listing ON booking_availability_blocks(listing_id, blocked_from, blocked_until);
CREATE INDEX IF NOT EXISTS idx_booking_availability_blocks_resource ON booking_availability_blocks(resource_id);

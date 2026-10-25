CREATE TABLE IF NOT EXISTS drive_ride_requests (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 customer_user_id INTEGER NOT NULL REFERENCES users(id),
 pickup_zone TEXT NOT NULL,
 dropoff_zone TEXT NOT NULL,
 vehicle_category TEXT NOT NULL DEFAULT 'car',
 status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','searching','offered','accepted','driver_arriving','driver_arrived','in_progress','completed','cancelled','no_driver_available')),
 fare_kobo INTEGER NOT NULL,
 currency TEXT NOT NULL DEFAULT 'NGN',
 fare_mode TEXT NOT NULL CHECK(fare_mode IN ('simulated','routed')),
 idempotency_key TEXT,
 accepted_driver_profile_id INTEGER REFERENCES driver_profiles(id),
 requested_at TEXT NOT NULL DEFAULT(datetime('now')),
 accepted_at TEXT,
 completed_at TEXT,
 cancelled_at TEXT,
 created_at TEXT NOT NULL DEFAULT(datetime('now')),
 updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_drive_ride_customer_idempotency ON drive_ride_requests(customer_user_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drive_ride_status ON drive_ride_requests(status,created_at);
CREATE TABLE IF NOT EXISTS drive_ride_offers (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 ride_request_id INTEGER NOT NULL REFERENCES drive_ride_requests(id) ON DELETE CASCADE,
 driver_profile_id INTEGER NOT NULL REFERENCES driver_profiles(id),
 status TEXT NOT NULL DEFAULT 'offered' CHECK(status IN ('offered','accepted','rejected','expired')),
 offered_at TEXT NOT NULL DEFAULT(datetime('now')),
 responded_at TEXT,
 UNIQUE(ride_request_id,driver_profile_id)
);
CREATE INDEX IF NOT EXISTS idx_drive_ride_offers_driver ON drive_ride_offers(driver_profile_id,status);
CREATE TABLE IF NOT EXISTS drive_ride_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 ride_request_id INTEGER NOT NULL REFERENCES drive_ride_requests(id) ON DELETE CASCADE,
 from_status TEXT,
 to_status TEXT NOT NULL,
 actor_user_id INTEGER REFERENCES users(id),
 actor_role TEXT NOT NULL,
 note TEXT,
 created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_drive_ride_events_ride ON drive_ride_events(ride_request_id,id);

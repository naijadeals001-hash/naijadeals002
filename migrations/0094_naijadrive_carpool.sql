-- Migration 0094: NaijaDrive carpooling foundation
-- Separate shared-ride inventory; never aliases a private cab request.
CREATE TABLE IF NOT EXISTS carpool_trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','full','cancelled','in_progress','completed')),
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  departure_at TEXT NOT NULL,
  seats_total INTEGER NOT NULL CHECK (seats_total > 0),
  seats_available INTEGER NOT NULL CHECK (seats_available >= 0),
  contribution_kobo INTEGER NOT NULL CHECK (contribution_kobo >= 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_carpool_trips_search ON carpool_trips(status, origin, destination, departure_at);
CREATE TABLE IF NOT EXISTS carpool_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES carpool_trips(id) ON DELETE CASCADE,
  passenger_user_id INTEGER NOT NULL REFERENCES users(id),
  seats_requested INTEGER NOT NULL CHECK (seats_requested > 0),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','accepted','rejected','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(trip_id, passenger_user_id)
);
CREATE INDEX IF NOT EXISTS idx_carpool_requests_passenger ON carpool_requests(passenger_user_id, status);
CREATE INDEX IF NOT EXISTS idx_carpool_requests_trip ON carpool_requests(trip_id, status);

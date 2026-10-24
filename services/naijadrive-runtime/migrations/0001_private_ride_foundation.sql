CREATE TABLE IF NOT EXISTS naijadrive_service_zones (
  id BIGSERIAL PRIMARY KEY,
  city TEXT NOT NULL,
  country_iso CHAR(2) NOT NULL,
  zone_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  center_latitude NUMERIC(9,6) NOT NULL,
  center_longitude NUMERIC(9,6) NOT NULL,
  radius_km NUMERIC(8,2) NOT NULL CHECK (radius_km > 0),
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS naijadrive_vehicle_categories (
  id BIGSERIAL PRIMARY KEY,
  category_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  passenger_capacity INTEGER NOT NULL CHECK (passenger_capacity > 0),
  regulatory_status TEXT NOT NULL DEFAULT 'pending_review' CHECK (regulatory_status IN ('pending_review', 'approved', 'rejected')),
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS naijadrive_fare_rules (
  id BIGSERIAL PRIMARY KEY,
  city TEXT NOT NULL,
  vehicle_category_id BIGINT NOT NULL REFERENCES naijadrive_vehicle_categories(id),
  base_fare_kobo BIGINT NOT NULL CHECK (base_fare_kobo >= 0),
  per_km_kobo BIGINT NOT NULL CHECK (per_km_kobo >= 0),
  per_minute_kobo BIGINT NOT NULL CHECK (per_minute_kobo >= 0),
  minimum_fare_kobo BIGINT NOT NULL CHECK (minimum_fare_kobo >= 0),
  booking_fee_kobo BIGINT NOT NULL CHECK (booking_fee_kobo >= 0),
  cancellation_fee_kobo BIGINT NOT NULL CHECK (cancellation_fee_kobo >= 0),
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (city, vehicle_category_id)
);

CREATE TABLE IF NOT EXISTS naijadrive_rides (
  id BIGSERIAL PRIMARY KEY,
  customer_user_id BIGINT NOT NULL,
  pickup_latitude NUMERIC(9,6) NOT NULL,
  pickup_longitude NUMERIC(9,6) NOT NULL,
  dropoff_latitude NUMERIC(9,6) NOT NULL,
  dropoff_longitude NUMERIC(9,6) NOT NULL,
  pickup_zone_key TEXT NOT NULL REFERENCES naijadrive_service_zones(zone_key),
  dropoff_zone_key TEXT NOT NULL REFERENCES naijadrive_service_zones(zone_key),
  vehicle_category_id BIGINT NOT NULL REFERENCES naijadrive_vehicle_categories(id),
  estimated_distance_km NUMERIC(10,3) NOT NULL CHECK (estimated_distance_km >= 0),
  estimated_duration_minutes NUMERIC(10,2) NOT NULL CHECK (estimated_duration_minutes >= 0),
  estimated_fare_kobo BIGINT NOT NULL CHECK (estimated_fare_kobo >= 0),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'searching', 'driver_assigned', 'driver_arrived', 'in_progress', 'completed', 'cancelled', 'no_driver')),
  assigned_driver_id BIGINT,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_naijadrive_rides_customer ON naijadrive_rides(customer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_naijadrive_rides_dispatch ON naijadrive_rides(status, pickup_zone_key, vehicle_category_id);

CREATE TABLE IF NOT EXISTS naijadrive_ride_status_events (
  id BIGSERIAL PRIMARY KEY,
  ride_id BIGINT NOT NULL REFERENCES naijadrive_rides(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_user_id BIGINT,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('customer', 'driver', 'admin', 'system')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_naijadrive_ride_events ON naijadrive_ride_status_events(ride_id, created_at);

CREATE TABLE IF NOT EXISTS naijadrive_driver_eligibility (
  driver_id BIGINT NOT NULL,
  vehicle_id BIGINT NOT NULL,
  vehicle_category_id BIGINT NOT NULL REFERENCES naijadrive_vehicle_categories(id),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  operational_status TEXT NOT NULL CHECK (operational_status IN ('inactive', 'active', 'suspended')),
  service_zone_key TEXT NOT NULL REFERENCES naijadrive_service_zones(zone_key),
  PRIMARY KEY (driver_id, vehicle_id, service_zone_key)
);

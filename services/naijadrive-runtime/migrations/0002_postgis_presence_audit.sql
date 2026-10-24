CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE naijadrive_service_zones
  ADD COLUMN IF NOT EXISTS boundary geometry(Polygon, 4326);

CREATE INDEX IF NOT EXISTS idx_naijadrive_service_zones_boundary
  ON naijadrive_service_zones USING GIST (boundary);

CREATE TABLE IF NOT EXISTS naijadrive_ride_audit_events (
  id BIGSERIAL PRIMARY KEY,
  ride_id BIGINT NOT NULL REFERENCES naijadrive_rides(id),
  action TEXT NOT NULL,
  actor_user_id BIGINT,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('customer', 'driver', 'admin', 'system')),
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_naijadrive_ride_audit_events_ride
  ON naijadrive_ride_audit_events(ride_id, created_at);

CREATE TABLE IF NOT EXISTS naijadrive_driver_presence (
  driver_id BIGINT PRIMARY KEY,
  vehicle_id BIGINT NOT NULL,
  vehicle_category TEXT NOT NULL,
  zone_key TEXT NOT NULL REFERENCES naijadrive_service_zones(zone_key),
  location geography(Point, 4326) NOT NULL,
  availability_status TEXT NOT NULL CHECK (availability_status IN ('offline', 'available', 'offered', 'assigned')),
  heartbeat_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  active_ride_id BIGINT REFERENCES naijadrive_rides(id)
);

CREATE INDEX IF NOT EXISTS idx_naijadrive_driver_presence_location
  ON naijadrive_driver_presence USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_naijadrive_driver_presence_available
  ON naijadrive_driver_presence(zone_key, vehicle_category, availability_status, expires_at);

-- Development pilot geometry. These are configurable circular operating areas,
-- not legal boundaries. Replace them with approved FCT polygon geometry before
-- passenger operations are enabled. Airport axis remains inactive.
INSERT INTO naijadrive_service_zones
  (city, country_iso, zone_key, name, center_latitude, center_longitude, radius_km, is_active, boundary)
VALUES
  ('Abuja', 'NG', 'abuja-central', 'Abuja Central', 9.0579, 7.4951, 18, TRUE,
   ST_Transform(ST_Buffer(ST_SetSRID(ST_Point(7.4951, 9.0579), 4326)::geography, 18000)::geometry, 4326)),
  ('Abuja', 'NG', 'gwarinpa', 'Gwarinpa', 9.1057, 7.4042, 10, TRUE,
   ST_Transform(ST_Buffer(ST_SetSRID(ST_Point(7.4042, 9.1057), 4326)::geography, 10000)::geometry, 4326)),
  ('Abuja', 'NG', 'lokogoma', 'Lokogoma', 8.9856, 7.4295, 9, TRUE,
   ST_Transform(ST_Buffer(ST_SetSRID(ST_Point(7.4295, 8.9856), 4326)::geography, 9000)::geometry, 4326)),
  ('Abuja', 'NG', 'airport-axis', 'Nnamdi Azikiwe Airport axis', 9.0068, 7.2632, 12, FALSE,
   ST_Transform(ST_Buffer(ST_SetSRID(ST_Point(7.2632, 9.0068), 4326)::geography, 12000)::geometry, 4326))
ON CONFLICT (zone_key) DO UPDATE SET
  name = EXCLUDED.name,
  center_latitude = EXCLUDED.center_latitude,
  center_longitude = EXCLUDED.center_longitude,
  radius_km = EXCLUDED.radius_km,
  boundary = EXCLUDED.boundary;

INSERT INTO naijadrive_vehicle_categories
  (category_key, display_name, passenger_capacity, regulatory_status, is_enabled)
VALUES
  ('car', 'Car', 4, 'pending_review', FALSE),
  ('motorcycle', 'Motorcycle', 1, 'pending_review', FALSE),
  ('tricycle', 'Tricycle', 3, 'pending_review', FALSE),
  ('van', 'Van', 7, 'pending_review', FALSE)
ON CONFLICT (category_key) DO NOTHING;

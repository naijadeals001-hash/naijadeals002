ALTER TABLE drive_ride_requests ADD COLUMN reassignment_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE drive_ride_offers ADD COLUMN expires_at TEXT;
ALTER TABLE drive_ride_offers ADD COLUMN rejection_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_drive_ride_offers_expiry ON drive_ride_offers(status, expires_at);

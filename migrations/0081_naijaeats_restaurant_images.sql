-- Migration 0081: NaijaEats Phase 1 restaurant identity images (logo/cover)
--
-- Scope: additive UPDATE only. Populates `logo_url` and `cover_image_url` for
-- the 6 restaurants seeded in migration 0080 (source_type='seed'). This is the
-- follow-up wiring step for the image asset set approved after the manual
-- image-review pass (2026-09-22) — see the review's 41-file inventory
-- (29 dish images already covered by migration 0080's dishes.image_url
-- references; this migration covers the 12 restaurant identity assets: 6
-- logos + 6 covers).
--
-- Files referenced below were copied into:
--   public/static/eats/restaurants/<restaurant-slug>-logo.jpg
--   public/static/eats/restaurants/<restaurant-slug>-cover.jpg
-- as part of the same change that added this migration.
--
-- Explicitly guarded: only touches rows WHERE source_type='seed' AND
-- slug=<x> — never touches any live/production restaurant row, never touches
-- any other column (verification_status, rating_avg, rating_count,
-- cuisine_id, owner_provider_profile_id, delivery/hours/pricing fields all
-- remain exactly as migration 0080 set them).
--
-- Local/dev D1 only. No production writes. No deployment.

UPDATE restaurants
SET logo_url = '/static/eats/restaurants/mama-bisis-kitchen-logo.jpg',
    cover_image_url = '/static/eats/restaurants/mama-bisis-kitchen-cover.jpg'
WHERE slug = 'mama-bisis-kitchen' AND source_type = 'seed';

UPDATE restaurants
SET logo_url = '/static/eats/restaurants/suya-spot-grill-house-logo.jpg',
    cover_image_url = '/static/eats/restaurants/suya-spot-grill-house-cover.jpg'
WHERE slug = 'suya-spot-grill-house' AND source_type = 'seed';

UPDATE restaurants
SET logo_url = '/static/eats/restaurants/accra-chop-house-logo.jpg',
    cover_image_url = '/static/eats/restaurants/accra-chop-house-cover.jpg'
WHERE slug = 'accra-chop-house' AND source_type = 'seed';

UPDATE restaurants
SET logo_url = '/static/eats/restaurants/senegal-table-logo.jpg',
    cover_image_url = '/static/eats/restaurants/senegal-table-cover.jpg'
WHERE slug = 'senegal-table' AND source_type = 'seed';

UPDATE restaurants
SET logo_url = '/static/eats/restaurants/ivorian-kitchen-logo.jpg',
    cover_image_url = '/static/eats/restaurants/ivorian-kitchen-cover.jpg'
WHERE slug = 'ivorian-kitchen' AND source_type = 'seed';

UPDATE restaurants
SET logo_url = '/static/eats/restaurants/the-baobab-room-logo.jpg',
    cover_image_url = '/static/eats/restaurants/the-baobab-room-cover.jpg'
WHERE slug = 'the-baobab-room' AND source_type = 'seed';

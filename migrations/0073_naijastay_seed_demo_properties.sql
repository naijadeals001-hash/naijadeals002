-- Migration 0073: NaijaStay Demo Seed — Properties, Units, Resources, Availability, Cancellation Policies
--
-- CONTEXT: Discovery (2026-09-19) confirmed the Booking Engine 2.0 schema
-- (migrations 0024, 0028, 0034, 0041, 0043 — bookable_listings,
-- booking_resources, booking_availability_rules, booking_availability_blocks,
-- booking_holds, booking_resource_allocations, booking_cancellation_policies,
-- bookings, booking_status_events, stay_properties, stay_property_status_events,
-- gig_service_details, stay_unit_details) is ALREADY LIVE in production with
-- ZERO schema drift from local (verified via gsk hosted d1_schema, table-by-
-- table byte-for-byte diff) and ZERO rows in the stay_* tables anywhere. This
-- migration does NOT create any new table or column — it reuses the EXACT
-- same generic engine NaijaGigs already proved out (86 real local test
-- bookings through the identical bookings/booking_holds/booking_resource_
-- allocations machinery), per the explicit "do not create duplicate booking
-- infrastructure" instruction.
--
-- Nigeria-only scope for this phase (Lagos + Abuja), per explicit instruction.
-- Architecture stays country-ready: every stay_properties row already carries
-- country_iso/city, and bookable_listings.country_iso already drives
-- searchPublicListings' country filter — adding a 3rd country later is a data
-- change, never a schema or UI rebuild.
--
-- Every host user uses email pattern demo_stay_*@naijadeals.demo and every
-- property/host name is prefixed "[DEMO]" so it is unambiguous in any
-- admin/Control-Center listing that this is seed data, never real commercial
-- inventory (spec section 33AA).
--
-- Password hashes below use the exact same PBKDF2-HMAC-SHA256, 100,000
-- iterations, 32-byte output algorithm as src/lib/auth.ts's hashPassword()
-- (Node's crypto.pbkdf2Sync with matching params — same method already
-- verified byte-for-byte equivalent and login-tested on both local and
-- production D1 for migration 0072's NaijaGigs demo accounts). Demo password
-- (never meant to be secret, these are seed/demo accounts only):
-- "Demo-NaijaStay-2026!"
--
-- provider_profiles.provider_type = 'host' — already present in the live
-- CHECK constraint (provider_type IN ('gig_provider','host',
-- 'driver_operator','restaurant_operator')), confirmed via schema dump
-- before writing this migration. No ALTER needed.
--
-- 6 properties across Lagos (Victoria Island, Lekki, Ikoyi) and Abuja
-- (Wuse II, Maitama, Asokoro), spanning hotel/apartment/resort/loft/
-- guesthouse/villa property types, 12 bookable unit-types total (2 per
-- property), real gallery imagery under /static/stay/ (generated originals,
-- zero commercial-stock legal risk), realistic NGN nightly pricing,
-- amenities, house rules, guest capacity, and one cancellation policy per
-- host. Two one-off availability_blocks added for realism (a room genuinely
-- blocked for maintenance on specific dates) to prove the blocking mechanism
-- end-to-end, not just theoretically wired.
--
-- NOTE ON SQL STYLE: every multi-row INSERT below uses one separate
-- INSERT...SELECT statement per row (mirroring migration 0072's proven
-- pattern) rather than a single UNION ALL chain — D1/SQLite enforces a
-- "too many terms in compound SELECT" limit that a 12-branch UNION ALL
-- (one per bookable_listing) hits in practice; discovered by testing this
-- migration against local D1 before ever touching production.

-- ============================================================
-- 1. DEMO HOST USERS
-- ============================================================
INSERT INTO users (email, phone, name, password_hash, password_salt, is_phone_verified, is_email_verified, role, country_iso, status)
VALUES
  ('demo_stay_lagospalm@naijadeals.demo', '+2348020000201', '[DEMO] Adaeze Nwankwo — Lagos Palm Hotel', 'b13da6749cd33f1169d6c422a66453a6166933bd8e23ad3f80bd351f5aa7c65b', '97779a9cdba9c562a3c5c475ea400ea4', 1, 1, 'customer', 'NG', 'active'),
  ('demo_stay_cedarapts@naijadeals.demo', '+2348020000202', '[DEMO] Chidi Obiora — The Cedar Apartments', '32f894b99aeb565df5b4463e4b51095874467e6b2886bd89297dc73cd294d49d', 'f16435d266999f329b39842167699e15', 1, 1, 'customer', 'NG', 'active'),
  ('demo_stay_lekkiresort@naijadeals.demo', '+2348020000203', '[DEMO] Folasade Bello — Lekki Beach Resort', 'fa387b6e2f71930df4417dd26b688ea79012901eb822d33d931103c11f4e5788', '9a27aff704afddd53551e030086c5b3d', 1, 1, 'customer', 'NG', 'active'),
  ('demo_stay_urbanloft@naijadeals.demo', '+2348020000204', '[DEMO] Kelechi Umeh — The Urban Loft Abuja', '96d22f272147039e0bcbf2f4231ded046bed40b8957e7acbffb6668a3a0f20a7', 'eb76931eb198eaee689deba6775f01d1', 1, 1, 'customer', 'NG', 'active'),
  ('demo_stay_ikoyiguest@naijadeals.demo', '+2348020000205', '[DEMO] Ngozi Eze — Ikoyi Guest House', 'df4812eac4e5bbe4aa82fae94869b31624f6af36a43a9fe8491f0bfffa896df0', '496ec0b0a583702892e45745859b850c', 1, 1, 'customer', 'NG', 'active'),
  ('demo_stay_asokorovilla@naijadeals.demo', '+2348020000206', '[DEMO] Yusuf Abdullahi — Asokoro Garden Villa', 'fcb41d35f4adbd98b989b80851ffd509536ef69d1ca11536dd01ade5264111e8', 'be8c6eb092644ef61402ae527cca4d6a', 1, 1, 'customer', 'NG', 'active');

-- ============================================================
-- 2. PROVIDER PROFILES — provider_type = 'host' (already valid per the
--    live CHECK constraint; confirmed via schema dump before writing this).
-- ============================================================
INSERT INTO provider_profiles (user_id, provider_type, display_name, bio, contact_email, contact_phone, country_iso, verification_status, operational_status, onboarding_completed_at, rating_avg, rating_count, avatar_url)
SELECT id, 'host', REPLACE(name, '[DEMO] ', ''),
  'Boutique waterfront hotel in the heart of Victoria Island — rooftop pool, full breakfast, and easy access to Lagos business district.',
  email, phone, 'NG', 'verified', 'active', datetime('now'), 4.8, 128, NULL
FROM users WHERE email = 'demo_stay_lagospalm@naijadeals.demo';

INSERT INTO provider_profiles (user_id, provider_type, display_name, bio, contact_email, contact_phone, country_iso, verification_status, operational_status, onboarding_completed_at, rating_avg, rating_count, avatar_url)
SELECT id, 'host', REPLACE(name, '[DEMO] ', ''),
  'Modern serviced apartments in Wuse II, Abuja — fully equipped kitchens, reliable power backup, ideal for extended business stays.',
  email, phone, 'NG', 'verified', 'active', datetime('now'), 4.6, 89, NULL
FROM users WHERE email = 'demo_stay_cedarapts@naijadeals.demo';

INSERT INTO provider_profiles (user_id, provider_type, display_name, bio, contact_email, contact_phone, country_iso, verification_status, operational_status, onboarding_completed_at, rating_avg, rating_count, avatar_url)
SELECT id, 'host', REPLACE(name, '[DEMO] ', ''),
  'Beachfront resort in Lekki with private beach access, pool, and family-friendly villas — a weekend escape without leaving Lagos.',
  email, phone, 'NG', 'verified', 'active', datetime('now'), 4.9, 214, NULL
FROM users WHERE email = 'demo_stay_lekkiresort@naijadeals.demo';

INSERT INTO provider_profiles (user_id, provider_type, display_name, bio, contact_email, contact_phone, country_iso, verification_status, operational_status, onboarding_completed_at, rating_avg, rating_count, avatar_url)
SELECT id, 'host', REPLACE(name, '[DEMO] ', ''),
  'Design-forward loft apartments in Maitama, Abuja — rooftop lounge, smart TVs, and a short drive from the city centre.',
  email, phone, 'NG', 'verified', 'active', datetime('now'), 4.5, 76, NULL
FROM users WHERE email = 'demo_stay_urbanloft@naijadeals.demo';

INSERT INTO provider_profiles (user_id, provider_type, display_name, bio, contact_email, contact_phone, country_iso, verification_status, operational_status, onboarding_completed_at, rating_avg, rating_count, avatar_url)
SELECT id, 'host', REPLACE(name, '[DEMO] ', ''),
  'Quiet garden guest house in Ikoyi, Lagos — home-style comfort, free breakfast, and personal attention from the host.',
  email, phone, 'NG', 'verified', 'active', datetime('now'), 4.7, 63, NULL
FROM users WHERE email = 'demo_stay_ikoyiguest@naijadeals.demo';

INSERT INTO provider_profiles (user_id, provider_type, display_name, bio, contact_email, contact_phone, country_iso, verification_status, operational_status, onboarding_completed_at, rating_avg, rating_count, avatar_url)
SELECT id, 'host', REPLACE(name, '[DEMO] ', ''),
  'Private villa estate in Asokoro, Abuja''s premier diplomatic district — landscaped garden, swimming pool, and full-house rental for families and groups.',
  email, phone, 'NG', 'verified', 'active', datetime('now'), 4.9, 41, NULL
FROM users WHERE email = 'demo_stay_asokorovilla@naijadeals.demo';

-- ============================================================
-- 3. STAY PROPERTIES — the actual "hotel/apartment/resort/villa" entity
--    (migration 0034), owned by the provider_profiles rows above.
-- ============================================================
INSERT INTO stay_properties
  (slug, owner_provider_profile_id, name, description, property_type, country_iso, city, neighborhood, address_line1, latitude, longitude, cover_image_url, gallery_json, amenities_json, house_rules, check_in_info, check_out_info, cancellation_policy, is_active, verification_status, rating_avg, rating_count)
SELECT
  'demo-lagos-palm-hotel', pp.id,
  '[DEMO] Lagos Palm Hotel',
  'A boutique waterfront hotel on Victoria Island, Lagos, offering rooftop pool views over the Atlantic, full daily breakfast, and 24-hour front desk service. Walking distance to Eko Atlantic and the Lagos business district — ideal for both business travellers and weekend visitors. NOTE: this is DEMO inventory for NaijaStay, not a real bookable commercial property.',
  'hotel', 'NG', 'Lagos', 'Victoria Island', '14 Ozumba Mbadiwe Avenue, Victoria Island', 6.4281, 3.4219,
  '/static/stay/lagos-palm-hotel-cover.jpg',
  '["/static/stay/lagos-palm-hotel-cover.jpg","/static/stay/lagos-palm-hotel-room.jpg","/static/stay/lagos-palm-hotel-pool.jpg"]',
  '["Swimming pool","Free WiFi","Breakfast included","Gym","24-hour front desk","Air conditioning","Parking","Airport shuttle"]',
  'No smoking in rooms. Pets are not allowed. Quiet hours from 10pm to 7am. Valid ID required at check-in.',
  'Check-in from 2:00 PM. Early check-in subject to availability — contact the host in advance.',
  'Check-out by 11:00 AM. Late check-out available on request, subject to a fee.',
  'Free cancellation up to 24 hours before check-in. See the listing''s cancellation policy for full terms.',
  1, 'verified', pp.rating_avg, pp.rating_count
FROM provider_profiles pp JOIN users u ON u.id = pp.user_id WHERE u.email = 'demo_stay_lagospalm@naijadeals.demo';

INSERT INTO stay_properties
  (slug, owner_provider_profile_id, name, description, property_type, country_iso, city, neighborhood, address_line1, latitude, longitude, cover_image_url, gallery_json, amenities_json, house_rules, check_in_info, check_out_info, cancellation_policy, is_active, verification_status, rating_avg, rating_count)
SELECT
  'demo-cedar-apartments', pp.id,
  '[DEMO] The Cedar Apartments',
  'Modern serviced apartments in Wuse II, Abuja, each with a fully equipped kitchen, dedicated workspace, and reliable generator power backup. Popular with business travellers and families needing extended stays close to the Central Business District. NOTE: this is DEMO inventory for NaijaStay, not a real bookable commercial property.',
  'apartment', 'NG', 'Abuja', 'Wuse II', '22 Aminu Kano Crescent, Wuse II', 9.0765, 7.4951,
  '/static/stay/cedar-apartments-cover.jpg',
  '["/static/stay/cedar-apartments-cover.jpg","/static/stay/cedar-apartments-living.jpg","/static/stay/cedar-apartments-bedroom.jpg"]',
  '["Kitchen","Free WiFi","Parking","Generator / power backup","Washing machine","Air conditioning","Smart TV"]',
  'No smoking indoors. No parties or events. Maximum occupancy strictly enforced per unit.',
  'Check-in from 1:00 PM. A self-check-in code is sent after payment confirmation.',
  'Check-out by 12:00 PM.',
  'Moderate cancellation — 50% refund if cancelled less than 24 hours before check-in, full refund otherwise.',
  1, 'verified', pp.rating_avg, pp.rating_count
FROM provider_profiles pp JOIN users u ON u.id = pp.user_id WHERE u.email = 'demo_stay_cedarapts@naijadeals.demo';

INSERT INTO stay_properties
  (slug, owner_provider_profile_id, name, description, property_type, country_iso, city, neighborhood, address_line1, latitude, longitude, cover_image_url, gallery_json, amenities_json, house_rules, check_in_info, check_out_info, cancellation_policy, is_active, verification_status, rating_avg, rating_count)
SELECT
  'demo-lekki-beach-resort', pp.id,
  '[DEMO] Lekki Beach Resort',
  'A beachfront resort in Lekki, Lagos, with direct private beach access, an outdoor pool, and family-sized villas alongside cosy beach bungalows. A popular weekend escape for Lagos residents and visiting families. NOTE: this is DEMO inventory for NaijaStay, not a real bookable commercial property.',
  'resort', 'NG', 'Lagos', 'Lekki', 'Km 22, Lekki-Epe Expressway, Lekki', 6.4478, 3.5852,
  '/static/stay/lekki-beach-resort-cover.jpg',
  '["/static/stay/lekki-beach-resort-cover.jpg","/static/stay/lekki-beach-resort-bungalow.jpg","/static/stay/lekki-beach-resort-pool.jpg"]',
  '["Private beach access","Swimming pool","Spa","Kitchen (villas only)","Free WiFi","Parking","Restaurant on-site"]',
  'No glass on the beach. Bonfires only in designated areas. Check with staff before bringing water sports equipment.',
  'Check-in from 3:00 PM.',
  'Check-out by 11:00 AM.',
  'Flexible cancellation — full refund up to 24 hours before check-in.',
  1, 'verified', pp.rating_avg, pp.rating_count
FROM provider_profiles pp JOIN users u ON u.id = pp.user_id WHERE u.email = 'demo_stay_lekkiresort@naijadeals.demo';

INSERT INTO stay_properties
  (slug, owner_provider_profile_id, name, description, property_type, country_iso, city, neighborhood, address_line1, latitude, longitude, cover_image_url, gallery_json, amenities_json, house_rules, check_in_info, check_out_info, cancellation_policy, is_active, verification_status, rating_avg, rating_count)
SELECT
  'demo-urban-loft-abuja', pp.id,
  '[DEMO] The Urban Loft Abuja',
  'Design-forward loft apartments in Maitama, Abuja, featuring high ceilings, floor-to-ceiling windows, and a shared rooftop lounge. A short drive from Abuja''s diplomatic zone and city centre. NOTE: this is DEMO inventory for NaijaStay, not a real bookable commercial property.',
  'apartment', 'NG', 'Abuja', 'Maitama', '7 Yedseram Street, Maitama', 9.0932, 7.4951,
  '/static/stay/urban-loft-abuja-cover.jpg',
  '["/static/stay/urban-loft-abuja-cover.jpg","/static/stay/urban-loft-abuja-interior.jpg","/static/stay/urban-loft-abuja-bathroom.jpg"]',
  '["Free WiFi","Generator / power backup","Gym access","Rooftop lounge","Smart TV","Air conditioning","Parking"]',
  'No smoking indoors. Visitors must be registered at the front desk after 9pm.',
  'Check-in from 2:00 PM.',
  'Check-out by 11:00 AM.',
  'Moderate cancellation — 50% refund if cancelled less than 24 hours before check-in, full refund otherwise.',
  1, 'verified', pp.rating_avg, pp.rating_count
FROM provider_profiles pp JOIN users u ON u.id = pp.user_id WHERE u.email = 'demo_stay_urbanloft@naijadeals.demo';

INSERT INTO stay_properties
  (slug, owner_provider_profile_id, name, description, property_type, country_iso, city, neighborhood, address_line1, latitude, longitude, cover_image_url, gallery_json, amenities_json, house_rules, check_in_info, check_out_info, cancellation_policy, is_active, verification_status, rating_avg, rating_count)
SELECT
  'demo-ikoyi-guest-house', pp.id,
  '[DEMO] Ikoyi Guest House',
  'A quiet, home-style guest house in Ikoyi, Lagos, set in a lush private garden. Free breakfast and personal attention from the host make it a favourite for solo travellers and couples seeking a calmer stay than a hotel. NOTE: this is DEMO inventory for NaijaStay, not a real bookable commercial property.',
  'guesthouse', 'NG', 'Lagos', 'Ikoyi', '9 Bourdillon Road, Ikoyi', 6.4531, 3.4324,
  '/static/stay/ikoyi-guest-house-cover.jpg',
  '["/static/stay/ikoyi-guest-house-cover.jpg","/static/stay/ikoyi-guest-house-bedroom.jpg","/static/stay/ikoyi-guest-house-garden.jpg"]',
  '["Garden","Breakfast included","Free WiFi","Parking","Airport shuttle","Air conditioning"]',
  'No smoking indoors. No visitors after 9pm without prior notice to the host. Quiet residential neighbourhood — please keep noise low.',
  'Check-in from 12:00 PM.',
  'Check-out by 10:00 AM.',
  'Strict cancellation — 50% refund if cancelled at least 7 days before check-in, no refund after.',
  1, 'verified', pp.rating_avg, pp.rating_count
FROM provider_profiles pp JOIN users u ON u.id = pp.user_id WHERE u.email = 'demo_stay_ikoyiguest@naijadeals.demo';

INSERT INTO stay_properties
  (slug, owner_provider_profile_id, name, description, property_type, country_iso, city, neighborhood, address_line1, latitude, longitude, cover_image_url, gallery_json, amenities_json, house_rules, check_in_info, check_out_info, cancellation_policy, is_active, verification_status, rating_avg, rating_count)
SELECT
  'demo-asokoro-garden-villa', pp.id,
  '[DEMO] Asokoro Garden Villa',
  'A private villa estate in Asokoro, Abuja''s premier diplomatic district, with a landscaped garden and swimming pool. Individual villa suites or the entire estate can be booked for families, groups, and executive retreats. NOTE: this is DEMO inventory for NaijaStay, not a real bookable commercial property.',
  'villa', 'NG', 'Abuja', 'Asokoro', '3 Yakubu Gowon Crescent, Asokoro', 9.0333, 7.5326,
  '/static/stay/asokoro-garden-villa-cover.jpg',
  '["/static/stay/asokoro-garden-villa-cover.jpg","/static/stay/asokoro-garden-villa-bedroom.jpg","/static/stay/asokoro-garden-villa-pool.jpg"]',
  '["Private pool","Garden","Kitchen","Free WiFi","Generator / power backup","Parking","24-hour security"]',
  'No smoking indoors. No events or parties without prior written approval from the host. Security deposit may apply for full-villa bookings.',
  'Check-in from 3:00 PM.',
  'Check-out by 12:00 PM.',
  'Strict cancellation — 50% refund if cancelled at least 7 days before check-in, no refund after.',
  1, 'verified', pp.rating_avg, pp.rating_count
FROM provider_profiles pp JOIN users u ON u.id = pp.user_id WHERE u.email = 'demo_stay_asokorovilla@naijadeals.demo';

-- ============================================================
-- 4. CANCELLATION POLICIES — one per host, reusing the EXISTING
--    booking_cancellation_policies table (migration 0041), attached to
--    each bookable_listing below via cancellation_policy_id.
-- ============================================================
INSERT INTO booking_cancellation_policies (owner_user_id, name, policy_type, cutoff_hours_before_start, refund_percentage_before_cutoff, refund_percentage_after_cutoff, flat_fee_kobo, is_active)
SELECT id, '[DEMO] Lagos Palm Hotel — Flexible', 'flexible', 24, 100, 0, 0, 1 FROM users WHERE email = 'demo_stay_lagospalm@naijadeals.demo';

INSERT INTO booking_cancellation_policies (owner_user_id, name, policy_type, cutoff_hours_before_start, refund_percentage_before_cutoff, refund_percentage_after_cutoff, flat_fee_kobo, is_active)
SELECT id, '[DEMO] The Cedar Apartments — Moderate', 'moderate', 24, 100, 50, 0, 1 FROM users WHERE email = 'demo_stay_cedarapts@naijadeals.demo';

INSERT INTO booking_cancellation_policies (owner_user_id, name, policy_type, cutoff_hours_before_start, refund_percentage_before_cutoff, refund_percentage_after_cutoff, flat_fee_kobo, is_active)
SELECT id, '[DEMO] Lekki Beach Resort — Flexible', 'flexible', 24, 100, 0, 0, 1 FROM users WHERE email = 'demo_stay_lekkiresort@naijadeals.demo';

INSERT INTO booking_cancellation_policies (owner_user_id, name, policy_type, cutoff_hours_before_start, refund_percentage_before_cutoff, refund_percentage_after_cutoff, flat_fee_kobo, is_active)
SELECT id, '[DEMO] The Urban Loft Abuja — Moderate', 'moderate', 24, 100, 50, 0, 1 FROM users WHERE email = 'demo_stay_urbanloft@naijadeals.demo';

INSERT INTO booking_cancellation_policies (owner_user_id, name, policy_type, cutoff_hours_before_start, refund_percentage_before_cutoff, refund_percentage_after_cutoff, flat_fee_kobo, is_active)
SELECT id, '[DEMO] Ikoyi Guest House — Strict', 'strict', 168, 100, 50, 0, 1 FROM users WHERE email = 'demo_stay_ikoyiguest@naijadeals.demo';

INSERT INTO booking_cancellation_policies (owner_user_id, name, policy_type, cutoff_hours_before_start, refund_percentage_before_cutoff, refund_percentage_after_cutoff, flat_fee_kobo, is_active)
SELECT id, '[DEMO] Asokoro Garden Villa — Strict', 'strict', 168, 100, 50, 0, 1 FROM users WHERE email = 'demo_stay_asokorovilla@naijadeals.demo';

-- ============================================================
-- 5. BOOKABLE LISTINGS — the generic Booking Engine wrapper
--    (listing_type='stay_unit', vertical='stay', is_date_only=1,
--    booking_mode='instant', pricing_unit='per_night'). Two unit types
--    per property = 12 listings total. cancellation_policy_id resolved
--    from the policy just inserted above for the same host.
-- ============================================================
INSERT INTO bookable_listings
  (listing_type, provider_user_id, title, description, country_iso, city, booking_mode, pricing_unit, base_price_kobo, currency, is_active, category, cover_image_url, stay_property_id, timezone, capacity_model, is_date_only, vertical, cancellation_policy_id, deposit_percentage)
SELECT 'stay_unit', u.id, 'Deluxe Room — [DEMO] Lagos Palm Hotel',
  'A comfortable deluxe room with a queen bed, city or partial ocean view, and en-suite bathroom. Sleeps up to 2 guests.',
  'NG', 'Lagos', 'instant', 'per_night', 8500000, 'NGN', 1, 'Hotel Room', '/static/stay/lagos-palm-hotel-room.jpg',
  sp.id, 'Africa/Lagos', 'pooled', 1, 'stay', cp.id, 30
FROM users u JOIN provider_profiles pp ON pp.user_id = u.id JOIN stay_properties sp ON sp.owner_provider_profile_id = pp.id JOIN booking_cancellation_policies cp ON cp.owner_user_id = u.id
WHERE u.email = 'demo_stay_lagospalm@naijadeals.demo';

INSERT INTO bookable_listings
  (listing_type, provider_user_id, title, description, country_iso, city, booking_mode, pricing_unit, base_price_kobo, currency, is_active, category, cover_image_url, stay_property_id, timezone, capacity_model, is_date_only, vertical, cancellation_policy_id, deposit_percentage)
SELECT 'stay_unit', u.id, 'Executive Suite — [DEMO] Lagos Palm Hotel',
  'A spacious executive suite with a king bed, separate sitting area, and full ocean view. Sleeps up to 3 guests.',
  'NG', 'Lagos', 'instant', 'per_night', 14500000, 'NGN', 1, 'Hotel Suite', '/static/stay/lagos-palm-hotel-pool.jpg',
  sp.id, 'Africa/Lagos', 'pooled', 1, 'stay', cp.id, 30
FROM users u JOIN provider_profiles pp ON pp.user_id = u.id JOIN stay_properties sp ON sp.owner_provider_profile_id = pp.id JOIN booking_cancellation_policies cp ON cp.owner_user_id = u.id
WHERE u.email = 'demo_stay_lagospalm@naijadeals.demo';

INSERT INTO bookable_listings
  (listing_type, provider_user_id, title, description, country_iso, city, booking_mode, pricing_unit, base_price_kobo, currency, is_active, category, cover_image_url, stay_property_id, timezone, capacity_model, is_date_only, vertical, cancellation_policy_id, deposit_percentage)
SELECT 'stay_unit', u.id, 'One-Bedroom Apartment — [DEMO] The Cedar Apartments',
  'A fully furnished one-bedroom apartment with kitchen, workspace, and generator backup. Sleeps up to 2 guests.',
  'NG', 'Abuja', 'instant', 'per_night', 6500000, 'NGN', 1, 'Serviced Apartment', '/static/stay/cedar-apartments-bedroom.jpg',
  sp.id, 'Africa/Lagos', 'pooled', 1, 'stay', cp.id, 50
FROM users u JOIN provider_profiles pp ON pp.user_id = u.id JOIN stay_properties sp ON sp.owner_provider_profile_id = pp.id JOIN booking_cancellation_policies cp ON cp.owner_user_id = u.id
WHERE u.email = 'demo_stay_cedarapts@naijadeals.demo';

INSERT INTO bookable_listings
  (listing_type, provider_user_id, title, description, country_iso, city, booking_mode, pricing_unit, base_price_kobo, currency, is_active, category, cover_image_url, stay_property_id, timezone, capacity_model, is_date_only, vertical, cancellation_policy_id, deposit_percentage)
SELECT 'stay_unit', u.id, 'Two-Bedroom Apartment — [DEMO] The Cedar Apartments',
  'A larger two-bedroom apartment ideal for families or small groups, full kitchen, and living area. Sleeps up to 4 guests.',
  'NG', 'Abuja', 'instant', 'per_night', 9500000, 'NGN', 1, 'Serviced Apartment', '/static/stay/cedar-apartments-living.jpg',
  sp.id, 'Africa/Lagos', 'pooled', 1, 'stay', cp.id, 50
FROM users u JOIN provider_profiles pp ON pp.user_id = u.id JOIN stay_properties sp ON sp.owner_provider_profile_id = pp.id JOIN booking_cancellation_policies cp ON cp.owner_user_id = u.id
WHERE u.email = 'demo_stay_cedarapts@naijadeals.demo';

INSERT INTO bookable_listings
  (listing_type, provider_user_id, title, description, country_iso, city, booking_mode, pricing_unit, base_price_kobo, currency, is_active, category, cover_image_url, stay_property_id, timezone, capacity_model, is_date_only, vertical, cancellation_policy_id, deposit_percentage)
SELECT 'stay_unit', u.id, 'Beach Bungalow — [DEMO] Lekki Beach Resort',
  'A cosy beachfront bungalow steps from the water, with mosquito-net canopy bed and private veranda. Sleeps up to 2 guests.',
  'NG', 'Lagos', 'instant', 'per_night', 12000000, 'NGN', 1, 'Beach Bungalow', '/static/stay/lekki-beach-resort-bungalow.jpg',
  sp.id, 'Africa/Lagos', 'pooled', 1, 'stay', cp.id, 30
FROM users u JOIN provider_profiles pp ON pp.user_id = u.id JOIN stay_properties sp ON sp.owner_provider_profile_id = pp.id JOIN booking_cancellation_policies cp ON cp.owner_user_id = u.id
WHERE u.email = 'demo_stay_lekkiresort@naijadeals.demo';

INSERT INTO bookable_listings
  (listing_type, provider_user_id, title, description, country_iso, city, booking_mode, pricing_unit, base_price_kobo, currency, is_active, category, cover_image_url, stay_property_id, timezone, capacity_model, is_date_only, vertical, cancellation_policy_id, deposit_percentage)
SELECT 'stay_unit', u.id, 'Family Villa — [DEMO] Lekki Beach Resort',
  'A full family villa with its own kitchen, pool access, and multiple bedrooms. Sleeps up to 6 guests.',
  'NG', 'Lagos', 'instant', 'per_night', 32000000, 'NGN', 1, 'Villa', '/static/stay/lekki-beach-resort-pool.jpg',
  sp.id, 'Africa/Lagos', 'pooled', 1, 'stay', cp.id, 30
FROM users u JOIN provider_profiles pp ON pp.user_id = u.id JOIN stay_properties sp ON sp.owner_provider_profile_id = pp.id JOIN booking_cancellation_policies cp ON cp.owner_user_id = u.id
WHERE u.email = 'demo_stay_lekkiresort@naijadeals.demo';

INSERT INTO bookable_listings
  (listing_type, provider_user_id, title, description, country_iso, city, booking_mode, pricing_unit, base_price_kobo, currency, is_active, category, cover_image_url, stay_property_id, timezone, capacity_model, is_date_only, vertical, cancellation_policy_id, deposit_percentage)
SELECT 'stay_unit', u.id, 'Studio Loft — [DEMO] The Urban Loft Abuja',
  'A stylish studio loft with high ceilings and a rooftop lounge. Sleeps up to 2 guests.',
  'NG', 'Abuja', 'instant', 'per_night', 6500000, 'NGN', 1, 'Loft', '/static/stay/urban-loft-abuja-interior.jpg',
  sp.id, 'Africa/Lagos', 'pooled', 1, 'stay', cp.id, 50
FROM users u JOIN provider_profiles pp ON pp.user_id = u.id JOIN stay_properties sp ON sp.owner_provider_profile_id = pp.id JOIN booking_cancellation_policies cp ON cp.owner_user_id = u.id
WHERE u.email = 'demo_stay_urbanloft@naijadeals.demo';

INSERT INTO bookable_listings
  (listing_type, provider_user_id, title, description, country_iso, city, booking_mode, pricing_unit, base_price_kobo, currency, is_active, category, cover_image_url, stay_property_id, timezone, capacity_model, is_date_only, vertical, cancellation_policy_id, deposit_percentage)
SELECT 'stay_unit', u.id, 'Penthouse Loft — [DEMO] The Urban Loft Abuja',
  'A top-floor penthouse loft with panoramic city views and a private terrace. Sleeps up to 4 guests.',
  'NG', 'Abuja', 'instant', 'per_night', 11000000, 'NGN', 1, 'Loft', '/static/stay/urban-loft-abuja-bathroom.jpg',
  sp.id, 'Africa/Lagos', 'pooled', 1, 'stay', cp.id, 50
FROM users u JOIN provider_profiles pp ON pp.user_id = u.id JOIN stay_properties sp ON sp.owner_provider_profile_id = pp.id JOIN booking_cancellation_policies cp ON cp.owner_user_id = u.id
WHERE u.email = 'demo_stay_urbanloft@naijadeals.demo';

INSERT INTO bookable_listings
  (listing_type, provider_user_id, title, description, country_iso, city, booking_mode, pricing_unit, base_price_kobo, currency, is_active, category, cover_image_url, stay_property_id, timezone, capacity_model, is_date_only, vertical, cancellation_policy_id, deposit_percentage)
SELECT 'stay_unit', u.id, 'Garden Room — [DEMO] Ikoyi Guest House',
  'A quiet room overlooking the private garden, with free breakfast included. Sleeps up to 2 guests.',
  'NG', 'Lagos', 'instant', 'per_night', 5500000, 'NGN', 1, 'Guest Room', '/static/stay/ikoyi-guest-house-bedroom.jpg',
  sp.id, 'Africa/Lagos', 'pooled', 1, 'stay', cp.id, 100
FROM users u JOIN provider_profiles pp ON pp.user_id = u.id JOIN stay_properties sp ON sp.owner_provider_profile_id = pp.id JOIN booking_cancellation_policies cp ON cp.owner_user_id = u.id
WHERE u.email = 'demo_stay_ikoyiguest@naijadeals.demo';

INSERT INTO bookable_listings
  (listing_type, provider_user_id, title, description, country_iso, city, booking_mode, pricing_unit, base_price_kobo, currency, is_active, category, cover_image_url, stay_property_id, timezone, capacity_model, is_date_only, vertical, cancellation_policy_id, deposit_percentage)
SELECT 'stay_unit', u.id, 'Master Suite — [DEMO] Ikoyi Guest House',
  'The largest room in the guest house, with garden views and an en-suite bathroom. Sleeps up to 2 guests.',
  'NG', 'Lagos', 'instant', 'per_night', 7500000, 'NGN', 1, 'Guest Room', '/static/stay/ikoyi-guest-house-garden.jpg',
  sp.id, 'Africa/Lagos', 'pooled', 1, 'stay', cp.id, 100
FROM users u JOIN provider_profiles pp ON pp.user_id = u.id JOIN stay_properties sp ON sp.owner_provider_profile_id = pp.id JOIN booking_cancellation_policies cp ON cp.owner_user_id = u.id
WHERE u.email = 'demo_stay_ikoyiguest@naijadeals.demo';

INSERT INTO bookable_listings
  (listing_type, provider_user_id, title, description, country_iso, city, booking_mode, pricing_unit, base_price_kobo, currency, is_active, category, cover_image_url, stay_property_id, timezone, capacity_model, is_date_only, vertical, cancellation_policy_id, deposit_percentage)
SELECT 'stay_unit', u.id, 'Villa Suite — [DEMO] Asokoro Garden Villa',
  'A private suite within the villa estate, with garden and pool access. Sleeps up to 4 guests.',
  'NG', 'Abuja', 'instant', 'per_night', 18000000, 'NGN', 1, 'Villa Suite', '/static/stay/asokoro-garden-villa-bedroom.jpg',
  sp.id, 'Africa/Lagos', 'pooled', 1, 'stay', cp.id, 100
FROM users u JOIN provider_profiles pp ON pp.user_id = u.id JOIN stay_properties sp ON sp.owner_provider_profile_id = pp.id JOIN booking_cancellation_policies cp ON cp.owner_user_id = u.id
WHERE u.email = 'demo_stay_asokorovilla@naijadeals.demo';

INSERT INTO bookable_listings
  (listing_type, provider_user_id, title, description, country_iso, city, booking_mode, pricing_unit, base_price_kobo, currency, is_active, category, cover_image_url, stay_property_id, timezone, capacity_model, is_date_only, vertical, cancellation_policy_id, deposit_percentage)
SELECT 'stay_unit', u.id, 'Full Villa — [DEMO] Asokoro Garden Villa',
  'The entire villa estate, exclusively for one group — private pool, garden, and full staff service. Sleeps up to 8 guests.',
  'NG', 'Abuja', 'instant', 'per_night', 45000000, 'NGN', 1, 'Full Villa', '/static/stay/asokoro-garden-villa-pool.jpg',
  sp.id, 'Africa/Lagos', 'pooled', 1, 'stay', cp.id, 100
FROM users u JOIN provider_profiles pp ON pp.user_id = u.id JOIN stay_properties sp ON sp.owner_provider_profile_id = pp.id JOIN booking_cancellation_policies cp ON cp.owner_user_id = u.id
WHERE u.email = 'demo_stay_asokorovilla@naijadeals.demo';

-- ============================================================
-- 6. STAY UNIT DETAILS — 1:1 extension (migration 0028) adding
--    unit_type/max_guests on top of the generic bookable_listings row.
-- ============================================================
INSERT INTO stay_unit_details (listing_id, unit_type, max_guests)
SELECT id, 'Deluxe Room', 2 FROM bookable_listings WHERE title = 'Deluxe Room — [DEMO] Lagos Palm Hotel';
INSERT INTO stay_unit_details (listing_id, unit_type, max_guests)
SELECT id, 'Executive Suite', 3 FROM bookable_listings WHERE title = 'Executive Suite — [DEMO] Lagos Palm Hotel';
INSERT INTO stay_unit_details (listing_id, unit_type, max_guests)
SELECT id, 'One-Bedroom Apartment', 2 FROM bookable_listings WHERE title = 'One-Bedroom Apartment — [DEMO] The Cedar Apartments';
INSERT INTO stay_unit_details (listing_id, unit_type, max_guests)
SELECT id, 'Two-Bedroom Apartment', 4 FROM bookable_listings WHERE title = 'Two-Bedroom Apartment — [DEMO] The Cedar Apartments';
INSERT INTO stay_unit_details (listing_id, unit_type, max_guests)
SELECT id, 'Beach Bungalow', 2 FROM bookable_listings WHERE title = 'Beach Bungalow — [DEMO] Lekki Beach Resort';
INSERT INTO stay_unit_details (listing_id, unit_type, max_guests)
SELECT id, 'Family Villa', 6 FROM bookable_listings WHERE title = 'Family Villa — [DEMO] Lekki Beach Resort';
INSERT INTO stay_unit_details (listing_id, unit_type, max_guests)
SELECT id, 'Studio Loft', 2 FROM bookable_listings WHERE title = 'Studio Loft — [DEMO] The Urban Loft Abuja';
INSERT INTO stay_unit_details (listing_id, unit_type, max_guests)
SELECT id, 'Penthouse Loft', 4 FROM bookable_listings WHERE title = 'Penthouse Loft — [DEMO] The Urban Loft Abuja';
INSERT INTO stay_unit_details (listing_id, unit_type, max_guests)
SELECT id, 'Garden Room', 2 FROM bookable_listings WHERE title = 'Garden Room — [DEMO] Ikoyi Guest House';
INSERT INTO stay_unit_details (listing_id, unit_type, max_guests)
SELECT id, 'Master Suite', 2 FROM bookable_listings WHERE title = 'Master Suite — [DEMO] Ikoyi Guest House';
INSERT INTO stay_unit_details (listing_id, unit_type, max_guests)
SELECT id, 'Villa Suite', 4 FROM bookable_listings WHERE title = 'Villa Suite — [DEMO] Asokoro Garden Villa';
INSERT INTO stay_unit_details (listing_id, unit_type, max_guests)
SELECT id, 'Full Villa', 8 FROM bookable_listings WHERE title = 'Full Villa — [DEMO] Asokoro Garden Villa';

-- ============================================================
-- 7. BOOKING RESOURCES — every bookable_listing needs >=1 (spec's "every
--    listing has >=1 resource, capacity never assumed to be 1" rule).
--    capacity_units here represents the number of identical units of that
--    room/unit type physically available at the property.
-- ============================================================
INSERT INTO booking_resources (listing_id, name, resource_type, capacity_units, sort_order)
SELECT id, 'Available units', 'pooled', 8, 0 FROM bookable_listings WHERE title = 'Deluxe Room — [DEMO] Lagos Palm Hotel';
INSERT INTO booking_resources (listing_id, name, resource_type, capacity_units, sort_order)
SELECT id, 'Available units', 'pooled', 3, 0 FROM bookable_listings WHERE title = 'Executive Suite — [DEMO] Lagos Palm Hotel';
INSERT INTO booking_resources (listing_id, name, resource_type, capacity_units, sort_order)
SELECT id, 'Available units', 'pooled', 5, 0 FROM bookable_listings WHERE title = 'One-Bedroom Apartment — [DEMO] The Cedar Apartments';
INSERT INTO booking_resources (listing_id, name, resource_type, capacity_units, sort_order)
SELECT id, 'Available units', 'pooled', 3, 0 FROM bookable_listings WHERE title = 'Two-Bedroom Apartment — [DEMO] The Cedar Apartments';
INSERT INTO booking_resources (listing_id, name, resource_type, capacity_units, sort_order)
SELECT id, 'Available units', 'pooled', 6, 0 FROM bookable_listings WHERE title = 'Beach Bungalow — [DEMO] Lekki Beach Resort';
INSERT INTO booking_resources (listing_id, name, resource_type, capacity_units, sort_order)
SELECT id, 'Available units', 'pooled', 2, 0 FROM bookable_listings WHERE title = 'Family Villa — [DEMO] Lekki Beach Resort';
INSERT INTO booking_resources (listing_id, name, resource_type, capacity_units, sort_order)
SELECT id, 'Available units', 'pooled', 4, 0 FROM bookable_listings WHERE title = 'Studio Loft — [DEMO] The Urban Loft Abuja';
INSERT INTO booking_resources (listing_id, name, resource_type, capacity_units, sort_order)
SELECT id, 'Available units', 'pooled', 2, 0 FROM bookable_listings WHERE title = 'Penthouse Loft — [DEMO] The Urban Loft Abuja';
INSERT INTO booking_resources (listing_id, name, resource_type, capacity_units, sort_order)
SELECT id, 'Available units', 'pooled', 5, 0 FROM bookable_listings WHERE title = 'Garden Room — [DEMO] Ikoyi Guest House';
INSERT INTO booking_resources (listing_id, name, resource_type, capacity_units, sort_order)
SELECT id, 'Available units', 'pooled', 2, 0 FROM bookable_listings WHERE title = 'Master Suite — [DEMO] Ikoyi Guest House';
INSERT INTO booking_resources (listing_id, name, resource_type, capacity_units, sort_order)
SELECT id, 'Available units', 'pooled', 2, 0 FROM bookable_listings WHERE title = 'Villa Suite — [DEMO] Asokoro Garden Villa';
INSERT INTO booking_resources (listing_id, name, resource_type, capacity_units, sort_order)
SELECT id, 'Available units', 'pooled', 1, 0 FROM bookable_listings WHERE title = 'Full Villa — [DEMO] Asokoro Garden Villa';

-- ============================================================
-- 8. AVAILABILITY BLOCKS — two realistic one-off maintenance blackouts,
--    proving the EXISTING blocking mechanism end-to-end for this vertical
--    (not just theoretically wired). Dates chosen in the future relative to
--    this migration's authoring date so they remain meaningful demo data.
-- ============================================================
INSERT INTO booking_availability_blocks (listing_id, resource_id, blocked_from, blocked_until, reason)
SELECT bl.id, br.id, '2026-12-24T00:00:00.000Z', '2026-12-27T00:00:00.000Z', 'Scheduled deep-cleaning and maintenance ([DEMO] block for availability testing)'
FROM bookable_listings bl JOIN booking_resources br ON br.listing_id = bl.id
WHERE bl.title = 'Executive Suite — [DEMO] Lagos Palm Hotel';

INSERT INTO booking_availability_blocks (listing_id, resource_id, blocked_from, blocked_until, reason)
SELECT bl.id, br.id, '2026-11-10T00:00:00.000Z', '2026-11-13T00:00:00.000Z', 'Private event booking, unavailable to the public ([DEMO] block for availability testing)'
FROM bookable_listings bl JOIN booking_resources br ON br.listing_id = bl.id
WHERE bl.title = 'Full Villa — [DEMO] Asokoro Garden Villa';

-- ============================================================
-- 9. ecosystem_verticals.stay status is DELIBERATELY NOT touched here.
--    Per explicit instruction: "Do not mark NaijaStay LIVE merely because
--    the pages render." That UPDATE happens as a SEPARATE, LATER migration
--    only after full local + production authenticated E2E verification.
-- ============================================================

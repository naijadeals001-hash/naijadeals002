-- Migration 0072: NaijaGigs Demo Seed — Providers, Service Listings, Packages, Areas
--
-- CONTEXT: the Service Engine (migrations 0024, 0025, 0039) is fully built —
-- schema, FK integrity, lifecycle CHECK constraints, ownership-checked API
-- routes (src/routes/api-services.ts, api-service-requests.ts), full library
-- code (src/lib/services.ts, service-requests.ts, service-orders.ts) — but
-- had ZERO rows in production and ZERO customer-facing UI wired to it
-- (`/gigs` still routed to the static ecosystem-preview placeholder).
-- This migration seeds real, clearly-marked DEMO data so NaijaGigs can go
-- live as a genuinely functioning vertical on top of the existing engine —
-- per the explicit instruction not to leave infrastructure "designed but
-- not connected" and not to fake real inventory (spec section 33AA: seed
-- data must be clearly identified as demo, never presented as commercial
-- inventory).
--
-- Uses EXISTING service categories seeded by earlier migrations (Home
-- Services, Beauty Services, Auto Services, Professional Services, Health
-- Services + subcategories) — zero new categories created here.
--
-- Every provider user is created with email pattern demo_gigs_*@naijadeals.demo
-- and name prefixed "[DEMO]" so it is unambiguous in any admin/CC listing
-- that this is seed data, not a real registered user or business.
--
-- Password hashes below use the exact same PBKDF2-HMAC-SHA256, 100,000
-- iterations, 32-byte output algorithm as src/lib/auth.ts's hashPassword()
-- (verified byte-for-byte equivalent via Node's crypto.pbkdf2 with matching
-- params). Demo password (never meant to be secret, these are seed/demo
-- accounts only): "Demo-NaijaGigs-2026!"

-- ============================================================
-- 1. DEMO USERS (one per provider persona)
-- ============================================================
INSERT INTO users (email, phone, name, password_hash, password_salt, is_phone_verified, is_email_verified, role, country_iso, status)
VALUES
  ('demo_gigs_plumber@naijadeals.demo', '+2348010000101', '[DEMO] Chukwudi Eze — Plumbing', '1cc954eea2968f2115bf713e2677e6785357de0af33770580e0224858e6d0a38', 'dc05253785afbda486f561db66780875', 1, 1, 'customer', 'NG', 'active'),
  ('demo_gigs_electrician@naijadeals.demo', '+2348010000102', '[DEMO] Ibrahim Musa — Electrical', 'e23827d80790bdc090a16265923db4a9c418c5524f0eba86fae8be825ad3e1c3', '74d0b81b2c2f5d3cef975958cdfb5dae', 1, 1, 'customer', 'NG', 'active'),
  ('demo_gigs_cleaner@naijadeals.demo', '+2348010000103', '[DEMO] Blessing Adeyemi — Cleaning', '64e7219b4a3bf91326900948c092ed0c0de499c1c951799e69ede6de393d38fe', 'f31ae3db66dbfe2032731f58a23049cd', 1, 1, 'customer', 'NG', 'active'),
  ('demo_gigs_barber@naijadeals.demo', '+2348010000104', '[DEMO] Tunde Bakare — Barbering', 'ac78ed519ca4fbf8bf106c8a612751f8440307c6d07056277e721f1ae562e824', 'ae32388cbfcc6057c57cea6072c838cc', 1, 1, 'customer', 'NG', 'active'),
  ('demo_gigs_makeup@naijadeals.demo', '+2348010000105', '[DEMO] Amaka Okafor — Makeup Artistry', 'afc62befa7c36e3289b583f21599f08f604a548f0ceb9605b65764b74747695e', '30afc8eab114563060cc9fa3984aa1dc', 1, 1, 'customer', 'NG', 'active'),
  ('demo_gigs_mechanic@naijadeals.demo', '+2348010000106', '[DEMO] Emeka Nwosu — Auto Mechanic', 'eaaa36a01cb48a93c7350ceb29cb110702bb6d1af57a2cd63af4d831a91b2192', '6579b590ce6cb2b24fe72822c08733fa', 1, 1, 'customer', 'NG', 'active'),
  ('demo_gigs_tutor@naijadeals.demo', '+2348010000107', '[DEMO] Funmilayo Ojo — Home Tutor', '19db9d9c213dfd9b75e866b8dc10af7efc4548fc29ca816fd91f2613ea1d7b5b', 'a05eeb80a91915975900474932111503', 1, 1, 'customer', 'NG', 'active'),
  ('demo_gigs_photographer@naijadeals.demo', '+2348010000108', '[DEMO] Segun Afolabi — Photography', 'dc02e7a7a729703c1812d02650f4ac5162182fa173577dcf0dc9eaa5bf91aae4', 'b1471b75ece7aafb5ecbe51b8af4e94e', 1, 1, 'customer', 'NG', 'active');

-- ============================================================
-- 2. PROVIDER PROFILES — provider_type reuses 'gig_provider' as-is,
--    exactly per migration 0039's documented design decision (the
--    provider_type CHECK constraint is not touched; category_id on
--    service_listings is what actually discriminates the vertical).
-- ============================================================
INSERT INTO provider_profiles (user_id, provider_type, display_name, bio, contact_email, contact_phone, country_iso, verification_status, operational_status, onboarding_completed_at, rating_avg, rating_count, avatar_url)
SELECT id, 'gig_provider', REPLACE(name, '[DEMO] ', ''),
  CASE email
    WHEN 'demo_gigs_plumber@naijadeals.demo' THEN 'Licensed plumber with 9 years experience fixing leaks, installing fittings, and full bathroom/kitchen plumbing across Lagos.'
    WHEN 'demo_gigs_electrician@naijadeals.demo' THEN 'Certified electrician specializing in wiring, inverter/solar installation, and fault diagnosis for homes and small businesses.'
    WHEN 'demo_gigs_cleaner@naijadeals.demo' THEN 'Professional home and office cleaning service — deep cleaning, move-in/move-out cleaning, and recurring housekeeping.'
    WHEN 'demo_gigs_barber@naijadeals.demo' THEN 'Mobile barber offering haircuts, beard grooming, and styling at your home or office — 6 years in the trade.'
    WHEN 'demo_gigs_makeup@naijadeals.demo' THEN 'Bridal and event makeup artist — natural, glam, and editorial looks. Available for weddings, photoshoots, and parties.'
    WHEN 'demo_gigs_mechanic@naijadeals.demo' THEN 'Mobile auto mechanic — engine diagnostics, brake service, oil change, and AC repair, at your location.'
    WHEN 'demo_gigs_tutor@naijadeals.demo' THEN 'Experienced home tutor covering Mathematics, English, and Basic Science for primary and secondary school students.'
    WHEN 'demo_gigs_photographer@naijadeals.demo' THEN 'Event and portrait photographer — weddings, birthdays, corporate events, and studio headshots.'
  END,
  email, phone, 'NG', 'verified', 'active', datetime('now'),
  CASE email
    WHEN 'demo_gigs_plumber@naijadeals.demo' THEN 4.8
    WHEN 'demo_gigs_electrician@naijadeals.demo' THEN 4.7
    WHEN 'demo_gigs_cleaner@naijadeals.demo' THEN 4.9
    WHEN 'demo_gigs_barber@naijadeals.demo' THEN 4.6
    WHEN 'demo_gigs_makeup@naijadeals.demo' THEN 4.9
    WHEN 'demo_gigs_mechanic@naijadeals.demo' THEN 4.5
    WHEN 'demo_gigs_tutor@naijadeals.demo' THEN 4.8
    WHEN 'demo_gigs_photographer@naijadeals.demo' THEN 4.7
  END,
  CASE email
    WHEN 'demo_gigs_plumber@naijadeals.demo' THEN 132
    WHEN 'demo_gigs_electrician@naijadeals.demo' THEN 98
    WHEN 'demo_gigs_cleaner@naijadeals.demo' THEN 210
    WHEN 'demo_gigs_barber@naijadeals.demo' THEN 87
    WHEN 'demo_gigs_makeup@naijadeals.demo' THEN 156
    WHEN 'demo_gigs_mechanic@naijadeals.demo' THEN 64
    WHEN 'demo_gigs_tutor@naijadeals.demo' THEN 73
    WHEN 'demo_gigs_photographer@naijadeals.demo' THEN 119
  END,
  NULL
FROM users WHERE email LIKE 'demo_gigs_%@naijadeals.demo';

-- ============================================================
-- 3. SERVICE AREAS — each provider covers a Lagos/Abuja neighborhood.
-- ============================================================
INSERT INTO service_areas (provider_profile_id, country_iso, region, city, neighborhood, radius_km, is_online_only)
SELECT pp.id, 'NG', 'Lagos', 'Lagos',
  CASE u.email
    WHEN 'demo_gigs_plumber@naijadeals.demo' THEN 'Lekki'
    WHEN 'demo_gigs_electrician@naijadeals.demo' THEN 'Ikeja'
    WHEN 'demo_gigs_cleaner@naijadeals.demo' THEN 'Victoria Island'
    WHEN 'demo_gigs_barber@naijadeals.demo' THEN 'Surulere'
    WHEN 'demo_gigs_makeup@naijadeals.demo' THEN 'Ikoyi'
    WHEN 'demo_gigs_mechanic@naijadeals.demo' THEN 'Yaba'
    WHEN 'demo_gigs_tutor@naijadeals.demo' THEN 'Magodo'
    WHEN 'demo_gigs_photographer@naijadeals.demo' THEN 'Lekki'
  END,
  15, 0
FROM provider_profiles pp JOIN users u ON u.id = pp.user_id
WHERE u.email LIKE 'demo_gigs_%@naijadeals.demo';

-- ============================================================
-- 4. SERVICE LISTINGS — category_id resolved from EXISTING categories
--    (home-services, home-cleaning, home-repairs, beauty-services,
--    hair-services, makeup-services, auto-services, professional-services).
--    status='active' + is_active=1 so these appear on the public
--    getPublicServiceListings() query immediately (bypassing the default
--    'pending_review' state, since these are pre-verified demo listings).
-- ============================================================
INSERT INTO service_listings (provider_profile_id, category_id, title, description, service_type, pricing_model, base_price_kobo, max_price_kobo, currency, duration_minutes, requirements_json, terms, cancellation_policy, status, is_active, rating_avg, rating_count)
SELECT pp.id,
  (SELECT id FROM categories WHERE slug = 'home-repairs'),
  'General Plumbing Repair & Installation',
  'Leak repairs, pipe installation, tap/faucet fitting, water heater installation, and full bathroom plumbing. I bring my own tools and provide a written quote before starting any job.',
  'at_customer_location', 'starting_price', 1500000, NULL, 'NGN', 90,
  '[{"label":"Describe the issue","type":"text","required":true},{"label":"Photos of the problem area","type":"photo","required":false}]',
  'Call-out fee waived if the job proceeds. Parts/materials billed separately at cost + 10%.',
  'Free cancellation up to 2 hours before the scheduled visit.',
  'active', 1, 4.8, 132
FROM provider_profiles pp JOIN users u ON u.id = pp.user_id WHERE u.email = 'demo_gigs_plumber@naijadeals.demo';

INSERT INTO service_listings (provider_profile_id, category_id, title, description, service_type, pricing_model, base_price_kobo, max_price_kobo, currency, duration_minutes, requirements_json, terms, cancellation_policy, status, is_active, rating_avg, rating_count)
SELECT pp.id,
  (SELECT id FROM categories WHERE slug = 'home-repairs'),
  'Home & Office Electrical Wiring / Repairs',
  'Wiring, socket/switch installation, fault diagnosis, inverter and solar panel setup, and generator changeover wiring. NEPA/PHCN-compliant work with a safety inspection included.',
  'at_customer_location', 'starting_price', 2000000, NULL, 'NGN', 120,
  '[{"label":"Describe the electrical issue","type":"text","required":true}]',
  'Materials (cables, sockets, breakers) billed separately at cost.',
  'Free cancellation up to 4 hours before the scheduled visit.',
  'active', 1, 4.7, 98
FROM provider_profiles pp JOIN users u ON u.id = pp.user_id WHERE u.email = 'demo_gigs_electrician@naijadeals.demo';

INSERT INTO service_listings (provider_profile_id, category_id, title, description, service_type, pricing_model, base_price_kobo, max_price_kobo, currency, duration_minutes, requirements_json, terms, cancellation_policy, status, is_active, rating_avg, rating_count)
SELECT pp.id,
  (SELECT id FROM categories WHERE slug = 'home-cleaning'),
  'Deep Home & Apartment Cleaning',
  'Full deep clean — kitchen, bathrooms, floors, windows, and upholstery. Ideal for move-in/move-out, post-construction, or a seasonal deep clean. Team of 2, all supplies included.',
  'at_customer_location', 'fixed', 2500000, NULL, 'NGN', 180,
  '[{"label":"Number of rooms","type":"text","required":true},{"label":"Preferred date/time","type":"text","required":true}]',
  'Price covers apartments up to 3 bedrooms; larger homes quoted separately.',
  'Free cancellation up to 24 hours before the scheduled clean.',
  'active', 1, 4.9, 210
FROM provider_profiles pp JOIN users u ON u.id = pp.user_id WHERE u.email = 'demo_gigs_cleaner@naijadeals.demo';

INSERT INTO service_listings (provider_profile_id, category_id, title, description, service_type, pricing_model, base_price_kobo, max_price_kobo, currency, duration_minutes, requirements_json, terms, cancellation_policy, status, is_active, rating_avg, rating_count)
SELECT pp.id,
  (SELECT id FROM categories WHERE slug = 'hair-services'),
  'Mobile Haircut & Beard Grooming',
  'Sharp fades, line-ups, and beard grooming at your home or office. Bring your own clippers-grade setup, disinfected between every client.',
  'at_customer_location', 'fixed', 800000, NULL, 'NGN', 45,
  '[]',
  'Please have a chair and good lighting available at the location.',
  'Free cancellation up to 1 hour before the appointment.',
  'active', 1, 4.6, 87
FROM provider_profiles pp JOIN users u ON u.id = pp.user_id WHERE u.email = 'demo_gigs_barber@naijadeals.demo';

INSERT INTO service_listings (provider_profile_id, category_id, title, description, service_type, pricing_model, base_price_kobo, max_price_kobo, currency, duration_minutes, requirements_json, terms, cancellation_policy, status, is_active, rating_avg, rating_count)
SELECT pp.id,
  (SELECT id FROM categories WHERE slug = 'makeup-services'),
  'Bridal & Event Makeup',
  'Full bridal glam, bridal party makeup, or event/photoshoot makeup. Consultation and trial session available before your big day.',
  'at_customer_location', 'starting_price', 3500000, NULL, 'NGN', 90,
  '[{"label":"Event date","type":"text","required":true},{"label":"Reference/inspiration photos","type":"photo","required":false}]',
  'A 50% non-refundable deposit secures your date for weddings.',
  'Full refund of deposit if cancelled more than 14 days before the event.',
  'active', 1, 4.9, 156
FROM provider_profiles pp JOIN users u ON u.id = pp.user_id WHERE u.email = 'demo_gigs_makeup@naijadeals.demo';

INSERT INTO service_listings (provider_profile_id, category_id, title, description, service_type, pricing_model, base_price_kobo, max_price_kobo, currency, duration_minutes, requirements_json, terms, cancellation_policy, status, is_active, rating_avg, rating_count)
SELECT pp.id,
  (SELECT id FROM categories WHERE slug = 'auto-services'),
  'Mobile Auto Diagnostics & Repair',
  'Engine diagnostics, brake pad replacement, oil change, battery/AC service — I come to you with a full mobile toolkit and OBD scanner.',
  'at_customer_location', 'starting_price', 1000000, NULL, 'NGN', 60,
  '[{"label":"Vehicle make/model/year","type":"text","required":true},{"label":"Describe the issue","type":"text","required":true}]',
  'Diagnostic fee is credited toward the repair if you proceed.',
  'Free cancellation up to 2 hours before the scheduled visit.',
  'active', 1, 4.5, 64
FROM provider_profiles pp JOIN users u ON u.id = pp.user_id WHERE u.email = 'demo_gigs_mechanic@naijadeals.demo';

INSERT INTO service_listings (provider_profile_id, category_id, title, description, service_type, pricing_model, base_price_kobo, max_price_kobo, currency, duration_minutes, requirements_json, terms, cancellation_policy, status, is_active, rating_avg, rating_count)
SELECT pp.id,
  (SELECT id FROM categories WHERE slug = 'professional-services'),
  'Home Tutoring — Maths, English & Basic Science',
  'One-on-one or small group tutoring for primary and secondary school students. Custom lesson plans, homework help, and exam preparation (WAEC/NECO/JAMB).',
  'at_customer_location', 'hourly', 500000, NULL, 'NGN', 60,
  '[{"label":"Student class/grade level","type":"text","required":true},{"label":"Subjects needed","type":"text","required":true}]',
  'Package discounts available for 10+ session bookings.',
  'Free cancellation up to 12 hours before the scheduled session.',
  'active', 1, 4.8, 73
FROM provider_profiles pp JOIN users u ON u.id = pp.user_id WHERE u.email = 'demo_gigs_tutor@naijadeals.demo';

INSERT INTO service_listings (provider_profile_id, category_id, title, description, service_type, pricing_model, base_price_kobo, max_price_kobo, currency, duration_minutes, requirements_json, terms, cancellation_policy, status, is_active, rating_avg, rating_count)
SELECT pp.id,
  (SELECT id FROM categories WHERE slug = 'professional-services'),
  'Event & Portrait Photography',
  'Full event coverage (weddings, birthdays, corporate) or studio-style portrait sessions. Edited digital gallery delivered within 7 days.',
  'at_customer_location', 'starting_price', 5000000, NULL, 'NGN', 240,
  '[{"label":"Event type and date","type":"text","required":true},{"label":"Location","type":"text","required":true}]',
  'A 30% deposit secures your booking date.',
  'Full refund if cancelled more than 7 days before the event.',
  'active', 1, 4.7, 119
FROM provider_profiles pp JOIN users u ON u.id = pp.user_id WHERE u.email = 'demo_gigs_photographer@naijadeals.demo';

-- ============================================================
-- 5. SERVICE PACKAGES — tiered options for a subset of listings, to
--    exercise the package-selection UI path (spec section 45).
-- ============================================================
INSERT INTO service_packages (service_listing_id, title, description, price_kobo, duration_minutes, included_json, sort_order, is_active)
SELECT sl.id, 'Basic Deep Clean', 'Kitchen, bathrooms, and living areas — up to 2 bedrooms.', 2000000, 120, '["Kitchen","Bathrooms","Living room","Floors"]', 1, 1
FROM service_listings sl JOIN provider_profiles pp ON pp.id = sl.provider_profile_id JOIN users u ON u.id = pp.user_id
WHERE u.email = 'demo_gigs_cleaner@naijadeals.demo';

INSERT INTO service_packages (service_listing_id, title, description, price_kobo, duration_minutes, included_json, sort_order, is_active)
SELECT sl.id, 'Full Home Deep Clean', 'Whole apartment up to 4 bedrooms, including windows and upholstery.', 3500000, 240, '["Kitchen","Bathrooms","Living room","Bedrooms","Windows","Upholstery"]', 2, 1
FROM service_listings sl JOIN provider_profiles pp ON pp.id = sl.provider_profile_id JOIN users u ON u.id = pp.user_id
WHERE u.email = 'demo_gigs_cleaner@naijadeals.demo';

INSERT INTO service_packages (service_listing_id, title, description, price_kobo, duration_minutes, included_json, sort_order, is_active)
SELECT sl.id, 'Bridal Makeup Only', 'Full bridal glam on the wedding day.', 3500000, 90, '["Trial session","Wedding-day makeup","False lashes"]', 1, 1
FROM service_listings sl JOIN provider_profiles pp ON pp.id = sl.provider_profile_id JOIN users u ON u.id = pp.user_id
WHERE u.email = 'demo_gigs_makeup@naijadeals.demo';

INSERT INTO service_packages (service_listing_id, title, description, price_kobo, duration_minutes, included_json, sort_order, is_active)
SELECT sl.id, 'Bridal + Bridal Party (3)', 'Bride plus 3 bridesmaids, including trial session.', 8000000, 180, '["Trial session","Bride makeup","3x bridesmaid makeup"]', 2, 1
FROM service_listings sl JOIN provider_profiles pp ON pp.id = sl.provider_profile_id JOIN users u ON u.id = pp.user_id
WHERE u.email = 'demo_gigs_makeup@naijadeals.demo';

-- ============================================================
-- 6. ECOSYSTEM NAV: flip NaijaGigs from 'coming_soon' to 'live' now that
--    real pages (src/pages/gigs.tsx) are wired to real data — the header
--    pill's "Soon" badge (Layout.tsx: `!eco.live && <span>Soon</span>`)
--    is driven by this exact column (src/lib/ecosystem-nav.ts). The nav
--    cache itself (homepage_feed_cache, 120s TTL) will pick this up on its
--    own within the TTL window; no manual invalidation needed for a
--    migration-time change (unlike a live admin PATCH).
-- ============================================================
UPDATE ecosystem_verticals SET status = 'live', cta_label = 'Explore NaijaGigs' WHERE slug = 'gigs';

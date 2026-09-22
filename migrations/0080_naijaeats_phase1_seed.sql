-- Migration 0080: NaijaEats Phase 1 Seed — 6 Demo Restaurants, Providers,
-- Users, Menus, Items, Options
--
-- CONTEXT: NaijaEats' schema (0032/0033) is fully built and applied to
-- production, but had ZERO restaurants/menus/menu_items/orders and no
-- customer-facing UI wired to it. This migration seeds exactly six
-- explicitly-labeled DEMO restaurants so Phase 1 (the customer ordering
-- experience) has real, referentially-valid data to render against —
-- following the exact seed-data precedent set by migration 0072
-- (NaijaGigs) and 0073 (NaijaStay): demo users with the
-- demo_eats_*@naijadeals.demo email convention, [DEMO] name prefix,
-- role='customer' (the provider/business distinction lives entirely in
-- provider_profiles.provider_type, never in users.role).
--
-- ABSOLUTE DATA PRINCIPLE HONORED: every restaurant, provider profile, and
-- menu item below is created with explicit source_type='seed' (never
-- relying on the column's 'live' default — migration 0079). No fabricated
-- ratings/reviews (rating_avg=0, rating_count=0 throughout), no fake
-- delivery ETAs, no fake deals, no live driver tracking. All six
-- restaurants/providers are verification_status='pending' — demo data must
-- never appear to be a verified real-world business.
--
-- Every menu_item.dish_id below references an EXISTING row in the `dishes`
-- table restored by migration 0078 (production-exact taxonomy). Zero new
-- dish taxonomy is invented here. Where a cuisine's real dish catalog is
-- thin (Senegalese: 3 dishes: Ivorian: 2 dishes; Moroccan: 3 dishes),
-- multiple menu_items legitimately reference the SAME dish_id as distinct,
-- real-world protein/preparation/serving variants (e.g. Thieboudienne
-- Rouge vs. Thieboudienne Blanc; Attiéké Poisson vs. Attiéké Poulet) —
-- explicitly approved by Pat, never a fabricated dish, never dish_id=NULL.
--
-- Password hashes below use the exact same PBKDF2-HMAC-SHA256, 100,000
-- iterations, 32-byte-output algorithm as src/lib/auth.ts's hashPassword()
-- (verified via Node's crypto.pbkdf2Sync with matching params). Demo
-- password (never meant to be secret — these are seed/demo accounts only):
-- "Demo-NaijaEats-2026!". Phone range +234803000030{1-6} was verified
-- unique against the full production `users.phone` column immediately
-- before writing this migration (Gigs uses +234801000010x, Stay uses
-- +234802000020x — no collision).
--
-- Explicitly OUT OF SCOPE for this migration (per Pat's Phase 1
-- authorization): Favorites/wishlist rows, Deals, Reservations, Catering,
-- fake reviews, fake popularity/order counts, fake customer activity.
--
-- Authorized for LOCAL/DEV D1 ONLY. Not applied to production. Does not
-- touch ecosystem_verticals (eats.status remains 'coming_soon', untouched).
--
-- Idempotent: every INSERT is guarded by WHERE NOT EXISTS on a natural key
-- (email for users, restaurant slug for restaurants, etc.) so re-running
-- this migration is a no-op after the first successful application.

-- ============================================================
-- 1. DEMO USERS (one per restaurant operator persona)
-- ============================================================
INSERT INTO users (email, phone, name, password_hash, password_salt, is_phone_verified, is_email_verified, role, country_iso, status)
SELECT 'demo_eats_mamabisi@naijadeals.demo', '+2348030000301', '[DEMO] Bisi Adewale — Mama Bisi''s Kitchen', '961ea0dbb8e3bc2a66d3044a5d5cad5f3a1ddc256cea19cab484d6ddfb2004e3', '3bfb493e4af09dfd6a28dbe41b2f3577', 1, 1, 'customer', 'NG', 'active'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'demo_eats_mamabisi@naijadeals.demo');

INSERT INTO users (email, phone, name, password_hash, password_salt, is_phone_verified, is_email_verified, role, country_iso, status)
SELECT 'demo_eats_suyaspot@naijadeals.demo', '+2348030000302', '[DEMO] Tunde Okonkwo — Suya Spot Grill House', 'cac322aefea6592320602aa33ee8f605a0099202db0455413b6893efb9516432', '9f1de5e9a365980cce5690271832e9d2', 1, 1, 'customer', 'NG', 'active'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'demo_eats_suyaspot@naijadeals.demo');

INSERT INTO users (email, phone, name, password_hash, password_salt, is_phone_verified, is_email_verified, role, country_iso, status)
SELECT 'demo_eats_accrachop@naijadeals.demo', '+2348030000303', '[DEMO] Ama Boateng — Accra Chop House', '7d8760074ab75abc313a07d276f5f2fc4fa15c5346928c69a6b1a6309449ffb5', 'f4fa8c0ef9ec59897446f79db6694606', 1, 1, 'customer', 'NG', 'active'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'demo_eats_accrachop@naijadeals.demo');

INSERT INTO users (email, phone, name, password_hash, password_salt, is_phone_verified, is_email_verified, role, country_iso, status)
SELECT 'demo_eats_senegaltable@naijadeals.demo', '+2348030000304', '[DEMO] Fatou Diallo — Senegal Table', 'ef15ee951c6b0ee751f571550a03e09b471d7e471ed34abd1018ed4ec1ff1bdf', '5ad466b99e69aadc2b7360107480f64d', 1, 1, 'customer', 'NG', 'active'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'demo_eats_senegaltable@naijadeals.demo');

INSERT INTO users (email, phone, name, password_hash, password_salt, is_phone_verified, is_email_verified, role, country_iso, status)
SELECT 'demo_eats_ivoriankitchen@naijadeals.demo', '+2348030000305', '[DEMO] Kouassi N''Guessan — Ivorian Kitchen', '445d26aad7a0fdf798b52bc3c3cef210b6bd6b890b9646f5810fa363f2435412', 'ebed3774751f1a2c9d592fb4a96981d0', 1, 1, 'customer', 'NG', 'active'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'demo_eats_ivoriankitchen@naijadeals.demo');

INSERT INTO users (email, phone, name, password_hash, password_salt, is_phone_verified, is_email_verified, role, country_iso, status)
SELECT 'demo_eats_baobabroom@naijadeals.demo', '+2348030000306', '[DEMO] Yasmine El-Amrani — The Baobab Room', 'e0283be1af4f9ea6a4ddd388a36ba1b7e407c43f55be4addee45a33f92ea801f', 'db5dbc040afda9c77e8dc67508922f91', 1, 1, 'customer', 'NG', 'active'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'demo_eats_baobabroom@naijadeals.demo');

-- ============================================================
-- 2. PROVIDER PROFILES — provider_type='restaurant_operator' (first use
--    of this CHECK-constraint value; verification_status='pending' per
--    Pat's explicit correction — demo restaurants must not appear
--    verified). rating_avg/rating_count = 0, honest-zero.
-- ============================================================
INSERT INTO provider_profiles (user_id, provider_type, display_name, bio, contact_email, contact_phone, country_iso, verification_status, operational_status, rating_avg, rating_count)
SELECT u.id, 'restaurant_operator', 'Bisi Adewale',
  'Runs a home-style Nigerian kitchen serving Yaba since 2014. Specializes in traditional soups made from scratch daily.',
  u.email, u.phone, 'NG', 'pending', 'active', 0, 0
FROM users u WHERE u.email = 'demo_eats_mamabisi@naijadeals.demo'
  AND NOT EXISTS (SELECT 1 FROM provider_profiles pp WHERE pp.user_id = u.id AND pp.provider_type = 'restaurant_operator');

INSERT INTO provider_profiles (user_id, provider_type, display_name, bio, contact_email, contact_phone, country_iso, verification_status, operational_status, rating_avg, rating_count)
SELECT u.id, 'restaurant_operator', 'Tunde Okonkwo',
  'Lagos street-food grill specialist — suya, asun, and pepper soup done the authentic way, fast.',
  u.email, u.phone, 'NG', 'pending', 'active', 0, 0
FROM users u WHERE u.email = 'demo_eats_suyaspot@naijadeals.demo'
  AND NOT EXISTS (SELECT 1 FROM provider_profiles pp WHERE pp.user_id = u.id AND pp.provider_type = 'restaurant_operator');

INSERT INTO provider_profiles (user_id, provider_type, display_name, bio, contact_email, contact_phone, country_iso, verification_status, operational_status, rating_avg, rating_count)
SELECT u.id, 'restaurant_operator', 'Ama Boateng',
  'Ghanaian kitchen bringing waakye, banku, and groundnut soup to Lekki since 2018.',
  u.email, u.phone, 'NG', 'pending', 'active', 0, 0
FROM users u WHERE u.email = 'demo_eats_accrachop@naijadeals.demo'
  AND NOT EXISTS (SELECT 1 FROM provider_profiles pp WHERE pp.user_id = u.id AND pp.provider_type = 'restaurant_operator');

INSERT INTO provider_profiles (user_id, provider_type, display_name, bio, contact_email, contact_phone, country_iso, verification_status, operational_status, rating_avg, rating_count)
SELECT u.id, 'restaurant_operator', 'Fatou Diallo',
  'Senegalese specialties — thieboudienne, yassa, and mafé — bringing Dakar''s flavors to Abuja.',
  u.email, u.phone, 'NG', 'pending', 'active', 0, 0
FROM users u WHERE u.email = 'demo_eats_senegaltable@naijadeals.demo'
  AND NOT EXISTS (SELECT 1 FROM provider_profiles pp WHERE pp.user_id = u.id AND pp.provider_type = 'restaurant_operator');

INSERT INTO provider_profiles (user_id, provider_type, display_name, bio, contact_email, contact_phone, country_iso, verification_status, operational_status, rating_avg, rating_count)
SELECT u.id, 'restaurant_operator', 'Kouassi N''Guessan',
  'Ivorian kitchen specializing in attiéké and kedjenou, serving Victoria Island since 2020.',
  u.email, u.phone, 'NG', 'pending', 'active', 0, 0
FROM users u WHERE u.email = 'demo_eats_ivoriankitchen@naijadeals.demo'
  AND NOT EXISTS (SELECT 1 FROM provider_profiles pp WHERE pp.user_id = u.id AND pp.provider_type = 'restaurant_operator');

INSERT INTO provider_profiles (user_id, provider_type, display_name, bio, contact_email, contact_phone, country_iso, verification_status, operational_status, rating_avg, rating_count)
SELECT u.id, 'restaurant_operator', 'Yasmine El-Amrani',
  'Premium Moroccan dining — tagine, couscous, and pastilla — on Victoria Island.',
  u.email, u.phone, 'NG', 'pending', 'active', 0, 0
FROM users u WHERE u.email = 'demo_eats_baobabroom@naijadeals.demo'
  AND NOT EXISTS (SELECT 1 FROM provider_profiles pp WHERE pp.user_id = u.id AND pp.provider_type = 'restaurant_operator');

-- ============================================================
-- 3. RESTAURANTS — is_active=1 (data-level flag, independent of
--    ecosystem_verticals.eats.status which remains 'coming_soon' and is
--    NOT touched by this migration). verification_status='pending',
--    rating_avg=0, rating_count=0, source_type='seed' EXPLICIT (never
--    relying on the column default of 'live').
-- ============================================================
INSERT INTO restaurants (slug, owner_provider_profile_id, name, description, cuisine_id, country_iso, city, address_line1, opening_time, closing_time, delivery_fee_kobo, min_order_kobo, avg_prep_minutes, delivery_zone_note, is_active, verification_status, rating_avg, rating_count, source_type)
SELECT 'mama-bisis-kitchen', pp.id, 'Mama Bisi''s Kitchen',
  'Home-style Nigerian cooking — soups, stews, and swallow made the way your mother makes it. A neighborhood favorite in Yaba for over a decade.',
  1, 'NG', 'Lagos', '14 Herbert Macaulay Way, Yaba, Lagos', '09:00', '21:00', 80000, 250000, 30,
  'Delivers within Yaba, Ebute-Metta, and Akoka', 1, 'pending', 0, 0, 'seed'
FROM provider_profiles pp JOIN users u ON u.id = pp.user_id
WHERE u.email = 'demo_eats_mamabisi@naijadeals.demo' AND pp.provider_type = 'restaurant_operator'
  AND NOT EXISTS (SELECT 1 FROM restaurants WHERE slug = 'mama-bisis-kitchen');

INSERT INTO restaurants (slug, owner_provider_profile_id, name, description, cuisine_id, country_iso, city, address_line1, opening_time, closing_time, delivery_fee_kobo, min_order_kobo, avg_prep_minutes, delivery_zone_note, is_active, verification_status, rating_avg, rating_count, source_type)
SELECT 'suya-spot-grill-house', pp.id, 'Suya Spot Grill House',
  'Lagos street-food grill classics — suya, asun, and pepper soup done the authentic way, fast.',
  1, 'NG', 'Lagos', '21 Allen Avenue, Ikeja, Lagos', '12:00', '23:00', 70000, 200000, 20,
  'Delivers within Ikeja, Maryland, and Opebi', 1, 'pending', 0, 0, 'seed'
FROM provider_profiles pp JOIN users u ON u.id = pp.user_id
WHERE u.email = 'demo_eats_suyaspot@naijadeals.demo' AND pp.provider_type = 'restaurant_operator'
  AND NOT EXISTS (SELECT 1 FROM restaurants WHERE slug = 'suya-spot-grill-house');

INSERT INTO restaurants (slug, owner_provider_profile_id, name, description, cuisine_id, country_iso, city, address_line1, opening_time, closing_time, delivery_fee_kobo, min_order_kobo, avg_prep_minutes, delivery_zone_note, is_active, verification_status, rating_avg, rating_count, source_type)
SELECT 'accra-chop-house', pp.id, 'Accra Chop House',
  'Ghanaian classics — waakye, banku, and fufu — served fresh in the heart of Lekki.',
  2, 'NG', 'Lagos', '8 Admiralty Way, Lekki Phase 1, Lagos', '10:00', '22:00', 90000, 300000, 30,
  'Delivers within Lekki Phase 1, Chevron, and Ajah', 1, 'pending', 0, 0, 'seed'
FROM provider_profiles pp JOIN users u ON u.id = pp.user_id
WHERE u.email = 'demo_eats_accrachop@naijadeals.demo' AND pp.provider_type = 'restaurant_operator'
  AND NOT EXISTS (SELECT 1 FROM restaurants WHERE slug = 'accra-chop-house');

INSERT INTO restaurants (slug, owner_provider_profile_id, name, description, cuisine_id, country_iso, city, address_line1, opening_time, closing_time, delivery_fee_kobo, min_order_kobo, avg_prep_minutes, delivery_zone_note, is_active, verification_status, rating_avg, rating_count, source_type)
SELECT 'senegal-table', pp.id, 'Senegal Table',
  'Authentic Senegalese specialties — thieboudienne, yassa, and mafé — in the heart of Abuja.',
  3, 'NG', 'Abuja', '12 Aminu Kano Crescent, Wuse II, Abuja', '11:00', '22:00', 100000, 350000, 35,
  'Delivers within Wuse II, Maitama, and Asokoro', 1, 'pending', 0, 0, 'seed'
FROM provider_profiles pp JOIN users u ON u.id = pp.user_id
WHERE u.email = 'demo_eats_senegaltable@naijadeals.demo' AND pp.provider_type = 'restaurant_operator'
  AND NOT EXISTS (SELECT 1 FROM restaurants WHERE slug = 'senegal-table');

INSERT INTO restaurants (slug, owner_provider_profile_id, name, description, cuisine_id, country_iso, city, address_line1, opening_time, closing_time, delivery_fee_kobo, min_order_kobo, avg_prep_minutes, delivery_zone_note, is_active, verification_status, rating_avg, rating_count, source_type)
SELECT 'ivorian-kitchen', pp.id, 'Ivorian Kitchen',
  'Côte d''Ivoire cuisine — attiéké and kedjenou made fresh — on Victoria Island.',
  4, 'NG', 'Lagos', '5 Ozumba Mbadiwe Avenue, Victoria Island, Lagos', '11:00', '22:00', 100000, 350000, 35,
  'Delivers within Victoria Island and Ikoyi', 1, 'pending', 0, 0, 'seed'
FROM provider_profiles pp JOIN users u ON u.id = pp.user_id
WHERE u.email = 'demo_eats_ivoriankitchen@naijadeals.demo' AND pp.provider_type = 'restaurant_operator'
  AND NOT EXISTS (SELECT 1 FROM restaurants WHERE slug = 'ivorian-kitchen');

INSERT INTO restaurants (slug, owner_provider_profile_id, name, description, cuisine_id, country_iso, city, address_line1, opening_time, closing_time, delivery_fee_kobo, min_order_kobo, avg_prep_minutes, delivery_zone_note, is_active, verification_status, rating_avg, rating_count, source_type)
SELECT 'the-baobab-room', pp.id, 'The Baobab Room',
  'Premium Moroccan dining — tagine, couscous, and pastilla — a signature experience on Victoria Island.',
  10, 'NG', 'Lagos', '30 Adeola Odeku Street, Victoria Island, Lagos', '12:00', '23:00', 150000, 600000, 45,
  'Delivers within Victoria Island, Ikoyi, and Lekki Phase 1', 1, 'pending', 0, 0, 'seed'
FROM provider_profiles pp JOIN users u ON u.id = pp.user_id
WHERE u.email = 'demo_eats_baobabroom@naijadeals.demo' AND pp.provider_type = 'restaurant_operator'
  AND NOT EXISTS (SELECT 1 FROM restaurants WHERE slug = 'the-baobab-room');

-- ============================================================
-- 4. MENUS — one active "Main Menu" per restaurant
-- ============================================================
INSERT INTO menus (restaurant_id, name, is_active)
SELECT r.id, 'Main Menu', 1 FROM restaurants r
WHERE r.slug IN ('mama-bisis-kitchen','suya-spot-grill-house','accra-chop-house','senegal-table','ivorian-kitchen','the-baobab-room')
  AND NOT EXISTS (SELECT 1 FROM menus m WHERE m.restaurant_id = r.id);

-- ============================================================
-- 5. MENU SECTIONS
-- ============================================================
INSERT INTO menu_sections (menu_id, name, sort_order)
SELECT m.id, 'Soups', 1 FROM menus m JOIN restaurants r ON r.id = m.restaurant_id
WHERE r.slug = 'mama-bisis-kitchen'
  AND NOT EXISTS (SELECT 1 FROM menu_sections ms WHERE ms.menu_id = m.id AND ms.name = 'Soups');

INSERT INTO menu_sections (menu_id, name, sort_order)
SELECT m.id, 'Rice & Sides', 2 FROM menus m JOIN restaurants r ON r.id = m.restaurant_id
WHERE r.slug = 'mama-bisis-kitchen'
  AND NOT EXISTS (SELECT 1 FROM menu_sections ms WHERE ms.menu_id = m.id AND ms.name = 'Rice & Sides');

INSERT INTO menu_sections (menu_id, name, sort_order)
SELECT m.id, 'Grills & Street Food', 1 FROM menus m JOIN restaurants r ON r.id = m.restaurant_id
WHERE r.slug = 'suya-spot-grill-house'
  AND NOT EXISTS (SELECT 1 FROM menu_sections ms WHERE ms.menu_id = m.id AND ms.name = 'Grills & Street Food');

INSERT INTO menu_sections (menu_id, name, sort_order)
SELECT m.id, 'Ghanaian Classics', 1 FROM menus m JOIN restaurants r ON r.id = m.restaurant_id
WHERE r.slug = 'accra-chop-house'
  AND NOT EXISTS (SELECT 1 FROM menu_sections ms WHERE ms.menu_id = m.id AND ms.name = 'Ghanaian Classics');

INSERT INTO menu_sections (menu_id, name, sort_order)
SELECT m.id, 'Senegalese Specialties', 1 FROM menus m JOIN restaurants r ON r.id = m.restaurant_id
WHERE r.slug = 'senegal-table'
  AND NOT EXISTS (SELECT 1 FROM menu_sections ms WHERE ms.menu_id = m.id AND ms.name = 'Senegalese Specialties');

INSERT INTO menu_sections (menu_id, name, sort_order)
SELECT m.id, 'Ivorian Specialties', 1 FROM menus m JOIN restaurants r ON r.id = m.restaurant_id
WHERE r.slug = 'ivorian-kitchen'
  AND NOT EXISTS (SELECT 1 FROM menu_sections ms WHERE ms.menu_id = m.id AND ms.name = 'Ivorian Specialties');

INSERT INTO menu_sections (menu_id, name, sort_order)
SELECT m.id, 'Signature Moroccan Dining', 1 FROM menus m JOIN restaurants r ON r.id = m.restaurant_id
WHERE r.slug = 'the-baobab-room'
  AND NOT EXISTS (SELECT 1 FROM menu_sections ms WHERE ms.menu_id = m.id AND ms.name = 'Signature Moroccan Dining');

-- ============================================================
-- 6. MENU ITEMS — every dish_id references an EXISTING dishes row
--    restored by migration 0078. source_type='seed' EXPLICIT throughout.
-- ============================================================

-- --- Mama Bisi's Kitchen: Soups ---
INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 2, 'Egusi Soup', 'Rich ground-melon-seed soup with assorted meat, served with your choice of swallow.', 350000, 1, 0, 1, 30, 1, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'mama-bisis-kitchen' AND ms.name = 'Soups'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Egusi Soup');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 5, 'Oha Soup', 'Traditional Igbo oha-leaf soup with cocoyam thickener, served with your choice of swallow.', 380000, 1, 0, 1, 30, 2, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'mama-bisis-kitchen' AND ms.name = 'Soups'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Oha Soup');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 4, 'Afang Soup', 'Nutrient-dense South-South Nigerian soup with afang and waterleaf, served with your choice of swallow.', 400000, 1, 0, 1, 35, 3, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'mama-bisis-kitchen' AND ms.name = 'Soups'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Afang Soup');

-- --- Mama Bisi's Kitchen: Rice & Sides ---
INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 14, 'Ofada Rice & Sauce', 'Local unpolished rice served with a spicy ayamase pepper sauce.', 320000, 1, 0, 1, 25, 1, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'mama-bisis-kitchen' AND ms.name = 'Rice & Sides'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Ofada Rice & Sauce');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 13, 'Efo Riro', 'Rich Yoruba vegetable soup made with spinach, served with your choice of swallow.', 300000, 1, 0, 1, 25, 2, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'mama-bisis-kitchen' AND ms.name = 'Rice & Sides'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Efo Riro');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 9, 'Moi Moi', 'Steamed bean pudding made from ground black-eyed peas, peppers, and onions.', 150000, 1, 1, 0, 15, 3, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'mama-bisis-kitchen' AND ms.name = 'Rice & Sides'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Moi Moi');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 22, 'Yam Porridge (Asaro)', 'One-pot yam dish cooked with palm oil, peppers, and leafy vegetables.', 280000, 1, 1, 0, 25, 4, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'mama-bisis-kitchen' AND ms.name = 'Rice & Sides'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Yam Porridge (Asaro)');

-- --- Suya Spot Grill House: Grills & Street Food ---
INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 8, 'Beef Suya', 'Spiced, skewered grilled beef coated in a peanut-based yaji spice blend.', 250000, 1, 0, 1, 15, 1, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'suya-spot-grill-house' AND ms.name = 'Grills & Street Food'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Beef Suya');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 25, 'Asun (Spicy Goat Meat)', 'Spicy, chopped grilled goat meat — a favorite Nigerian small chop.', 300000, 1, 0, 1, 20, 2, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'suya-spot-grill-house' AND ms.name = 'Grills & Street Food'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Asun (Spicy Goat Meat)');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 26, 'Peppered Snails', 'Giant African snails cooked in a rich, spicy pepper sauce.', 450000, 1, 0, 1, 20, 3, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'suya-spot-grill-house' AND ms.name = 'Grills & Street Food'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Peppered Snails');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 18, 'Nkwobi', 'Spiced cow foot in a rich palm oil and potash sauce.', 350000, 1, 0, 1, 20, 4, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'suya-spot-grill-house' AND ms.name = 'Grills & Street Food'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Nkwobi');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 19, 'Isi Ewu', 'Spiced goat head, a celebratory Igbo delicacy served with a peppery sauce.', 500000, 1, 0, 1, 25, 5, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'suya-spot-grill-house' AND ms.name = 'Grills & Street Food'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Isi Ewu');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 17, 'Pepper Soup (Goat)', 'Light, spicy broth made with goat meat and traditional spices.', 320000, 1, 0, 1, 20, 6, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'suya-spot-grill-house' AND ms.name = 'Grills & Street Food'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Pepper Soup (Goat)');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 24, 'Nigerian Fried Rice', 'Colorful, vegetable-packed fried rice, a staple at Nigerian parties.', 280000, 1, 0, 0, 20, 7, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'suya-spot-grill-house' AND ms.name = 'Grills & Street Food'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Nigerian Fried Rice');

-- --- Accra Chop House: Ghanaian Classics ---
INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 27, 'Waakye', 'Ghanaian rice and beans cooked with dried millet leaves for its distinct color.', 280000, 1, 1, 0, 25, 1, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'accra-chop-house' AND ms.name = 'Ghanaian Classics'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Waakye');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 28, 'Banku & Tilapia', 'Fermented corn and cassava dough served with grilled tilapia.', 380000, 1, 0, 0, 30, 2, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'accra-chop-house' AND ms.name = 'Ghanaian Classics'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Banku & Tilapia');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 29, 'Kenkey & Fish', 'Fermented, steamed corn dough wrapped in corn husks, served with fish.', 350000, 1, 0, 0, 25, 3, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'accra-chop-house' AND ms.name = 'Ghanaian Classics'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Kenkey & Fish');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 30, 'Fufu & Light Soup', 'Pounded cassava and plantain, served with a hearty tomato-based light soup.', 360000, 1, 0, 1, 30, 4, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'accra-chop-house' AND ms.name = 'Ghanaian Classics'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Fufu & Light Soup');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 31, 'Red Red', 'Black-eyed peas stewed in palm oil, served with fried ripe plantain.', 250000, 1, 1, 0, 20, 5, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'accra-chop-house' AND ms.name = 'Ghanaian Classics'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Red Red');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 32, 'Groundnut Soup', 'Rich, creamy peanut-based soup, served with rice balls or fufu.', 340000, 1, 0, 1, 30, 6, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'accra-chop-house' AND ms.name = 'Ghanaian Classics'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Groundnut Soup');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 34, 'Kelewele', 'Spiced, deep-fried ripe plantain cubes, a popular Ghanaian street snack.', 180000, 1, 1, 1, 15, 7, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'accra-chop-house' AND ms.name = 'Ghanaian Classics'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Kelewele');

-- --- Senegal Table: Senegalese Specialties (dish-variant approach, approved) ---
INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 35, 'Thieboudienne Rouge (Red)', 'Senegal''s national dish — fish and rice cooked in a rich red tomato sauce with vegetables.', 450000, 1, 0, 0, 40, 1, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'senegal-table' AND ms.name = 'Senegalese Specialties'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Thieboudienne Rouge (Red)');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 35, 'Thieboudienne Blanc (White)', 'The lighter, white-sauce preparation of Senegal''s national fish-and-rice dish.', 450000, 1, 0, 0, 40, 2, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'senegal-table' AND ms.name = 'Senegalese Specialties'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Thieboudienne Blanc (White)');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 36, 'Yassa Poulet (Chicken)', 'Chicken marinated in lemon and onions, then grilled and braised.', 400000, 1, 0, 0, 30, 3, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'senegal-table' AND ms.name = 'Senegalese Specialties'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Yassa Poulet (Chicken)');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 36, 'Yassa Poisson (Fish)', 'Fish marinated in lemon and onions, then grilled and braised.', 420000, 1, 0, 0, 30, 4, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'senegal-table' AND ms.name = 'Senegalese Specialties'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Yassa Poisson (Fish)');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 37, 'Mafé Boeuf (Beef)', 'Peanut-based stew with beef and vegetables, served over rice.', 420000, 1, 0, 0, 35, 5, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'senegal-table' AND ms.name = 'Senegalese Specialties'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Mafé Boeuf (Beef)');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 37, 'Mafé Poulet (Chicken)', 'Peanut-based stew with chicken and vegetables, served over rice.', 400000, 1, 0, 0, 35, 6, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'senegal-table' AND ms.name = 'Senegalese Specialties'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Mafé Poulet (Chicken)');

-- --- Ivorian Kitchen: Ivorian Specialties (dish-variant approach, approved) ---
INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 49, 'Attiéké Poisson (with Fish)', 'Fermented, granulated cassava couscous served with grilled fish.', 420000, 1, 0, 0, 30, 1, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'ivorian-kitchen' AND ms.name = 'Ivorian Specialties'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Attiéké Poisson (with Fish)');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 49, 'Attiéké Poulet (with Chicken)', 'Fermented, granulated cassava couscous served with grilled chicken.', 400000, 1, 0, 0, 30, 2, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'ivorian-kitchen' AND ms.name = 'Ivorian Specialties'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Attiéké Poulet (with Chicken)');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 49, 'Attiéké Garba (with Tuna, street-style)', 'Street-style attiéké served with fried tuna, onions, and a spicy tomato relish.', 350000, 1, 0, 0, 20, 3, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'ivorian-kitchen' AND ms.name = 'Ivorian Specialties'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Attiéké Garba (with Tuna, street-style)');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 50, 'Kedjenou de Poulet (Chicken)', 'Slow-cooked chicken stew, sealed and simmered with vegetables.', 420000, 1, 0, 0, 40, 4, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'ivorian-kitchen' AND ms.name = 'Ivorian Specialties'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Kedjenou de Poulet (Chicken)');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 50, 'Kedjenou de Pintade (Guinea Fowl)', 'Slow-cooked guinea fowl stew, sealed and simmered with vegetables.', 460000, 1, 0, 0, 40, 5, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'ivorian-kitchen' AND ms.name = 'Ivorian Specialties'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Kedjenou de Pintade (Guinea Fowl)');

-- --- The Baobab Room: Signature Moroccan Dining (dish-variant approach, approved) ---
INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 54, 'Chicken Tagine with Olives & Preserved Lemon', 'Slow-cooked chicken stew in the traditional clay pot, with green olives and preserved lemon.', 650000, 1, 0, 0, 45, 1, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'the-baobab-room' AND ms.name = 'Signature Moroccan Dining'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Chicken Tagine with Olives & Preserved Lemon');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 54, 'Lamb Tagine with Prunes & Almonds', 'Slow-cooked lamb stew in the traditional clay pot, with sweet prunes and toasted almonds.', 850000, 1, 0, 0, 50, 2, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'the-baobab-room' AND ms.name = 'Signature Moroccan Dining'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Lamb Tagine with Prunes & Almonds');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 55, 'Royal Couscous (Mixed Meats & Seven Vegetables)', 'Steamed semolina topped with a mixed-meat stew and seven traditional vegetables.', 750000, 1, 0, 0, 50, 3, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'the-baobab-room' AND ms.name = 'Signature Moroccan Dining'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Royal Couscous (Mixed Meats & Seven Vegetables)');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 55, 'Vegetable Couscous', 'Steamed semolina topped with a hearty vegetable stew.', 500000, 1, 1, 0, 40, 4, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'the-baobab-room' AND ms.name = 'Signature Moroccan Dining'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Vegetable Couscous');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 56, 'Chicken Pastilla', 'Savory-sweet pastry filled with spiced chicken, dusted with sugar and cinnamon.', 600000, 1, 0, 0, 40, 5, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'the-baobab-room' AND ms.name = 'Signature Moroccan Dining'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Chicken Pastilla');

INSERT INTO menu_items (menu_section_id, restaurant_id, dish_id, name, description, base_price_kobo, is_available, is_vegetarian, is_spicy, prep_minutes, sort_order, source_type)
SELECT ms.id, r.id, 56, 'Seafood Pastilla', 'Savory-sweet pastry filled with spiced seafood, dusted with sugar and cinnamon.', 700000, 1, 0, 0, 40, 6, 'seed'
FROM menu_sections ms JOIN menus mn ON mn.id = ms.menu_id JOIN restaurants r ON r.id = mn.restaurant_id
WHERE r.slug = 'the-baobab-room' AND ms.name = 'Signature Moroccan Dining'
  AND NOT EXISTS (SELECT 1 FROM menu_items mi WHERE mi.menu_section_id = ms.id AND mi.name = 'Seafood Pastilla');

-- ============================================================
-- 7. OPTION GROUPS + OPTIONS
-- ============================================================

-- Mama Bisi's — Egusi Soup: Swallow Choice (required, min1/max1)
INSERT INTO menu_item_option_groups (menu_item_id, name, is_required, min_select, max_select, sort_order)
SELECT mi.id, 'Swallow Choice', 1, 1, 1, 1 FROM menu_items mi
WHERE mi.name = 'Egusi Soup' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'mama-bisis-kitchen')
  AND NOT EXISTS (SELECT 1 FROM menu_item_option_groups g WHERE g.menu_item_id = mi.id AND g.name = 'Swallow Choice');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Pounded Yam', 0, 1, 1 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Egusi Soup' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'mama-bisis-kitchen') AND g.name = 'Swallow Choice'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Pounded Yam');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Semovita', 0, 1, 2 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Egusi Soup' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'mama-bisis-kitchen') AND g.name = 'Swallow Choice'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Semovita');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Eba', 0, 1, 3 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Egusi Soup' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'mama-bisis-kitchen') AND g.name = 'Swallow Choice'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Eba');

-- Mama Bisi's — Oha Soup: Swallow Choice
INSERT INTO menu_item_option_groups (menu_item_id, name, is_required, min_select, max_select, sort_order)
SELECT mi.id, 'Swallow Choice', 1, 1, 1, 1 FROM menu_items mi
WHERE mi.name = 'Oha Soup' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'mama-bisis-kitchen')
  AND NOT EXISTS (SELECT 1 FROM menu_item_option_groups g WHERE g.menu_item_id = mi.id AND g.name = 'Swallow Choice');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Pounded Yam', 0, 1, 1 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Oha Soup' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'mama-bisis-kitchen') AND g.name = 'Swallow Choice'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Pounded Yam');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Semovita', 0, 1, 2 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Oha Soup' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'mama-bisis-kitchen') AND g.name = 'Swallow Choice'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Semovita');

-- Mama Bisi's — Afang Soup: Swallow Choice
INSERT INTO menu_item_option_groups (menu_item_id, name, is_required, min_select, max_select, sort_order)
SELECT mi.id, 'Swallow Choice', 1, 1, 1, 1 FROM menu_items mi
WHERE mi.name = 'Afang Soup' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'mama-bisis-kitchen')
  AND NOT EXISTS (SELECT 1 FROM menu_item_option_groups g WHERE g.menu_item_id = mi.id AND g.name = 'Swallow Choice');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Pounded Yam', 0, 1, 1 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Afang Soup' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'mama-bisis-kitchen') AND g.name = 'Swallow Choice'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Pounded Yam');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Fufu', 0, 1, 2 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Afang Soup' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'mama-bisis-kitchen') AND g.name = 'Swallow Choice'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Fufu');

-- Mama Bisi's — Ofada Rice & Sauce: Protein Add-on (optional, min0/max2)
INSERT INTO menu_item_option_groups (menu_item_id, name, is_required, min_select, max_select, sort_order)
SELECT mi.id, 'Protein Add-on', 0, 0, 2, 1 FROM menu_items mi
WHERE mi.name = 'Ofada Rice & Sauce' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'mama-bisis-kitchen')
  AND NOT EXISTS (SELECT 1 FROM menu_item_option_groups g WHERE g.menu_item_id = mi.id AND g.name = 'Protein Add-on');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Extra Assorted Meat', 100000, 1, 1 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Ofada Rice & Sauce' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'mama-bisis-kitchen') AND g.name = 'Protein Add-on'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Extra Assorted Meat');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Boiled Egg', 30000, 1, 2 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Ofada Rice & Sauce' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'mama-bisis-kitchen') AND g.name = 'Protein Add-on'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Boiled Egg');

-- Mama Bisi's — Efo Riro: Swallow Choice
INSERT INTO menu_item_option_groups (menu_item_id, name, is_required, min_select, max_select, sort_order)
SELECT mi.id, 'Swallow Choice', 1, 1, 1, 1 FROM menu_items mi
WHERE mi.name = 'Efo Riro' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'mama-bisis-kitchen')
  AND NOT EXISTS (SELECT 1 FROM menu_item_option_groups g WHERE g.menu_item_id = mi.id AND g.name = 'Swallow Choice');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'White Rice', 0, 1, 1 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Efo Riro' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'mama-bisis-kitchen') AND g.name = 'Swallow Choice'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'White Rice');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Semovita', 0, 1, 2 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Efo Riro' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'mama-bisis-kitchen') AND g.name = 'Swallow Choice'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Semovita');

-- Mama Bisi's — Yam Porridge: Protein Add-on (optional, min0/max1)
INSERT INTO menu_item_option_groups (menu_item_id, name, is_required, min_select, max_select, sort_order)
SELECT mi.id, 'Protein Add-on', 0, 0, 1, 1 FROM menu_items mi
WHERE mi.name = 'Yam Porridge (Asaro)' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'mama-bisis-kitchen')
  AND NOT EXISTS (SELECT 1 FROM menu_item_option_groups g WHERE g.menu_item_id = mi.id AND g.name = 'Protein Add-on');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Smoked Fish', 80000, 1, 1 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Yam Porridge (Asaro)' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'mama-bisis-kitchen') AND g.name = 'Protein Add-on'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Smoked Fish');

-- Suya Spot — Beef Suya: Spice Level (required) + Extra Suya Spice (optional)
INSERT INTO menu_item_option_groups (menu_item_id, name, is_required, min_select, max_select, sort_order)
SELECT mi.id, 'Spice Level', 1, 1, 1, 1 FROM menu_items mi
WHERE mi.name = 'Beef Suya' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'suya-spot-grill-house')
  AND NOT EXISTS (SELECT 1 FROM menu_item_option_groups g WHERE g.menu_item_id = mi.id AND g.name = 'Spice Level');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Mild', 0, 1, 1 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Beef Suya' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'suya-spot-grill-house') AND g.name = 'Spice Level'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Mild');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Extra Pepper', 0, 1, 2 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Beef Suya' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'suya-spot-grill-house') AND g.name = 'Spice Level'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Extra Pepper');
INSERT INTO menu_item_option_groups (menu_item_id, name, is_required, min_select, max_select, sort_order)
SELECT mi.id, 'Extra Suya Spice', 0, 0, 1, 2 FROM menu_items mi
WHERE mi.name = 'Beef Suya' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'suya-spot-grill-house')
  AND NOT EXISTS (SELECT 1 FROM menu_item_option_groups g WHERE g.menu_item_id = mi.id AND g.name = 'Extra Suya Spice');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Extra Suya Spice', 20000, 1, 1 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Beef Suya' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'suya-spot-grill-house') AND g.name = 'Extra Suya Spice'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Extra Suya Spice');

-- Suya Spot — Asun: Portion (required)
INSERT INTO menu_item_option_groups (menu_item_id, name, is_required, min_select, max_select, sort_order)
SELECT mi.id, 'Portion', 1, 1, 1, 1 FROM menu_items mi
WHERE mi.name = 'Asun (Spicy Goat Meat)' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'suya-spot-grill-house')
  AND NOT EXISTS (SELECT 1 FROM menu_item_option_groups g WHERE g.menu_item_id = mi.id AND g.name = 'Portion');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Regular', 0, 1, 1 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Asun (Spicy Goat Meat)' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'suya-spot-grill-house') AND g.name = 'Portion'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Regular');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Large', 150000, 1, 2 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Asun (Spicy Goat Meat)' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'suya-spot-grill-house') AND g.name = 'Portion'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Large');

-- Suya Spot — Pepper Soup (Goat): Protein Choice (required)
INSERT INTO menu_item_option_groups (menu_item_id, name, is_required, min_select, max_select, sort_order)
SELECT mi.id, 'Protein Choice', 1, 1, 1, 1 FROM menu_items mi
WHERE mi.name = 'Pepper Soup (Goat)' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'suya-spot-grill-house')
  AND NOT EXISTS (SELECT 1 FROM menu_item_option_groups g WHERE g.menu_item_id = mi.id AND g.name = 'Protein Choice');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Goat Meat', 0, 1, 1 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Pepper Soup (Goat)' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'suya-spot-grill-house') AND g.name = 'Protein Choice'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Goat Meat');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Catfish', 30000, 1, 2 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Pepper Soup (Goat)' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'suya-spot-grill-house') AND g.name = 'Protein Choice'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Catfish');

-- Suya Spot — Nigerian Fried Rice: Protein Add-on (optional)
INSERT INTO menu_item_option_groups (menu_item_id, name, is_required, min_select, max_select, sort_order)
SELECT mi.id, 'Protein Add-on', 0, 0, 1, 1 FROM menu_items mi
WHERE mi.name = 'Nigerian Fried Rice' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'suya-spot-grill-house')
  AND NOT EXISTS (SELECT 1 FROM menu_item_option_groups g WHERE g.menu_item_id = mi.id AND g.name = 'Protein Add-on');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Grilled Chicken', 100000, 1, 1 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Nigerian Fried Rice' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'suya-spot-grill-house') AND g.name = 'Protein Add-on'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Grilled Chicken');

-- Accra Chop — Waakye: Protein Add-on (optional, min0/max2)
INSERT INTO menu_item_option_groups (menu_item_id, name, is_required, min_select, max_select, sort_order)
SELECT mi.id, 'Protein Add-on', 0, 0, 2, 1 FROM menu_items mi
WHERE mi.name = 'Waakye' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'accra-chop-house')
  AND NOT EXISTS (SELECT 1 FROM menu_item_option_groups g WHERE g.menu_item_id = mi.id AND g.name = 'Protein Add-on');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Grilled Chicken', 100000, 1, 1 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Waakye' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'accra-chop-house') AND g.name = 'Protein Add-on'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Grilled Chicken');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Boiled Egg', 30000, 1, 2 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Waakye' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'accra-chop-house') AND g.name = 'Protein Add-on'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Boiled Egg');

-- Accra Chop — Red Red: Protein Add-on (optional, min0/max1)
INSERT INTO menu_item_option_groups (menu_item_id, name, is_required, min_select, max_select, sort_order)
SELECT mi.id, 'Protein Add-on', 0, 0, 1, 1 FROM menu_items mi
WHERE mi.name = 'Red Red' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'accra-chop-house')
  AND NOT EXISTS (SELECT 1 FROM menu_item_option_groups g WHERE g.menu_item_id = mi.id AND g.name = 'Protein Add-on');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Extra Fried Plantain', 50000, 1, 1 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Red Red' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'accra-chop-house') AND g.name = 'Protein Add-on'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Extra Fried Plantain');

-- Accra Chop — Groundnut Soup: Swallow Choice (required)
INSERT INTO menu_item_option_groups (menu_item_id, name, is_required, min_select, max_select, sort_order)
SELECT mi.id, 'Swallow Choice', 1, 1, 1, 1 FROM menu_items mi
WHERE mi.name = 'Groundnut Soup' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'accra-chop-house')
  AND NOT EXISTS (SELECT 1 FROM menu_item_option_groups g WHERE g.menu_item_id = mi.id AND g.name = 'Swallow Choice');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Banku', 0, 1, 1 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Groundnut Soup' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'accra-chop-house') AND g.name = 'Swallow Choice'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Banku');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Rice Balls', 0, 1, 2 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Groundnut Soup' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'accra-chop-house') AND g.name = 'Swallow Choice'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Rice Balls');

-- Baobab Room — Seafood Pastilla: Spice Level (optional, min0/max1)
INSERT INTO menu_item_option_groups (menu_item_id, name, is_required, min_select, max_select, sort_order)
SELECT mi.id, 'Spice Level', 0, 0, 1, 1 FROM menu_items mi
WHERE mi.name = 'Seafood Pastilla' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'the-baobab-room')
  AND NOT EXISTS (SELECT 1 FROM menu_item_option_groups g WHERE g.menu_item_id = mi.id AND g.name = 'Spice Level');
INSERT INTO menu_item_options (option_group_id, name, price_delta_kobo, is_available, sort_order)
SELECT g.id, 'Extra Harissa', 0, 1, 1 FROM menu_item_option_groups g JOIN menu_items mi ON mi.id = g.menu_item_id
WHERE mi.name = 'Seafood Pastilla' AND mi.restaurant_id = (SELECT id FROM restaurants WHERE slug = 'the-baobab-room') AND g.name = 'Spice Level'
  AND NOT EXISTS (SELECT 1 FROM menu_item_options o WHERE o.option_group_id = g.id AND o.name = 'Extra Harissa');

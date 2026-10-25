-- Pan-African rollout controls.
-- Reuses cc_countries, cc_capabilities and cc_capability_country_overrides.
-- This migration adds no operational records and defaults new markets/verticals
-- to non-operational states. Activation remains an authorized Control Center action.

INSERT OR IGNORE INTO cc_capabilities
  (key, name, description, category, status, control_type, enabled, dependencies_json, route, sort_order)
VALUES
  ('ecosystem.naijashop', 'NaijaShop', 'Core marketplace vertical', 'ecosystem', 'ACTIVE', 'country_toggle', 1, '["commerce.marketplace"]', '/shop', 10),
  ('ecosystem.naijafresh', 'NaijaFresh', 'Fresh grocery and produce vertical', 'ecosystem', 'CONFIGURATION_REQUIRED', 'country_toggle', 1, '["commerce.marketplace","logistics.naijasend_booking"]', '/fresh', 20),
  ('ecosystem.naijaeats', 'NaijaEats', 'Restaurant ordering vertical', 'ecosystem', 'ACTIVE', 'country_toggle', 1, '["commerce.marketplace","logistics.naijasend_booking"]', '/eats', 30),
  ('ecosystem.naijagigs', 'NaijaGigs', 'Freelance and service marketplace', 'ecosystem', 'ACTIVE', 'country_toggle', 1, '["merchant.onboarding"]', '/gigs', 40),
  ('ecosystem.naijastay', 'NaijaStay', 'Short-stay booking vertical', 'ecosystem', 'ACTIVE', 'country_toggle', 1, '["money.wallet"]', '/stay', 50),
  ('ecosystem.naijadrive', 'NaijaDrive', 'Private ride and mobility vertical', 'ecosystem', 'CONFIGURATION_REQUIRED', 'country_toggle', 0, '["platform.integration_maps","logistics.gps_navigation"]', '/drive', 60),
  ('ecosystem.naijasend', 'NaijaSend', 'Delivery and shipment vertical', 'ecosystem', 'CONFIGURATION_REQUIRED', 'country_toggle', 1, '["logistics.naijasend_booking"]', '/send', 70),
  ('ecosystem.naijapay', 'NaijaPay', 'Shared payment and finance entry point', 'ecosystem', 'CONFIGURATION_REQUIRED', 'country_toggle', 1, '["money.wallet"]', '/naijapay', 80),
  ('ecosystem.naijauto', 'NaijaAuto', 'Automotive marketplace and services', 'ecosystem', 'CONFIGURATION_REQUIRED', 'country_toggle', 0, '["commerce.marketplace"]', '/auto', 90),
  ('ecosystem.naijahomes', 'NaijaHomes', 'Property marketplace', 'ecosystem', 'CONFIGURATION_REQUIRED', 'country_toggle', 0, '["commerce.marketplace"]', '/homes', 100),
  ('ecosystem.naijatravel', 'NaijaTravel', 'Travel discovery and booking', 'ecosystem', 'CONFIGURATION_REQUIRED', 'country_toggle', 0, '["commerce.marketplace"]', '/travel', 110),
  ('ecosystem.naijaevents', 'NaijaEvents', 'Events and ticketing', 'ecosystem', 'CONFIGURATION_REQUIRED', 'country_toggle', 0, '["commerce.marketplace"]', '/events', 120),
  ('ecosystem.naijalearn', 'NaijaLearn', 'Courses and learning', 'ecosystem', 'CONFIGURATION_REQUIRED', 'country_toggle', 0, '["merchant.onboarding"]', '/learn', 130),
  ('ecosystem.naijajobs', 'NaijaJobs', 'Recruitment and employment', 'ecosystem', 'CONFIGURATION_REQUIRED', 'country_toggle', 0, '["account.registration"]', '/jobs', 140),
  ('ecosystem.naijahealth', 'NaijaHealth', 'Healthcare discovery and appointments', 'ecosystem', 'CONFIGURATION_REQUIRED', 'country_toggle', 0, '["trust.kyc_verification"]', '/health', 150),
  ('ecosystem.naijafarm', 'NaijaFarm', 'Agricultural marketplace', 'ecosystem', 'CONFIGURATION_REQUIRED', 'country_toggle', 0, '["commerce.marketplace","logistics.naijasend_booking"]', '/farm', 160),
  ('ecosystem.naijastream', 'NaijaStream', 'African media and creator content', 'ecosystem', 'CONFIGURATION_REQUIRED', 'country_toggle', 0, '["platform.integration_identity_kyc"]', '/stream', 170),
  ('ecosystem.naijahome', 'NaijaHome', 'Home services vertical', 'ecosystem', 'CONFIGURATION_REQUIRED', 'country_toggle', 0, '["merchant.onboarding"]', '/home', 180),
  ('ecosystem.naijabeauty', 'NaijaBeauty', 'Beauty and wellness services', 'ecosystem', 'CONFIGURATION_REQUIRED', 'country_toggle', 0, '["merchant.onboarding"]', '/beauty', 190),
  ('ecosystem.aura', 'Aura AI', 'Cross-ecosystem assistant', 'ecosystem', 'CONFIGURATION_REQUIRED', 'country_toggle', 0, '["intelligence.aura_ai"]', '/aura', 200);

UPDATE cc_capabilities
SET status = CASE
  WHEN key IN ('ecosystem.naijashop','ecosystem.naijaeats','ecosystem.naijagigs','ecosystem.naijastay') THEN 'ACTIVE'
  ELSE 'CONFIGURATION_REQUIRED'
END,
control_type = 'country_toggle',
enabled = CASE
  WHEN key IN ('ecosystem.naijashop','ecosystem.naijafresh','ecosystem.naijaeats','ecosystem.naijagigs','ecosystem.naijastay','ecosystem.naijasend','ecosystem.naijapay') THEN 1
  ELSE enabled
END,
updated_at = datetime('now')
WHERE key LIKE 'ecosystem.%';

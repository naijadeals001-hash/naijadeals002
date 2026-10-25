-- NaijaPay Batch 3: deterministic sandbox utility catalog. No live fulfillment is enabled.
INSERT OR IGNORE INTO naijapay_providers(provider_key, display_name, category, adapter_type, operational_status, environment, configuration_status, authorization_status, health_status, is_active)
VALUES
 ('data-sandbox','Data Bundle Sandbox','data','sandbox','sandbox','sandbox','unconfigured','not_authorized','unknown',0),
 ('cable-sandbox','Cable TV Sandbox','cable_tv','sandbox','sandbox','sandbox','unconfigured','not_authorized','unknown',0),
 ('internet-sandbox','Internet Subscription Sandbox','internet','sandbox','sandbox','sandbox','unconfigured','not_authorized','unknown',0),
 ('water-sandbox','Water Utility Sandbox','water','sandbox','sandbox','sandbox','unconfigured','not_authorized','unknown',0);
-- Sandbox adapters are explicitly configured and healthy for deterministic QA,
-- but remain sandbox-only and cannot be promoted to live without separate live authorization.
UPDATE naijapay_providers SET configuration_status='verified', authorization_status='authorized', health_status='healthy', is_active=1 WHERE provider_key LIKE '%-sandbox';
INSERT OR IGNORE INTO naijapay_provider_countries(provider_id, iso_code, rollout_status, supported_operations_json)
SELECT id, 'NG', 'sandbox', '["catalog","validate","quote","purchase","status"]' FROM naijapay_providers WHERE provider_key LIKE '%-sandbox';
INSERT OR IGNORE INTO naijapay_products(provider_id,product_code,display_name,category,country_iso,currency,operation,operational_status,metadata_json) SELECT id,'airtime-ng-500','Airtime ₦500','airtime','NG','NGN','purchase','sandbox','{"denomination_minor":50000}' FROM naijapay_providers WHERE provider_key='airtime-sandbox';
INSERT OR IGNORE INTO naijapay_products(provider_id,product_code,display_name,category,country_iso,currency,operation,operational_status,metadata_json) SELECT id,'data-1gb-30d','Data 1GB / 30 days','data','NG','NGN','purchase','sandbox','{"volume":"1GB","validity_days":30,"amount_minor":50000}' FROM naijapay_providers WHERE provider_key='data-sandbox';
INSERT OR IGNORE INTO naijapay_products(provider_id,product_code,display_name,category,country_iso,currency,operation,operational_status,metadata_json) SELECT id,'electricity-prepaid','Electricity prepaid token','electricity','NG','NGN','purchase','sandbox','{"meter_type":"prepaid"}' FROM naijapay_providers WHERE provider_key='utility-sandbox';
INSERT OR IGNORE INTO naijapay_products(provider_id,product_code,display_name,category,country_iso,currency,operation,operational_status,metadata_json) SELECT id,'cable-basic-30d','Cable Basic / 30 days','cable_tv','NG','NGN','purchase','sandbox','{"validity_days":30,"amount_minor":250000}' FROM naijapay_providers WHERE provider_key='cable-sandbox';
INSERT OR IGNORE INTO naijapay_products(provider_id,product_code,display_name,category,country_iso,currency,operation,operational_status,metadata_json) SELECT id,'internet-home-30d','Home Internet / 30 days','internet','NG','NGN','purchase','sandbox','{"validity_days":30,"amount_minor":500000}' FROM naijapay_providers WHERE provider_key='internet-sandbox';
INSERT OR IGNORE INTO naijapay_products(provider_id,product_code,display_name,category,country_iso,currency,operation,operational_status,metadata_json) SELECT id,'water-standard','Water utility bill','water','NG','NGN','purchase','sandbox','{"amount_required":true}' FROM naijapay_providers WHERE provider_key='water-sandbox';

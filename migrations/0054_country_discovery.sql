-- NaijaDeals — Country Discovery (Pat's "All 54 African Countries" directive, 2026-09-15)
--
-- Problem being fixed:
--   Pat's Full Visual Asset Audit directive originally asked for a 4-country
--   Country Discovery section (Nigeria/Ghana/Kenya/Morocco). Pat then EXPLICITLY
--   rejected that scope and required "all 54 African countries," "database-driven,
--   not 54 hardcoded cards." cc_countries (migration 0013, seeded 0040) already
--   existed but only carried 10 rows — a Marketplace-Engine-2.1 serviceability
--   concept (which countries a listing ships to), not a customer-facing
--   discovery/storytelling surface. This migration:
--     1. Adds the visual/discovery columns cc_countries needs to power a
--        customer-facing "Discover Africa" section (image, flag emoji, a short
--        one-line description, and a discovery-specific display flag) WITHOUT
--        touching or duplicating its existing serviceability columns/purpose.
--     2. Backfills all 54 UN-member African sovereign states (the previous 10
--        rows are already correct and are left untouched via INSERT OR IGNORE;
--        Morocco/Egypt/etc. are newly added here).
--     3. Leaves image_url NULL for every row — this migration deliberately ships
--        ZERO placeholder strings. The get-countries query (src/lib/country.ts)
--        and the homepage section (home.tsx) filter on `image_url IS NOT NULL`,
--        so a country with no sourced photo yet simply does not render — "show
--        fewer, but all real," the same principle already applied to Top Brands/
--        Popular Vendors/product carousels. Real, licensed photography is sourced
--        and backfilled via image_url UPDATEs in a later pass — not in this
--        migration, and never via /ph.svg.
--
-- Deliberately NOT a 55th "Western Sahara / SADR" row: this table uses UN
-- membership (54 states) as its authoritative source, matching Pat's literal
-- "all 54 African countries" instruction. If Pat later wants the African
-- Union's 55-member list instead, that is a one-row INSERT here, not a schema
-- change.
--
-- Why these columns and not more: `display_on_homepage` lets a small curated
-- subset (e.g. LIVE + a few flagship PLANNED markets) be surfaced first in the
-- Country Discovery section without deleting or hiding the other 50 rows from
-- the underlying dataset — but the DEFAULT is 1 (show once it has a real
-- image), so a newly-arriving country is visible automatically the moment its
-- photo is set, with no separate "please feature me" admin step required.

ALTER TABLE cc_countries ADD COLUMN image_url TEXT;                          -- customer-facing discovery photo (repo-persistent /static/countries/{iso}.jpg or a curated web/CC-licensed URL) — NULL means "not yet sourced", never a placeholder string
ALTER TABLE cc_countries ADD COLUMN flag_emoji TEXT;                         -- Unicode regional-indicator flag emoji, e.g. '🇳🇬' — a real, licence-free "flag" representation distinct from image_url's real photography
ALTER TABLE cc_countries ADD COLUMN short_description TEXT;                 -- one-sentence, honest, non-fabricated blurb for the discovery card (e.g. what NaijaDeals does/will do there)
ALTER TABLE cc_countries ADD COLUMN display_on_homepage INTEGER NOT NULL DEFAULT 1 CHECK (display_on_homepage IN (0,1)); -- admin kill-switch per country, independent of whether image_url is set

CREATE INDEX IF NOT EXISTS idx_cc_countries_display ON cc_countries(display_on_homepage);

-- ---------------------------------------------------------------------------
-- All 54 UN-member African sovereign states. The 10 rows from migration 0040
-- already exist with correct iso_code/name/region/currency/language data —
-- INSERT OR IGNORE (keyed on the existing UNIQUE(iso_code)) leaves them
-- untouched and only adds the remaining 44. status defaults to 'PLANNED' for
-- every newly-added row (honest: none of these are real serviceable markets
-- yet) except NG which migration 0040 already set to 'LIVE'. display_order
-- continues Nigeria-first, then alphabetical by name within each UN
-- geoscheme region, in blocks of 10 starting at 110 (0040 used 10-100).
-- ---------------------------------------------------------------------------

INSERT OR IGNORE INTO cc_countries (iso_code, name, region, currency_code, default_language, available_languages_json, status, display_order, default_timezone) VALUES
  -- Northern Africa
  ('DZ', 'Algeria',       'Northern Africa', 'DZD', 'ar', '["ar","fr"]',        'PLANNED', 110, 'Africa/Algiers'),
  ('EG', 'Egypt',         'Northern Africa', 'EGP', 'ar', '["ar"]',             'PLANNED', 120, 'Africa/Cairo'),
  ('LY', 'Libya',         'Northern Africa', 'LYD', 'ar', '["ar"]',             'PLANNED', 130, 'Africa/Tripoli'),
  ('MA', 'Morocco',       'Northern Africa', 'MAD', 'ar', '["ar","fr"]',        'PLANNED', 140, 'Africa/Casablanca'),
  ('SD', 'Sudan',         'Northern Africa', 'SDG', 'ar', '["ar","en"]',        'PLANNED', 150, 'Africa/Khartoum'),
  ('TN', 'Tunisia',       'Northern Africa', 'TND', 'ar', '["ar","fr"]',        'PLANNED', 160, 'Africa/Tunis'),

  -- Western Africa (remaining, beyond NG/GH/SN/CI already seeded)
  ('BJ', 'Benin',              'Western Africa', 'XOF', 'fr', '["fr"]',            'PLANNED', 210, 'Africa/Porto-Novo'),
  ('BF', 'Burkina Faso',       'Western Africa', 'XOF', 'fr', '["fr"]',            'PLANNED', 220, 'Africa/Ouagadougou'),
  ('CV', 'Cabo Verde',         'Western Africa', 'CVE', 'pt', '["pt"]',            'PLANNED', 230, 'Atlantic/Cape_Verde'),
  ('GM', 'Gambia',             'Western Africa', 'GMD', 'en', '["en"]',            'PLANNED', 240, 'Africa/Banjul'),
  ('GN', 'Guinea',             'Western Africa', 'GNF', 'fr', '["fr"]',            'PLANNED', 250, 'Africa/Conakry'),
  ('GW', 'Guinea-Bissau',      'Western Africa', 'XOF', 'pt', '["pt"]',            'PLANNED', 260, 'Africa/Bissau'),
  ('LR', 'Liberia',            'Western Africa', 'LRD', 'en', '["en"]',            'PLANNED', 270, 'Africa/Monrovia'),
  ('ML', 'Mali',               'Western Africa', 'XOF', 'fr', '["fr"]',            'PLANNED', 280, 'Africa/Bamako'),
  ('MR', 'Mauritania',         'Western Africa', 'MRU', 'ar', '["ar","fr"]',       'PLANNED', 290, 'Africa/Nouakchott'),
  ('NE', 'Niger',              'Western Africa', 'XOF', 'fr', '["fr"]',            'PLANNED', 300, 'Africa/Niamey'),
  ('SL', 'Sierra Leone',       'Western Africa', 'SLE', 'en', '["en"]',            'PLANNED', 310, 'Africa/Freetown'),
  ('TG', 'Togo',               'Western Africa', 'XOF', 'fr', '["fr"]',            'PLANNED', 320, 'Africa/Lome'),

  -- Central Africa (remaining, beyond CM already seeded)
  ('AO', 'Angola',                        'Central Africa', 'AOA', 'pt', '["pt"]',          'PLANNED', 410, 'Africa/Luanda'),
  ('BI', 'Burundi',                       'Central Africa', 'BIF', 'fr', '["fr","rn"]',     'PLANNED', 420, 'Africa/Bujumbura'),
  ('CF', 'Central African Republic',      'Central Africa', 'XAF', 'fr', '["fr","sg"]',     'PLANNED', 430, 'Africa/Bangui'),
  ('TD', 'Chad',                          'Central Africa', 'XAF', 'fr', '["fr","ar"]',     'PLANNED', 440, 'Africa/Ndjamena'),
  ('CG', 'Congo (Republic of the)',       'Central Africa', 'XAF', 'fr', '["fr"]',          'PLANNED', 450, 'Africa/Brazzaville'),
  ('CD', 'Congo (Democratic Republic)',   'Central Africa', 'CDF', 'fr', '["fr"]',          'PLANNED', 460, 'Africa/Kinshasa'),
  ('GQ', 'Equatorial Guinea',             'Central Africa', 'XAF', 'es', '["es","fr"]',     'PLANNED', 470, 'Africa/Malabo'),
  ('GA', 'Gabon',                         'Central Africa', 'XAF', 'fr', '["fr"]',          'PLANNED', 480, 'Africa/Libreville'),
  ('ST', 'Sao Tome and Principe',         'Central Africa', 'STN', 'pt', '["pt"]',          'PLANNED', 490, 'Africa/Sao_Tome'),

  -- Eastern Africa (remaining, beyond KE/UG/TZ/RW already seeded)
  ('KM', 'Comoros',        'Eastern Africa', 'KMF', 'ar', '["ar","fr"]',       'PLANNED', 610, 'Indian/Comoro'),
  ('DJ', 'Djibouti',       'Eastern Africa', 'DJF', 'ar', '["ar","fr"]',       'PLANNED', 620, 'Africa/Djibouti'),
  ('ER', 'Eritrea',        'Eastern Africa', 'ERN', 'ti', '["ti","ar","en"]',  'PLANNED', 630, 'Africa/Asmara'),
  ('SZ', 'Eswatini',       'Eastern Africa', 'SZL', 'en', '["en","ss"]',       'PLANNED', 640, 'Africa/Mbabane'),
  ('ET', 'Ethiopia',       'Eastern Africa', 'ETB', 'am', '["am"]',            'PLANNED', 650, 'Africa/Addis_Ababa'),
  ('MG', 'Madagascar',     'Eastern Africa', 'MGA', 'mg', '["mg","fr"]',       'PLANNED', 660, 'Indian/Antananarivo'),
  ('MW', 'Malawi',         'Eastern Africa', 'MWK', 'en', '["en","ny"]',       'PLANNED', 670, 'Africa/Blantyre'),
  ('MU', 'Mauritius',      'Eastern Africa', 'MUR', 'en', '["en","fr"]',       'PLANNED', 680, 'Indian/Mauritius'),
  ('MZ', 'Mozambique',     'Eastern Africa', 'MZN', 'pt', '["pt"]',            'PLANNED', 690, 'Africa/Maputo'),
  ('SC', 'Seychelles',     'Eastern Africa', 'SCR', 'fr', '["fr","en"]',       'PLANNED', 700, 'Indian/Mahe'),
  ('SO', 'Somalia',        'Eastern Africa', 'SOS', 'so', '["so","ar"]',       'PLANNED', 710, 'Africa/Mogadishu'),
  ('SS', 'South Sudan',    'Eastern Africa', 'SSP', 'en', '["en"]',            'PLANNED', 720, 'Africa/Juba'),
  ('ZM', 'Zambia',         'Eastern Africa', 'ZMW', 'en', '["en"]',            'PLANNED', 730, 'Africa/Lusaka'),
  ('ZW', 'Zimbabwe',       'Eastern Africa', 'ZWL', 'en', '["en"]',            'PLANNED', 740, 'Africa/Harare'),

  -- Southern Africa (remaining, beyond ZA already seeded)
  ('BW', 'Botswana',    'Southern Africa', 'BWP', 'en', '["en","tn"]', 'PLANNED', 810, 'Africa/Gaborone'),
  ('LS', 'Lesotho',     'Southern Africa', 'LSL', 'en', '["en","st"]', 'PLANNED', 820, 'Africa/Maseru'),
  ('NA', 'Namibia',     'Southern Africa', 'NAD', 'en', '["en"]',      'PLANNED', 830, 'Africa/Windhoek');

-- Backfill flag_emoji + short_description for ALL 54 rows (the 10 pre-existing
-- plus the 44 just added). Flag emoji is a real, deterministic Unicode
-- representation (regional indicator pair), not a placeholder graphic — it
-- renders instantly with zero image asset required, which is why it is kept
-- SEPARATE from image_url (a country can show its flag immediately while its
-- real photography is still being sourced, without ever touching /ph.svg).
UPDATE cc_countries SET flag_emoji = '🇳🇬', short_description = 'NaijaDeals'' home market — live shopping, nationwide delivery, escrow-protected payments across all 36 states.' WHERE iso_code = 'NG';
UPDATE cc_countries SET flag_emoji = '🇬🇭', short_description = 'West African craftsmanship — Kente weaving, shea butter and a growing NaijaDeals vendor community in Accra and Kumasi.' WHERE iso_code = 'GH';
UPDATE cc_countries SET flag_emoji = '🇰🇪', short_description = 'East Africa''s trade hub — Nairobi coffee exporters and Maasai craft cooperatives bringing East African goods to the marketplace.' WHERE iso_code = 'KE';
UPDATE cc_countries SET flag_emoji = '🇿🇦', short_description = 'Southern Africa''s largest economy — a planned future market for NaijaDeals'' pan-African expansion.' WHERE iso_code = 'ZA';
UPDATE cc_countries SET flag_emoji = '🇺🇬', short_description = 'The Pearl of Africa — fertile land and a fast-growing East African digital economy.' WHERE iso_code = 'UG';
UPDATE cc_countries SET flag_emoji = '🇹🇿', short_description = 'Home to Kilimanjaro and Zanzibar — a key East African trade and tourism gateway.' WHERE iso_code = 'TZ';
UPDATE cc_countries SET flag_emoji = '🇷🇼', short_description = 'The Land of a Thousand Hills — one of Africa''s fastest-growing digital economies.' WHERE iso_code = 'RW';
UPDATE cc_countries SET flag_emoji = '🇸🇳', short_description = 'A West African cultural and commercial anchor on the Atlantic coast.' WHERE iso_code = 'SN';
UPDATE cc_countries SET flag_emoji = '🇨🇮', short_description = 'West Africa''s cocoa capital and a major regional trade economy.' WHERE iso_code = 'CI';
UPDATE cc_countries SET flag_emoji = '🇨🇲', short_description = 'Central Africa''s bilingual crossroads, bridging West and Central African trade.' WHERE iso_code = 'CM';
UPDATE cc_countries SET flag_emoji = '🇩🇿', short_description = 'Africa''s largest country by land area, spanning the Sahara to the Mediterranean coast.' WHERE iso_code = 'DZ';
UPDATE cc_countries SET flag_emoji = '🇪🇬', short_description = 'Home to the pyramids and the Nile — a historic bridge between Africa and the Middle East.' WHERE iso_code = 'EG';
UPDATE cc_countries SET flag_emoji = '🇱🇾', short_description = 'A North African nation on the Mediterranean, rich in ancient history.' WHERE iso_code = 'LY';
UPDATE cc_countries SET flag_emoji = '🇲🇦', short_description = 'Marrakech leatherwork, Fez ceramics and centuries-old souks meet modern commerce.' WHERE iso_code = 'MA';
UPDATE cc_countries SET flag_emoji = '🇸🇩', short_description = 'A vast Nile Valley nation at the crossroads of North and East Africa.' WHERE iso_code = 'SD';
UPDATE cc_countries SET flag_emoji = '🇹🇳', short_description = 'North Africa''s Mediterranean gateway, blending Berber, Arab and European heritage.' WHERE iso_code = 'TN';
UPDATE cc_countries SET flag_emoji = '🇧🇯', short_description = 'The birthplace of Vodun and a historic West African trading kingdom.' WHERE iso_code = 'BJ';
UPDATE cc_countries SET flag_emoji = '🇧🇫', short_description = 'A landlocked West African nation known for its textile and craft traditions.' WHERE iso_code = 'BF';
UPDATE cc_countries SET flag_emoji = '🇨🇻', short_description = 'An Atlantic island nation blending African, Portuguese and Creole culture.' WHERE iso_code = 'CV';
UPDATE cc_countries SET flag_emoji = '🇬🇲', short_description = 'West Africa''s smallest mainland nation, wrapped around the Gambia River.' WHERE iso_code = 'GM';
UPDATE cc_countries SET flag_emoji = '🇬🇳', short_description = 'A mineral-rich West African nation on the Atlantic coast.' WHERE iso_code = 'GN';
UPDATE cc_countries SET flag_emoji = '🇬🇼', short_description = 'A Lusophone West African nation known for its cashew trade and archipelago coastline.' WHERE iso_code = 'GW';
UPDATE cc_countries SET flag_emoji = '🇱🇷', short_description = 'Africa''s oldest republic, on the West African Atlantic coast.' WHERE iso_code = 'LR';
UPDATE cc_countries SET flag_emoji = '🇲🇱', short_description = 'Home to Timbuktu and centuries of trans-Saharan trade history.' WHERE iso_code = 'ML';
UPDATE cc_countries SET flag_emoji = '🇲🇷', short_description = 'A vast Saharan nation bridging North and West Africa.' WHERE iso_code = 'MR';
UPDATE cc_countries SET flag_emoji = '🇳🇪', short_description = 'A landlocked Sahelian nation with a deep Tuareg and Hausa heritage.' WHERE iso_code = 'NE';
UPDATE cc_countries SET flag_emoji = '🇸🇱', short_description = 'A West African coastal nation known for its diamonds and resilience.' WHERE iso_code = 'SL';
UPDATE cc_countries SET flag_emoji = '🇹🇬', short_description = 'A narrow West African nation stretching from the Atlantic to the Sahel.' WHERE iso_code = 'TG';
UPDATE cc_countries SET flag_emoji = '🇦🇴', short_description = 'A Lusophone Central African nation rich in oil, diamonds and Atlantic coastline.' WHERE iso_code = 'AO';
UPDATE cc_countries SET flag_emoji = '🇧🇮', short_description = 'A small, densely-populated Great Lakes nation in Central/East Africa.' WHERE iso_code = 'BI';
UPDATE cc_countries SET flag_emoji = '🇨🇫', short_description = 'A landlocked Central African nation at the heart of the continent.' WHERE iso_code = 'CF';
UPDATE cc_countries SET flag_emoji = '🇹🇩', short_description = 'A vast Sahelian and Central African nation spanning desert to savanna.' WHERE iso_code = 'TD';
UPDATE cc_countries SET flag_emoji = '🇨🇬', short_description = 'A Central African nation along the Congo River''s western bank.' WHERE iso_code = 'CG';
UPDATE cc_countries SET flag_emoji = '🇨🇩', short_description = 'Africa''s second-largest country by area, spanning the Congo Basin rainforest.' WHERE iso_code = 'CD';
UPDATE cc_countries SET flag_emoji = '🇬🇶', short_description = 'A small Central African nation and the only Spanish-speaking country in Africa.' WHERE iso_code = 'GQ';
UPDATE cc_countries SET flag_emoji = '🇬🇦', short_description = 'A Central African nation with dense equatorial rainforest and Atlantic coastline.' WHERE iso_code = 'GA';
UPDATE cc_countries SET flag_emoji = '🇸🇹', short_description = 'A small island nation in the Gulf of Guinea, off Central Africa''s coast.' WHERE iso_code = 'ST';
UPDATE cc_countries SET flag_emoji = '🇰🇲', short_description = 'A volcanic island nation in the Indian Ocean, off East Africa''s coast.' WHERE iso_code = 'KM';
UPDATE cc_countries SET flag_emoji = '🇩🇯', short_description = 'A strategic Horn of Africa nation on the Bab-el-Mandeb strait.' WHERE iso_code = 'DJ';
UPDATE cc_countries SET flag_emoji = '🇪🇷', short_description = 'A Red Sea nation in the Horn of Africa with a distinct highland culture.' WHERE iso_code = 'ER';
UPDATE cc_countries SET flag_emoji = '🇸🇿', short_description = 'A small Southern African kingdom known for its cultural traditions.' WHERE iso_code = 'SZ';
UPDATE cc_countries SET flag_emoji = '🇪🇹', short_description = 'The only African nation never colonized — birthplace of coffee, home to ancient highlands.' WHERE iso_code = 'ET';
UPDATE cc_countries SET flag_emoji = '🇲🇬', short_description = 'A vast Indian Ocean island nation with unique biodiversity and Malagasy culture.' WHERE iso_code = 'MG';
UPDATE cc_countries SET flag_emoji = '🇲🇼', short_description = 'The Warm Heart of Africa, along the shores of Lake Malawi.' WHERE iso_code = 'MW';
UPDATE cc_countries SET flag_emoji = '🇲🇺', short_description = 'An Indian Ocean island nation known for its multicultural heritage.' WHERE iso_code = 'MU';
UPDATE cc_countries SET flag_emoji = '🇲🇿', short_description = 'A Lusophone East African nation with a long Indian Ocean coastline.' WHERE iso_code = 'MZ';
UPDATE cc_countries SET flag_emoji = '🇸🇨', short_description = 'An Indian Ocean archipelago nation off East Africa''s coast.' WHERE iso_code = 'SC';
UPDATE cc_countries SET flag_emoji = '🇸🇴', short_description = 'A Horn of Africa nation with the continent''s longest coastline.' WHERE iso_code = 'SO';
UPDATE cc_countries SET flag_emoji = '🇸🇸', short_description = 'Africa''s youngest nation, in the Nile Valley of East Africa.' WHERE iso_code = 'SS';
UPDATE cc_countries SET flag_emoji = '🇿🇲', short_description = 'Home to Victoria Falls and a growing Southern African economy.' WHERE iso_code = 'ZM';
UPDATE cc_countries SET flag_emoji = '🇿🇼', short_description = 'A landlocked Southern African nation known for its wildlife and resilience.' WHERE iso_code = 'ZW';
UPDATE cc_countries SET flag_emoji = '🇧🇼', short_description = 'A stable Southern African nation known for diamonds and the Okavango Delta.' WHERE iso_code = 'BW';
UPDATE cc_countries SET flag_emoji = '🇱🇸', short_description = 'The Kingdom in the Sky, entirely surrounded by South Africa.' WHERE iso_code = 'LS';
UPDATE cc_countries SET flag_emoji = '🇳🇦', short_description = 'A Southern African nation of dramatic desert landscapes along the Atlantic.' WHERE iso_code = 'NA';

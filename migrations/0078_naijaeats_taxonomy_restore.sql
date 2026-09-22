-- Migration 0078: NaijaEats Taxonomy Restore (cuisines + dishes)
--
-- CONTEXT: migrations 0032/0033 (NaijaEats foundation) were reconstructed
-- from a live PRODUCTION schema dump after the original migration source
-- (0013-0036) was lost (see docs/NAIJADEALS-PRODUCTION-RECOVERY-REPORT.md).
-- A schema dump captures CREATE TABLE structure only, not row data — so
-- the cuisines/dishes taxonomy that genuinely exists in PRODUCTION (10
-- cuisines, 56 dishes) was never captured as an INSERT anywhere in this
-- repo, leaving local/dev D1 with the correct schema but zero taxonomy
-- rows. This migration restores that missing development-data layer.
--
-- This is a RECOVERY of pre-existing production data, not new taxonomy.
-- Every row below was read directly from production via a read-only
-- `gsk hosted d1_query` SELECT (2026-09-22) and is reproduced here
-- byte-for-byte: same IDs, slugs, names, descriptions, image paths,
-- vegetarian/spicy flags, and sort_order. Nothing is invented, modified,
-- or "cleaned up."
--
-- Authorized for LOCAL/DEV D1 ONLY. Do not apply to production — this
-- migration exists purely to make local development mirror the data
-- production already has, so NaijaEats Phase 1 seed data (menu items)
-- can reference real dish_id foreign keys in the dev environment.
--
-- INSERT OR IGNORE is used throughout: if a row with this ID already
-- exists (e.g. this migration is re-run, or run against an environment
-- that already has the taxonomy), nothing changes.

-- ============================================================
-- 1. CUISINES (10 rows, IDs 1-10, production-exact)
-- ============================================================
INSERT OR IGNORE INTO cuisines (id, slug, name, region, description, icon, sort_order, image_url) VALUES (1, 'nigerian', 'Nigerian', 'Western Africa', 'Nigeria''s rich culinary tradition — jollof rice, soups, grills, and more.', 'restaurant', 1, '/static/eats/cuisines/nigerian.jpg');
INSERT OR IGNORE INTO cuisines (id, slug, name, region, description, icon, sort_order, image_url) VALUES (2, 'ghanaian', 'Ghanaian', 'Western Africa', 'Ghana''s staple dishes — waakye, banku, fufu, and groundnut soup.', 'restaurant', 2, '/static/eats/cuisines/ghanaian.jpg');
INSERT OR IGNORE INTO cuisines (id, slug, name, region, description, icon, sort_order, image_url) VALUES (3, 'senegalese', 'Senegalese', 'Western Africa', 'Senegal''s celebrated dishes — thieboudienne, yassa, and mafé.', 'restaurant', 3, '/static/eats/cuisines/senegalese.jpg');
INSERT OR IGNORE INTO cuisines (id, slug, name, region, description, icon, sort_order, image_url) VALUES (4, 'ivorian', 'Ivorian', 'Western Africa', 'Cote d''Ivoire''s attiéké and kedjenou traditions.', 'restaurant', 4, '/static/eats/cuisines/ivorian.jpg');
INSERT OR IGNORE INTO cuisines (id, slug, name, region, description, icon, sort_order, image_url) VALUES (5, 'ethiopian_eritrean', 'Ethiopian & Eritrean', 'Eastern Africa', 'Injera, doro wat, and tibs from the Horn of Africa.', 'restaurant', 5, '/static/eats/cuisines/ethiopian_eritrean.jpg');
INSERT OR IGNORE INTO cuisines (id, slug, name, region, description, icon, sort_order, image_url) VALUES (6, 'kenyan', 'Kenyan', 'Eastern Africa', 'Nyama choma, ugali, and sukuma wiki.', 'restaurant', 6, '/static/eats/cuisines/kenyan.jpg');
INSERT OR IGNORE INTO cuisines (id, slug, name, region, description, icon, sort_order, image_url) VALUES (7, 'tanzanian', 'Tanzanian', 'Eastern Africa', 'Pilau and chips mayai from the East African coast.', 'restaurant', 7, '/static/eats/cuisines/tanzanian.jpg');
INSERT OR IGNORE INTO cuisines (id, slug, name, region, description, icon, sort_order, image_url) VALUES (8, 'cameroonian', 'Cameroonian', 'Middle Africa', 'Ndolé, eru, and achu.', 'restaurant', 8, '/static/eats/cuisines/cameroonian.jpg');
INSERT OR IGNORE INTO cuisines (id, slug, name, region, description, icon, sort_order, image_url) VALUES (9, 'south_african', 'South African', 'Southern Africa', 'Bunny chow, bobotie, and chakalaka.', 'restaurant', 9, '/static/eats/cuisines/south_african.jpg');
INSERT OR IGNORE INTO cuisines (id, slug, name, region, description, icon, sort_order, image_url) VALUES (10, 'moroccan', 'Moroccan', 'Northern Africa', 'Tagine, couscous, and pastilla.', 'restaurant', 10, '/static/eats/cuisines/moroccan.jpg');

-- ============================================================
-- 2. DISHES (56 rows, IDs 1-56 with gaps at 5 IDs pre-consumed
--    by other allocations upstream — production-exact, no renumbering)
-- ============================================================
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (1, 'jollof-rice', 'Jollof Rice', 1, 'West Africa''s iconic tomato-and-pepper rice dish, often served with chicken, beef, or fish.', '/static/eats/dishes/jollof-rice.jpg', 0, 1, 1);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (2, 'egusi-soup', 'Egusi Soup', 1, 'A rich soup made from ground melon seeds, leafy vegetables, and assorted meat or fish.', '/static/eats/dishes/egusi-soup.jpg', 0, 1, 2);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (3, 'pounded-yam', 'Pounded Yam', 1, 'Smooth, stretchy yam paste, traditionally eaten with a soup like egusi or okra.', '/static/eats/dishes/pounded-yam.jpg', 1, 0, 3);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (4, 'afang-soup', 'Afang Soup', 1, 'A nutrient-dense soup from Nigeria''s South-South, made with afang and waterleaf.', '/static/eats/dishes/afang-soup.jpg', 0, 1, 4);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (5, 'oha-soup', 'Oha Soup', 1, 'An Igbo delicacy made with oha leaves and cocoyam thickener.', '/static/eats/dishes/oha-soup.jpg', 0, 1, 5);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (6, 'bitterleaf-soup', 'Bitterleaf Soup', 1, 'Also known as Ofe Onugbu — a traditional Igbo soup with bitterleaf and assorted meat.', '/static/eats/dishes/bitterleaf-soup.jpg', 0, 1, 6);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (7, 'nsala-soup', 'Nsala Soup', 1, 'A pepper-based "white soup" traditionally made with catfish, without palm oil.', '/static/eats/dishes/nsala-soup.jpg', 0, 1, 7);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (8, 'suya', 'Suya', 1, 'Spiced, skewered grilled meat coated in a peanut-based yaji spice blend.', '/static/eats/dishes/suya.jpg', 0, 1, 8);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (9, 'moi-moi', 'Moi Moi', 1, 'A steamed bean pudding made from ground black-eyed peas, peppers, and onions.', '/static/eats/dishes/moi-moi.jpg', 1, 0, 9);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (10, 'akara', 'Akara', 1, 'Deep-fried bean cakes made from black-eyed peas — a popular Nigerian breakfast item.', '/static/eats/dishes/akara.jpg', 1, 0, 10);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (11, 'amala', 'Amala', 1, 'A smooth swallow made from yam flour, popular in Southwest Nigeria.', '/static/eats/dishes/amala.jpg', 1, 0, 11);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (12, 'ewedu', 'Ewedu', 1, 'A mucilaginous soup made from jute leaves, commonly paired with amala and gbegiri.', '/static/eats/dishes/ewedu.jpg', 1, 0, 12);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (13, 'efo-riro', 'Efo Riro', 1, 'A rich Yoruba vegetable soup made with spinach or fluted pumpkin leaves.', '/static/eats/dishes/efo-riro.jpg', 0, 1, 13);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (14, 'ofada-rice', 'Ofada Rice & Sauce', 1, 'Local unpolished rice served with a spicy pepper sauce (ayamase).', '/static/eats/dishes/ofada-rice-sauce.jpg', 0, 1, 14);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (15, 'banga-soup', 'Banga Soup', 1, 'A palm-fruit-based soup from the Niger Delta, distinct from regular palm oil soups.', '/static/eats/dishes/banga-soup.jpg', 0, 1, 15);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (16, 'fisherman-soup', 'Fisherman Soup', 1, 'A hearty, spicy seafood soup loaded with fresh fish and other seafood.', '/static/eats/dishes/fisherman-soup.jpg', 0, 1, 16);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (17, 'pepper-soup', 'Pepper Soup', 1, 'A light, spicy broth made with assorted meat or fish and traditional spices.', '/static/eats/dishes/pepper-soup.jpg', 0, 1, 17);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (18, 'nkwobi', 'Nkwobi', 1, 'Spiced cow foot in a rich palm oil and potash sauce — a popular small-chops delicacy.', '/static/eats/dishes/nkwobi.jpg', 0, 1, 18);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (19, 'isi-ewu', 'Isi Ewu', 1, 'Spiced goat head, a celebratory Igbo delicacy served with a peppery sauce.', '/static/eats/dishes/isi-ewu.jpg', 0, 1, 19);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (20, 'abacha', 'Abacha', 1, 'African salad made from shredded cassava, garnished with ugba, vegetables, and a palm-oil dressing.', '/static/eats/dishes/abacha.jpg', 0, 1, 20);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (21, 'ukwa', 'Ukwa', 1, 'Breadfruit porridge, a traditional Igbo dish often prepared for special occasions.', '/static/eats/dishes/ukwa.jpg', 1, 0, 21);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (22, 'yam-porridge', 'Yam Porridge (Asaro)', 1, 'A one-pot yam dish cooked with palm oil, peppers, and leafy vegetables.', '/static/eats/dishes/yam-porridge-asaro.jpg', 1, 0, 22);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (23, 'beans-plantain', 'Beans & Plantain', 1, 'A comforting combination of stewed beans and fried or boiled ripe plantain.', '/static/eats/dishes/beans-plantain.jpg', 1, 0, 23);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (24, 'nigerian-fried-rice', 'Nigerian Fried Rice', 1, 'A colorful, vegetable-packed fried rice, a staple at Nigerian parties.', '/static/eats/dishes/nigerian-fried-rice.jpg', 0, 0, 24);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (25, 'asun', 'Asun', 1, 'Spicy, chopped grilled goat meat, a favorite Nigerian small chop.', '/static/eats/dishes/asun.jpg', 0, 1, 25);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (26, 'peppered-snails', 'Peppered Snails', 1, 'Giant African snails cooked in a rich, spicy pepper sauce.', '/static/eats/dishes/peppered-snails.jpg', 0, 1, 26);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (27, 'waakye', 'Waakye', 2, 'Ghanaian rice and beans cooked with dried millet leaves for its distinct color.', '/static/eats/dishes/waakye.jpg', 1, 0, 1);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (28, 'banku', 'Banku', 2, 'A fermented corn and cassava dough, often served with soup or grilled tilapia.', '/static/eats/dishes/banku.jpg', 1, 0, 2);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (29, 'kenkey', 'Kenkey', 2, 'Fermented, steamed corn dough wrapped in corn husks or plantain leaves.', '/static/eats/dishes/kenkey.jpg', 1, 0, 3);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (30, 'ghanaian-fufu', 'Fufu', 2, 'Pounded cassava and plantain, served with a hearty soup.', '/static/eats/dishes/fufu.jpg', 1, 0, 4);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (31, 'red-red', 'Red Red', 2, 'Black-eyed peas stewed in palm oil, served with fried ripe plantain.', '/static/eats/dishes/red-red.jpg', 1, 0, 5);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (32, 'groundnut-soup', 'Groundnut Soup', 2, 'A rich, creamy peanut-based soup, often served with rice balls or fufu.', '/static/eats/dishes/groundnut-soup.jpg', 0, 1, 6);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (33, 'light-soup', 'Light Soup', 2, 'A tomato-based Ghanaian soup, lighter than groundnut soup, with meat or fish.', '/static/eats/dishes/light-soup.jpg', 0, 1, 7);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (34, 'kelewele', 'Kelewele', 2, 'Spiced, deep-fried ripe plantain cubes, a popular Ghanaian street snack.', '/static/eats/dishes/kelewele.jpg', 1, 1, 8);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (35, 'thieboudienne', 'Thieboudienne', 3, 'Senegal''s national dish — fish and rice cooked in a rich tomato sauce with vegetables.', '/static/eats/dishes/thieboudienne.jpg', 0, 0, 1);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (36, 'yassa', 'Yassa', 3, 'Chicken or fish marinated in lemon and onions, then grilled or braised.', '/static/eats/dishes/yassa.jpg', 0, 0, 2);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (37, 'mafe', 'Mafé', 3, 'A peanut-based stew with meat and vegetables, served over rice.', '/static/eats/dishes/mafe.jpg', 0, 0, 3);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (38, 'injera', 'Injera', 5, 'A spongy, slightly sour flatbread made from fermented teff flour — the base of most Ethiopian meals.', '/static/eats/dishes/injera.jpg', 1, 0, 1);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (39, 'doro-wat', 'Doro Wat', 5, 'A spicy Ethiopian chicken stew simmered in berbere spice and served with injera.', '/static/eats/dishes/doro-wat.jpg', 0, 1, 2);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (40, 'tibs', 'Tibs', 5, 'Sautéed cubes of beef or lamb with onions, peppers, and rosemary.', '/static/eats/dishes/tibs.jpg', 0, 1, 3);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (41, 'nyama-choma', 'Nyama Choma', 6, 'Grilled meat (usually goat or beef), a Kenyan social-eating staple.', '/static/eats/dishes/nyama-choma.jpg', 0, 0, 1);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (42, 'ugali', 'Ugali', 6, 'A firm maize-flour porridge, the everyday staple across East Africa.', '/static/eats/dishes/ugali.jpg', 1, 0, 2);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (43, 'sukuma-wiki', 'Sukuma Wiki', 6, 'Sautéed collard greens, a common Kenyan side dish.', '/static/eats/dishes/sukuma-wiki.jpg', 1, 0, 3);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (44, 'pilau', 'Pilau', 7, 'Spiced rice cooked with meat and aromatic East African spices.', '/static/eats/dishes/pilau.jpg', 0, 0, 1);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (45, 'chips-mayai', 'Chips Mayai', 7, 'A Tanzanian street-food omelette made with french fries baked into the egg.', '/static/eats/dishes/chips-mayai.jpg', 1, 0, 2);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (46, 'ndole', 'Ndolé', 8, 'Cameroon''s national dish — a stew of bitterleaf, groundnuts, and fish or beef.', '/static/eats/dishes/ndole.jpg', 0, 0, 1);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (47, 'eru', 'Eru', 8, 'A vegetable soup made from eru leaves and waterleaf, often served with fufu corn.', '/static/eats/dishes/eru.jpg', 0, 1, 2);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (48, 'achu', 'Achu', 8, 'Cocoyam pudding served with a yellow spicy soup, popular in Cameroon''s Northwest region.', '/static/eats/dishes/achu.jpg', 1, 1, 3);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (49, 'attieke', 'Attiéké', 4, 'Fermented, granulated cassava couscous, often served with grilled fish.', '/static/eats/dishes/attieke.jpg', 1, 0, 1);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (50, 'kedjenou', 'Kedjenou', 4, 'Slow-cooked chicken or guinea fowl stew, sealed and simmered with vegetables.', '/static/eats/dishes/kedjenou.jpg', 0, 0, 2);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (51, 'bunny-chow', 'Bunny Chow', 9, 'A hollowed-out bread loaf filled with curry, a Durban street-food classic.', '/static/eats/dishes/bunny-chow.jpg', 0, 1, 1);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (52, 'bobotie', 'Bobotie', 9, 'A spiced minced-meat bake topped with an egg-based custard.', '/static/eats/dishes/bobotie.jpg', 0, 0, 2);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (53, 'chakalaka', 'Chakalaka', 9, 'A spicy vegetable relish, usually served alongside grilled meats.', '/static/eats/dishes/chakalaka.jpg', 1, 1, 3);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (54, 'tagine', 'Tagine', 10, 'A slow-cooked stew of meat and vegetables, named after the clay pot it''s cooked in.', '/static/eats/dishes/tagine.jpg', 0, 0, 1);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (55, 'couscous', 'Couscous', 10, 'Steamed semolina, traditionally topped with a vegetable and meat stew.', '/static/eats/dishes/couscous.jpg', 0, 0, 2);
INSERT OR IGNORE INTO dishes (id, slug, name, cuisine_id, description, image_url, is_vegetarian, is_spicy, sort_order) VALUES (56, 'pastilla', 'Pastilla', 10, 'A savory-sweet pastry filled with spiced meat or seafood, dusted with sugar and cinnamon.', '/static/eats/dishes/pastilla.jpg', 0, 0, 3);

-- Reset the AUTOINCREMENT counters so any FUTURE inserts (e.g. a real
-- restaurant operator's new dish suggestion, or a later NaijaEats catalog
-- expansion) continue from the correct next ID rather than colliding with
-- these explicit-ID rows. No-op on a system where sqlite_sequence rows
-- don't exist yet (INSERT OR IGNORE handles first-run cleanly via the
-- INSERT ... SELECT pattern below).
INSERT INTO sqlite_sequence (name, seq) SELECT 'cuisines', 10 WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'cuisines');
UPDATE sqlite_sequence SET seq = 10 WHERE name = 'cuisines' AND seq < 10;
INSERT INTO sqlite_sequence (name, seq) SELECT 'dishes', 56 WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'dishes');
UPDATE sqlite_sequence SET seq = 56 WHERE name = 'dishes' AND seq < 56;


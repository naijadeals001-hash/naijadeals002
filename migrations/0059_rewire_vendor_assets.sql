-- NaijaDeals — Rewire Vendor Assets (Popular Vendors fix)
--
-- ROOT CAUSE (same class of bug as migration 0058 for brands): the `vendors`
-- table's 18 real, catalog-linked seed vendors (lagos-tech-hub, naija-gadget-store,
-- etc.) have never had their logo_url updated away from the seed-time
-- `/ph.svg?label=...` placeholder. Unlike brands, there was no earlier
-- migration that even attempted a fix — getPopularVendors() has always had a
-- real-asset filter but nothing was ever wired to satisfy it.
--
-- ASSET DECISION (per Pat's explicit directive, 2026-09-16): a candidate
-- pre-existing asset directory (public/static/vendors/vendor-1.jpg ... vendor-20.jpg,
-- added in an earlier commit e8ed19f) was investigated and REJECTED — those 20
-- files are logo-style graphics for a different, unrelated set of fictional
-- business names ("Electronics World", "GadgetTech Hub", "Fashion Vault NG",
-- "FoodMart NG", etc.) that do not correspond to any of these 18 vendor
-- records. Wiring them by numeric coincidence would create a false identity
-- association for a specific named vendor row — exactly the fabrication this
-- migration must NOT do.
--
-- Instead, 18 NEW original storefront/product photographs were generated
-- specifically for these 18 real seed-vendor records (public/static/vendor-photos/
-- <slug>.jpg), each depicting genuine content matching that vendor's declared
-- business type and city (per vendors.description/city columns) with NO text,
-- logos, or trademarks of any real company — i.e. authentic-to-the-record
-- original imagery, not an appropriated identity. These are DB-attached seed
-- vendors (all user_id IS NULL, onboarding_completed_at backfilled in migration
-- 0009), not verified independent real-world businesses, so an original
-- NaijaDeals-created visual identity for each is the correct, non-fabricating
-- choice per Pat's ruling. The 32 `cctest%` QA test-fixture vendor rows are
-- intentionally left untouched (out of scope; excluded from any homepage query
-- by their is_verified/is_active semantics being test-only noise, not real
-- catalog data).

UPDATE vendors SET logo_url = '/static/vendor-photos/lagos-tech-hub.jpg'               WHERE slug = 'lagos-tech-hub';
UPDATE vendors SET logo_url = '/static/vendor-photos/naija-gadget-store.jpg'           WHERE slug = 'naija-gadget-store';
UPDATE vendors SET logo_url = '/static/vendor-photos/abuja-electronics-mart.jpg'       WHERE slug = 'abuja-electronics-mart';
UPDATE vendors SET logo_url = '/static/vendor-photos/portharcourt-phones-and-more.jpg' WHERE slug = 'portharcourt-phones-and-more';
UPDATE vendors SET logo_url = '/static/vendor-photos/kano-fabric-traders.jpg'          WHERE slug = 'kano-fabric-traders';
UPDATE vendors SET logo_url = '/static/vendor-photos/ariya-ankara-house.jpg'           WHERE slug = 'ariya-ankara-house';
UPDATE vendors SET logo_url = '/static/vendor-photos/oyo-adire-collective.jpg'         WHERE slug = 'oyo-adire-collective';
UPDATE vendors SET logo_url = '/static/vendor-photos/aso-oke-heritage-weavers.jpg'     WHERE slug = 'aso-oke-heritage-weavers';
UPDATE vendors SET logo_url = '/static/vendor-photos/mamas-kitchen-grocers.jpg'        WHERE slug = 'mamas-kitchen-grocers';
UPDATE vendors SET logo_url = '/static/vendor-photos/naija-fresh-market.jpg'           WHERE slug = 'naija-fresh-market';
UPDATE vendors SET logo_url = '/static/vendor-photos/zaron-beauty-nigeria.jpg'         WHERE slug = 'zaron-beauty-nigeria';
UPDATE vendors SET logo_url = '/static/vendor-photos/enugu-home-and-living.jpg'        WHERE slug = 'enugu-home-and-living';
UPDATE vendors SET logo_url = '/static/vendor-photos/kumasi-kente-weavers.jpg'         WHERE slug = 'kumasi-kente-weavers';
UPDATE vendors SET logo_url = '/static/vendor-photos/accra-shea-collective.jpg'        WHERE slug = 'accra-shea-collective';
UPDATE vendors SET logo_url = '/static/vendor-photos/nairobi-coffee-exporters.jpg'     WHERE slug = 'nairobi-coffee-exporters';
UPDATE vendors SET logo_url = '/static/vendor-photos/maasai-craft-cooperative.jpg'     WHERE slug = 'maasai-craft-cooperative';
UPDATE vendors SET logo_url = '/static/vendor-photos/marrakech-leather-and-rugs.jpg'   WHERE slug = 'marrakech-leather-and-rugs';
UPDATE vendors SET logo_url = '/static/vendor-photos/fez-ceramics-house.jpg'           WHERE slug = 'fez-ceramics-house';

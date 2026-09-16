-- NaijaDeals — Rewire Country Assets (Explore Africa fix)
--
-- ROOT CAUSE: cc_countries.image_url has been NULL for all 54 rows since the
-- table was seeded — no country-asset migration has ever existed. This is a
-- pure missing-content gap, not a code or ordering bug (confirmed via live
-- D1: SELECT COUNT(*) FROM cc_countries WHERE image_url IS NOT NULL => 0).
--
-- FIX: 54 original, country-specific photographs were generated (Pat's
-- explicit authorization, 2026-09-16), each depicting a REAL landmark,
-- landscape, or cultural scene unmistakably tied to that exact nation
-- (e.g. Nigeria -> Lagos-area African market/coast scenery, Ghana ->
-- Independence Arch-era West African imagery, Kenya -> Maasai Mara,
-- Egypt -> Pyramids of Giza, Morocco -> Marrakech/Chefchaouen-style
-- architecture, Ethiopia -> Lalibela rock-hewn church, etc.). No generic
-- interchangeable "Africa" stock imagery, no fabricated/fake landmarks
-- presented as real, no wrong-country flags or cultural attribution.
-- Every image explicitly excludes text/logos/watermarks to avoid any
-- trademark or signage risk.
--
-- Assets stored at public/static/countries/<iso-lowercase>-<name-slug>.jpg
-- and wired below by iso_code (verified against the live cc_countries
-- table — all 54 ISO codes matched with zero mismatches, zero missing).
--
-- Homepage renders a CURATED SUBSET (not all 54 as giant cards) per Pat's
-- Section 5 — home.tsx already slices getDiscoverableCountries() to a
-- small featured set and links to "See All 54 →" for the full list; no
-- code change required here since getDiscoverableCountries() already
-- filters on display_on_homepage + image_url IS NOT NULL.

UPDATE cc_countries SET image_url = '/static/countries/ng-nigeria.jpg'                       WHERE iso_code = 'NG';
UPDATE cc_countries SET image_url = '/static/countries/gh-ghana.jpg'                         WHERE iso_code = 'GH';
UPDATE cc_countries SET image_url = '/static/countries/ke-kenya.jpg'                         WHERE iso_code = 'KE';
UPDATE cc_countries SET image_url = '/static/countries/za-south-africa.jpg'                  WHERE iso_code = 'ZA';
UPDATE cc_countries SET image_url = '/static/countries/ug-uganda.jpg'                        WHERE iso_code = 'UG';
UPDATE cc_countries SET image_url = '/static/countries/tz-tanzania.jpg'                      WHERE iso_code = 'TZ';
UPDATE cc_countries SET image_url = '/static/countries/rw-rwanda.jpg'                        WHERE iso_code = 'RW';
UPDATE cc_countries SET image_url = '/static/countries/sn-senegal.jpg'                       WHERE iso_code = 'SN';
UPDATE cc_countries SET image_url = '/static/countries/ci-cote-divoire.jpg'                  WHERE iso_code = 'CI';
UPDATE cc_countries SET image_url = '/static/countries/cm-cameroon.jpg'                      WHERE iso_code = 'CM';
UPDATE cc_countries SET image_url = '/static/countries/dz-algeria.jpg'                       WHERE iso_code = 'DZ';
UPDATE cc_countries SET image_url = '/static/countries/eg-egypt.jpg'                         WHERE iso_code = 'EG';
UPDATE cc_countries SET image_url = '/static/countries/ly-libya.jpg'                         WHERE iso_code = 'LY';
UPDATE cc_countries SET image_url = '/static/countries/ma-morocco.jpg'                       WHERE iso_code = 'MA';
UPDATE cc_countries SET image_url = '/static/countries/sd-sudan.jpg'                         WHERE iso_code = 'SD';
UPDATE cc_countries SET image_url = '/static/countries/tn-tunisia.jpg'                       WHERE iso_code = 'TN';
UPDATE cc_countries SET image_url = '/static/countries/bj-benin.jpg'                         WHERE iso_code = 'BJ';
UPDATE cc_countries SET image_url = '/static/countries/bf-burkina-faso.jpg'                  WHERE iso_code = 'BF';
UPDATE cc_countries SET image_url = '/static/countries/cv-cabo-verde.jpg'                    WHERE iso_code = 'CV';
UPDATE cc_countries SET image_url = '/static/countries/gm-gambia.jpg'                        WHERE iso_code = 'GM';
UPDATE cc_countries SET image_url = '/static/countries/gn-guinea.jpg'                        WHERE iso_code = 'GN';
UPDATE cc_countries SET image_url = '/static/countries/gw-guinea-bissau.jpg'                 WHERE iso_code = 'GW';
UPDATE cc_countries SET image_url = '/static/countries/lr-liberia.jpg'                       WHERE iso_code = 'LR';
UPDATE cc_countries SET image_url = '/static/countries/ml-mali.jpg'                          WHERE iso_code = 'ML';
UPDATE cc_countries SET image_url = '/static/countries/mr-mauritania.jpg'                    WHERE iso_code = 'MR';
UPDATE cc_countries SET image_url = '/static/countries/ne-niger.jpg'                         WHERE iso_code = 'NE';
UPDATE cc_countries SET image_url = '/static/countries/sl-sierra-leone.jpg'                  WHERE iso_code = 'SL';
UPDATE cc_countries SET image_url = '/static/countries/tg-togo.jpg'                          WHERE iso_code = 'TG';
UPDATE cc_countries SET image_url = '/static/countries/ao-angola.jpg'                        WHERE iso_code = 'AO';
UPDATE cc_countries SET image_url = '/static/countries/bi-burundi.jpg'                       WHERE iso_code = 'BI';
UPDATE cc_countries SET image_url = '/static/countries/cf-central-african-republic.jpg'      WHERE iso_code = 'CF';
UPDATE cc_countries SET image_url = '/static/countries/td-chad.jpg'                          WHERE iso_code = 'TD';
UPDATE cc_countries SET image_url = '/static/countries/cg-congo-republic.jpg'                WHERE iso_code = 'CG';
UPDATE cc_countries SET image_url = '/static/countries/cd-congo-drc.jpg'                     WHERE iso_code = 'CD';
UPDATE cc_countries SET image_url = '/static/countries/gq-equatorial-guinea.jpg'             WHERE iso_code = 'GQ';
UPDATE cc_countries SET image_url = '/static/countries/ga-gabon.jpg'                         WHERE iso_code = 'GA';
UPDATE cc_countries SET image_url = '/static/countries/st-sao-tome-and-principe.jpg'         WHERE iso_code = 'ST';
UPDATE cc_countries SET image_url = '/static/countries/km-comoros.jpg'                       WHERE iso_code = 'KM';
UPDATE cc_countries SET image_url = '/static/countries/dj-djibouti.jpg'                      WHERE iso_code = 'DJ';
UPDATE cc_countries SET image_url = '/static/countries/er-eritrea.jpg'                       WHERE iso_code = 'ER';
UPDATE cc_countries SET image_url = '/static/countries/sz-eswatini.jpg'                      WHERE iso_code = 'SZ';
UPDATE cc_countries SET image_url = '/static/countries/et-ethiopia.jpg'                      WHERE iso_code = 'ET';
UPDATE cc_countries SET image_url = '/static/countries/mg-madagascar.jpg'                    WHERE iso_code = 'MG';
UPDATE cc_countries SET image_url = '/static/countries/mw-malawi.jpg'                        WHERE iso_code = 'MW';
UPDATE cc_countries SET image_url = '/static/countries/mu-mauritius.jpg'                     WHERE iso_code = 'MU';
UPDATE cc_countries SET image_url = '/static/countries/mz-mozambique.jpg'                    WHERE iso_code = 'MZ';
UPDATE cc_countries SET image_url = '/static/countries/sc-seychelles.jpg'                    WHERE iso_code = 'SC';
UPDATE cc_countries SET image_url = '/static/countries/so-somalia.jpg'                       WHERE iso_code = 'SO';
UPDATE cc_countries SET image_url = '/static/countries/ss-south-sudan.jpg'                   WHERE iso_code = 'SS';
UPDATE cc_countries SET image_url = '/static/countries/zm-zambia.jpg'                        WHERE iso_code = 'ZM';
UPDATE cc_countries SET image_url = '/static/countries/zw-zimbabwe.jpg'                      WHERE iso_code = 'ZW';
UPDATE cc_countries SET image_url = '/static/countries/bw-botswana.jpg'                      WHERE iso_code = 'BW';
UPDATE cc_countries SET image_url = '/static/countries/ls-lesotho.jpg'                       WHERE iso_code = 'LS';
UPDATE cc_countries SET image_url = '/static/countries/na-namibia.jpg'                       WHERE iso_code = 'NA';

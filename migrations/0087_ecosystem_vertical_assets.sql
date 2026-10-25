-- Batch A: complete the homepage ecosystem image registry with real, local assets.
-- These are existing repository assets, not fabricated listings or external URLs.
-- The verticals remain honest about their lifecycle status; this only improves
-- discovery imagery for the homepage and shared preview pages.

UPDATE ecosystem_verticals
SET hero_image_desktop = '/static/categories/phone-accessories.jpg',
    hero_image_mobile = '/static/categories/phone-accessories.jpg',
    updated_at = datetime('now')
WHERE slug = 'pay';

UPDATE ecosystem_verticals
SET hero_image_desktop = '/static/products/088-bluetooth-car-fm-transmitter.jpg',
    hero_image_mobile = '/static/products/088-bluetooth-car-fm-transmitter.jpg',
    updated_at = datetime('now')
WHERE slug = 'auto';

UPDATE ecosystem_verticals
SET hero_image_desktop = '/static/categories/home-improvement.jpg',
    hero_image_mobile = '/static/categories/home-improvement.jpg',
    updated_at = datetime('now')
WHERE slug = 'homes';

UPDATE ecosystem_verticals
SET hero_image_desktop = '/static/categories/travel-accessories.jpg',
    hero_image_mobile = '/static/categories/travel-accessories.jpg',
    updated_at = datetime('now')
WHERE slug = 'travel';

UPDATE ecosystem_verticals
SET hero_image_desktop = '/static/banners/banner-2.jpg',
    hero_image_mobile = '/static/banners/banner-2.jpg',
    updated_at = datetime('now')
WHERE slug = 'events';

UPDATE ecosystem_verticals
SET hero_image_desktop = '/static/products/026-boys-school-uniform-set.jpg',
    hero_image_mobile = '/static/products/026-boys-school-uniform-set.jpg',
    updated_at = datetime('now')
WHERE slug = 'learn';

UPDATE ecosystem_verticals
SET hero_image_desktop = '/static/categories/office-furniture.jpg',
    hero_image_mobile = '/static/categories/office-furniture.jpg',
    updated_at = datetime('now')
WHERE slug = 'jobs';

UPDATE ecosystem_verticals
SET hero_image_desktop = '/static/products/076-digital-blood-pressure-monitor.jpg',
    hero_image_mobile = '/static/products/076-digital-blood-pressure-monitor.jpg',
    updated_at = datetime('now')
WHERE slug = 'health';

UPDATE ecosystem_verticals
SET hero_image_desktop = '/static/categories/african-agriculture.jpg',
    hero_image_mobile = '/static/categories/african-agriculture.jpg',
    updated_at = datetime('now')
WHERE slug = 'farm';

UPDATE ecosystem_verticals
SET hero_image_desktop = '/static/categories/furniture.jpg',
    hero_image_mobile = '/static/categories/furniture.jpg',
    updated_at = datetime('now')
WHERE slug = 'home';

UPDATE ecosystem_verticals
SET hero_image_desktop = '/static/categories/african-beauty.jpg',
    hero_image_mobile = '/static/categories/african-beauty.jpg',
    updated_at = datetime('now')
WHERE slug = 'beauty';

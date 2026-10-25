-- Batch B: replace pragmatic category proxies with dedicated original artwork
-- for the four reserved verticals that are now exposed in the ecosystem rail.
-- These are presentation assets only; vertical lifecycle/status and transaction
-- availability remain controlled by the existing registry and rollout engines.

UPDATE ecosystem_verticals
SET hero_image_desktop = '/static/ecosystem/pay-original.svg',
    hero_image_mobile = '/static/ecosystem/pay-original.svg',
    updated_at = datetime('now')
WHERE slug = 'pay';

UPDATE ecosystem_verticals
SET hero_image_desktop = '/static/ecosystem/jobs-original.svg',
    hero_image_mobile = '/static/ecosystem/jobs-original.svg',
    updated_at = datetime('now')
WHERE slug = 'jobs';

UPDATE ecosystem_verticals
SET hero_image_desktop = '/static/ecosystem/learn-original.svg',
    hero_image_mobile = '/static/ecosystem/learn-original.svg',
    updated_at = datetime('now')
WHERE slug = 'learn';

UPDATE ecosystem_verticals
SET hero_image_desktop = '/static/ecosystem/events-original.svg',
    hero_image_mobile = '/static/ecosystem/events-original.svg',
    updated_at = datetime('now')
WHERE slug = 'events';

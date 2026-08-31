-- NaijaDeals — Ecosystem Vertical Previews
--
-- Problem being fixed:
--   The global header/footer ecosystem nav (Layout.tsx's ECOSYSTEM_LINKS,
--   already shipping) links to /fresh, /eats, /gigs, /stay, /drive, /send,
--   /stream, /aura — all eight of which currently 404, because no route or
--   page exists for them. A visitor exploring "the NaijaDeals ecosystem"
--   from the nav hits a dead end on 8 of 9 destinations. NaijaShop (/shop)
--   is the only vertical that is actually built.
--
-- What this migration adds:
--   Config-driven content for a reusable "Ecosystem Preview" experience —
--   one component/page renders all 8 planned verticals, keyed by slug, with
--   real product-identity copy (tagline, description, feature list, CTA,
--   SEO metadata, hero art) instead of a generic "Coming Soon" stub or a
--   404. No fabricated stats, listings, restaurants, drivers, reviews, or
--   availability anywhere in this data — every string here describes what
--   the vertical WILL do, framed honestly as not-yet-live.
--
-- Status lifecycle (per Pat's explicit instruction — this is the whole
-- point of making this config-driven rather than hardcoded per page):
--   COMING_SOON     -> preview + waitlist only, no functional CTA beyond that.
--   IN_DEVELOPMENT  -> reserved for a vertical that has a limited real preview
--                      (e.g. a build-in-progress screenshot, early access list)
--                      without full functionality. Not used by any row yet.
--   BETA            -> reserved for a vertical with real (if limited) live
--                      functionality behind this same route. Not used yet.
--   LIVE            -> the vertical is a real, fully functional product.
--                      NaijaShop is LIVE today, but is NOT a row in this table —
--                      it is not a "preview", it already has its own real
--                      /shop implementation. This table exists to flip a row
--                      COMING_SOON -> LIVE at the moment a vertical's actual
--                      engine ships, at which point its /route in index.tsx is
--                      simply repointed from ecosystemPreviewPage to the real
--                      page handler (this table then becomes purely historical/
--                      SEO metadata for that vertical, or can be dropped).
--
-- Architecture: ONE reusable page handler (src/pages/ecosystem-preview.tsx) +
-- ONE reusable component (src/components/EcosystemPreview.tsx), registered
-- for all 8 routes with a slug param. No per-vertical TSX files. Adding a 9th
-- vertical later means one more row in this table, zero new code.

CREATE TABLE IF NOT EXISTS ecosystem_verticals (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  slug               TEXT NOT NULL UNIQUE,   -- 'fresh' | 'eats' | 'gigs' | 'stay' | 'drive' | 'send' | 'stream' | 'aura'
  route              TEXT NOT NULL UNIQUE,   -- '/fresh' etc. (kept separate from slug so a route can differ from slug if ever needed)
  name               TEXT NOT NULL,          -- 'NaijaFresh'
  tagline             TEXT NOT NULL,          -- short hero headline, e.g. 'Fresh from Nigeria. Delivered to you.'
  description        TEXT NOT NULL,          -- 1-2 sentence honest description of what the vertical will do
  icon               TEXT NOT NULL,          -- Material Symbols icon name, matches ECOSYSTEM_LINKS in Layout.tsx
  accent_color       TEXT NOT NULL,          -- Tailwind color token used for this vertical's badges/accents, e.g. 'amber'
  hero_image_desktop TEXT NOT NULL,          -- repo-persistent path under /static/ecosystem/
  hero_image_mobile  TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'coming_soon' CHECK (status IN ('coming_soon','in_development','beta','live')),
  cta_label          TEXT NOT NULL DEFAULT 'Notify me',
  seo_title          TEXT NOT NULL,          -- <title> content, WITHOUT the ' | NaijaDeals' suffix (Layout adds it)
  seo_description    TEXT NOT NULL,          -- <meta name="description">
  display_order      INTEGER NOT NULL DEFAULT 100,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ecosystem_verticals_route ON ecosystem_verticals(route);

CREATE TABLE IF NOT EXISTS ecosystem_vertical_features (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  vertical_id  INTEGER NOT NULL REFERENCES ecosystem_verticals(id) ON DELETE CASCADE,
  icon         TEXT NOT NULL,   -- Material Symbols icon
  title        TEXT NOT NULL,   -- short feature name, e.g. 'Farm-fresh produce'
  description  TEXT NOT NULL,  -- one sentence explaining the planned feature
  display_order INTEGER NOT NULL DEFAULT 100
);

CREATE INDEX IF NOT EXISTS idx_ecosystem_vertical_features_vertical ON ecosystem_vertical_features(vertical_id, display_order);

-- Waitlist signups per vertical. Deliberately separate from newsletter_subscribers
-- (0001_initial_schema.sql) — that table is a single global marketing list with no
-- concept of "which vertical". This one records *which specific vertical* someone
-- asked to be notified about, which is what actually lets us message the right
-- people when e.g. NaijaEats flips to LIVE, without spamming everyone who signed
-- up only for NaijaStay.
CREATE TABLE IF NOT EXISTS ecosystem_waitlist (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  vertical_id  INTEGER NOT NULL REFERENCES ecosystem_verticals(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  user_id      INTEGER REFERENCES users(id),  -- NULL if the visitor was a guest at signup time
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vertical_id, email)
);

CREATE INDEX IF NOT EXISTS idx_ecosystem_waitlist_vertical ON ecosystem_waitlist(vertical_id);

-- ---------------------------------------------------------------------------
-- Seed data: 8 verticals, honest positioning per Pat's brief, 4 planned
-- features each. All hero art is a persistent, git-tracked asset under
-- public/static/ecosystem/ (added alongside this migration) — no external,
-- temporary, or stock-photo URLs.
-- ---------------------------------------------------------------------------

INSERT INTO ecosystem_verticals
  (slug, route, name, tagline, description, icon, accent_color, hero_image_desktop, hero_image_mobile, status, cta_label, seo_title, seo_description, display_order)
VALUES
  ('fresh', '/fresh', 'NaijaFresh',
   'Fresh from Nigeria. Delivered to you.',
   'NaijaFresh will bring farm-fresh produce, groceries and everyday essentials from local farmers and producers straight to your door — the same trusted NaijaDeals account and delivery network, extended to fresh food.',
   'nutrition', 'green',
   '/static/ecosystem/fresh-desktop.jpg', '/static/ecosystem/fresh-mobile.jpg',
   'coming_soon', 'Notify me',
   'NaijaFresh — Fresh Nigerian Produce & Groceries, Coming Soon',
   'NaijaFresh is coming soon to NaijaDeals: farm-fresh produce, groceries and everyday essentials from local Nigerian farmers and producers, delivered to your door.',
   10),

  ('eats', '/eats', 'NaijaEats',
   'Your favourite Nigerian food, one tap away.',
   'NaijaEats will connect you with restaurants and local food vendors across Nigeria for pickup and delivery — order your favourite meals through the same app you already shop with.',
   'restaurant', 'amber',
   '/static/ecosystem/eats-desktop.jpg', '/static/ecosystem/eats-mobile.jpg',
   'coming_soon', 'Notify me',
   'NaijaEats — Restaurant Food Delivery in Nigeria, Coming Soon',
   'NaijaEats is coming soon to NaijaDeals: order from restaurants and local food vendors across Nigeria for pickup or delivery.',
   20),

  ('gigs', '/gigs', 'NaijaGigs',
   'Get things done. Get paid.',
   'NaijaGigs will connect you with vetted Nigerian freelancers, professionals and local service providers — and give skilled workers a trusted marketplace to find paying work.',
   'design_services', 'blue',
   '/static/ecosystem/gigs-desktop.jpg', '/static/ecosystem/gigs-mobile.jpg',
   'coming_soon', 'Notify me',
   'NaijaGigs — Hire Nigerian Freelancers & Professionals, Coming Soon',
   'NaijaGigs is coming soon to NaijaDeals: connect with trusted Nigerian freelancers, professionals and local service providers.',
   30),

  ('stay', '/stay', 'NaijaStay',
   'Find your next place to stay.',
   'NaijaStay will list hotels, apartments and short stays across Nigeria — from weekend getaways in Lagos to business trips in Abuja, booked through your NaijaDeals account.',
   'bed', 'purple',
   '/static/ecosystem/stay-desktop.jpg', '/static/ecosystem/stay-mobile.jpg',
   'coming_soon', 'Notify me',
   'NaijaStay — Hotels & Short Stays in Nigeria, Coming Soon',
   'NaijaStay is coming soon to NaijaDeals: hotels, apartments, short stays and unique destinations across Nigeria.',
   40),

  ('drive', '/drive', 'NaijaDrive',
   'Move around Nigeria with confidence.',
   'NaijaDrive will bring vehicle rentals, driver bookings and business mobility services to the NaijaDeals ecosystem — reliable transportation, arranged in the same app you already trust.',
   'directions_car', 'slate',
   '/static/ecosystem/drive-desktop.jpg', '/static/ecosystem/drive-mobile.jpg',
   'coming_soon', 'Notify me',
   'NaijaDrive — Vehicle Rentals & Mobility in Nigeria, Coming Soon',
   'NaijaDrive is coming soon to NaijaDeals: vehicle rentals, drivers, and mobility services across Nigeria.',
   50),

  ('send', '/send', 'NaijaSend',
   'Send anything. Anywhere.',
   'NaijaSend will offer local delivery, package pickup and nationwide shipping with real-time tracking — the same logistics backbone that already powers NaijaShop deliveries, opened up for your own packages.',
   'local_shipping', 'orange',
   '/static/ecosystem/send-desktop.jpg', '/static/ecosystem/send-mobile.jpg',
   'coming_soon', 'Notify me',
   'NaijaSend — Local & Nationwide Delivery in Nigeria, Coming Soon',
   'NaijaSend is coming soon to NaijaDeals: local delivery, package pickup and nationwide shipping with tracking, across all 36 states.',
   60),

  ('stream', '/stream', 'NaijaStream',
   'African entertainment, all in one place.',
   'NaijaStream will bring music, movies, live content and original programming from African creators into the NaijaDeals ecosystem — entertainment built for and by Africa.',
   'play_circle', 'red',
   '/static/ecosystem/stream-desktop.jpg', '/static/ecosystem/stream-mobile.jpg',
   'coming_soon', 'Notify me',
   'NaijaStream — African Music, Movies & Creator Content, Coming Soon',
   'NaijaStream is coming soon to NaijaDeals: music, movies, live content and original programming from African creators.',
   70),

  ('aura', '/aura', 'Aura AI',
   'Your intelligent NaijaDeals companion.',
   'Aura AI will be the intelligent layer across the NaijaDeals ecosystem — helping you discover products, compare options, find deals, and navigate every vertical from one conversational assistant.',
   'auto_awesome', 'indigo',
   '/static/ecosystem/aura-desktop.jpg', '/static/ecosystem/aura-mobile.jpg',
   'coming_soon', 'Notify me',
   'Aura AI — Your Intelligent NaijaDeals Shopping Companion, Coming Soon',
   'Aura AI is coming soon to NaijaDeals: an intelligent companion for product discovery, deal-finding, comparisons and personalized shopping help.',
   80);

-- NOTE: deliberately using per-vertical INSERT...VALUES with a scalar
-- subquery for vertical_id, NOT a single INSERT...SELECT ... UNION ALL
-- across all 32 rows — D1/SQLite's compound-SELECT term limit rejects a
-- 32-way UNION ALL ("too many terms in compound SELECT"). Each statement
-- below is its own INSERT with a multi-row VALUES list (no UNION at all),
-- which has no such limit.

-- fresh
INSERT INTO ecosystem_vertical_features (vertical_id, icon, title, description, display_order) VALUES
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'fresh'), 'agriculture', 'Farm-fresh produce', 'Fruits, vegetables and staples sourced directly from Nigerian farmers.', 10),
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'fresh'), 'shopping_basket', 'Everyday groceries', 'Rice, beans, oil, spices and household essentials in one basket.', 20),
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'fresh'), 'storefront', 'Local farmers & producers', 'Support small-scale Nigerian farmers and producers directly through the app.', 30),
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'fresh'), 'local_shipping', 'Fast, fresh delivery', 'Delivery designed around keeping produce fresh from farm to door.', 40);

-- eats
INSERT INTO ecosystem_vertical_features (vertical_id, icon, title, description, display_order) VALUES
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'eats'), 'storefront', 'Local restaurants & vendors', 'Discover restaurants and independent food vendors near you.', 10),
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'eats'), 'menu_book', 'Browse real menus', 'See dishes, prices and options before you order — no guessing.', 20),
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'eats'), 'takeout_dining', 'Pickup or delivery', 'Choose to collect your order or have it delivered to your door.', 30),
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'eats'), 'schedule', 'Real-time order tracking', 'Know exactly when your food is being prepared and on its way.', 40);

-- gigs
INSERT INTO ecosystem_vertical_features (vertical_id, icon, title, description, display_order) VALUES
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'gigs'), 'verified_user', 'Vetted professionals', 'Every freelancer and service provider goes through a verification process.', 10),
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'gigs'), 'handyman', 'Home & business services', 'From repairs to design work, tutoring and events — find the right skill.', 20),
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'gigs'), 'payments', 'Secure, escrow-based payment', 'Pay only when the work is confirmed complete, protected by escrow.', 30),
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'gigs'), 'work', 'Earn as a professional', 'List your own services and get discovered by customers across Nigeria.', 40);

-- stay
INSERT INTO ecosystem_vertical_features (vertical_id, icon, title, description, display_order) VALUES
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'stay'), 'apartment', 'Hotels & apartments', 'Browse verified hotels, apartments and short-let stays.', 10),
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'stay'), 'holiday_village', 'Short stays & destinations', 'From weekend escapes to extended stays, find a place that fits.', 20),
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'stay'), 'verified', 'Verified hosts only', 'Every listing is tied to a verified host on the NaijaDeals platform.', 30),
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'stay'), 'calendar_month', 'Simple booking & dates', 'Check availability and book your stay in a few taps.', 40);

-- drive
INSERT INTO ecosystem_vertical_features (vertical_id, icon, title, description, display_order) VALUES
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'drive'), 'directions_car', 'Vehicle rentals', 'Rent cars and vehicles by the day or for longer trips.', 10),
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'drive'), 'sports_motorsports', 'Driver bookings', 'Book a trusted driver for personal or business travel.', 20),
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'drive'), 'business_center', 'Business mobility', 'Fleet and mobility solutions for businesses across Nigeria.', 30),
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'drive'), 'shield', 'Verified drivers & vehicles', 'Every driver and vehicle listed will go through a verification process.', 40);

-- send
INSERT INTO ecosystem_vertical_features (vertical_id, icon, title, description, display_order) VALUES
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'send'), 'local_shipping', 'Local delivery', 'Send packages across town, fast — tracked door to door.', 10),
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'send'), 'inventory_2', 'Package pickup', 'Schedule a pickup instead of dropping your package off yourself.', 20),
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'send'), 'public', 'Nationwide shipping', 'Ship to any of Nigeria''s 36 states through one trusted network.', 30),
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'send'), 'location_on', 'Live tracking', 'Follow your package from pickup to delivery in real time.', 40);

-- stream
INSERT INTO ecosystem_vertical_features (vertical_id, icon, title, description, display_order) VALUES
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'stream'), 'music_note', 'Music', 'Stream music from African artists across every genre.', 10),
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'stream'), 'movie', 'Movies & shows', 'Discover films and series made by African creators.', 20),
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'stream'), 'sensors', 'Live content', 'Watch live events, shows and creator broadcasts.', 30),
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'stream'), 'star', 'Original programming', 'Exclusive shows and content produced for the NaijaDeals audience.', 40);

-- aura
INSERT INTO ecosystem_vertical_features (vertical_id, icon, title, description, display_order) VALUES
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'aura'), 'search', 'Product discovery', 'Ask for what you need and get matched to real products in the catalog.', 10),
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'aura'), 'compare_arrows', 'Compare options', 'Compare products and sellers side by side before you decide.', 20),
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'aura'), 'sell', 'Deal discovery', 'Surface active deals and discounts relevant to what you''re looking for.', 30),
  ((SELECT id FROM ecosystem_verticals WHERE slug = 'aura'), 'explore', 'Ecosystem navigation', 'Get pointed to the right NaijaDeals vertical for what you need.', 40);

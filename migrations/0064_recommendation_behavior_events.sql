-- Phase 3A — Recommendation Engine V1: Behavior/Event Infrastructure.
--
-- Genspark's Phase 3 architecture proposal (approved by Pat with 5 locked decisions,
-- see conversation record) found via direct D1/repo inspection that NO server-side
-- product-view/search/category-view event tracking exists anywhere in this codebase
-- (search_index_events is a catalog-indexer changefeed, NOT a user-search log; the
-- only "Recently Viewed" mechanism is 100% client-side localStorage in app.js).
--
-- This migration creates the append-only behavioral event log that Phase 3's
-- rule-based candidate/ranking engine reads from, PLUS the dismissal-tracking table
-- Pat's decision #2 explicitly asked to build now (even with no dismiss UI yet).
--
-- DELIBERATELY NOT LOGGED HERE (see proposal Section 4): wishlist_add/remove,
-- cart_add/remove, purchase. Those already have live, correctly-indexed tables
-- (wishlists, cart_items, order_items) — duplicating them into behavior_events
-- would create two disagreeing sources of truth for zero signal gain. The future
-- recommendation-scoring query JOINs those tables directly instead.
--
-- idx_products_category was VERIFIED to already exist (migration 0002) before
-- writing this file — Pat's decision #3, "do not assume, verify" — so no new
-- product-side index is added here.

CREATE TABLE IF NOT EXISTS behavior_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Anonymous cookie value (nd_visitor, Pat's decision #1 — a DEDICATED behavioral
  -- identity cookie, deliberately separate from nd_guest which only scopes carts)
  -- OR 'user:<id>' once merged into an authenticated identity. Always populated;
  -- never NULL — every event has SOME visitor identity, even if user_id is NULL.
  visitor_id    TEXT NOT NULL,

  -- Populated once the event's visitor is authenticated at write time, OR
  -- retroactively by mergeVisitorBehaviorIntoUser() on login/register (an UPDATE
  -- of pre-login rows, never a duplicate INSERT — see src/lib/behavior-events.ts).
  user_id       INTEGER NULL REFERENCES users(id),

  event_type    TEXT NOT NULL CHECK (event_type IN
                  ('product_view', 'product_click', 'category_view', 'search')),

  product_id    INTEGER NULL REFERENCES products(id),
  category_id   INTEGER NULL REFERENCES categories(id),

  -- Raw search query text for 'search' events only.
  search_query  TEXT NULL,

  -- Free-form provenance, e.g. 'pdp', 'shop_grid', 'homepage_recommended' —
  -- used by future ranking/analytics to distinguish signal strength by origin.
  source        TEXT NULL,

  occurred_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_behavior_events_visitor ON behavior_events(visitor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_behavior_events_user ON behavior_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_behavior_events_type_product ON behavior_events(event_type, product_id);
CREATE INDEX IF NOT EXISTS idx_behavior_events_occurred ON behavior_events(occurred_at);

-- Pat's decision #2: build this table in V1 even though no dismiss UI exists yet —
-- cheap future-proofing, avoids a second migration later. NOT read by anything
-- until a dismiss affordance ships (Phase 3C/3D), and NOT populated by this
-- migration or by Phase 3A's instrumentation.
CREATE TABLE IF NOT EXISTS recommendation_dismissals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id    TEXT NOT NULL,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  dismissed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reco_dismissals_visitor ON recommendation_dismissals(visitor_id, product_id);

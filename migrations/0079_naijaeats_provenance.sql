-- Migration 0079: NaijaEats Provenance (source_type columns)
--
-- Adds machine-readable provenance to restaurants and menu_items, following
-- the exact precedent set by migration 0077 (NaijaFresh) on
-- products/product_listings: DEFAULT 'live' so any future real-world
-- restaurant/menu_item row is correctly classified with zero extra work,
-- while every Phase 1 seed row explicitly sets 'seed' (never relies on the
-- default — see migration 0080).
--
-- Purely additive (ALTER TABLE ... ADD COLUMN). No existing rows are
-- affected in a breaking way; restaurants/menu_items are currently empty in
-- both dev and production, so this has zero blast radius either way.
--
-- Authorized for LOCAL/DEV D1 in this phase. Not applied to production as
-- part of this work — a future, separately authorized migration will bring
-- this same additive change to production alongside (or ahead of) the
-- actual Phase 1 production seed/activation.

ALTER TABLE restaurants ADD COLUMN source_type TEXT NOT NULL DEFAULT 'live';
ALTER TABLE menu_items  ADD COLUMN source_type TEXT NOT NULL DEFAULT 'live';

CREATE INDEX IF NOT EXISTS idx_restaurants_source_type ON restaurants(source_type);
CREATE INDEX IF NOT EXISTS idx_menu_items_source_type ON menu_items(source_type);

-- NaijaDeals — Address Book Depth Migration (Phase E, Build Item 2: Saved Addresses)
--
-- Purely additive. Does NOT touch the existing `addresses` table's core columns or any
-- existing function contract in lib/addresses.ts / api-addresses.ts — it only:
--   1. Adds one nullable column (delivery_instructions) the account address manager and
--      checkout both need, per Pat's spec ("delivery instructions where supported").
--   2. Creates a small reference table of Nigerian states so the state selector on both
--      the Account address page and Checkout can be a genuine <select> populated FROM THE
--      DATABASE — never a hardcoded array baked into a .tsx file. City remains free-text
--      (Nigeria has no single canonical city/LGA list short enough to hardcode without it
--      becoming its own maintenance burden — this matches how Jumia/Amazon-style forms
--      actually work: state = dropdown, city = free text).
--
-- Relationship map:
--   addresses.delivery_instructions  -> just a plain nullable text column, no FK
--   nigerian_states                  -> standalone reference table, read-only lookup,
--                                       joined by NAME (not FK) against addresses.state
--                                       since addresses.state has always been free text
--                                       and existing seeded rows must keep working unchanged.

ALTER TABLE addresses ADD COLUMN delivery_instructions TEXT;

CREATE TABLE IF NOT EXISTS nigerian_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  is_fct INTEGER NOT NULL DEFAULT 0, -- Federal Capital Territory (Abuja) is not technically a "state" but customers expect it in this list
  sort_order INTEGER NOT NULL
);

INSERT INTO nigerian_states (name, is_fct, sort_order) VALUES
  ('Abia', 0, 1), ('Adamawa', 0, 2), ('Akwa Ibom', 0, 3), ('Anambra', 0, 4),
  ('Bauchi', 0, 5), ('Bayelsa', 0, 6), ('Benue', 0, 7), ('Borno', 0, 8),
  ('Cross River', 0, 9), ('Delta', 0, 10), ('Ebonyi', 0, 11), ('Edo', 0, 12),
  ('Ekiti', 0, 13), ('Enugu', 0, 14), ('Gombe', 0, 15), ('Imo', 0, 16),
  ('Jigawa', 0, 17), ('Kaduna', 0, 18), ('Kano', 0, 19), ('Katsina', 0, 20),
  ('Kebbi', 0, 21), ('Kogi', 0, 22), ('Kwara', 0, 23), ('Lagos', 0, 24),
  ('Nasarawa', 0, 25), ('Niger', 0, 26), ('Ogun', 0, 27), ('Ondo', 0, 28),
  ('Osun', 0, 29), ('Oyo', 0, 30), ('Plateau', 0, 31), ('Rivers', 0, 32),
  ('Sokoto', 0, 33), ('Taraba', 0, 34), ('Yobe', 0, 35), ('Zamfara', 0, 36),
  ('Abuja (FCT)', 1, 0);

-- Migration 0027: Polymorphic Reviews Foundation
--
-- RECONSTRUCTED MIGRATION (not original production source code).
--
-- Provenance: This file was generated from PRODUCTION's live D1 schema,
-- captured read-only via `gsk hosted d1_schema` against naijadeals.com's
-- hosted database (project 393ef41c-f7b9-4ded-996a-2f5265e3280d, db uuid
-- bbbd12bf-e8cd-4e14-8413-76ed8b96ed1e) on 2026-09-12. Production's own
-- git_sha (99b1664df552ce1cd707330e17207d8869f12a4e) and its ORIGINAL
-- migrations/0013-0036 source files were never recovered (see
-- docs/NAIJADEALS-PRODUCTION-RECOVERY-REPORT.md). This file reproduces
-- the FINAL OBSERVED table structure (columns, types, defaults, foreign
-- keys, indexes) for the tables production's own /api/version reports as
-- belonging to migration "0027_polymorphic_reviews_foundation.sql", as closely as a final-state
-- schema dump allows.
--
-- Table-to-migration-number attribution beyond what /api/version's own
-- filenames imply is INFERRED (semantic grouping by subject area and
-- foreign-key dependency order), not independently confirmed against a
-- migration-by-migration production history (which does not exist to
-- inspect -- D1 does not retain per-migration column-level diffs, only
-- the current CREATE TABLE state). See
-- docs/NAIJADEALS-PRODUCTION-SCHEMA-MAP.md for the full mapping rationale
-- and confidence notes per table.
--

-- DO NOT apply this migration to production. Local/dev D1 only, per the
-- explicit read-only production-safety rule for this reconstruction phase.
--
-- SCHEMA-DRIFT ALTER (found by column-level diff against production, not
-- just table-name diff): production's pre-existing "reviews" table (owned
-- by local migrations 0001/0002) was ALTERed to become polymorphic and to
-- gain a moderation workflow. This migration number is the most plausible
-- home for that ALTER because it is literally named "polymorphic reviews
-- foundation" and it is the same subject-area migration that introduces
-- review_status_events below. Exact original migration number for this
-- ALTER is UNKNOWN — SOURCE CODE REQUIRED; only the final-state columns
-- are recoverable from the schema dump, not which migration number applied
-- them. NOTE: SQLite's ALTER TABLE ADD COLUMN does not support
-- "IF NOT EXISTS" (unlike CREATE TABLE/INDEX), so idempotency for this
-- statement relies on the standard migration-runner guarantee that each
-- migration file is only ever applied once per database (via the
-- migrations tracking table), not on statement-level idempotency.

ALTER TABLE reviews ADD COLUMN reviewable_type TEXT NOT NULL DEFAULT 'product' CHECK (reviewable_type IN ('product', 'provider_profile', 'restaurant', 'stay'));
ALTER TABLE reviews ADD COLUMN reviewable_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reviews ADD COLUMN status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden'));
ALTER TABLE reviews ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));
ALTER TABLE reviews ADD COLUMN moderated_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE reviews ADD COLUMN moderated_at TEXT;

-- Production's reviews.product_id is nullable (INTEGER, no NOT NULL) since
-- polymorphic reviews (provider_profile/restaurant/stay) do not have a
-- product_id. SQLite cannot ALTER a column's NOT NULL constraint directly;
-- rebuilding the table is the standard SQLite-safe way to relax it.
CREATE TABLE IF NOT EXISTS reviews__rebuild_0027 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  author_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  has_photo INTEGER NOT NULL DEFAULT 0,
  photo_url TEXT,
  helpful_count INTEGER NOT NULL DEFAULT 0,
  is_verified_purchase INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  avatar_url TEXT,
  reviewable_type TEXT NOT NULL DEFAULT 'product' CHECK (reviewable_type IN ('product', 'provider_profile', 'restaurant', 'stay')),
  reviewable_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  moderated_by_user_id INTEGER REFERENCES users(id),
  moderated_at TEXT
);
INSERT INTO reviews__rebuild_0027 SELECT id, product_id, user_id, author_name, rating, title, comment, has_photo, photo_url, helpful_count, is_verified_purchase, created_at, avatar_url, reviewable_type, reviewable_id, status, updated_at, moderated_by_user_id, moderated_at FROM reviews;
DROP TABLE reviews;
ALTER TABLE reviews__rebuild_0027 RENAME TO reviews;

CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewable ON reviews(reviewable_type, reviewable_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_one_per_user_per_entity
  ON reviews(user_id, reviewable_type, reviewable_id)
  WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS "review_status_events" (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id      INTEGER NOT NULL REFERENCES "reviews"(id),
  status         TEXT NOT NULL,
  actor_user_id  INTEGER REFERENCES users(id),
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_review_status_events_review ON review_status_events(review_id);


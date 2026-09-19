-- Migration 0069: Country Facts — verified editorial content for /countries/:iso
--
-- Stage 2A (Africa Catalog & Country Architecture), design section 1.1.
--
-- PURPOSE: gives the country detail page (/countries/:iso) a real place to
-- store major cities, history, culture, industries, and government/
-- leadership content — none of which existed anywhere in this schema before
-- this migration (confirmed via the Stage 2 discovery audit: cc_countries
-- only carries flag/image/region/currency/short_description, no structured
-- fact rows of any kind).
--
-- DESIGN, deliberately modeled on product_country_origins (migration 0067)'s
-- proven verification-lifecycle shape — same fields, same semantics, same
-- discipline, reused rather than reinvented:
--   verification_status ('unverified' | 'verified' | 'disputed'), source_url,
--   verified_by_user_id, verified_at.
--
-- NON-NEGOTIABLE RULE (Pat's explicit Stage 2A authorization): a row may
-- NEVER be marked 'verified' without a non-empty source_url. This migration
-- does not itself enforce that (SQLite CHECK constraints cannot reference
-- other columns' NULL-ness across an UPDATE in a portable way here) — the
-- enforcement lives in application code (src/lib/country-profile.ts's
-- verifyCountryFact()), exactly mirroring how product_country_origins'
-- verification write path is application-enforced, not DB-enforced, in this
-- codebase's existing convention.
--
-- ZERO ROWS ARE INSERTED by this migration. It only creates structure —
-- identical discipline to migration 0067. No leadership, no history, no
-- city list is fabricated to make the schema "look complete." Every fact
-- row that will ever exist is created one at a time via the new Control
-- Center propose -> verify workflow, starting from zero for all 54
-- countries.
--
-- Zero destructive changes. No existing table/column touched. Purely
-- additive: one new table + supporting indexes.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS cc_country_facts (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  country_id            INTEGER NOT NULL REFERENCES cc_countries(id) ON DELETE CASCADE,

  -- fact_type groups facts into the sections the country page renders.
  -- 'government_leadership' is the most fabrication-sensitive type — per
  -- Pat's explicit Stage 2A decision, this capability ships now but with
  -- ZERO rows until each one is individually verified with a source_url.
  fact_type             TEXT NOT NULL CHECK (fact_type IN
                          ('major_city', 'history', 'culture', 'industry', 'government_leadership')),

  -- label: short identifier for the fact — a city name, a role title
  -- ('President'), an industry name ('Textile Manufacturing'), etc.
  label                 TEXT NOT NULL,

  -- value: the actual content — a person's name for leadership facts, a
  -- paragraph of prose for history/culture, a short description for
  -- industry/major_city.
  value                 TEXT NOT NULL,

  sort_order            INTEGER NOT NULL DEFAULT 0,

  -- verification_status: the honesty gate. Nothing with status != 'verified'
  -- may ever be surfaced on the public country page. 'unverified' is the
  -- correct default and may persist indefinitely — not an error state.
  verification_status   TEXT NOT NULL DEFAULT 'unverified'
                          CHECK (verification_status IN ('unverified', 'verified', 'disputed')),

  -- source_url: REQUIRED by application code before a row may transition to
  -- 'verified' (enforced in country-profile.ts, not by a DB constraint —
  -- matches this project's established convention for this exact pattern).
  source_url            TEXT,

  verified_by_user_id   INTEGER REFERENCES users(id),
  verified_at           TEXT,

  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The query every country-page render performs: all facts for one country,
-- filtered to verified-only, grouped by type, in display order.
CREATE INDEX IF NOT EXISTS idx_cc_country_facts_country_type
  ON cc_country_facts(country_id, fact_type);

-- Admin list view: "show me everything pending verification across all
-- countries" — the Control Center review queue's primary query.
CREATE INDEX IF NOT EXISTS idx_cc_country_facts_verification_status
  ON cc_country_facts(verification_status);

PRAGMA foreign_keys = ON;

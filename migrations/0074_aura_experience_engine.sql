-- Migration 0074: Aura Experience Engine — schema foundation.
--
-- CONTEXT (Pat's explicit architecture mandate, 2026-09-19): Aura AI is ONE
-- shared intelligence layer with MULTIPLE swappable visual "experiences"
-- (Aura Classic / Aura Luxe / Aura Pulse / Aura Executive). Different users
-- can be assigned different experiences and see them concurrently. This
-- migration builds the DATA MODEL for that system now, even though Phase 1
-- only ships one fully-designed experience (Aura Luxe) — so we never have
-- to rebuild the application when Classic/Pulse/Executive get their own
-- reference designs later (per explicit "do not architect Aura as a one-off
-- page" instruction).
--
-- DESIGN PRINCIPLE: this is a CONFIGURATION registry, not a duplicate AI
-- backend. aura_experiences rows describe VISUAL/UX identity only (slug,
-- display name, theme tokens, tagline, status) — there is exactly one
-- Aura intelligence layer elsewhere in the codebase (Phase 3), and every
-- experience routes through it identically. Nothing here duplicates any
-- AI/LLM logic.
--
-- RESOLUTION ORDER this schema supports (per Pat's diagram): explicit
-- per-user assignment (aura_experience_assignments) overrides a default
-- fallback (aura_experiences.is_default = 1, resolved code-side in
-- src/lib/aura-experience.ts). Account-type/segment/time/A-B-rollout rules
-- are intentionally NOT modeled as separate columns yet — Phase 4 explicitly
-- defers "account-type assignment / time-based / context-based / A/B
-- testing / rollout percentages" to when Classic/Pulse/Executive actually
-- exist and need to be distributed. Building those rules against a table
-- that (for now) has exactly one populated experience row would be
-- speculative complexity with no way to test it honestly — the assignment
-- table's shape (one row per user, one experience_id, nullable so
-- "unassigned" is representable) is deliberately the smallest schema that
-- won't need a breaking change when those rules are added: they become
-- ADDITIONAL nullable columns/tables layered on top of this, never a
-- replacement of it.

-- ---------- Experience registry ----------
CREATE TABLE IF NOT EXISTS aura_experiences (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  slug               TEXT NOT NULL UNIQUE  -- 'classic' | 'luxe' | 'pulse' | 'executive'
                       CHECK (slug IN ('classic', 'luxe', 'pulse', 'executive')),
  name               TEXT NOT NULL,        -- 'Aura Luxe'
  tagline             TEXT NOT NULL,        -- 'Ask Aura. Find it. Do it.' (shared across experiences per spec — kept per-row so a future experience CAN diverge without a schema change, not because Phase 1 intends to diverge it)
  description        TEXT NOT NULL,        -- short internal description of the intended audience/tone
  -- Theme tokens: enough for the layout to look up an experience's palette
  -- without hardcoding "if slug === 'luxe'" branches sprinkled through
  -- components. Kept as a small flat set of named tokens (not a JSON
  -- style-sheet) because Phase 1 only needs to prove the CONCEPT of
  -- swappable theming — the actual Luxe visual implementation in
  -- src/pages/aura.tsx uses Tailwind classes directly, matching the
  -- reference image pixel-for-pixel; these columns exist so Phase 4's
  -- Classic/Pulse/Executive can be told apart programmatically (e.g. by an
  -- admin list view) before they have real page templates.
  theme_primary_color   TEXT NOT NULL DEFAULT '#008753',
  theme_dark_color       TEXT NOT NULL DEFAULT '#021F13',
  theme_accent_color     TEXT NOT NULL DEFAULT '#CCA43B',
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'retired')),
  is_default         INTEGER NOT NULL DEFAULT 0,  -- exactly one row should carry 1 (enforced in app code, not a partial index, for SQLite/D1 compat)
  display_order      INTEGER NOT NULL DEFAULT 100,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_aura_experiences_status ON aura_experiences(status);

-- ---------- Per-user explicit assignment ----------
-- One row per user who has an EXPLICIT experience override. Absence of a
-- row means "fall back to the default experience" (resolved in
-- src/lib/aura-experience.ts's resolveAuraExperience(), never assumed by
-- raw SQL elsewhere). assigned_by_user_id is nullable because Phase 1's
-- only assignment path is a manual/dev-time override (Control Center admin
-- assignment UI is explicitly deferred to Phase 4) — NULL means
-- "system/seed-assigned", never a fabricated actor.
CREATE TABLE IF NOT EXISTS aura_experience_assignments (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id              INTEGER NOT NULL UNIQUE REFERENCES users(id),
  experience_id        INTEGER NOT NULL REFERENCES aura_experiences(id),
  assignment_reason    TEXT NOT NULL DEFAULT 'manual' CHECK (assignment_reason IN ('manual', 'default_fallback', 'segment', 'ab_test', 'preference')),
  assigned_by_user_id  INTEGER REFERENCES users(id),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_aura_assignments_experience ON aura_experience_assignments(experience_id);

-- ---------- Seed: the 4 named experiences from the spec ----------
-- Aura Luxe is the ONLY one with a full visual implementation in Phase 1.
-- Classic/Pulse/Executive exist as 'draft' configuration placeholders per
-- explicit "do NOT block the architecture waiting for three additional
-- reference images" instruction — they have no page template yet, and
-- attempting to route a user into one before Phase 4 builds their UI would
-- be a broken experience, not a real feature, hence 'draft' not 'active'.
INSERT OR IGNORE INTO aura_experiences (slug, name, tagline, description, theme_primary_color, theme_dark_color, theme_accent_color, status, is_default, display_order) VALUES
  ('classic',   'Aura Classic',   'Ask Aura. Find it. Do it.', 'General-purpose NaijaDeals assistant — the default fallback experience for any user with no explicit assignment.', '#008753', '#0F172A', '#059669', 'draft', 1, 10),
  ('luxe',      'Aura Luxe',      'Ask Aura. Find it. Do it.', 'African luxury concierge experience — Nigerian-inspired premium visual language (deep emerald, champagne gold, ivory). Fully implemented in Phase 1.', '#008753', '#021F13', '#CCA43B', 'active', 0, 20),
  ('pulse',     'Aura Pulse',     'Ask Aura. Find it. Do it.', 'Youthful, energetic entertainment/discovery experience. Configuration placeholder — pending its own reference design.', '#008753', '#1E1B4B', '#F59E0B', 'draft', 0, 30),
  ('executive', 'Aura Executive', 'Ask Aura. Find it. Do it.', 'Business-intelligence / professional assistant experience. Configuration placeholder — pending its own reference design.', '#008753', '#111827', '#3B82F6', 'draft', 0, 40);

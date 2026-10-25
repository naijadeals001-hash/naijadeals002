-- Control Center 2.0: persisted readiness dimensions for the authoritative vertical registry.
-- This is administrative metadata only; it does not make a capability operational.
CREATE TABLE IF NOT EXISTS cc_vertical_readiness (
  vertical_slug TEXT PRIMARY KEY,
  enablement_state TEXT NOT NULL DEFAULT 'disabled' CHECK (enablement_state IN ('enabled','disabled','restricted')),
  implementation_state TEXT NOT NULL DEFAULT 'planned' CHECK (implementation_state IN ('planned','in_progress','partial','implementation_complete')),
  automated_acceptance_state TEXT NOT NULL DEFAULT 'not_run' CHECK (automated_acceptance_state IN ('not_run','failed','partial','passed')),
  browser_acceptance_state TEXT NOT NULL DEFAULT 'not_run' CHECK (browser_acceptance_state IN ('not_run','failed','partial','passed')),
  outstanding_acceptance_json TEXT NOT NULL DEFAULT '[]',
  operations_state TEXT NOT NULL DEFAULT 'unavailable' CHECK (operations_state IN ('healthy','degraded','unavailable','not_yet_operational')),
  integration_state TEXT NOT NULL DEFAULT 'unconfigured' CHECK (integration_state IN ('configured','unconfigured','unhealthy','unverified')),
  release_state TEXT NOT NULL DEFAULT 'not_released' CHECK (release_state IN ('not_released','preview_verified','production_verified')),
  owner_role TEXT NOT NULL DEFAULT 'platform_admin',
  dependencies_json TEXT NOT NULL DEFAULT '[]',
  blockers TEXT NOT NULL DEFAULT '',
  health_detail TEXT NOT NULL DEFAULT '',
  latest_commit_sha TEXT,
  latest_remote_sha TEXT,
  last_health_check_at TEXT,
  last_status_update_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cc_vertical_readiness_states ON cc_vertical_readiness(enablement_state, implementation_state, operations_state);

CREATE TABLE IF NOT EXISTS cc_vertical_city_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vertical_slug TEXT NOT NULL REFERENCES ecosystem_verticals(slug) ON DELETE CASCADE,
  country_iso TEXT NOT NULL,
  city_name TEXT NOT NULL,
  enablement_state TEXT NOT NULL CHECK (enablement_state IN ('enabled','disabled','restricted')),
  reason TEXT,
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vertical_slug, country_iso, city_name)
);
CREATE INDEX IF NOT EXISTS idx_cc_vertical_city_lookup ON cc_vertical_city_overrides(country_iso, city_name, vertical_slug);

INSERT OR IGNORE INTO cc_vertical_readiness
  (vertical_slug, enablement_state, implementation_state, automated_acceptance_state, browser_acceptance_state, outstanding_acceptance_json, operations_state, integration_state, release_state, owner_role, dependencies_json, blockers, health_detail)
VALUES
  ('shop','enabled','partial','passed','partial','["authenticated browser checkout","provider payment success"]','degraded','unverified','preview_verified','commerce_admin','["payments","inventory"]','Authenticated checkout and external payment verification remain pending.','Preview commerce engine is available; production operational readiness is not verified.'),
  ('fresh','enabled','in_progress','not_run','not_run','["merchant preparation","substitution flow","delivery acceptance"]','not_yet_operational','unconfigured','preview_verified','operations_admin','["catalog","logistics"]','Dedicated fulfillment workflow is incomplete.','Discovery exists; operational fulfillment is not yet verified.'),
  ('eats','enabled','partial','partial','not_run','["courier fixture stabilization","authenticated customer/merchant/courier browser acceptance","notification provider"]','degraded','unverified','preview_verified','operations_admin','["restaurants","logistics","notifications"]','Courier D1 fixture and authenticated browser acceptance remain pending.','Persisted restaurant, fulfillment and courier-dispatch foundations exist in preview.'),
  ('drive','disabled','partial','passed','not_run','["authenticated browser acceptance","GPS","routing","real-time updates","payments","operator workflow"]','degraded','unconfigured','preview_verified','logistics_admin','["maps","gps","payments","notifications"]','Private ride and recovery APIs are implemented, but the vertical is not production-operational.','Preview ride lifecycle and dispatch recovery are available; external mobility integrations are not configured.'),
  ('gigs','enabled','partial','passed','partial','["milestones","messaging","revisions"]','degraded','unverified','preview_verified','services_admin','["provider_verification","payments"]','Collaboration workflow remains incomplete.','Core request-to-order workflow is verified in preview.'),
  ('stay','enabled','partial','passed','partial','["host operations","adversarial double-booking browser acceptance"]','degraded','unverified','preview_verified','booking_admin','["booking","payments"]','Host workspace and adversarial acceptance remain pending.','Guest booking and availability are verified in preview.'),
  ('send','enabled','partial','passed','not_run','["carrier capability","dispatch offers","proof of delivery","authenticated browser acceptance"]','not_yet_operational','unconfigured','preview_verified','logistics_admin','["logistics","providers","payments"]','Carrier capability and dispatch workflow remain incomplete.','Freight marketplace foundation exists; delivery operations are not yet operational.'),
  ('pay','enabled','partial','partial','not_run','["provider authorization","settlement reconciliation"]','degraded','unverified','preview_verified','finance_admin','["wallet","payment_providers"]','External provider configuration and settlement verification remain pending.','Shared wallet/payment registry and finance visibility exist in preview.'),
  ('aura','disabled','planned','not_run','not_run','["model integration","safe command execution"]','not_yet_operational','unconfigured','preview_verified','platform_admin','["ai_provider","authorization"]','No model-backed administrative command execution is connected.','Shell only; no AI action is implied.'),
  ('auto','disabled','planned','not_run','not_run','["catalog","provider workflows"]','not_yet_operational','unconfigured','not_released','vertical_manager','["marketplace","providers"]','Vertical not implemented.','Registry metadata only.'),
  ('homes','disabled','planned','not_run','not_run','["property catalog","host workflows"]','not_yet_operational','unconfigured','not_released','vertical_manager','["marketplace","booking"]','Vertical not implemented.','Registry metadata only.'),
  ('travel','disabled','planned','not_run','not_run','["travel inventory","booking integrations"]','not_yet_operational','unconfigured','not_released','vertical_manager','["booking","payments"]','Vertical not implemented.','Registry metadata only.'),
  ('events','disabled','planned','not_run','not_run','["event inventory","ticketing"]','not_yet_operational','unconfigured','not_released','vertical_manager','["booking","payments"]','Vertical not implemented.','Registry metadata only.'),
  ('learn','disabled','planned','not_run','not_run','["course catalog","progress tracking"]','not_yet_operational','unconfigured','not_released','vertical_manager','["providers","payments"]','Vertical not implemented.','Registry metadata only.'),
  ('jobs','disabled','planned','not_run','not_run','["employer workflows","applications"]','not_yet_operational','unconfigured','not_released','vertical_manager','["identity","providers"]','Vertical not implemented.','Registry metadata only.'),
  ('health','disabled','planned','not_run','not_run','["provider verification","appointment workflows","regulatory review"]','not_yet_operational','unconfigured','not_released','vertical_manager','["trust","booking"]','Vertical not implemented.','Registry metadata only.'),
  ('farm','disabled','planned','not_run','not_run','["producer catalog","bulk logistics"]','not_yet_operational','unconfigured','not_released','vertical_manager','["marketplace","logistics"]','Vertical not implemented.','Registry metadata only.'),
  ('stream','disabled','planned','not_run','not_run','["content catalog","creator workflows","playback"]','not_yet_operational','unconfigured','not_released','vertical_manager','["media","payments"]','Vertical not implemented.','Registry metadata only.'),
  ('home','disabled','planned','not_run','not_run','["service catalog","provider workflows"]','not_yet_operational','unconfigured','not_released','vertical_manager','["services","providers"]','Vertical not implemented.','Registry metadata only.'),
  ('beauty','disabled','planned','not_run','not_run','["product catalog","appointments"]','not_yet_operational','unconfigured','not_released','vertical_manager','["marketplace","booking"]','Vertical not implemented.','Registry metadata only.');

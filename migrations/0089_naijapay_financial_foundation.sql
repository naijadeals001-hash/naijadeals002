-- NaijaPay Batch 1: shared financial foundation.
-- Additive only. Existing wallet_ledger remains the source for the legacy
-- consumer wallet while new payment intents and journal tables provide the
-- shared contract for every NaijaDeals vertical.

CREATE TABLE IF NOT EXISTS payment_intents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_reference TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  vertical_key TEXT NOT NULL,
  order_reference TEXT,
  country_iso TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','pending','authorized','succeeded','failed','reversed','refunded','disputed','cancelled')),
  funding_method TEXT NOT NULL CHECK (funding_method IN ('wallet','paystack','bank_transfer','provider_balance','other')),
  merchant_reference TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_payment_intents_user_created ON payment_intents(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_intents_status ON payment_intents(status, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_intents_vertical ON payment_intents(vertical_key, created_at);

CREATE TABLE IF NOT EXISTS payment_intent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_intent_id INTEGER NOT NULL REFERENCES payment_intents(id),
  event_type TEXT NOT NULL,
  provider TEXT,
  provider_reference TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(payment_intent_id, event_type, provider_reference)
);
CREATE INDEX IF NOT EXISTS idx_payment_intent_events_provider_ref ON payment_intent_events(provider, provider_reference);

-- One immutable journal entry has at least one debit and one credit line. The
-- application posts balanced entries atomically; triggers prevent history edits.
CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_reference TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed')),
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id),
  account_code TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_code, currency, created_at);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(journal_entry_id);

CREATE TRIGGER IF NOT EXISTS trg_journal_entries_no_update
BEFORE UPDATE ON journal_entries BEGIN SELECT RAISE(ABORT, 'journal entries are immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_journal_entries_no_delete
BEFORE DELETE ON journal_entries BEGIN SELECT RAISE(ABORT, 'journal entries are immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_journal_lines_no_update
BEFORE UPDATE ON journal_lines BEGIN SELECT RAISE(ABORT, 'journal lines are immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_journal_lines_no_delete
BEFORE DELETE ON journal_lines BEGIN SELECT RAISE(ABORT, 'journal lines are immutable'); END;

ALTER TABLE payment_transactions ADD COLUMN currency TEXT NOT NULL DEFAULT 'NGN';
ALTER TABLE payment_transactions ADD COLUMN idempotency_key TEXT;
ALTER TABLE payment_transactions ADD COLUMN transaction_reference TEXT;
ALTER TABLE payment_transactions ADD COLUMN intent_id INTEGER REFERENCES payment_intents(id);
ALTER TABLE payment_transactions ADD COLUMN updated_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_tx_transaction_reference ON payment_transactions(transaction_reference) WHERE transaction_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_tx_user_idempotency ON payment_transactions(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_tx_intent ON payment_transactions(intent_id);

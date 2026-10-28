-- Lakebase operational schema for dispatch. Owned by the deployer; the app's service principal gets DML only.
-- REPLICA IDENTITY FULL lets Lakehouse Sync stream every change back to Unity Catalog (lb_*_history tables).
CREATE SCHEMA IF NOT EXISTS ops;
CREATE SEQUENCE IF NOT EXISTS ops.wo_seq START 1001;

CREATE TABLE IF NOT EXISTS ops.work_orders (
  wo_id                TEXT PRIMARY KEY DEFAULT ('WO-' || nextval('ops.wo_seq')),
  pump_id              TEXT NOT NULL,
  fleet_id             TEXT NOT NULL,
  failure_mode         TEXT,
  best_action          TEXT,
  expected_savings_usd NUMERIC,
  tech_id              TEXT,
  window_start         TIMESTAMP,
  window_end           TIMESTAMP,
  status               TEXT NOT NULL DEFAULT 'scheduled',
  ai_draft             TEXT,
  procedure_id         TEXT,
  model_version        TEXT,
  trace_id             TEXT,
  created_by           TEXT,
  created_at           TIMESTAMP NOT NULL DEFAULT now(),
  updated_at           TIMESTAMP NOT NULL DEFAULT now(),
  completed_at         TIMESTAMP,
  finding_confirmed    BOOLEAN,   -- realized outcome: did the teardown confirm the predicted mode?
  failure_avoided      BOOLEAN,   -- realized outcome: would it have failed before the next planned change?
  is_synthetic_seed    BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS ops.wo_events (
  event_id   BIGSERIAL PRIMARY KEY,
  wo_id      TEXT NOT NULL,
  status     TEXT NOT NULL,
  changed_by TEXT,
  changed_at TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE ops.work_orders REPLICA IDENTITY FULL;
ALTER TABLE ops.wo_events REPLICA IDENTITY FULL;

-- Synthetic work-order history (flagged is_synthetic_seed) so the timeline and Genie have context on day one.
-- Timestamps are relative to the demo clock, 2026-10-28 12:00 (NOW in src/data_gen/generate_data.py).
-- Run after Lakehouse Sync is streaming, so these inserts land in UC too. Idempotent.
INSERT INTO ops.work_orders (pump_id, fleet_id, failure_mode, best_action, expected_savings_usd, tech_id,
                             window_start, window_end, status, created_by, created_at, completed_at,
                             finding_confirmed, failure_avoided, is_synthetic_seed, model_version)
SELECT s.pump_id, s.fleet_id, s.mode, s.act, s.usd, s.tech,
       ts.t + make_interval(hours => s.h), ts.t + make_interval(hours => s.h + 2), s.status, 'seed',
       ts.t + make_interval(hours => s.h - 1),
       CASE WHEN s.status = 'done' THEN ts.t + make_interval(hours => s.h + 2) END,
       s.confirmed, s.avoided, true, 'seed'
FROM (VALUES
  ('F02-P11', 'F02', 'valve_seat_washout', 'swap_at_next_gap', 24800, 'T005', -150, 'done', true, true),
  ('F05-P03', 'F05', 'power_end_bearing',  'pull_now',         47100, 'T018', -118, 'done', true, true),
  ('F09-P16', 'F09', 'packing_failure',    'swap_at_next_gap',  9800, 'T034',  -96, 'done', true, true),
  ('F12-P07', 'F12', 'valve_seat_washout', 'swap_at_next_gap', 22950, 'T046',  -70, 'done', false, false),
  ('F03-P19', 'F03', 'valve_seat_washout', 'swap_at_next_gap', 25300, 'T010',  -40, 'done', true, true),
  ('F11-P12', 'F11', 'power_end_bearing',  'pull_now',         45200, 'T042',  -20, 'in_progress', NULL, NULL)
) AS s(pump_id, fleet_id, mode, act, usd, tech, h, status, confirmed, avoided)
CROSS JOIN (SELECT TIMESTAMP '2026-10-28 12:00:00' AS t) ts
WHERE NOT EXISTS (SELECT 1 FROM ops.work_orders WHERE is_synthetic_seed);

INSERT INTO ops.wo_events (wo_id, status, changed_by, changed_at)
SELECT wo_id, status, 'seed', created_at FROM ops.work_orders
WHERE is_synthetic_seed AND NOT EXISTS (SELECT 1 FROM ops.wo_events WHERE changed_by = 'seed');

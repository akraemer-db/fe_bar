-- Synthetic work-order history and upcoming dispatches (flagged is_synthetic_seed), so the timeline,
-- performance charts, and Genie have context on day one. Timestamps are relative to the demo clock,
-- 2026-10-28 12:00 (NOW in src/data_gen/generate_data.py). Re-running replaces the seed; demo-created rows
-- (is_synthetic_seed = false) are untouched. Expected $ values sit inside each mode's value-model range.
DELETE FROM ops.wo_events WHERE changed_by = 'seed';
DELETE FROM ops.work_orders WHERE is_synthetic_seed;

INSERT INTO ops.work_orders (pump_id, fleet_id, failure_mode, best_action, expected_savings_usd, tech_id,
                             window_start, window_end, status, created_by, created_at, completed_at,
                             finding_confirmed, failure_avoided, is_synthetic_seed, model_version)
SELECT s.pump_id, s.fleet_id, s.mode, s.act, s.usd, s.tech,
       ts.t + make_interval(hours => s.h), ts.t + make_interval(hours => s.h + s.dur), s.status, 'seed',
       -- past jobs were created 2 hrs before their window; upcoming ones were booked over the last ~2.5 days
       CASE WHEN s.h > 0 THEN ts.t - make_interval(hours => 2 + (s.h * 7) % 60) ELSE ts.t + make_interval(hours => s.h - 2) END,
       CASE WHEN s.status = 'done' THEN ts.t + make_interval(hours => s.h + s.dur) END,
       s.confirmed, s.avoided, true, 'seed'
FROM (VALUES
  ('F07-P15', 'F07', 'packing_failure', 'swap_at_next_gap', 12000, 'T025', -679, 2, 'done', true, true),
  ('F09-P06', 'F09', 'power_end_bearing', 'pull_now', 41500, 'T034', -640, 2, 'done', true, true),
  ('F15-P01', 'F15', 'valve_seat_washout', 'swap_at_next_gap', 25000, 'T057', -636, 2, 'done', true, true),
  ('F13-P15', 'F13', 'valve_seat_washout', 'swap_at_next_gap', 30900, 'T050', -603, 2, 'done', true, true),
  ('F07-P16', 'F07', 'packing_failure', 'swap_at_next_gap', 18750, 'T025', -597, 2, 'done', true, true),
  ('F10-P06', 'F10', 'valve_seat_washout', 'swap_at_next_gap', 23850, 'T038', -554, 2, 'done', true, true),
  ('F03-P18', 'F03', 'valve_seat_washout', 'swap_at_next_gap', 26500, 'T010', -506, 2, 'done', true, true),
  ('F10-P07', 'F10', 'packing_failure', 'swap_at_next_gap', 14900, 'T039', -436, 2, 'done', true, true),
  ('F07-P04', 'F07', 'valve_seat_washout', 'swap_at_next_gap', 29000, 'T025', -370, 2, 'done', true, true),
  ('F14-P20', 'F14', 'valve_seat_washout', 'swap_at_next_gap', 22400, 'T054', -348, 2, 'done', true, false),
  ('F09-P03', 'F09', 'packing_failure', 'swap_at_next_gap', 16050, 'T034', -314, 2, 'done', true, true),
  ('F11-P10', 'F11', 'valve_seat_washout', 'swap_at_next_gap', 28450, 'T041', -230, 2, 'done', true, true),
  ('F05-P01', 'F05', 'packing_failure', 'swap_at_next_gap', 16400, 'T019', -179, 2, 'done', true, true),
  ('F07-P13', 'F07', 'valve_seat_washout', 'swap_at_next_gap', 25350, 'T026', -164, 2, 'done', false, false),
  ('F08-P19', 'F08', 'valve_seat_washout', 'swap_at_next_gap', 24900, 'T030', -160, 2, 'done', true, false),
  ('F10-P08', 'F10', 'valve_seat_washout', 'swap_at_next_gap', 24700, 'T039', -106, 2, 'done', true, true),
  ('F04-P08', 'F04', 'packing_failure', 'swap_at_next_gap', 19850, 'T015', -94, 2, 'done', true, true),
  ('F05-P08', 'F05', 'packing_failure', 'swap_at_next_gap', 18000, 'T019', -69, 2, 'done', true, true),
  ('F13-P04', 'F13', 'valve_seat_washout', 'swap_at_next_gap', 30800, 'T051', -60, 2, 'done', true, true),
  ('F01-P07', 'F01', 'valve_seat_washout', 'swap_at_next_gap', 31650, 'T001', -47, 2, 'done', true, true),
  ('F04-P16', 'F04', 'packing_failure', 'swap_at_next_gap', 9850, 'T015', -3, 4, 'in_progress', NULL, NULL),
  ('F04-P07', 'F04', 'packing_failure', 'swap_at_next_gap', 9750, 'T016', -1, 4, 'in_progress', NULL, NULL),
  ('F04-P02', 'F04', 'valve_seat_washout', 'swap_at_next_gap', 23600, 'T014', 2, 2, 'dispatched', NULL, NULL),
  ('F09-P19', 'F09', 'power_end_bearing', 'pull_now', 42700, 'T035', 4, 2, 'dispatched', NULL, NULL),
  ('F03-P15', 'F03', 'power_end_bearing', 'pull_now', 71600, 'T010', 6, 2, 'dispatched', NULL, NULL),
  ('F10-P02', 'F10', 'power_end_bearing', 'pull_now', 62300, 'T039', 9, 2, 'dispatched', NULL, NULL),
  ('F12-P10', 'F12', 'power_end_bearing', 'pull_now', 39050, 'T045', 13, 2, 'scheduled', NULL, NULL),
  ('F08-P03', 'F08', 'packing_failure', 'swap_at_next_gap', 16150, 'T030', 18, 2, 'scheduled', NULL, NULL),
  ('F02-P03', 'F02', 'valve_seat_washout', 'swap_at_next_gap', 24700, 'T005', 22, 2, 'scheduled', NULL, NULL),
  ('F15-P05', 'F15', 'packing_failure', 'swap_at_next_gap', 16700, 'T059', 27, 2, 'scheduled', NULL, NULL),
  ('F02-P16', 'F02', 'power_end_bearing', 'pull_now', 59350, 'T005', 31, 2, 'scheduled', NULL, NULL),
  ('F14-P16', 'F14', 'packing_failure', 'swap_at_next_gap', 17750, 'T056', 36, 2, 'scheduled', NULL, NULL),
  ('F10-P01', 'F10', 'packing_failure', 'swap_at_next_gap', 10050, 'T037', 41, 2, 'scheduled', NULL, NULL),
  ('F11-P04', 'F11', 'power_end_bearing', 'pull_now', 59300, 'T043', 45, 2, 'scheduled', NULL, NULL)
) AS s(pump_id, fleet_id, mode, act, usd, tech, h, dur, status, confirmed, avoided)
CROSS JOIN (SELECT TIMESTAMP '2026-10-28 12:00:00' AS t) ts;

-- status history: created as scheduled, then each later status
INSERT INTO ops.wo_events (wo_id, status, changed_by, changed_at)
SELECT wo_id, 'scheduled', 'seed', created_at FROM ops.work_orders WHERE is_synthetic_seed
UNION ALL
SELECT wo_id, status, 'seed', COALESCE(completed_at, window_start) FROM ops.work_orders
WHERE is_synthetic_seed AND status <> 'scheduled';

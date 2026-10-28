// API contract types. Mirrors the JSON shapes served by the FastAPI backend.

export type FailureMode = "valve_seat_washout" | "packing_failure" | "power_end_bearing";
export type BestAction = "keep_running" | "swap_at_next_gap" | "pull_now";
export type WorkOrderStatus = "scheduled" | "dispatched" | "in_progress" | "done";

export interface Health {
  status: string;
  model_name: string;
  model_version: string;
}

export interface Summary {
  pumps_at_risk: number;
  expected_usd_at_stake: number;
  protected_this_week_usd: number;
  model_version: string;
  as_of: string;
}

export interface Action {
  rank: number;
  pump_id: string;
  fleet_id: string;
  failure_mode: FailureMode;
  risk: number;
  best_action: BestAction;
  expected_savings_usd: number;
  cost_if_failed_usd: number;
  planned_fix_usd: number;
  // Option values are negative expected dollars (i.e. the negated expected cost).
  option_keep_running_usd: number;
  option_pull_now_usd: number;
  option_swap_at_gap_usd: number | null;
  standby_available: boolean;
  owner: string;
  top_drivers: string[];
  model_version: string;
  next_gap_start: string | null;
  next_gap_end: string | null;
  next_gap_after_stage: number | null;
  has_open_work_order: boolean;
}

export interface TrendSignal {
  key: string;
  label: string;
  fleet_median: number;
}

export interface TrendPoint {
  event_ts: string;
  [signal: string]: string | number;
}

export interface Trend {
  pump_id: string;
  failure_mode: FailureMode;
  signals: TrendSignal[];
  points: TrendPoint[];
}

export interface Rescore {
  pump_id: string;
  risk: number;
  top_mode: FailureMode;
  probabilities: Record<string, number>;
  model_version: string;
  endpoint: string;
  latency_ms: number;
}

export interface Technician {
  tech_id: string;
  name: string;
  home_fleet_id: string;
  skill: string;
  shift: string;
  busy_until: string | null;
}

export interface PartLine {
  part_no: string;
  description: string;
  cost_usd: number;
}

export interface WorkOrderDraft {
  pump_id: string;
  failure_mode: FailureMode;
  procedure_id: string;
  draft_markdown: string;
  parts: PartLine[];
  trace_id: string;
  model: string;
}

export interface WorkOrderCreate {
  pump_id: string;
  fleet_id: string;
  failure_mode: FailureMode;
  best_action: BestAction;
  expected_savings_usd: number;
  tech_id: string;
  window_start: string;
  window_end: string;
  ai_draft: string;
  procedure_id: string;
  model_version: string;
}

export interface WorkOrder {
  wo_id: string;
  pump_id: string;
  fleet_id: string;
  failure_mode: FailureMode;
  best_action: BestAction;
  expected_savings_usd: number;
  tech_id: string;
  tech_name?: string;
  window_start: string;
  window_end: string;
  status: WorkOrderStatus;
  created_at: string;
  ai_draft?: string;
  procedure_id?: string;
  model_version?: string;
}

export interface TimelineTechnician {
  tech_id: string;
  name: string;
  home_fleet_id: string;
  skill: string;
  shift: string;
}

export interface TimelineBlock {
  wo_id: string;
  tech_id: string;
  pump_id: string;
  failure_mode: FailureMode;
  start: string;
  end: string;
  status: WorkOrderStatus;
}

export interface StageGap {
  fleet_id: string;
  gap_start: string;
  gap_end: string;
  after_stage: number;
}

export interface Timeline {
  now: string;
  technicians: TimelineTechnician[];
  blocks: TimelineBlock[];
  stage_gaps: StageGap[];
}

export interface GenieResponse {
  conversation_id: string;
  answer_text: string;
  sql: string;
  columns: string[];
  rows: unknown[][];
}

// GET /api/performance (see performance.sample.json for a live example)
export interface PerfWeek {
  week_start: string;
  pump_caused_npt_hrs: number;
  unplanned_failures: number;
  pump_hours: number;
}

export interface PerfModeCost {
  failure_mode: FailureMode;
  failures_12m: number;
  cost_if_failed_usd: number;
  planned_fix_usd: number;
  annual_cost_usd: number;
  mtbf_pumping_hrs: number;
}

export interface PerfLever {
  scenario: "conservative" | "target";
  lever: string;
  annual_usd: number;
  proven_in: string; // "" on the Program total row
}

export interface PerfModelStats {
  recall: number;
  precision: number;
  false_alarms_per_pump_month: number;
  median_lead_hrs: number;
  net_usd_annualized: number;
  events: number;
  caught: number;
  false_alarms: number;
  threshold: number;
}

export interface PerfModeRecall {
  failure_mode: FailureMode;
  recall: number;
  n: number;
}

export interface PerfFleet {
  fleet_id: string;
  npt_hrs_90d: number;
  failures_90d: number;
  expected_usd_at_stake: number;
  protected_30d_usd: number;
}

export interface PerfDay {
  day: string;
  work_orders: number;
  expected_usd: number;
  cumulative_usd: number;
}

export interface PerfStatus {
  status: WorkOrderStatus;
  n: number;
  expected_usd: number;
}

export interface Performance {
  as_of: string;
  weekly: PerfWeek[];
  by_mode_cost: PerfModeCost[];
  levers: PerfLever[];
  model: { lightgbm_calibrated: PerfModelStats; calendar_baseline: PerfModelStats };
  model_recall_by_mode: PerfModeRecall[];
  fleet: PerfFleet[];
  protected_daily: PerfDay[];
  work_order_status: PerfStatus[];
  outcomes: { completed: number; confirmed: number; avoided: number };
  note: string;
}

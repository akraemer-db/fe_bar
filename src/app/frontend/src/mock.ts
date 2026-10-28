// Mock backend for `npm run dev:mock` (VITE_MOCK=1). Mirrors the API contract in types.ts.
// Keeps an in-memory work order store so dispatch and status changes show up in the UI.
import { parseLocal, toIsoLocal } from "./format";
import performanceSample from "./performance.sample.json";
import type {
  Action,
  FailureMode,
  GenieResponse,
  Health,
  Rescore,
  StageGap,
  Summary,
  Technician,
  Timeline,
  Trend,
  TrendPoint,
  WorkOrder,
  WorkOrderCreate,
  WorkOrderDraft,
  WorkOrderStatus,
} from "./types";

const AS_OF = "2026-10-28T11:00:00";
const NOW = "2026-10-28T12:00:00";
const MODEL_VERSION = "1";
const MODEL_NAME = "production_forecasting_catalog.frac_pump_pdm.frac_pump_failure_model";
const HOUR_MS = 3_600_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Scripted ranked actions. Option values are negative expected dollars.
// Expected $ protected = best option minus keep running.
// ---------------------------------------------------------------------------
type BaseAction = Omit<Action, "has_open_work_order">;

const BASE_ACTIONS: BaseAction[] = [
  {
    rank: 1,
    pump_id: "F07-P09",
    fleet_id: "F07",
    failure_mode: "power_end_bearing",
    risk: 0.72,
    best_action: "pull_now",
    expected_savings_usd: 48676,
    cost_if_failed_usd: 85292,
    planned_fix_usd: 10000,
    option_keep_running_usd: -61410,
    option_pull_now_usd: -12734,
    option_swap_at_gap_usd: -13838,
    standby_available: true,
    owner: "Shop (swap to standby)",
    top_drivers: [
      "crank LF vibration +64% vs fleet",
      "lube oil temp +7.1 F vs fleet",
      "lube oil pressure -5.9 psi vs fleet",
    ],
    model_version: MODEL_VERSION,
    next_gap_start: "2026-10-28T14:20:00",
    next_gap_end: "2026-10-28T15:05:00",
    next_gap_after_stage: 2,
  },
  {
    rank: 2,
    pump_id: "F07-P14",
    fleet_id: "F07",
    failure_mode: "valve_seat_washout",
    risk: 0.86,
    best_action: "swap_at_next_gap",
    expected_savings_usd: 26087,
    cost_if_failed_usd: 38557,
    planned_fix_usd: 5000,
    option_keep_running_usd: -33159,
    option_pull_now_usd: -7734,
    option_swap_at_gap_usd: -7072,
    standby_available: true,
    owner: "Field crew (swap at next gap)",
    top_drivers: [
      "cylinder 3 flagged",
      "worst-cylinder valve impact 2.3x fleet normal",
      "discharge pulsation +29% vs fleet",
      "cylinder imbalance 2.2x fleet normal",
    ],
    model_version: MODEL_VERSION,
    next_gap_start: "2026-10-28T16:10:00",
    next_gap_end: "2026-10-28T16:55:00",
    next_gap_after_stage: 3,
  },
  {
    rank: 3,
    pump_id: "F03-P02",
    fleet_id: "F03",
    failure_mode: "packing_failure",
    risk: 0.55,
    best_action: "swap_at_next_gap",
    expected_savings_usd: 10739,
    cost_if_failed_usd: 24000,
    planned_fix_usd: 3000,
    option_keep_running_usd: -13200,
    option_pull_now_usd: -4200,
    option_swap_at_gap_usd: -2461,
    standby_available: true,
    owner: "Fleet ops (next gap)",
    top_drivers: [
      "packing temp +9 F vs fleet",
      "packing leak rate 2.4x fleet normal",
      "plunger load trending up over 36 hrs",
    ],
    model_version: MODEL_VERSION,
    next_gap_start: "2026-10-28T13:10:00",
    next_gap_end: "2026-10-28T13:40:00",
    next_gap_after_stage: 1,
  },
  {
    rank: 4,
    pump_id: "F05-P11",
    fleet_id: "F05",
    failure_mode: "valve_seat_washout",
    risk: 0.41,
    best_action: "pull_now",
    expected_savings_usd: 10100,
    cost_if_failed_usd: 52000,
    planned_fix_usd: 9000,
    option_keep_running_usd: -21320,
    option_pull_now_usd: -11220,
    option_swap_at_gap_usd: null,
    standby_available: true,
    owner: "Shop (swap to standby)",
    top_drivers: ["cylinder 1 valve impact 1.3x fleet normal", "discharge pulsation +4% vs fleet"],
    model_version: MODEL_VERSION,
    next_gap_start: "2026-10-28T17:00:00",
    next_gap_end: "2026-10-28T17:50:00",
    next_gap_after_stage: 2,
  },
  {
    rank: 5,
    pump_id: "F11-P04",
    fleet_id: "F11",
    failure_mode: "packing_failure",
    risk: 0.31,
    best_action: "swap_at_next_gap",
    expected_savings_usd: 3150,
    cost_if_failed_usd: 12000,
    planned_fix_usd: 2500,
    option_keep_running_usd: -3720,
    option_pull_now_usd: -2100,
    option_swap_at_gap_usd: -570,
    standby_available: true,
    owner: "Fleet ops (next gap)",
    top_drivers: ["discharge pressure ripple +6% vs fleet"],
    model_version: MODEL_VERSION,
    next_gap_start: "2026-10-28T16:00:00",
    next_gap_end: "2026-10-28T16:40:00",
    next_gap_after_stage: 2,
  },
  {
    rank: 6,
    pump_id: "F09-P05",
    fleet_id: "F09",
    failure_mode: "packing_failure",
    risk: 0.22,
    best_action: "swap_at_next_gap",
    expected_savings_usd: 1820,
    cost_if_failed_usd: 9000,
    planned_fix_usd: 1500,
    option_keep_running_usd: -1980,
    option_pull_now_usd: -900,
    option_swap_at_gap_usd: -160,
    standby_available: true,
    owner: "Fleet ops (next gap)",
    top_drivers: ["packing temp +3 F vs fleet"],
    model_version: MODEL_VERSION,
    next_gap_start: "2026-10-28T18:30:00",
    next_gap_end: "2026-10-28T19:10:00",
    next_gap_after_stage: 1,
  },
  {
    rank: 7,
    pump_id: "F14-P01",
    fleet_id: "F14",
    failure_mode: "power_end_bearing",
    risk: 0.19,
    best_action: "keep_running",
    expected_savings_usd: 0,
    cost_if_failed_usd: 60000,
    planned_fix_usd: 8000,
    option_keep_running_usd: -11400,
    option_pull_now_usd: -14000,
    option_swap_at_gap_usd: null,
    standby_available: false,
    owner: "Field ops (monitor)",
    top_drivers: ["crank LF vibration +12% vs fleet"],
    model_version: MODEL_VERSION,
    next_gap_start: "2026-10-28T15:30:00",
    next_gap_end: "2026-10-28T16:05:00",
    next_gap_after_stage: 2,
  },
];

const TECHS: Technician[] = [
  { tech_id: "T025", name: "R. Gomez", home_fleet_id: "F07", skill: "fluid end", shift: "day", busy_until: null },
  { tech_id: "T031", name: "J. Ortiz", home_fleet_id: "F07", skill: "power end", shift: "night", busy_until: "2026-10-28T16:30:00" },
  { tech_id: "T018", name: "M. Patel", home_fleet_id: "F03", skill: "valve/seat", shift: "day", busy_until: null },
  { tech_id: "T022", name: "D. Chen", home_fleet_id: "F05", skill: "packing", shift: "day", busy_until: null },
  { tech_id: "T012", name: "L. Ruiz", home_fleet_id: "F09", skill: "fluid end", shift: "night", busy_until: null },
  { tech_id: "T040", name: "S. Brooks", home_fleet_id: "F11", skill: "power end", shift: "swing", busy_until: null },
  { tech_id: "T047", name: "K. Nakamura", home_fleet_id: "F14", skill: "valve/seat", shift: "day", busy_until: "2026-10-28T13:45:00" },
];

const GAPS: StageGap[] = [
  { fleet_id: "F03", gap_start: "2026-10-28T13:10:00", gap_end: "2026-10-28T13:40:00", after_stage: 1 },
  { fleet_id: "F05", gap_start: "2026-10-28T17:00:00", gap_end: "2026-10-28T17:50:00", after_stage: 2 },
  { fleet_id: "F07", gap_start: "2026-10-28T14:20:00", gap_end: "2026-10-28T15:05:00", after_stage: 2 },
  { fleet_id: "F07", gap_start: "2026-10-28T16:10:00", gap_end: "2026-10-28T16:55:00", after_stage: 3 },
  { fleet_id: "F09", gap_start: "2026-10-28T18:30:00", gap_end: "2026-10-28T19:10:00", after_stage: 1 },
  { fleet_id: "F11", gap_start: "2026-10-28T16:00:00", gap_end: "2026-10-28T16:40:00", after_stage: 2 },
  { fleet_id: "F14", gap_start: "2026-10-28T15:30:00", gap_end: "2026-10-28T16:05:00", after_stage: 2 },
  { fleet_id: "F03", gap_start: "2026-10-29T09:20:00", gap_end: "2026-10-29T09:55:00", after_stage: 3 },
  { fleet_id: "F07", gap_start: "2026-10-29T06:30:00", gap_end: "2026-10-29T07:10:00", after_stage: 1 },
];

let workOrders: WorkOrder[] = [
  {
    wo_id: "WO-1193",
    pump_id: "F05-P06",
    fleet_id: "F05",
    failure_mode: "valve_seat_washout",
    best_action: "pull_now",
    expected_savings_usd: 21400,
    tech_id: "T022",
    window_start: "2026-10-27T05:30:00",
    window_end: "2026-10-27T06:15:00",
    status: "done",
    created_at: "2026-10-27T05:10:00",
    procedure_id: "PROC-VS-220",
    model_version: MODEL_VERSION,
  },
  {
    wo_id: "WO-1195",
    pump_id: "F09-P05",
    fleet_id: "F09",
    failure_mode: "packing_failure",
    best_action: "swap_at_next_gap",
    expected_savings_usd: 1820,
    tech_id: "T012",
    window_start: "2026-10-28T12:00:00",
    window_end: "2026-10-28T13:10:00",
    status: "in_progress",
    created_at: "2026-10-28T09:40:00",
    procedure_id: "PROC-PK-115",
    model_version: MODEL_VERSION,
  },
  {
    wo_id: "WO-1196",
    pump_id: "F11-P04",
    fleet_id: "F11",
    failure_mode: "packing_failure",
    best_action: "swap_at_next_gap",
    expected_savings_usd: 3150,
    tech_id: "T040",
    window_start: "2026-10-28T16:00:00",
    window_end: "2026-10-28T16:40:00",
    status: "scheduled",
    created_at: "2026-10-28T08:15:00",
    procedure_id: "PROC-PK-115",
    model_version: MODEL_VERSION,
  },
  {
    wo_id: "WO-1188",
    pump_id: "F07-P03",
    fleet_id: "F07",
    failure_mode: "packing_failure",
    best_action: "swap_at_next_gap",
    expected_savings_usd: 9200,
    tech_id: "T031",
    window_start: "2026-10-28T09:00:00",
    window_end: "2026-10-28T09:45:00",
    status: "done",
    created_at: "2026-10-20T14:05:00",
    procedure_id: "PROC-PK-115",
    model_version: MODEL_VERSION,
  },
  {
    wo_id: "WO-1190",
    pump_id: "F03-P07",
    fleet_id: "F03",
    failure_mode: "valve_seat_washout",
    best_action: "swap_at_next_gap",
    expected_savings_usd: 4300,
    tech_id: "T018",
    window_start: "2026-10-28T13:10:00",
    window_end: "2026-10-28T13:40:00",
    status: "scheduled",
    created_at: "2026-10-20T16:30:00",
    procedure_id: "PROC-VS-220",
    model_version: MODEL_VERSION,
  },
];
let nextWoNumber = 1201;

const techName = (id: string) => TECHS.find((t) => t.tech_id === id)?.name;

function buildActions(): Action[] {
  return BASE_ACTIONS.map((a) => ({
    ...a,
    has_open_work_order: workOrders.some((w) => w.pump_id === a.pump_id && w.status !== "done"),
  }));
}

function buildSummary(): Summary {
  const weekAgo = parseLocal(AS_OF).getTime() - 7 * 24 * HOUR_MS;
  const actions = buildActions();
  return {
    pumps_at_risk: actions.length,
    expected_usd_at_stake: actions
      .filter((a) => !a.has_open_work_order)
      .reduce((sum, a) => sum + a.expected_savings_usd, 0),
    protected_this_week_usd: workOrders
      .filter((w) => parseLocal(w.created_at).getTime() >= weekAgo)
      .reduce((sum, w) => sum + w.expected_savings_usd, 0),
    model_version: MODEL_VERSION,
    as_of: AS_OF,
  };
}

// ---------------------------------------------------------------------------
// Trend signals. Hero pumps ramp up over the last ~40 hourly points.
// ---------------------------------------------------------------------------
interface SignalDef {
  key: string;
  label: string;
  median: number;
  peak: number; // absolute change at full ramp (hero pumps only)
  noise: number;
}

const SIGNALS: Record<FailureMode, SignalDef[]> = {
  power_end_bearing: [
    { key: "pe_vib_lf_ips", label: "Crank LF vibration (ips)", median: 0.25, peak: 0.16, noise: 0.006 },
    { key: "lube_oil_temp_f", label: "Lube oil temp (F)", median: 150, peak: 7.1, noise: 0.4 },
    { key: "lube_oil_psi", label: "Lube oil pressure (psi)", median: 60, peak: -5.9, noise: 0.3 },
  ],
  valve_seat_washout: [
    { key: "cyl_valve_impact", label: "Worst-cylinder valve impact (x fleet)", median: 1.0, peak: 1.3, noise: 0.02 },
    { key: "discharge_pulsation_psi", label: "Discharge pulsation (psi)", median: 210, peak: 61, noise: 3 },
    { key: "cyl_imbalance", label: "Cylinder imbalance (x fleet)", median: 1.0, peak: 1.2, noise: 0.02 },
  ],
  packing_failure: [
    { key: "packing_temp_f", label: "Packing temp (F)", median: 118, peak: 9, noise: 0.5 },
    { key: "packing_leak_gpm", label: "Packing leak rate (gpm)", median: 0.02, peak: 0.05, noise: 0.002 },
  ],
};

const HERO_RAMP_PEAK: Record<string, Partial<Record<string, number>>> = {
  "F07-P09": { pe_vib_lf_ips: 0.16, lube_oil_temp_f: 7.1, lube_oil_psi: -5.9 },
  "F07-P14": { cyl_valve_impact: 1.3, discharge_pulsation_psi: 61, cyl_imbalance: 1.2 },
  "F03-P02": { packing_temp_f: 9, packing_leak_gpm: 0.05 },
};

function rampAt(i: number): number {
  if (i <= 7) return 0;
  return Math.min(1, (i - 7) / 40) ** 1.6;
}

function modeOf(pumpId: string): FailureMode {
  return BASE_ACTIONS.find((a) => a.pump_id === pumpId)?.failure_mode ?? "power_end_bearing";
}

function buildTrend(pumpId: string): Trend {
  const mode = modeOf(pumpId);
  const defs = SIGNALS[mode];
  const peaks = HERO_RAMP_PEAK[pumpId] ?? {};
  const start = parseLocal("2026-10-26T12:00:00").getTime();
  const points: TrendPoint[] = Array.from({ length: 48 }, (_, i) => {
    const ramp = rampAt(i);
    const point: TrendPoint = { event_ts: toIsoLocal(new Date(start + i * HOUR_MS)) };
    for (const d of defs) {
      const wobble = Math.sin(i * 2.3 + d.median) * d.noise;
      const value = d.median + ramp * (peaks[d.key] ?? 0) + wobble;
      point[d.key] = Number(value.toFixed(3));
    }
    return point;
  });
  return {
    pump_id: pumpId,
    failure_mode: mode,
    signals: defs.map((d) => ({ key: d.key, label: d.label, fleet_median: d.median })),
    points,
  };
}

// ---------------------------------------------------------------------------
// Draft work orders, grounded in a (fictional) procedure library.
// ---------------------------------------------------------------------------
const DRAFTS: Record<FailureMode, { procedure_id: string; markdown: string; parts: WorkOrderDraft["parts"] }> = {
  power_end_bearing: {
    procedure_id: "PROC-PE-310",
    markdown: [
      "### Work order: power end bearing",
      "**Why:** Crank LF vibration is up 64% vs fleet and lube oil temp is up 7.1 F over the last 40 hours. Pattern matches early main bearing wear.",
      "**Steps**",
      "1. Confirm standby pump is staged and the manifold is isolated.",
      "2. Lock out the power end and depressurize the fluid end.",
      "3. Drain lube oil and inspect crankshaft main and rod bearing journals.",
      "4. Replace the bearing set (PE-BRG-SET) and torque to spec.",
      "5. Refill lube oil, run 15 min at idle, then at low load. Log vibration baseline.",
      "**Safety:** Follow LOTO and high-pressure line procedures before opening the power end.",
    ].join("\n"),
    parts: [
      { part_no: "PE-BRG-SET", description: "Crankshaft main + rod bearing set", cost_usd: 7600 },
      { part_no: "OIL-SYN-75W90", description: "Synthetic gear lube, 5 gal", cost_usd: 420 },
    ],
  },
  valve_seat_washout: {
    procedure_id: "PROC-VS-220",
    markdown: [
      "### Work order: valve/seat washout",
      "**Why:** Cylinder 3 valve impact is 2.3x fleet normal with discharge pulsation up 29%. Pattern matches a washed valve seat.",
      "**Steps**",
      "1. Stage the standby fluid end and isolate suction and discharge.",
      "2. Remove cylinder 3 valve cover and extract the valve assembly.",
      "3. Inspect seat for washout grooves; replace valve and seat set if beyond limit.",
      "4. Reinstall, torque to spec, and prime the fluid end.",
      "5. Run 10 min at low pressure and confirm pulsation returns to fleet band.",
      "**Safety:** Verify pressure is bled to zero before breaking any fluid end connection.",
    ].join("\n"),
    parts: [
      { part_no: "VS-SET-4", description: "Valve and seat set, cylinder 3", cost_usd: 1450 },
      { part_no: "VC-GSKT-3", description: "Valve cover gasket kit", cost_usd: 185 },
    ],
  },
  packing_failure: {
    procedure_id: "PROC-PK-115",
    markdown: [
      "### Work order: packing failure",
      "**Why:** Packing temp is up 9 F and leak rate is 2.4x fleet normal. Pattern matches worn plunger packing.",
      "**Steps**",
      "1. Swap to standby at the stage gap and isolate the affected plunger.",
      "2. Remove the packing nut and extract the worn packing set.",
      "3. Inspect plunger surface; polish or replace if scored.",
      "4. Install new packing set (PKG-SET-HP) and torque the packing nut to spec.",
      "5. Bring the pump up on low pressure and confirm leak rate is inside fleet band.",
      "**Safety:** Keep clear of the plunger path while the pump is primed.",
    ].join("\n"),
    parts: [{ part_no: "PKG-SET-HP", description: "High pressure packing set", cost_usd: 2200 }],
  },
};

// ---------------------------------------------------------------------------
// Genie canned answers for the suggested questions.
// ---------------------------------------------------------------------------
function genieAnswer(question: string): Omit<GenieResponse, "conversation_id"> {
  const q = question.toLowerCase();
  if (q.includes("protected")) {
    return {
      answer_text:
        "Work orders created in the last 7 days carry $26.4k of expected protection. F05 leads at $21.4k, almost all from one valve/seat pull that completed on Tuesday.",
      sql:
        "SELECT fleet_id, SUM(expected_savings_usd) AS expected_usd\nFROM frac_pump_pdm.gold.work_orders\nWHERE created_at >= current_timestamp() - INTERVAL 7 DAYS\nGROUP BY fleet_id\nORDER BY expected_usd DESC",
      columns: ["fleet_id", "expected_usd"],
      rows: [
        ["F05", 21400],
        ["F11", 3150],
        ["F09", 1820],
      ],
    };
  }
  if (q.includes("npt")) {
    return {
      answer_text:
        "F07 had the most pump-caused NPT last quarter at 41.5 hours, about 2.3x F03 in second place.",
      sql:
        "SELECT fleet_id, ROUND(SUM(npt_hours), 1) AS pump_npt_hours\nFROM frac_pump_pdm.gold.npt_events\nWHERE cause_category = 'pump' AND quarter = '2026-Q3'\nGROUP BY fleet_id\nORDER BY pump_npt_hours DESC",
      columns: ["fleet_id", "pump_npt_hours"],
      rows: [
        ["F07", 41.5],
        ["F03", 18.2],
        ["F14", 12.9],
        ["F05", 9.4],
      ],
    };
  }
  if (q.includes("mtbf")) {
    return {
      answer_text:
        "Valve/seat washout fails most often, with an MTBF of 168 hours. Power end bearing has the longest MTBF at 412 hours but the highest cost per event.",
      sql:
        "SELECT failure_mode, ROUND(AVG(hours_between_failures), 0) AS mtbf_hours, COUNT(*) AS events\nFROM frac_pump_pdm.gold.failure_events\nGROUP BY failure_mode\nORDER BY mtbf_hours",
      columns: ["failure_mode", "mtbf_hours", "events"],
      rows: [
        ["valve_seat_washout", 168, 22],
        ["packing_failure", 236, 15],
        ["power_end_bearing", 412, 9],
      ],
    };
  }
  return {
    answer_text:
      "Mock mode only answers the three suggested questions. Try one of the suggestion chips, or connect the backend to ask anything.",
    sql: "",
    columns: [],
    rows: [],
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export async function mockRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  await sleep(250 + Math.random() * 150);
  const url = new URL(path, "http://mock.local");
  const p = url.pathname;
  const out = (v: unknown) => v as T;
  let m: RegExpMatchArray | null;

  if (method === "GET" && p === "/api/health") {
    const health: Health = { status: "ok", model_name: MODEL_NAME, model_version: MODEL_VERSION };
    return out(health);
  }
  if (method === "GET" && p === "/api/summary") return out(buildSummary());
  if (method === "GET" && p === "/api/performance") {
    return out(performanceSample as unknown as Performance);
  }
  if (method === "POST" && p === "/api/demo/reset") return out({ deleted_work_orders: 0 });
  if (method === "GET" && p === "/api/actions") return out(buildActions());

  if (method === "GET" && (m = p.match(/^\/api\/pumps\/([^/]+)\/trend$/))) {
    return out(buildTrend(decodeURIComponent(m[1])));
  }

  if (method === "POST" && (m = p.match(/^\/api\/pumps\/([^/]+)\/rescore$/))) {
    await sleep(400);
    const pumpId = decodeURIComponent(m[1]);
    const action = BASE_ACTIONS.find((a) => a.pump_id === pumpId);
    const mode = action?.failure_mode ?? "power_end_bearing";
    const risk = Number(Math.max(0.01, (action?.risk ?? 0.3) - 0.01).toFixed(2));
    const probabilities: Record<string, number> = {
      healthy: Number((1 - risk).toFixed(2)),
      valve_seat_washout: 0,
      packing_failure: 0,
      power_end_bearing: 0,
    };
    probabilities[mode] = risk;
    const result: Rescore = {
      pump_id: pumpId,
      risk,
      top_mode: mode,
      probabilities,
      model_version: MODEL_VERSION,
      endpoint: "frac-pump-failure-scorer",
      latency_ms: 150 + Math.round(Math.random() * 60),
    };
    return out(result);
  }

  if (method === "GET" && p === "/api/technicians") {
    const fleet = url.searchParams.get("fleet_id");
    return out(TECHS.filter((t) => !fleet || t.home_fleet_id === fleet));
  }

  if (method === "POST" && p === "/api/work_orders/draft") {
    await sleep(1400);
    const { pump_id } = body as { pump_id: string };
    const mode = modeOf(pump_id);
    const d = DRAFTS[mode];
    const draft: WorkOrderDraft = {
      pump_id,
      failure_mode: mode,
      procedure_id: d.procedure_id,
      draft_markdown: d.markdown.replace(/power end bearing|valve\/seat washout|packing failure/i, (s) =>
        `${s} on ${pump_id}`,
      ),
      parts: d.parts,
      trace_id: `tr-mock-${Math.floor(Math.random() * 1e6).toString(16)}`,
      model: "databricks-claude-sonnet-4-6",
    };
    return out(draft);
  }

  if (method === "POST" && p === "/api/work_orders") {
    const b = body as WorkOrderCreate;
    const wo: WorkOrder = {
      wo_id: `WO-${nextWoNumber++}`,
      pump_id: b.pump_id,
      fleet_id: b.fleet_id,
      failure_mode: b.failure_mode,
      best_action: b.best_action,
      expected_savings_usd: b.expected_savings_usd,
      tech_id: b.tech_id,
      tech_name: techName(b.tech_id),
      window_start: b.window_start,
      window_end: b.window_end,
      status: "scheduled",
      created_at: NOW,
      ai_draft: b.ai_draft,
      procedure_id: b.procedure_id,
      model_version: b.model_version,
    };
    workOrders = [...workOrders, wo];
    return out(wo);
  }

  if (method === "GET" && p === "/api/work_orders") {
    return out(workOrders.map((w) => ({ ...w, tech_name: techName(w.tech_id) })));
  }

  if (method === "PATCH" && (m = p.match(/^\/api\/work_orders\/([^/]+)$/))) {
    const woId = decodeURIComponent(m[1]);
    const status = (body as { status: WorkOrderStatus }).status;
    const existing = workOrders.find((w) => w.wo_id === woId);
    if (!existing) throw new Error(`Work order ${woId} not found`);
    const updated: WorkOrder = { ...existing, status };
    workOrders = workOrders.map((w) => (w.wo_id === woId ? updated : w));
    return out({ ...updated, tech_name: techName(updated.tech_id) });
  }

  if (method === "GET" && p === "/api/timeline") {
    const hours = Number(url.searchParams.get("hours") ?? 48);
    const t0 = parseLocal(NOW).getTime();
    const t1 = t0 + hours * HOUR_MS;
    const blocks = workOrders
      .filter((w) => parseLocal(w.window_end).getTime() >= t0 && parseLocal(w.window_start).getTime() <= t1)
      .map((w) => ({
        wo_id: w.wo_id,
        tech_id: w.tech_id,
        pump_id: w.pump_id,
        failure_mode: w.failure_mode,
        start: w.window_start,
        end: w.window_end,
        status: w.status,
      }));
    const timeline: Timeline = {
      now: NOW,
      technicians: TECHS.map(({ tech_id, name, home_fleet_id, skill, shift }) => ({
        tech_id,
        name,
        home_fleet_id,
        skill,
        shift,
      })),
      blocks,
      stage_gaps: GAPS.filter(
        (g) => parseLocal(g.gap_end).getTime() >= t0 && parseLocal(g.gap_start).getTime() <= t1,
      ),
    };
    return out(timeline);
  }

  if (method === "POST" && p === "/api/genie/ask") {
    await sleep(2200);
    const b = body as { question: string; conversation_id: string | null };
    const resp: GenieResponse = {
      conversation_id: b.conversation_id ?? `01ef-mock-${Math.floor(Math.random() * 1e6).toString(16)}`,
      ...genieAnswer(b.question),
    };
    return out(resp);
  }

  throw new Error(`Mock route not implemented: ${method} ${p}`);
}

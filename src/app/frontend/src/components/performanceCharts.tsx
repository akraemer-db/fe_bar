// Charts for the Performance tab. Built with recharts and the dataviz reference palette
// (light surface). Rules applied: one y-scale per chart (no dual axes), bars capped at 24px
// with 4px rounded data ends, 2px lines, hairline solid gridlines, text in ink tokens only.
import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { MODE_LABEL, STATUS_LABEL, fmtUsd, fmtUsdFull, parseLocal } from "../format";
import type { PerfDay, PerfFleet, PerfLever, PerfModeCost, PerfModeRecall, PerfStatus, PerfWeek } from "../types";

// Reference palette, light surface (see dataviz/references/palette.md).
export const VIZ = {
  s1: "#2a78d6", // categorical slot 1, blue
  s2: "#eb6834", // categorical slot 2, orange
  surface: "#fcfcfb",
  ink: "#0b0b0b",
  ink2: "#52514e",
  muted: "#898781",
  grid: "#e1e0d9",
  axis: "#c3c2b7",
};

const TICK = { fill: VIZ.ink2, fontSize: 13 };
const AXIS_LINE = { stroke: VIZ.axis };

const pct = (v: number) => `${Math.round(v * 100)}%`;
const shortDate = (iso: string) =>
  parseLocal(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

// ---------------------------------------------------------------------------
// Tooltip: values lead, labels follow. Built with React text nodes (no innerHTML).
// ---------------------------------------------------------------------------
interface TipRow {
  label: string;
  value: string;
  color?: string;
}
interface TipContent {
  title: string;
  rows: TipRow[];
}

function tip<T>(build: (row: T) => TipContent) {
  return function VizTooltip(props: { active?: boolean; payload?: { payload?: unknown }[] }): ReactNode {
    if (!props.active || !props.payload || props.payload.length === 0) return null;
    const row = props.payload[0]?.payload as T;
    const content = build(row);
    return (
      <div className="viz-tip">
        <div className="viz-tip-title">{content.title}</div>
        {content.rows.map((r) => (
          <div className="viz-tip-row" key={r.label}>
            {r.color && <i className="viz-key" style={{ background: r.color }} />}
            <span className="viz-tip-label">{r.label}</span>
            <strong className="viz-tip-value">{r.value}</strong>
          </div>
        ))}
      </div>
    );
  };
}

// Recharts only detects a Legend rendered directly under the chart, so spread these props inline.
const LEGEND_PROPS = {
  verticalAlign: "top" as const,
  align: "left" as const,
  iconType: "square" as const,
  wrapperStyle: { fontSize: 13, paddingBottom: 8 },
};

// ---------------------------------------------------------------------------
// Opportunity: value by lever, conservative vs target
// ---------------------------------------------------------------------------
interface LeverRow {
  name: string;
  provenIn: string;
  conservative: number;
  target: number;
}

function LeverTick(props: { x?: number; y?: number; payload?: { value: string }; proven: Record<string, string> }) {
  const name = props.payload?.value ?? "";
  const proven = props.proven[name];
  return (
    <g transform={`translate(${props.x ?? 0},${props.y ?? 0})`}>
      <text x={-10} y={proven ? -2 : 4} textAnchor="end" fill={VIZ.ink} fontSize={14} fontWeight={600}>
        {name}
      </text>
      {proven && (
        <text x={-10} y={15} textAnchor="end" fill={VIZ.ink2} fontSize={12}>
          Proven in: {proven}
        </text>
      )}
    </g>
  );
}

export function LeverChart({ levers }: { levers: PerfLever[] }) {
  const byName = new Map<string, LeverRow>();
  for (const l of levers) {
    if (l.lever === "Program total") continue;
    const row = byName.get(l.lever) ?? { name: l.lever, provenIn: l.proven_in, conservative: 0, target: 0 };
    if (l.scenario === "conservative") row.conservative = l.annual_usd;
    else row.target = l.annual_usd;
    byName.set(l.lever, row);
  }
  const rows = [...byName.values()].sort((a, b) => b.target - a.target);
  const proven = Object.fromEntries(rows.map((r) => [r.name, r.provenIn]));
  const max = Math.max(1, ...rows.flatMap((r) => [r.conservative, r.target]));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={rows} layout="vertical" margin={{ top: 36, right: 72, bottom: 4, left: 4 }} barGap={2} barCategoryGap="26%">
        <CartesianGrid horizontal={false} stroke={VIZ.grid} />
        <XAxis type="number" domain={[0, max * 1.18]} tickFormatter={fmtUsd} tick={TICK} axisLine={false} tickLine={false} />
        <YAxis
          type="category"
          dataKey="name"
          width={262}
          tickLine={false}
          axisLine={AXIS_LINE}
          tick={(p) => <LeverTick x={p.x} y={p.y} payload={p.payload} proven={proven} />}
        />
        <Tooltip
          cursor={{ fill: "rgba(11,11,11,0.04)" }}
          content={tip<LeverRow>((r) => ({
            title: r.name,
            rows: [
              { label: "Conservative", value: fmtUsdFull(r.conservative), color: VIZ.s1 },
              { label: "Target", value: fmtUsdFull(r.target), color: VIZ.s2 },
              { label: "Proven in", value: r.provenIn },
            ],
          }))}
        />
        <Legend {...LEGEND_PROPS} />
        <Bar dataKey="conservative" name="Conservative" fill={VIZ.s1} radius={[0, 4, 4, 0]} maxBarSize={22}>
          <LabelList dataKey="conservative" position="right" formatter={(v: number) => fmtUsd(v)} fill={VIZ.ink} fontSize={13} />
        </Bar>
        <Bar dataKey="target" name="Target" fill={VIZ.s2} radius={[0, 4, 4, 0]} maxBarSize={22}>
          <LabelList dataKey="target" position="right" formatter={(v: number) => fmtUsd(v)} fill={VIZ.ink} fontSize={13} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Opportunity: annual cost of unplanned failures by mode (single series)
// ---------------------------------------------------------------------------
interface ModeRow {
  label: string;
  annual: number;
  costLabel: string;
  failures: number;
  mtbf: number;
  costIfFailed: number;
}

export function ModeCostChart({ rows }: { rows: PerfModeCost[] }) {
  const data: ModeRow[] = [...rows]
    .sort((a, b) => b.annual_cost_usd - a.annual_cost_usd)
    .map((r) => ({
      label: MODE_LABEL[r.failure_mode] ?? r.failure_mode,
      annual: r.annual_cost_usd,
      costLabel: fmtUsd(r.annual_cost_usd),
      failures: r.failures_12m,
      mtbf: r.mtbf_pumping_hrs,
      costIfFailed: r.cost_if_failed_usd,
    }));
  const max = Math.max(1, ...data.map((d) => d.annual));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 72, bottom: 4, left: 4 }} barCategoryGap="32%">
        <CartesianGrid horizontal={false} stroke={VIZ.grid} />
        <XAxis type="number" domain={[0, max * 1.18]} tickFormatter={fmtUsd} tick={TICK} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" width={150} tick={{ ...TICK, fill: VIZ.ink, fontWeight: 600 }} tickLine={false} axisLine={AXIS_LINE} />
        <Tooltip
          cursor={{ fill: "rgba(11,11,11,0.04)" }}
          content={tip<ModeRow>((r) => ({
            title: r.label,
            rows: [
              { label: "Annual cost", value: fmtUsdFull(r.annual) },
              { label: "Failures, 12 mo", value: r.failures.toLocaleString("en-US") },
              { label: "MTBF", value: `${Math.round(r.mtbf).toLocaleString("en-US")} pumping hrs` },
              { label: "Cost if failed", value: fmtUsdFull(r.costIfFailed) },
            ],
          }))}
        />
        <Bar dataKey="annual" name="Annual cost" fill={VIZ.s1} radius={[0, 4, 4, 0]} maxBarSize={24}>
          <LabelList dataKey="costLabel" position="right" fill={VIZ.ink} fontSize={13} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Opportunity: protected (30 d) vs expected at stake, by fleet (grouped, sorted)
// ---------------------------------------------------------------------------
interface FleetRow {
  fleet: string;
  protectedUsd: number;
  atStake: number;
  npt: number;
  failures: number;
}

export function FleetChart({ fleet }: { fleet: PerfFleet[] }) {
  const rows: FleetRow[] = [...fleet]
    .sort((a, b) => b.protected_30d_usd - a.protected_30d_usd)
    .map((f) => ({
      fleet: f.fleet_id,
      protectedUsd: f.protected_30d_usd,
      atStake: f.expected_usd_at_stake,
      npt: f.npt_hrs_90d,
      failures: f.failures_90d,
    }));
  const max = Math.max(1, ...rows.flatMap((r) => [r.protectedUsd, r.atStake]));
  return (
    <ResponsiveContainer width="100%" height={Math.max(360, rows.length * 38)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 36, right: 72, bottom: 4, left: 4 }} barGap={2} barCategoryGap="22%">
        <CartesianGrid horizontal={false} stroke={VIZ.grid} />
        <XAxis type="number" domain={[0, max * 1.18]} tickFormatter={fmtUsd} tick={TICK} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="fleet" width={56} tick={{ ...TICK, fill: VIZ.ink, fontWeight: 600 }} tickLine={false} axisLine={AXIS_LINE} />
        <Tooltip
          cursor={{ fill: "rgba(11,11,11,0.04)" }}
          content={tip<FleetRow>((r) => ({
            title: `Fleet ${r.fleet}`,
            rows: [
              { label: "Protected, 30 d", value: fmtUsdFull(r.protectedUsd), color: VIZ.s1 },
              { label: "Expected at stake", value: fmtUsdFull(r.atStake), color: VIZ.s2 },
              { label: "NPT, 90 d", value: `${r.npt} hrs` },
              { label: "Failures, 90 d", value: String(r.failures) },
            ],
          }))}
        />
        <Legend {...LEGEND_PROPS} />
        <Bar dataKey="protectedUsd" name="Protected, 30 days" fill={VIZ.s1} radius={[0, 4, 4, 0]} maxBarSize={18} />
        <Bar dataKey="atStake" name="Expected at stake" fill={VIZ.s2} radius={[0, 4, 4, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Performance: weekly NPT and failures, two aligned charts (no dual axis)
// ---------------------------------------------------------------------------
export interface WeekRow {
  label: string;
  week: string;
  npt: number;
  failures: number;
  pumpHours: number;
  partial: boolean;
}

export function weekRows(weekly: PerfWeek[], asOf: string): WeekRow[] {
  const asOfMs = parseLocal(asOf).getTime();
  return weekly.map((w) => {
    const start = parseLocal(w.week_start).getTime();
    return {
      label: shortDate(w.week_start),
      week: `Week of ${shortDate(w.week_start)}`,
      npt: w.pump_caused_npt_hrs,
      failures: w.unplanned_failures,
      pumpHours: w.pump_hours,
      partial: asOfMs >= start && asOfMs < start + 7 * 864e5,
    };
  });
}

export function WeeklyCharts({ rows }: { rows: WeekRow[] }) {
  const common = { data: rows, margin: { top: 6, right: 12, bottom: 0, left: 4 } };
  const weekTip = tip<WeekRow>((r) => ({
    title: r.week + (r.partial ? " (partial week)" : ""),
    rows: [
      { label: "Pump-caused NPT", value: `${r.npt} hrs`, color: VIZ.s1 },
      { label: "Unplanned failures", value: String(r.failures), color: VIZ.s2 },
      { label: "Pump hours", value: r.pumpHours.toLocaleString("en-US") },
    ],
  }));
  return (
    <div className="perf-stack">
      <div className="perf-mini-title">Pump-caused NPT, hrs per week</div>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart {...common} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke={VIZ.grid} />
          <XAxis dataKey="label" tick={{ ...TICK, fontSize: 12 }} interval={7} tickLine={false} axisLine={AXIS_LINE} />
          <YAxis width={40} tick={{ ...TICK, fontSize: 12 }} tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: "rgba(11,11,11,0.04)" }} content={weekTip} />
          <Bar dataKey="npt" name="Pump-caused NPT" fill={VIZ.s1} radius={[4, 4, 0, 0]} maxBarSize={14} />
        </BarChart>
      </ResponsiveContainer>
      <div className="perf-mini-title">Unplanned failures per week</div>
      <ResponsiveContainer width="100%" height={130}>
        <BarChart {...common} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke={VIZ.grid} />
          <XAxis dataKey="label" tick={{ ...TICK, fontSize: 12 }} interval={7} tickLine={false} axisLine={AXIS_LINE} />
          <YAxis width={40} tick={{ ...TICK, fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip cursor={{ fill: "rgba(11,11,11,0.04)" }} content={weekTip} />
          <Bar dataKey="failures" name="Unplanned failures" fill={VIZ.s2} radius={[4, 4, 0, 0]} maxBarSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Performance: expected $ protected, last 30 days (cumulative area + daily WO bars)
// ---------------------------------------------------------------------------
interface DayRow {
  label: string;
  day: string;
  cumulative: number;
  workOrders: number;
  expected: number;
}

export function ProtectedCharts({ days }: { days: PerfDay[] }) {
  const rows: DayRow[] = days.map((d) => ({
    label: shortDate(d.day),
    day: d.day,
    cumulative: d.cumulative_usd,
    workOrders: d.work_orders,
    expected: d.expected_usd,
  }));
  const last = rows.length - 1;
  return (
    <div className="perf-stack">
      <div className="perf-mini-title">Cumulative expected $ protected</div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={rows} margin={{ top: 14, right: 16, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke={VIZ.grid} />
          <XAxis dataKey="label" tick={{ ...TICK, fontSize: 12 }} tickLine={false} axisLine={AXIS_LINE} minTickGap={12} />
          <YAxis width={60} tickFormatter={fmtUsd} tick={{ ...TICK, fontSize: 12 }} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ stroke: VIZ.axis }}
            content={tip<DayRow>((r) => ({
              title: shortDate(r.day),
              rows: [
                { label: "Cumulative", value: fmtUsdFull(r.cumulative), color: VIZ.s1 },
                { label: "Added that day", value: fmtUsdFull(r.expected) },
                { label: "Work orders", value: String(r.workOrders) },
              ],
            }))}
          />
          <Area
            type="linear"
            dataKey="cumulative"
            name="Cumulative $ protected"
            stroke={VIZ.s1}
            strokeWidth={2}
            fill={VIZ.s1}
            fillOpacity={0.1}
            dot={(p: { cx?: number; cy?: number; index?: number; key?: string }) =>
              p.index === last && p.cx !== undefined && p.cy !== undefined ? (
                <circle key={p.key ?? "end"} cx={p.cx} cy={p.cy} r={5} fill={VIZ.s1} stroke={VIZ.surface} strokeWidth={2} />
              ) : (
                <g key={p.key ?? `d${p.index}`} />
              )
            }
            activeDot={{ r: 5, fill: VIZ.s1, stroke: VIZ.surface, strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="perf-mini-title">Work orders created per day</div>
      <ResponsiveContainer width="100%" height={110}>
        <BarChart data={rows} margin={{ top: 6, right: 16, bottom: 0, left: 4 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke={VIZ.grid} />
          <XAxis dataKey="label" tick={{ ...TICK, fontSize: 12 }} tickLine={false} axisLine={AXIS_LINE} minTickGap={12} />
          <YAxis width={60} tick={{ ...TICK, fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: "rgba(11,11,11,0.04)" }}
            content={tip<DayRow>((r) => ({
              title: shortDate(r.day),
              rows: [{ label: "Work orders", value: String(r.workOrders) }],
            }))}
          />
          <Bar dataKey="workOrders" name="Work orders" fill={VIZ.s1} radius={[4, 4, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Performance: catch rate by mode (single series, n in the label)
// ---------------------------------------------------------------------------
interface RecallRow {
  label: string;
  recall: number;
  text: string;
  n: number;
}

export function RecallChart({ rows }: { rows: PerfModeRecall[] }) {
  const data: RecallRow[] = rows.map((r) => ({
    label: MODE_LABEL[r.failure_mode] ?? r.failure_mode,
    recall: r.recall,
    text: `${pct(r.recall)} (n=${r.n})`,
    n: r.n,
  }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 110, bottom: 4, left: 4 }} barCategoryGap="32%">
        <CartesianGrid horizontal={false} stroke={VIZ.grid} />
        <XAxis type="number" domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tickFormatter={(v: number) => pct(v)} tick={TICK} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" width={150} tick={{ ...TICK, fill: VIZ.ink, fontWeight: 600 }} tickLine={false} axisLine={AXIS_LINE} />
        <Tooltip
          cursor={{ fill: "rgba(11,11,11,0.04)" }}
          content={tip<RecallRow>((r) => ({
            title: r.label,
            rows: [
              { label: "Catch rate", value: pct(r.recall), color: VIZ.s1 },
              { label: "Failures in backtest", value: String(r.n) },
            ],
          }))}
        />
        <Bar dataKey="recall" name="Catch rate" fill={VIZ.s1} radius={[0, 4, 4, 0]} maxBarSize={24}>
          <LabelList dataKey="text" position="right" fill={VIZ.ink} fontSize={13} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Work orders: $ by status (single series, count in the label)
// ---------------------------------------------------------------------------
interface StatusRow {
  label: string;
  usd: number;
  text: string;
  n: number;
}

export function StatusChart({ rows }: { rows: PerfStatus[] }) {
  const order = ["scheduled", "dispatched", "in_progress", "done"];
  const data: StatusRow[] = [...rows]
    .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))
    .map((r) => ({
      label: `${STATUS_LABEL[r.status]} (${r.n})`,
      usd: r.expected_usd,
      n: r.n,
      text: fmtUsd(r.expected_usd),
    }));
  const max = Math.max(1, ...data.map((d) => d.usd));
  return (
    <ResponsiveContainer width="100%" height={210}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 130, bottom: 4, left: 4 }} barCategoryGap="30%">
        <CartesianGrid horizontal={false} stroke={VIZ.grid} />
        <XAxis type="number" domain={[0, max * 1.4]} tickFormatter={fmtUsd} tick={TICK} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" width={110} tick={{ ...TICK, fill: VIZ.ink, fontWeight: 600 }} tickLine={false} axisLine={AXIS_LINE} />
        <Tooltip
          cursor={{ fill: "rgba(11,11,11,0.04)" }}
          content={tip<StatusRow>((r) => ({
            title: r.label,
            rows: [
              { label: "Expected $ protected", value: fmtUsdFull(r.usd), color: VIZ.s1 },
              { label: "Work orders", value: String(r.n) },
            ],
          }))}
        />
        <Bar dataKey="usd" name="Expected $ protected" fill={VIZ.s1} radius={[0, 4, 4, 0]} maxBarSize={24}>
          <LabelList dataKey="text" position="right" fill={VIZ.ink} fontSize={13} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

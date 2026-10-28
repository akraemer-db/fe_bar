import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, errMsg } from "../api";
import { MODE_LABEL, STATUS_LABEL, fmtDay, fmtDayTime, fmtUsd, fmtUsdFull, parseLocal } from "../format";
import { useToast } from "../toast";
import type { Performance } from "../types";
import {
  FleetChart,
  ModeCostChart,
  ProtectedCharts,
  RecallChart,
  StatusChart,
  WaterfallChart,
  WeeklyCharts,
  weekRows,
} from "./performanceCharts";

/** "$9.1-10.9M" for two values in the millions, otherwise "$48.7k-$1.2M" style. */
function rangeUsd(lo: number, hi: number): string {
  if (lo >= 1_000_000 && hi >= 1_000_000) return `$${(lo / 1e6).toFixed(1)}-${(hi / 1e6).toFixed(1)}M`;
  return `${fmtUsd(lo)}-${fmtUsd(hi)}`;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function PerformanceView() {
  const notify = useToast();
  const [data, setData] = useState<Performance | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .performance()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) notify(errMsg(e), "error");
      });
    return () => {
      alive = false;
    };
  }, [notify]);

  const derived = useMemo(() => (data ? derive(data) : null), [data]);

  if (!data || !derived) {
    return <div className="empty">Loading performance data...</div>;
  }

  const { tiles, captions, wf } = derived;

  return (
    <div className="perf">
      <div className="perf-header">
        <div>
          <h2 className="perf-h2">Opportunity</h2>
          <p className="muted small">Annual value estimates, and what the work orders have protected so far.</p>
        </div>
        <div className="small muted">As of {fmtDayTime(data.as_of)}</div>
      </div>

      <div className="perf-tiles">
        {tiles.map((t) => (
          <div className="perf-tile" key={t.label}>
            <div className="perf-tile-label">{t.label}</div>
            <div className="perf-tile-value">{t.value}</div>
            <div className="perf-tile-sub">{t.sub}</div>
          </div>
        ))}
      </div>

      <div className="perf-grid">
        <Card
          title="From failure cost avoided to added EBITDA"
          caption={captions.lever}
          wide
          table={
            <DataTable
              head={["Step", "Conservative", "Target"]}
              rows={[
                ["Failure cost avoided", fmtUsdFull(wf.conservative.gross), fmtUsdFull(wf.target.gross)],
                ["False-alarm inspections", fmtUsdFull(-wf.conservative.falseAlarm), fmtUsdFull(-wf.target.falseAlarm)],
                ["Platform run rate", fmtUsdFull(-wf.conservative.platform), fmtUsdFull(-wf.target.platform)],
                ["Added EBITDA", fmtUsdFull(wf.conservative.net), fmtUsdFull(wf.target.net)],
                ["Catch rate", pct(data.app_value[0].catch_rate), pct(data.app_value[1].catch_rate)],
                ["Failures caught of total", `${data.app_value[0].failures_caught} of ${data.app_value[0].failures_total}`, `${data.app_value[1].failures_caught} of ${data.app_value[1].failures_total}`],
              ]}
            />
          }
        >
          <div className="perf-wf-pair">
            <WaterfallChart s={wf.conservative} max={wf.max} />
            <WaterfallChart s={wf.target} max={wf.max} />
          </div>
          <p className="perf-returns">{derived.returnLine}</p>
        </Card>

        <Card
          title="Annual cost of unplanned failures, by mode"
          caption={captions.mode}
          table={
            <DataTable
              head={["Failure mode", "Annual cost", "Failures, 12 mo", "MTBF (pumping hrs)", "Cost if failed"]}
              rows={data.by_mode_cost.map((m) => [
                MODE_LABEL[m.failure_mode] ?? m.failure_mode,
                fmtUsdFull(m.annual_cost_usd),
                String(m.failures_12m),
                Math.round(m.mtbf_pumping_hrs).toLocaleString("en-US"),
                fmtUsdFull(m.cost_if_failed_usd),
              ])}
            />
          }
        >
          <ModeCostChart rows={data.by_mode_cost} />
        </Card>

        <Card
          title="Opportunity by fleet"
          caption={captions.fleet}
          wide
          table={
            <DataTable
              head={["Fleet", "Protected, 30 d", "Expected at stake", "NPT, 90 d (hrs)", "Failures, 90 d"]}
              rows={derived.fleetSorted.map((f) => [
                f.fleet_id,
                fmtUsdFull(f.protected_30d_usd),
                fmtUsdFull(f.expected_usd_at_stake),
                String(f.npt_hrs_90d),
                String(f.failures_90d),
              ])}
            />
          }
        >
          <FleetChart fleet={data.fleet} />
        </Card>
      </div>

      <div className="perf-section">
        <h2 className="perf-h2">Performance</h2>
        <p className="muted small">What the fleet is doing week to week, and how the model compares with a calendar rule.</p>
      </div>

      <div className="perf-grid">
        <Card
          title="Pump-caused NPT and unplanned failures, weekly"
          caption={captions.weekly}
          wide={false}
          table={
            <DataTable
              head={["Week", "Pump-caused NPT (hrs)", "Unplanned failures", "Pump hours"]}
              rows={derived.weekRows.map((w) => [
                w.week + (w.partial ? " (partial)" : ""),
                String(w.npt),
                String(w.failures),
                w.pumpHours.toLocaleString("en-US"),
              ])}
            />
          }
        >
          <WeeklyCharts rows={derived.weekRows} />
        </Card>

        <Card
          title="Expected $ protected, last 30 days"
          caption={captions.protected}
          table={
            <DataTable
              head={["Day", "Work orders", "Added $", "Cumulative $"]}
              rows={data.protected_daily.map((d) => [
                fmtDay(parseLocal(d.day)),
                String(d.work_orders),
                fmtUsdFull(d.expected_usd),
                fmtUsdFull(d.cumulative_usd),
              ])}
            />
          }
        >
          <ProtectedCharts days={data.protected_daily} />
        </Card>

        <Card
          title="Model vs calendar rule"
          caption={captions.model}
          wide
          table={null}
        >
          <ModelTable model={data.model} />
        </Card>

        <Card
          title="Catch rate by failure mode"
          caption={captions.recall}
          table={
            <DataTable
              head={["Failure mode", "Catch rate", "Failures in backtest"]}
              rows={data.model_recall_by_mode.map((r) => [MODE_LABEL[r.failure_mode] ?? r.failure_mode, pct(r.recall), String(r.n)])}
            />
          }
        >
          <RecallChart rows={data.model_recall_by_mode} />
        </Card>

        <Card
          title="Work orders by status"
          caption={captions.status}
          table={
            <DataTable
              head={["Status", "Work orders", "Expected $ protected"]}
              rows={data.work_order_status.map((s) => [STATUS_LABEL[s.status], String(s.n), fmtUsdFull(s.expected_usd)])}
            />
          }
        >
          <StatusChart rows={data.work_order_status} />
        </Card>

        <Card title="Outcomes of completed work orders" caption={captions.outcomes} table={null}>
          <div className="perf-outcomes">
            <Outcome label="Completed" value={data.outcomes.completed} />
            <Outcome label="Confirmed predicted mode" value={data.outcomes.confirmed} />
            <Outcome label="Avoided a failure" value={data.outcomes.avoided} />
          </div>
        </Card>
      </div>

      <p className="perf-footnote">
        {data.note} Modeled estimates from value_model.py; synthetic data.
      </p>
      <p className="perf-footnote">
        Expansion upside, not in the app: ~{fmtUsd(derived.expansion)}/yr from longer fluid end life and condition-based consumables (sized in value_model.py, scoped after the pilot).
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Derived figures. Everything shown in tiles and captions is computed here
// from the response, so the text always matches the charts.
// ---------------------------------------------------------------------------
function derive(d: Performance) {
  const conservative = d.app_value.find((a) => a.scenario === "conservative");
  const target = d.app_value.find((a) => a.scenario === "target");
  if (!conservative || !target) throw new Error("app_value must include conservative and target scenarios");
  const cons = conservative;
  const tgt = target;
  const lo = (f: (a: typeof cons) => number) => f(cons);
  const hi = (f: (a: typeof cons) => number) => f(tgt);

  const protectedNow = d.protected_daily.length ? d.protected_daily[d.protected_daily.length - 1].cumulative_usd : 0;
  const woTotal = d.protected_daily.reduce((s, x) => s + x.work_orders, 0);
  const baseline = cons.baseline_failure_cost_usd;

  const tiles = [
    {
      label: "Added EBITDA (est.)",
      value: rangeUsd(lo((a) => a.net_ebitda_usd), hi((a) => a.net_ebitda_usd)),
      sub: "per year, conservative to target",
    },
    {
      label: "Less spent on unplanned failures",
      value: `${Math.round(lo((a) => a.failure_cost_reduction_pct))}-${Math.round(hi((a) => a.failure_cost_reduction_pct))}%`,
      sub: `of ~${fmtUsd(baseline)} / yr today`,
    },
    {
      label: "Breakdowns prevented",
      value: `${cons.failures_caught}-${tgt.failures_caught} of ${cons.failures_total}`,
      sub: `${Math.round(cons.spread_hrs_recovered)}-${Math.round(tgt.spread_hrs_recovered)} spread hrs back`,
    },
    {
      label: "$ protected (last 30 days)",
      value: fmtUsd(protectedNow),
      sub: `cumulative, ${woTotal} work orders`,
    },
  ];

  const returnLine =
    `Return on platform: ${cons.return_on_platform_x.toFixed(1)}-${tgt.return_on_platform_x.toFixed(1)}x · ` +
    `Payback ${tgt.payback_months.toFixed(1)}-${cons.payback_months.toFixed(1)} months (pumps already instrumented) · ` +
    `${cons.pct_fleet_ebitda.toFixed(1)}-${tgt.pct_fleet_ebitda.toFixed(1)}% of fleet EBITDA`;

  const wf = {
    conservative: { label: "Conservative", gross: cons.gross_avoided_usd, falseAlarm: cons.false_alarm_cost_usd, platform: cons.platform_cost_usd, net: cons.net_ebitda_usd },
    target: { label: "Target", gross: tgt.gross_avoided_usd, falseAlarm: tgt.false_alarm_cost_usd, platform: tgt.platform_cost_usd, net: tgt.net_ebitda_usd },
    max: Math.max(cons.gross_avoided_usd, tgt.gross_avoided_usd) * 1.2,
  };

  const modes = [...d.by_mode_cost].sort((a, b) => b.annual_cost_usd - a.annual_cost_usd);
  const topMode = modes[0];
  const topFleet = [...d.fleet].sort((a, b) => b.protected_30d_usd - a.protected_30d_usd)[0];
  const fleetSorted = [...d.fleet].sort((a, b) => b.protected_30d_usd - a.protected_30d_usd);
  const npt = d.weekly.reduce((s, w) => s + w.pump_caused_npt_hrs, 0);
  const failures = d.weekly.reduce((s, w) => s + w.unplanned_failures, 0);
  const recalls = d.model_recall_by_mode.map((r) => r.recall);
  const lgbm = d.model.lightgbm_calibrated;
  const cal = d.model.calendar_baseline;
  const doneRow = d.work_order_status.find((s) => s.status === "done");

  const captions = {
    lever: `Failure cost avoided, less false-alarm inspections and platform run rate, leaves ${rangeUsd(cons.net_ebitda_usd, tgt.net_ebitda_usd)} of added EBITDA a year.`,
    mode: `${MODE_LABEL[topMode.failure_mode] ?? topMode.failure_mode} is the largest unplanned cost at ${fmtUsd(topMode.annual_cost_usd)} a year.`,
    fleet: `${topFleet.fleet_id} leads with ${fmtUsd(topFleet.protected_30d_usd)} protected in 30 days. Bars are sorted by protection.`,
    weekly: `Pump-caused NPT totals ${npt.toFixed(1)} hrs and ${failures} unplanned failures over 52 weeks.`,
    protected: `${fmtUsd(protectedNow)} protected across ${woTotal} work orders in the last 30 days.`,
    model: `LightGBM catches ${lgbm.caught} of ${lgbm.events} events (${pct(lgbm.recall)}) with a ${lgbm.threshold} threshold. The calendar rule catches ${cal.caught}.`,
    recall: `Catch rate ranges from ${pct(Math.min(...recalls))} to ${pct(Math.max(...recalls))} across modes. Bars show the backtest failure count.`,
    status: doneRow ? `${doneRow.n} completed work orders account for ${fmtUsd(doneRow.expected_usd)} of expected protection.` : "Work order counts and expected protection by status.",
    outcomes: `${d.outcomes.confirmed} of ${d.outcomes.completed} completed work orders confirmed the predicted mode; ${d.outcomes.avoided} avoided a failure.`,
  };

  const weekly = weekRows(d.weekly, d.as_of);

  return { tiles, captions, returnLine, wf, expansion: cons.expansion_upside_usd, fleetSorted, weekRows: weekly };
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------
function Card({
  title,
  caption,
  table,
  wide,
  children,
}: {
  title: string;
  caption: string;
  table: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`perf-card${wide ? " perf-card-wide" : ""}`}>
      <header className="perf-card-head">
        <h3>{title}</h3>
        <p className="perf-caption">{caption}</p>
      </header>
      {children}
      {table && (
        <details className="perf-table">
          <summary>Table view</summary>
          {table}
        </details>
      )}
    </section>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="table-wrap">
      <table className="data-table compact">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} className={i === 0 ? undefined : "num"}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={j === 0 ? undefined : "num"}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelTable({ model }: { model: Performance["model"] }) {
  const m = model.lightgbm_calibrated;
  const c = model.calendar_baseline;
  const rows: [string, string, string][] = [
    ["Catch rate (recall)", pct(m.recall), pct(c.recall)],
    ["Events caught", `${m.caught} of ${m.events}`, `${c.caught} of ${c.events}`],
    ["Precision", pct(m.precision), pct(c.precision)],
    ["False alarms per pump-month", m.false_alarms_per_pump_month.toFixed(2), c.false_alarms_per_pump_month.toFixed(2)],
    ["Median lead time", `${m.median_lead_hrs.toFixed(1)} hrs`, `${c.median_lead_hrs.toFixed(1)} hrs`],
    ["Net $ per year (annualized)", fmtUsd(m.net_usd_annualized), fmtUsd(c.net_usd_annualized)],
    ["Alarm threshold", m.threshold.toFixed(2), c.threshold.toFixed(2)],
  ];
  return (
    <div className="table-wrap">
      <table className="data-table model-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th className="num">LightGBM (calibrated)</th>
            <th className="num">Calendar rule (best variant alarms on nothing)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, a, b]) => (
            <tr key={label}>
              <td>{label}</td>
              <td className="num strong-cell">{a}</td>
              <td className="num">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Outcome({ label, value }: { label: string; value: number }) {
  return (
    <div className="perf-outcome">
      <div className="perf-tile-value">{value}</div>
      <div className="perf-tile-sub">{label}</div>
    </div>
  );
}

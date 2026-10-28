import { useEffect, useState, type ReactNode } from "react";
import { api, errMsg } from "../api";
import { ACTION_LABEL, MODE_LABEL, fmtPct, fmtUsd, fmtUsdFull } from "../format";
import { useToast } from "../toast";
import type { Action, Rescore, Trend } from "../types";
import { Sparkline, type SparkPoint } from "./Sparkline";
import { RiskCell } from "./RiskCell";

interface ActionDrawerProps {
  action: Action;
  onClose: () => void;
  onDispatch: () => void;
}

export function ActionDrawer({ action: a, onClose, onDispatch }: ActionDrawerProps) {
  const notify = useToast();
  const [trend, setTrend] = useState<Trend | null>(null);
  const [rescore, setRescore] = useState<Rescore | null>(null);
  const [rescoring, setRescoring] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .trend(a.pump_id)
      .then((t) => {
        if (alive) setTrend(t);
      })
      .catch((e) => {
        if (alive) notify(errMsg(e), "error");
      });
    return () => {
      alive = false;
    };
  }, [a.pump_id, notify]);

  // Keep running is the negated expected cost; the option values are negative dollars.
  const options: { key: Action["best_action"]; value: number | null }[] = [
    { key: "keep_running", value: a.option_keep_running_usd },
    { key: "swap_at_next_gap", value: a.option_swap_at_gap_usd },
    { key: "pull_now", value: a.option_pull_now_usd },
  ];
  const keepValue = a.option_keep_running_usd;

  const runRescore = async () => {
    setRescoring(true);
    try {
      setRescore(await api.rescore(a.pump_id));
    } catch (e) {
      notify(errMsg(e), "error");
    } finally {
      setRescoring(false);
    }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Details for ${a.pump_id}`}>
        <div className="drawer-head">
          <div>
            <div className="eyebrow">
              Rank {a.rank} · Fleet {a.fleet_id}
            </div>
            <h2>
              {a.pump_id} · {MODE_LABEL[a.failure_mode] ?? a.failure_mode}
            </h2>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="drawer-body">
          <div className="stat-row">
            <Stat label="Expected $ protected" value={fmtUsd(a.expected_savings_usd)} strong />
            <Stat label="Risk (24 hr)" value={<RiskCell risk={a.risk} />} />
            <Stat label="Best action" value={ACTION_LABEL[a.best_action] ?? a.best_action} />
          </div>

          <Section title="Drivers">
            <ul className="drivers">
              {a.top_drivers.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </Section>

          <Section title="Options">
            <table className="data-table options-table">
              <thead>
                <tr>
                  <th>Option</th>
                  <th className="num">Expected cost</th>
                  <th className="num">Protected vs keep</th>
                </tr>
              </thead>
              <tbody>
                {options.map((o) => {
                  const isBest = o.key === a.best_action;
                  const label = o.key === "keep_running" ? "Keep running" : o.key === "swap_at_next_gap" ? "Swap at next gap" : "Pull now, standby online";
                  return (
                    <tr key={o.key} className={isBest ? "best" : undefined}>
                      <td>
                        {label}
                        {isBest && <span className="best-tag">best</span>}
                      </td>
                      {o.value === null ? (
                        <>
                          <td className="num muted">n/a (no standby free)</td>
                          <td className="num muted">n/a</td>
                        </>
                      ) : (
                        <>
                          <td className="num">{fmtUsdFull(-o.value)}</td>
                          <td className="num">{fmtUsdFull(o.value - keepValue)}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="footnote">
              Expected $ protected = best option − keep running. Keep running = risk × cost if failed (
              {fmtUsdFull(a.cost_if_failed_usd)}).
            </p>
            <p className="small muted">
              Owner: {a.owner}. Planned fix {fmtUsdFull(a.planned_fix_usd)}.
            </p>
          </Section>

          <Section title="Last 48 hrs vs fleet median">
            {trend === null ? (
              <div className="empty small">Loading signals...</div>
            ) : (
              <div className="spark-grid">
                {trend.signals.map((sig) => {
                  const data: SparkPoint[] = trend.points.map((p) => ({ t: p.event_ts, v: Number(p[sig.key]) }));
                  const last = data.length ? data[data.length - 1].v : sig.fleet_median;
                  const deltaPct = sig.fleet_median !== 0 ? ((last - sig.fleet_median) / sig.fleet_median) * 100 : 0;
                  return (
                    <div className="spark-card" key={sig.key}>
                      <div className="spark-head">
                        <span className="small">{sig.label}</span>
                        <span className="small">
                          <strong>{last.toFixed(2)}</strong>{" "}
                          <span className="muted">
                            ({deltaPct >= 0 ? "+" : ""}
                            {deltaPct.toFixed(0)}% vs median {sig.fleet_median})
                          </span>
                        </span>
                      </div>
                      <Sparkline data={data} median={sig.fleet_median} />
                    </div>
                  );
                })}
              </div>
            )}
            <p className="small muted">Dashed line = fleet median.</p>
          </Section>

          <Section title="Live model re-score">
            <button type="button" className="btn" onClick={runRescore} disabled={rescoring}>
              {rescoring ? "Scoring..." : "Re-score with live model"}
            </button>
            {rescore && (
              <div className="rescore-result">
                <div>
                  <strong>Risk {fmtPct(rescore.risk)}</strong>, top mode {MODE_LABEL[rescore.top_mode] ?? rescore.top_mode}
                </div>
                <div className="small muted">
                  Model version {rescore.model_version} · served by endpoint {rescore.endpoint} ({rescore.latency_ms} ms)
                </div>
              </div>
            )}
          </Section>
        </div>

        <div className="drawer-foot">
          <button type="button" className="btn btn-primary" disabled={a.has_open_work_order} onClick={onDispatch}>
            {a.has_open_work_order ? "WO open" : "Dispatch technician"}
          </button>
        </div>
      </aside>
    </>
  );
}

function Stat({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={strong ? "stat-value strong" : "stat-value"}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="drawer-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

import { useCallback, useEffect, useState } from "react";
import { api, errMsg } from "../api";
import { ACTION_LABEL, MODE_LABEL, fmtDayTime, fmtUsd } from "../format";
import { useToast } from "../toast";
import type { Action, Summary } from "../types";
import { ActionDrawer } from "./ActionDrawer";
import { DispatchModal } from "./DispatchModal";
import { RiskCell } from "./RiskCell";

export function ActionsView() {
  const notify = useToast();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [actions, setActions] = useState<Action[] | null>(null);
  const [selectedPump, setSelectedPump] = useState<string | null>(null);
  const [dispatchTarget, setDispatchTarget] = useState<Action | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([api.summary(), api.actions()]);
      setSummary(s);
      setActions([...a].sort((x, y) => x.rank - y.rank));
    } catch (e) {
      notify(errMsg(e), "error");
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = actions?.find((a) => a.pump_id === selectedPump) ?? null;

  return (
    <>
      <KpiStrip summary={summary} />

      <section className="panel">
        <div className="panel-head">
          <h2>Ranked actions</h2>
          <span className="muted small">Sorted by expected $ protected. Click a row for drivers and options.</span>
        </div>
        {actions === null ? (
          <div className="empty">Loading actions...</div>
        ) : actions.length === 0 ? (
          <div className="empty">No pumps above the risk threshold.</div>
        ) : (
          <ActionsTable
            actions={actions}
            selectedPump={selectedPump}
            onSelect={setSelectedPump}
            onDispatch={setDispatchTarget}
          />
        )}
        <p className="footnote">
          Risk = calibrated P(failure mode within 24 pumping hrs). $ figures from value_model.py; synthetic data, hero
          pumps scripted.
        </p>
      </section>

      {selected && (
        <ActionDrawer
          key={selected.pump_id}
          action={selected}
          onClose={() => setSelectedPump(null)}
          onDispatch={() => setDispatchTarget(selected)}
        />
      )}

      {dispatchTarget && (
        <DispatchModal
          action={dispatchTarget}
          onClose={() => setDispatchTarget(null)}
          onDone={() => {
            setDispatchTarget(null);
            void load();
          }}
        />
      )}
    </>
  );
}

function KpiStrip({ summary }: { summary: Summary | null }) {
  const cards = [
    {
      label: "Pumps at risk",
      value: summary ? String(summary.pumps_at_risk) : "-",
      sub: "above the 24 hr risk threshold",
    },
    {
      label: "Expected $ at stake",
      value: summary ? fmtUsd(summary.expected_usd_at_stake) : "-",
      sub: "sum over open actions",
    },
    {
      label: "$ protected this week",
      value: summary ? fmtUsd(summary.protected_this_week_usd) : "-",
      sub: "work orders created in last 7 days",
    },
    {
      label: "Model version",
      value: summary ? `v${summary.model_version}` : "-",
      sub: summary ? `as of ${fmtDayTime(summary.as_of)}` : "",
    },
  ];
  return (
    <div className="kpi-strip">
      {cards.map((c) => (
        <div className="kpi" key={c.label}>
          <div className="kpi-label">{c.label}</div>
          <div className="kpi-value">{c.value}</div>
          <div className="kpi-sub">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

interface ActionsTableProps {
  actions: Action[];
  selectedPump: string | null;
  onSelect: (pumpId: string) => void;
  onDispatch: (action: Action) => void;
}

function ActionsTable({ actions, selectedPump, onSelect, onDispatch }: ActionsTableProps) {
  return (
    <div className="table-wrap">
      <table className="data-table actions-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Pump</th>
            <th>Predicted mode</th>
            <th>Risk (24 hr)</th>
            <th>Best action</th>
            <th className="num">Expected $ protected</th>
            <th>Next gap</th>
            <th aria-label="Dispatch" />
          </tr>
        </thead>
        <tbody>
          {actions.map((a) => (
            <tr
              key={a.pump_id}
              className={selectedPump === a.pump_id ? "selected" : undefined}
              onClick={() => onSelect(a.pump_id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSelect(a.pump_id);
              }}
              tabIndex={0}
            >
              <td className="rank">{a.rank}</td>
              <td>
                <div className="pump-id">{a.pump_id}</div>
                <div className="muted small">Fleet {a.fleet_id}</div>
              </td>
              <td>{MODE_LABEL[a.failure_mode] ?? a.failure_mode}</td>
              <td>
                <RiskCell risk={a.risk} />
              </td>
              <td>{ACTION_LABEL[a.best_action] ?? a.best_action}</td>
              <td className="num money">{fmtUsd(a.expected_savings_usd)}</td>
              <td>
                <div>{fmtDayTime(a.next_gap_start)}</div>
                {a.next_gap_after_stage !== null && (
                  <div className="muted small">after stage {a.next_gap_after_stage}</div>
                )}
              </td>
              <td className="action-cell">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={a.has_open_work_order}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDispatch(a);
                  }}
                >
                  {a.has_open_work_order ? "WO open" : "Dispatch"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

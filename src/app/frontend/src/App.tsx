import { useEffect, useState } from "react";
import { IS_MOCK, api, errMsg } from "./api";
import { ActionsView } from "./components/ActionsView";
import { GeniePanel } from "./components/GeniePanel";
import { TimelineView } from "./components/TimelineView";
import { useToast } from "./toast";
import type { Health } from "./types";

type View = "actions" | "timeline";

const TABS: { id: View; label: string }[] = [
  { id: "actions", label: "Ranked Actions" },
  { id: "timeline", label: "Timeline" },
];

export function App() {
  const notify = useToast();
  const [view, setView] = useState<View>("actions");
  const [genieOpen, setGenieOpen] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch((e) => notify(errMsg(e), "error"));
  }, [notify]);

  const resetDemo = async () => {
    if (!window.confirm("Reset the demo? This removes every work order dispatched in the demo (seeded history stays).")) return;
    try {
      const r = await api.resetDemo();
      notify(`Demo reset: removed ${r.deleted_work_orders} work order(s)`, "success");
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      notify(errMsg(e), "error");
    }
  };

  const modelName = health ? health.model_name.split(".").pop() ?? health.model_name : "frac_pump_failure_model";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>Fleet Reliability Command Center</h1>
          <p className="subtitle">Mesa Ridge Pressure Pumping (fictional) · synthetic data</p>
        </div>

        <nav className="tabs" role="tablist" aria-label="Views">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={view === t.id}
              className={`tab ${view === t.id ? "tab-active" : ""}`}
              onClick={() => setView(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="topbar-right">
          <span className="model-badge" title={health?.model_name ?? "model status unavailable"}>
            {health ? `${modelName} v${health.model_version}` : "model status unavailable"}
          </span>
          <button type="button" className="btn" onClick={resetDemo} title="Remove work orders dispatched in this demo">
            Reset demo
          </button>
          <button
            type="button"
            className={`btn ${genieOpen ? "btn-active" : ""}`}
            aria-pressed={genieOpen}
            onClick={() => setGenieOpen((v) => !v)}
          >
            {genieOpen ? "Hide Ask Genie" : "Ask Genie"}
          </button>
        </div>
      </header>

      {IS_MOCK && <div className="mock-banner">Mock data mode (VITE_MOCK=1). Responses come from src/mock.ts.</div>}

      <div className={`shell ${genieOpen ? "shell-genie" : ""}`}>
        <main className="content">{view === "actions" ? <ActionsView /> : <TimelineView />}</main>
        {genieOpen && (
          <aside className="genie-col">
            <GeniePanel onClose={() => setGenieOpen(false)} />
          </aside>
        )}
      </div>
    </div>
  );
}

import { fmtPct } from "../format";

export function RiskCell({ risk }: { risk: number }) {
  const tone = risk >= 0.7 ? "high" : risk >= 0.4 ? "med" : "low";
  return (
    <div className="risk">
      <span className="risk-val">{fmtPct(risk)}</span>
      <div className="risk-bar" aria-hidden="true">
        <div className={`risk-fill risk-${tone}`} style={{ width: `${Math.round(risk * 100)}%` }} />
      </div>
    </div>
  );
}

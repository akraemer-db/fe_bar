import { useEffect, useState } from "react";
import { api, errMsg } from "../api";
import { ACTION_LABEL, MODE_LABEL, fmtDayTime, fmtUsd, fmtUsdFull, fromInputValue, hhmm, toInputValue } from "../format";
import { Markdown } from "../markdown";
import { useToast } from "../toast";
import type { Action, Technician, WorkOrderDraft } from "../types";

interface DispatchModalProps {
  action: Action;
  onClose: () => void;
  onDone: () => void;
}

type Step = "draft" | "assign";

export function DispatchModal({ action: a, onClose, onDone }: DispatchModalProps) {
  const notify = useToast();
  const [step, setStep] = useState<Step>("draft");
  const [draft, setDraft] = useState<WorkOrderDraft | null>(null);
  const [draftText, setDraftText] = useState("");
  const [editing, setEditing] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [techs, setTechs] = useState<Technician[] | null>(null);
  const [techId, setTechId] = useState("");
  const [windowStart, setWindowStart] = useState(toInputValue(a.next_gap_start));
  const [windowEnd, setWindowEnd] = useState(toInputValue(a.next_gap_end));
  const [submitting, setSubmitting] = useState(false);

  // Step 1: AI-drafted work order, grounded in the procedure library.
  useEffect(() => {
    let alive = true;
    api
      .draftWorkOrder(a.pump_id)
      .then((d) => {
        if (!alive) return;
        setDraft(d);
        setDraftText(d.draft_markdown);
      })
      .catch((e) => {
        if (!alive) return;
        setDraftError(errMsg(e));
        notify(errMsg(e), "error");
      });
    return () => {
      alive = false;
    };
  }, [a.pump_id, notify]);

  // Step 2: technicians for the action's fleet.
  useEffect(() => {
    let alive = true;
    api
      .technicians(a.fleet_id)
      .then((list) => {
        if (!alive) return;
        setTechs(list);
        const firstFree = list.find((t) => t.busy_until === null) ?? list[0];
        if (firstFree) setTechId(firstFree.tech_id);
      })
      .catch((e) => {
        if (!alive) return;
        setTechs([]);
        notify(errMsg(e), "error");
      });
    return () => {
      alive = false;
    };
  }, [a.fleet_id, notify]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const windowValid = windowStart !== "" && windowEnd !== "" && windowEnd > windowStart;
  const canApprove = draft !== null && techId !== "" && windowValid && !submitting;

  const approve = async () => {
    if (!draft || !canApprove) return;
    setSubmitting(true);
    try {
      const wo = await api.createWorkOrder({
        pump_id: a.pump_id,
        fleet_id: a.fleet_id,
        failure_mode: a.failure_mode,
        best_action: a.best_action,
        expected_savings_usd: a.expected_savings_usd,
        tech_id: techId,
        window_start: fromInputValue(windowStart),
        window_end: fromInputValue(windowEnd),
        ai_draft: draftText,
        procedure_id: draft.procedure_id,
        model_version: a.model_version,
      });
      const name = techs?.find((t) => t.tech_id === techId)?.name ?? wo.tech_name ?? techId;
      notify(`${wo.wo_id} dispatched to ${name} for ${hhmm(wo.window_start)} gap`, "success");
      onDone();
    } catch (e) {
      notify(errMsg(e), "error");
      setSubmitting(false);
    }
  };

  const selectedTech = techs?.find((t) => t.tech_id === techId);

  return (
    <>
      <div className="modal-backdrop" onClick={() => !submitting && onClose()} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Dispatch ${a.pump_id}`}>
        <div className="modal-head">
          <div>
            <div className="eyebrow">
              Dispatch · step {step === "draft" ? "1" : "2"} of 2 · {step === "draft" ? "Review draft" : "Assign technician"}
            </div>
            <h2>
              {a.pump_id} · {MODE_LABEL[a.failure_mode] ?? a.failure_mode}
            </h2>
            <div className="small muted">
              {ACTION_LABEL[a.best_action] ?? a.best_action} · expected {fmtUsd(a.expected_savings_usd)} protected
            </div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
        </div>

        {step === "draft" && (
          <div className="modal-body">
            {draftError ? (
              <div className="error-box">Could not draft the work order. {draftError}</div>
            ) : !draft ? (
              <div className="loading-row">
                <span className="spinner" aria-hidden="true" />
                <span>Drafting work order from procedure library...</span>
              </div>
            ) : (
              <>
                <div className="small muted draft-meta">
                  Grounded in <strong>{draft.procedure_id}</strong> · drafted by {draft.model} · trace {draft.trace_id}
                </div>

                <div className="draft-toolbar">
                  <span className="small muted">{editing ? "Editing draft text" : "Preview"}</span>
                  <button type="button" className="btn btn-sm" onClick={() => setEditing((v) => !v)}>
                    {editing ? "Show preview" : "Edit draft"}
                  </button>
                </div>
                {editing ? (
                  <textarea
                    className="draft-editor"
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    rows={14}
                    spellCheck={false}
                  />
                ) : (
                  <div className="draft-view">
                    <Markdown source={draftText} />
                  </div>
                )}

                <h3 className="section-title">Parts</h3>
                <table className="data-table parts-table">
                  <thead>
                    <tr>
                      <th>Part no.</th>
                      <th>Description</th>
                      <th className="num">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.parts.map((p) => (
                      <tr key={p.part_no}>
                        <td className="mono">{p.part_no}</td>
                        <td>{p.description}</td>
                        <td className="num">{fmtUsdFull(p.cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2}>Parts total</td>
                      <td className="num">{fmtUsdFull(draft.parts.reduce((s, p) => s + p.cost_usd, 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </>
            )}
          </div>
        )}

        {step === "assign" && (
          <div className="modal-body">
            <label className="field">
              <span className="field-label">Technician</span>
              {techs === null ? (
                <span className="small muted">Loading technicians...</span>
              ) : techs.length === 0 ? (
                <span className="small muted">No technicians on fleet {a.fleet_id}.</span>
              ) : (
                <select value={techId} onChange={(e) => setTechId(e.target.value)}>
                  {techs.map((t) => (
                    <option key={t.tech_id} value={t.tech_id}>
                      {t.name}, {t.skill}, {t.shift} shift
                      {t.busy_until ? ` (busy until ${fmtDayTime(t.busy_until)})` : ""}
                    </option>
                  ))}
                </select>
              )}
              {selectedTech?.busy_until && (
                <span className="small warn-text">
                  {selectedTech.name} is busy until {fmtDayTime(selectedTech.busy_until)}. Check the window before approving.
                </span>
              )}
            </label>

            <div className="field-row">
              <label className="field">
                <span className="field-label">Window start</span>
                <input type="datetime-local" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">Window end</span>
                <input type="datetime-local" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
              </label>
            </div>
            <p className="small muted">
              Defaults to the next stage gap{a.next_gap_after_stage !== null ? ` after stage ${a.next_gap_after_stage}` : ""}:{" "}
              {fmtDayTime(a.next_gap_start)} to {fmtDayTime(a.next_gap_end)}.
            </p>
            {!windowValid && <div className="error-box">Window end must be after window start.</div>}
          </div>
        )}

        <div className="modal-foot">
          {step === "draft" ? (
            <>
              <span className="small muted">Owner: {a.owner}</span>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!draft}
                onClick={() => setStep("assign")}
              >
                Next: assign technician
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn" onClick={() => setStep("draft")} disabled={submitting}>
                Back
              </button>
              <button type="button" className="btn btn-primary" onClick={approve} disabled={!canApprove}>
                {submitting ? "Dispatching..." : "Approve & dispatch"}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

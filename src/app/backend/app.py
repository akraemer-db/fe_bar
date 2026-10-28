"""Fleet Reliability Command Center: FastAPI backend for the Databricks App.

Data paths (each is the right tool for its access pattern):
  Lakebase (Postgres)  ranked actions, technicians, stage gaps (synced from UC) + work orders (native, written here)
  SQL warehouse        48-hr sensor trends and the latest feature row (analytical reads on gold Delta tables)
  Model Serving        live re-score with frac_pump_failure_model@champion
  FMAPI (Claude)       AI-drafted work orders grounded in the procedure library, traced in MLflow
  Genie                natural-language questions over the governed gold tables + Lakebase work orders
"""
import json
import os
import time
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path

import mlflow
import psycopg
from databricks import sql as dbsql
from databricks.sdk import WorkspaceClient
from databricks.sdk.core import Config
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from psycopg.rows import dict_row
from pydantic import BaseModel

CATALOG = os.getenv("UC_CATALOG", "production_forecasting_catalog")
SCHEMA = os.getenv("UC_SCHEMA", "frac_pump_pdm")
FQ = f"{CATALOG}.{SCHEMA}"
MODEL_NAME = f"{FQ}.frac_pump_failure_model"
ENDPOINT = os.getenv("SERVING_ENDPOINT_NAME", "frac-pump-failure-scorer")
LLM = os.getenv("LLM_ENDPOINT", "databricks-claude-sonnet-4-6")
GENIE_SPACE_ID = os.getenv("GENIE_SPACE_ID", "")
WAREHOUSE_ID = os.getenv("DATABRICKS_WAREHOUSE_ID", "6f1ac903576b114a")
LAKEBASE_ENDPOINT = os.getenv("LAKEBASE_ENDPOINT", "projects/frac-pump-pdm/branches/production/endpoints/primary")
SYNC = SCHEMA  # Postgres schema that holds the synced tables (same name as the UC schema)

w = WorkspaceClient()
cfg = Config()
MODE_LABEL = {"valve_seat_washout": "Valve/seat washout", "packing_failure": "Packing failure",
              "power_end_bearing": "Power end bearing"}
TREND_SIGNALS = {
    "valve_seat_washout": [("valve_impact_max", "Worst-cylinder valve impact (g²)"), ("pulsation_psi_pp", "Discharge pulsation (psi p-p)"),
                           ("cyl_imbalance", "Cylinder imbalance (x)")],
    "packing_failure": [("packing_temp_f", "Packing temp (F)"), ("lube_oil_psi", "Lube delivery pressure (psi)")],
    "power_end_bearing": [("pe_vib_lf_ips", "Crank LF vibration (ips)"), ("lube_oil_temp_f", "Lube oil temp (F)"),
                          ("lube_oil_psi", "Lube oil pressure (psi)")],
}

if os.getenv("MLFLOW_EXPERIMENT_ID"):
    mlflow.set_tracking_uri("databricks")
    mlflow.set_experiment(experiment_id=os.environ["MLFLOW_EXPERIMENT_ID"])
    mlflow.openai.autolog()

# ---------------------------------------------------------------- Lakebase
_token = {"value": None, "expires": 0.0}


def _pg_password():
    if os.getenv("PGPASSWORD"):
        return os.environ["PGPASSWORD"]
    if time.time() > _token["expires"]:
        cred = w.postgres.generate_database_credential(endpoint=LAKEBASE_ENDPOINT)
        _token.update(value=cred.token, expires=time.time() + 45 * 60)  # tokens last 1 hr
    return _token["value"]


@contextmanager
def pg():
    host = os.getenv("PGHOST") or w.postgres.get_endpoint(name=LAKEBASE_ENDPOINT).status.hosts.host
    user = os.getenv("PGUSER") or w.current_user.me().user_name
    with psycopg.connect(host=host, dbname=os.getenv("PGDATABASE", "databricks_postgres"), user=user,
                         password=_pg_password(), port=int(os.getenv("PGPORT", "5432")), sslmode="require",
                         row_factory=dict_row, autocommit=True) as conn:
        yield conn


# ops.* tables are created and seeded by scripts/lakebase_ops_*.sql at deploy time; the app only does DML.


# ---------------------------------------------------------------- SQL warehouse
def wh(query, params=None):
    with dbsql.connect(server_hostname=cfg.host.replace("https://", ""), http_path=f"/sql/1.0/warehouses/{WAREHOUSE_ID}",
                       credentials_provider=lambda: cfg.authenticate) as conn, conn.cursor() as cur:
        cur.execute(query, params or {})
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def iso(v):
    return v.isoformat() if isinstance(v, datetime) else v


def clean(row):
    return {k: (iso(v) if isinstance(v, datetime) else float(v) if hasattr(v, "is_finite") else v) for k, v in row.items()}


# ---------------------------------------------------------------- API
app = FastAPI(title="Fleet Reliability Command Center")


def as_of():
    with pg() as c:
        r = c.execute(f"SELECT max(scored_hour) AS t FROM {SYNC}.lb_ranked_actions").fetchone()
    return r["t"] or datetime.now()


@app.get("/api/health")
def health():
    with pg() as c:
        r = c.execute(f"SELECT max(model_version) AS v FROM {SYNC}.lb_ranked_actions").fetchone()
    return {"status": "ok", "model_name": MODEL_NAME, "model_version": r["v"]}


@app.get("/api/actions")
def actions():
    with pg() as c:
        rows = c.execute(f"""
          SELECT a.*, EXISTS (SELECT 1 FROM ops.work_orders o WHERE o.pump_id = a.pump_id
                              AND o.status <> 'done' AND NOT o.is_synthetic_seed) AS has_open_work_order
          FROM {SYNC}.lb_ranked_actions a ORDER BY a.rank""").fetchall()
    out = []
    for r in rows:
        r = clean(r)
        r["top_drivers"] = json.loads(r["top_drivers"]) if isinstance(r.get("top_drivers"), str) else r.get("top_drivers")
        out.append(r)
    return out


@app.get("/api/summary")
def summary():
    t = as_of()
    with pg() as c:
        a = c.execute(f"SELECT count(*) AS n, coalesce(sum(expected_savings_usd),0) AS usd, max(model_version) AS v "
                      f"FROM {SYNC}.lb_ranked_actions").fetchone()
        p = c.execute("SELECT coalesce(sum(expected_savings_usd),0) AS usd FROM ops.work_orders "
                      "WHERE created_at >= %s", (t - timedelta(days=7),)).fetchone()
    return {"pumps_at_risk": a["n"], "expected_usd_at_stake": float(a["usd"]),
            "protected_this_week_usd": float(p["usd"]), "model_version": a["v"], "as_of": iso(t)}


@app.get("/api/pumps/{pump_id}/trend")
def trend(pump_id: str):
    with pg() as c:
        a = c.execute(f"SELECT failure_mode FROM {SYNC}.lb_ranked_actions WHERE pump_id = %s", (pump_id,)).fetchone()
    mode = a["failure_mode"] if a else "valve_seat_washout"
    sig = TREND_SIGNALS[mode]
    cols = ", ".join(k for k, _ in sig)
    pts = wh(f"SELECT event_ts, {cols} FROM {FQ}.gold_pump_features WHERE pump_id = :p ORDER BY event_ts DESC LIMIT 48",
             {"p": pump_id})
    med = wh(f"SELECT {', '.join(f'percentile_approx({k}, 0.5) AS {k}' for k, _ in sig)} FROM {FQ}.gold_pump_features "
             f"WHERE event_ts >= (SELECT max(event_ts) - INTERVAL 24 HOURS FROM {FQ}.gold_pump_features)")[0]
    return {"pump_id": pump_id, "failure_mode": mode,
            "signals": [{"key": k, "label": l, "fleet_median": float(med[k])} for k, l in sig],
            "points": [clean(p) for p in reversed(pts)]}


def _features(pump_id):
    row = wh(f"SELECT * FROM {FQ}.gold_pump_features WHERE pump_id = :p ORDER BY event_ts DESC LIMIT 1", {"p": pump_id})
    if not row:
        raise HTTPException(404, f"no features for {pump_id}")
    keep = lambda k: k.endswith(("_avg6", "_avg24", "_max6", "_trend")) or k in (
        "hrs_since_valve_change", "rate_bpm_theoretical", "discharge_psi", "proppant_ppa")
    return {k: (float(v) if v is not None else None) for k, v in row[0].items() if keep(k)}


@app.post("/api/pumps/{pump_id}/rescore")
def rescore(pump_id: str):
    feats = _features(pump_id)
    t0 = time.time()
    resp = w.serving_endpoints.query(name=ENDPOINT, dataframe_records=[feats])
    p = resp.predictions[0]
    ep = w.serving_endpoints.get(ENDPOINT)
    version = ep.config.served_entities[0].entity_version if ep.config and ep.config.served_entities else None
    probs = {k[2:]: round(float(v), 3) for k, v in p.items() if k.startswith("p_")}
    return {"pump_id": pump_id, "risk": round(float(p["risk"]), 3), "top_mode": p["top_mode"], "probabilities": probs,
            "model_version": version, "endpoint": ENDPOINT, "latency_ms": int((time.time() - t0) * 1000)}


@app.get("/api/technicians")
def technicians(fleet_id: str | None = None):
    with pg() as c:
        rows = c.execute(f"""
          SELECT t.tech_id, t.name, t.home_fleet_id, t.skill, t.shift,
                 (SELECT max(o.window_end) FROM ops.work_orders o WHERE o.tech_id = t.tech_id
                   AND o.status IN ('scheduled','dispatched','in_progress')) AS busy_until
          FROM {SYNC}.lb_technicians t WHERE %s::text IS NULL OR t.home_fleet_id = %s ORDER BY t.tech_id""",
                         (fleet_id, fleet_id)).fetchall()
    return [clean(r) for r in rows]


class DraftReq(BaseModel):
    pump_id: str


@mlflow.trace(name="draft_work_order", span_type="CHAIN")
def _draft(action, procs, parts):
    prompt = f"""You are a reliability planner at a frac pressure-pumping company. Draft a concise field work order.

Pump: {action['pump_id']} (fleet {action['fleet_id']}), quintuplex 2,500 HHP
Predicted failure mode: {MODE_LABEL[action['failure_mode']]} with calibrated risk {action['risk']:.0%} within 24 pumping hours
Recommended action: {action['best_action']} (expected $ protected {action['expected_savings_usd']:,.0f})
Evidence from the model: {'; '.join(action['top_drivers'])}
Window: next stage gap {action['next_gap_start']} to {action['next_gap_end']}

Procedures (cite by ID, do not invent steps outside them):
{json.dumps(procs, indent=1)}

Parts available for this mode:
{json.dumps(parts, indent=1)}

Rules: cite the procedure IDs you used. Never state torque, pressure, or test values; refer to the OEM manual and site procedure.
Always include the isolation/zero-energy step. Output markdown with sections: Why this pump, Steps, Parts kit, Safety, Estimated time."""
    out = w.serving_endpoints.get_open_ai_client().chat.completions.create(
        model=LLM, messages=[{"role": "user", "content": prompt}], max_tokens=900, temperature=0.2)
    return out.choices[0].message.content


@app.post("/api/work_orders/draft")
def draft(req: DraftReq):
    a = next((x for x in actions() if x["pump_id"] == req.pump_id), None)
    if not a:
        raise HTTPException(404, f"{req.pump_id} is not in the ranked actions")
    procs = wh(f"SELECT procedure_id, title, steps FROM {FQ}.dim_procedure_library "
               f"WHERE failure_mode IN (:m, 'all') ORDER BY procedure_id", {"m": a["failure_mode"]})
    parts = wh(f"SELECT part_no, description, cost_usd FROM {FQ}.dim_parts_catalog WHERE failure_mode = :m",
               {"m": a["failure_mode"]})
    text = _draft(a, procs, parts)
    trace_id = mlflow.get_last_active_trace_id() if os.getenv("MLFLOW_EXPERIMENT_ID") else None
    primary = next((p["procedure_id"] for p in procs if p["procedure_id"] != "PROC-SAF-001"), procs[0]["procedure_id"])
    return {"pump_id": a["pump_id"], "failure_mode": a["failure_mode"], "procedure_id": primary,
            "draft_markdown": text, "parts": [clean(p) for p in parts], "trace_id": trace_id, "model": LLM}


class WorkOrderReq(BaseModel):
    pump_id: str
    fleet_id: str
    failure_mode: str
    best_action: str
    expected_savings_usd: float
    tech_id: str
    window_start: str
    window_end: str
    ai_draft: str | None = None
    procedure_id: str | None = None
    model_version: str | None = None
    trace_id: str | None = None


def _who():
    return os.getenv("DATABRICKS_CLIENT_ID", "local-dev")


WO_SELECT = """SELECT o.*, t.name AS tech_name FROM ops.work_orders o
               LEFT JOIN {sync}.lb_technicians t ON t.tech_id = o.tech_id"""


@app.post("/api/work_orders")
def create_wo(req: WorkOrderReq):
    with pg() as c:
        r = c.execute("""INSERT INTO ops.work_orders (pump_id, fleet_id, failure_mode, best_action, expected_savings_usd,
                         tech_id, window_start, window_end, ai_draft, procedure_id, model_version, trace_id, created_by, created_at)
                         VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING wo_id""",
                      (req.pump_id, req.fleet_id, req.failure_mode, req.best_action, req.expected_savings_usd, req.tech_id,
                       req.window_start, req.window_end, req.ai_draft, req.procedure_id, req.model_version, req.trace_id,
                       _who(), as_of())).fetchone()
        c.execute("INSERT INTO ops.wo_events (wo_id, status, changed_by) VALUES (%s, 'scheduled', %s)", (r["wo_id"], _who()))
        row = c.execute(WO_SELECT.format(sync=SYNC) + " WHERE o.wo_id = %s", (r["wo_id"],)).fetchone()
    return clean(row)


@app.get("/api/work_orders")
def list_wo():
    with pg() as c:
        rows = c.execute(WO_SELECT.format(sync=SYNC) + " ORDER BY o.created_at DESC LIMIT 50").fetchall()
    return [clean(r) for r in rows]


class StatusReq(BaseModel):
    status: str


@app.patch("/api/work_orders/{wo_id}")
def update_wo(wo_id: str, req: StatusReq):
    if req.status not in ("scheduled", "dispatched", "in_progress", "done"):
        raise HTTPException(400, "bad status")
    with pg() as c:
        c.execute("UPDATE ops.work_orders SET status = %s, updated_at = now(), "
                  "completed_at = CASE WHEN %s = 'done' THEN now() ELSE completed_at END WHERE wo_id = %s",
                  (req.status, req.status, wo_id))
        c.execute("INSERT INTO ops.wo_events (wo_id, status, changed_by) VALUES (%s, %s, %s)", (wo_id, req.status, _who()))
        row = c.execute(WO_SELECT.format(sync=SYNC) + " WHERE o.wo_id = %s", (wo_id,)).fetchone()
    if not row:
        raise HTTPException(404, wo_id)
    return clean(row)


@app.get("/api/timeline")
def timeline(hours: int = 48):
    now = as_of()
    with pg() as c:
        techs = c.execute(f"SELECT tech_id, name, home_fleet_id, skill, shift FROM {SYNC}.lb_technicians ORDER BY tech_id").fetchall()
        blocks = c.execute("""SELECT wo_id, tech_id, pump_id, failure_mode, window_start AS start, window_end AS "end", status
                              FROM ops.work_orders WHERE window_end >= %s AND window_start <= %s""",
                           (now - timedelta(hours=6), now + timedelta(hours=hours))).fetchall()
        gaps = c.execute(f"""SELECT fleet_id, gap_start, gap_end, stage_no AS after_stage FROM {SYNC}.lb_stage_schedule
                             WHERE gap_start <= %s ORDER BY fleet_id, gap_start""", (now + timedelta(hours=hours),)).fetchall()
    return {"now": iso(now), "technicians": [clean(t) for t in techs], "blocks": [clean(b) for b in blocks],
            "stage_gaps": [clean(g) for g in gaps]}


class GenieReq(BaseModel):
    question: str
    conversation_id: str | None = None


@app.post("/api/genie/ask")
def genie(req: GenieReq):
    if not GENIE_SPACE_ID:
        raise HTTPException(503, "GENIE_SPACE_ID not configured")
    if req.conversation_id:
        msg = w.genie.create_message_and_wait(GENIE_SPACE_ID, req.conversation_id, req.question)
    else:
        msg = w.genie.start_conversation_and_wait(GENIE_SPACE_ID, req.question)
    text, sql_text, cols, rows = [], None, [], []
    for att in msg.attachments or []:
        if att.text and att.text.content:
            text.append(att.text.content)
        if att.query:
            sql_text = att.query.query
            if att.query.description:
                text.append(att.query.description)
            res = w.genie.get_message_attachment_query_result(GENIE_SPACE_ID, msg.conversation_id, msg.id, att.attachment_id)
            sr = res.statement_response
            if sr and sr.manifest and sr.result:
                cols = [c.name for c in sr.manifest.schema.columns]
                rows = (sr.result.data_array or [])[:50]
    return {"conversation_id": msg.conversation_id, "answer_text": "\n\n".join(text), "sql": sql_text,
            "columns": cols, "rows": rows}


# ---------------------------------------------------------------- static React build
STATIC = Path(__file__).parent / "static"
if STATIC.exists():
    app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = STATIC / path
        return FileResponse(f if path and f.is_file() else STATIC / "index.html")

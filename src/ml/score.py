# Databricks notebook source
# MAGIC %md
# MAGIC # Batch score + ranked actions
# MAGIC 1. Score each pump's latest hour with `frac_pump_failure_model@champion`.
# MAGIC 2. Explain each risk in plain language (signal vs the fleet's normal).
# MAGIC 3. Price three options per at-risk pump with `value_model.decide_action()` (keep running, swap at next stage gap, pull now).
# MAGIC    It's the same function the deck numbers come from, so the app, Genie, and the deck can't disagree.
# MAGIC 4. Publish `gold_pump_risk_scores`, `gold_ranked_actions`, `value_assumptions`, `mode_costs` (sources for Lakebase and Genie).

# COMMAND ----------

# MAGIC %pip install -q lightgbm==4.5.0 tabulate
# MAGIC %restart_python

# COMMAND ----------

dbutils.widgets.text("catalog", "production_forecasting_catalog")
dbutils.widgets.text("schema", "frac_pump_pdm")
C, S = dbutils.widgets.get("catalog"), dbutils.widgets.get("schema")
FQ = f"{C}.{S}"
MODEL_NAME = f"{FQ}.frac_pump_failure_model"

import os, sys, json
import numpy as np, pandas as pd, mlflow
from mlflow import MlflowClient
from pyspark.sql import functions as F

sys.path.append(os.path.abspath("../../value_model"))
import value_model as vm

mlflow.set_registry_uri("databricks-uc")
mv = MlflowClient().get_model_version_by_alias(MODEL_NAME, "champion")
threshold = float(mv.tags.get("threshold", 0.5))
model = mlflow.pyfunc.load_model(f"models:/{MODEL_NAME}@champion")
features = model.metadata.get_input_schema().input_names()
print(f"{MODEL_NAME} v{mv.version} (threshold {threshold})")

# COMMAND ----------

feat = spark.table(f"{FQ}.gold_pump_features")
latest = (feat.withColumn("rn", F.row_number().over(
    __import__("pyspark.sql.window", fromlist=["Window"]).Window.partitionBy("pump_id").orderBy(F.desc("event_ts"))))
    .where("rn = 1").drop("rn").toPandas())
pred = model.predict(latest[features])
scores = pd.concat([latest[["pump_id", "fleet_id", "event_ts"]].reset_index(drop=True), pred], axis=1)
scores["model_name"], scores["model_version"] = MODEL_NAME, str(mv.version)

# plain-language drivers: how far each mode's key signals sit from the fleet-wide median right now
DRIVERS = {
    "valve_seat_washout": [("valve_impact_max_avg6", "worst-cylinder valve impact", "x"), ("pulsation_psi_pp_avg6", "discharge pulsation", "%"),
                           ("cyl_imbalance_avg6", "cylinder imbalance", "x")],
    "packing_failure": [("packing_temp_f_avg6", "packing temp", "F"), ("lube_oil_psi_avg6", "lube delivery pressure", "psi")],
    "power_end_bearing": [("pe_vib_lf_ips_avg6", "crank LF vibration", "%"), ("lube_oil_temp_f_avg6", "lube oil temp", "F"),
                          ("lube_oil_psi_avg6", "lube oil pressure", "psi")],
}
med = latest[sorted({c for v in DRIVERS.values() for c, _, _ in v})].median()

def drivers(row, mode):
    out = []
    for col, label, unit in DRIVERS[mode]:
        x, m = row[col], med[col]
        if unit == "x":
            out.append(f"{label} {x / m:.1f}x fleet normal")
        elif unit == "%":
            out.append(f"{label} {100 * (x / m - 1):+.0f}% vs fleet")
        else:
            out.append(f"{label} {x - m:+.1f} {unit} vs fleet")
    if mode == "valve_seat_washout":
        out.insert(0, f"cylinder {int(row['valve_impact_worst_cyl'])} flagged")
    return out

scores["top_drivers"] = [json.dumps(drivers(latest.iloc[i], scores.top_mode[i])) for i in range(len(scores))]
spark.createDataFrame(scores).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{FQ}.gold_pump_risk_scores")
print(scores.sort_values("risk", ascending=False).head(8)[["pump_id", "top_mode", "risk"]].to_string(index=False))

# COMMAND ----------

# MAGIC %md ## Price the options and rank by expected $ protected

# COMMAND ----------

sched = spark.table(f"{FQ}.dim_stage_schedule").toPandas()
now = pd.Timestamp(latest.event_ts.max())
next_gap = (sched[pd.to_datetime(sched.gap_start) > now].sort_values("gap_start").groupby("fleet_id").first()
            [["stage_no", "gap_start", "gap_end"]].reset_index())
standby_free = {f: True for f in scores.fleet_id.unique()}     # 4 standby pumps per fleet; demo assumes one is free

rows = []
for _, r in scores[scores.risk >= threshold].iterrows():
    d = vm.decide_action(float(r.risk), r.top_mode, standby_available=standby_free[r.fleet_id])
    mp = vm.mode_params(vm.ASSUMPTIONS)[r.top_mode]
    rows.append({"pump_id": r.pump_id, "fleet_id": r.fleet_id, "scored_hour": r.event_ts, "failure_mode": r.top_mode,
                 "risk": round(float(r.risk), 3), "best_action": d["best_action"], "expected_savings_usd": d["expected_savings"],
                 "cost_if_failed_usd": d["cost_if_failed"], "planned_fix_usd": d["planned_fix"],
                 "option_keep_running_usd": d["options"]["keep_running"], "option_pull_now_usd": d["options"]["pull_now"],
                 "option_swap_at_gap_usd": d["options"].get("swap_at_next_gap"), "standby_available": d["standby_available"],
                 "owner": mp["owner"], "top_drivers": r.top_drivers, "model_version": r.model_version})
actions = pd.DataFrame(rows).merge(next_gap, on="fleet_id", how="left").rename(
    columns={"stage_no": "next_gap_after_stage", "gap_start": "next_gap_start", "gap_end": "next_gap_end"})
actions = actions.sort_values("expected_savings_usd", ascending=False).reset_index(drop=True)
actions.insert(0, "rank", actions.index + 1)
spark.createDataFrame(actions).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{FQ}.gold_ranked_actions")
spark.sql(f"ALTER TABLE {FQ}.gold_ranked_actions SET TBLPROPERTIES (delta.enableChangeDataFeed = true)")
spark.sql(f"COMMENT ON TABLE {FQ}.gold_ranked_actions IS 'At-risk pumps ranked by expected $ protected (value_model.decide_action). One row per pump; synced to Lakebase.'")
print(actions[["rank", "pump_id", "failure_mode", "risk", "best_action", "expected_savings_usd"]].head(10).to_string(index=False))

# COMMAND ----------

# MAGIC %md ## Publish the value model tables (Genie and the app quote these, never hard-coded numbers)

# COMMAND ----------

va = pd.read_csv("../../value_model/value_assumptions.csv")
mc = pd.read_csv("../../value_model/mode_costs.csv")
spark.createDataFrame(va.astype({"value": float})).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{FQ}.value_assumptions")
spark.createDataFrame(mc.fillna({"event_mix": 0})).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{FQ}.mode_costs")
levers = []
for scen in ("conservative", "target"):
    r = vm.run(scen)
    for lever, key, proven in [("Failures caught early (ML)", "lever1_ml", "POC backtest"),
                               ("Fluid end life +10%", "lever2_fe_life", "Pilot"),
                               ("Condition-based consumables -10%", "lever3_consumables", "Pilot")]:
        levers.append({"scenario": scen, "lever": lever, "annual_usd": float(r[key]), "proven_in": proven})
    levers.append({"scenario": scen, "lever": "Program total", "annual_usd": float(r["program_total"]), "proven_in": ""})
spark.createDataFrame(pd.DataFrame(levers)).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{FQ}.value_model_levers")
display(spark.table(f"{FQ}.mode_costs"))
display(spark.table(f"{FQ}.value_model_levers"))

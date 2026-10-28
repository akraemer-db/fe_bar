# Databricks notebook source
# MAGIC %md
# MAGIC # Train: calendar-rule baseline vs calibrated LightGBM
# MAGIC Predicts **which failure mode (if any) hits each pump within the next 24 pumping hours**.
# MAGIC
# MAGIC The model has to beat what Mesa Ridge does today (change valves on hours), measured in **dollars**, not accuracy:
# MAGIC * Event-level: a failure counts as caught if the right mode is flagged at least 1 pumping hour ahead (the next stage gap).
# MAGIC * Alarms: one alarm per pump per 24 hrs; an alarm with no failure of that mode within 24 hrs is a false alarm ($4k standby swap + inspection).
# MAGIC * Value per catch comes from `value_model.py` (`cost_if_failed - planned_fix`), the same numbers the deck and app use.
# MAGIC
# MAGIC Time split: train on months 1-9, test on months 10-12. Synthetic data proves the pipeline works, not the value.

# COMMAND ----------

# MAGIC %pip install -q lightgbm==4.5.0
# MAGIC %restart_python

# COMMAND ----------

dbutils.widgets.text("catalog", "production_forecasting_catalog")
dbutils.widgets.text("schema", "frac_pump_pdm")
C, S = dbutils.widgets.get("catalog"), dbutils.widgets.get("schema")
FQ = f"{C}.{S}"
MODEL_NAME = f"{FQ}.frac_pump_failure_model"

import os, sys, json
import numpy as np, pandas as pd
import mlflow, lightgbm as lgb
from mlflow.models import infer_signature
from sklearn.calibration import CalibratedClassifierCV

sys.path.append(os.path.abspath("../../value_model"))
import value_model as vm

mlflow.set_registry_uri("databricks-uc")
mlflow.set_experiment(f"/Users/{spark.sql('select current_user()').first()[0]}/frac_pump_pdm")
MODES = ["valve_seat_washout", "packing_failure", "power_end_bearing"]
CLASSES = ["healthy"] + MODES
VALUE_PER_CATCH = {m: vm.cost_if_failed(vm.ASSUMPTIONS, m) - vm.mode_params(vm.ASSUMPTIONS)[m]["planned_fix"] for m in MODES}
FALSE_ALARM_COST = vm.v(vm.ASSUMPTIONS, "false_alarm_cost")
print({k: round(v) for k, v in VALUE_PER_CATCH.items()}, "false alarm $", FALSE_ALARM_COST)

# COMMAND ----------

df = spark.table(f"{FQ}.gold_pump_features").toPandas()
df["event_ts"] = pd.to_datetime(df.event_ts)
FEATURES = [c for c in df.columns if c.endswith(("_avg6", "_avg24", "_max6", "_trend"))] + \
           ["hrs_since_valve_change", "rate_bpm_theoretical", "discharge_psi", "proppant_ppa"]
split_ts = df.event_ts.max() - pd.Timedelta(days=92)
train, test = df[df.event_ts < split_ts], df[df.event_ts >= split_ts]
val_ts = split_ts - pd.Timedelta(days=60)
fit, val = train[train.event_ts < val_ts], train[train.event_ts >= val_ts]
print(f"rows: train {len(train):,} | test {len(test):,} | features {len(FEATURES)}")
print("label mix (train):", train.label.value_counts().to_dict())

# COMMAND ----------

def evaluate(frame, probs, threshold):
    """Event-level catches, alarm-level precision, and $ for one operating threshold.

    Every labeled hour points at its failure via pump_hour_meter + hrs_to_next_failure, which is a unique failure key.
    """
    f = frame[["pump_id", "event_ts", "label", "hrs_to_next_failure", "pump_hour_meter"]].copy()
    for i, m in enumerate(MODES):
        f[f"p_{m}"] = probs[:, i + 1]
    f["flag_mode"] = f[[f"p_{m}" for m in MODES]].idxmax(axis=1).str[2:]
    f["flag"] = f[[f"p_{m}" for m in MODES]].max(axis=1) >= threshold
    lab = f[f.label != "healthy"].copy()
    lab["fail_key"] = lab.pump_id + "@" + (lab.pump_hour_meter + lab.hrs_to_next_failure).astype(int).astype(str)
    ev = lab.groupby(["fail_key", "pump_id", "label"]).event_ts.max().rename("last_labeled_ts").reset_index()
    hit = lab[lab.flag & (lab.flag_mode == lab.label) & (lab.hrs_to_next_failure >= 1)]
    ev = ev.merge(hit.groupby("fail_key").hrs_to_next_failure.max().rename("lead_hrs"), on="fail_key", how="left")
    ev["caught"] = ev.lead_hrs.notna()
    # alarms: first flag per pump per 24 hrs; true if that mode fails within 24 pumping hrs
    a = f[f.flag].sort_values(["pump_id", "event_ts"])
    a = a[a.groupby("pump_id").event_ts.diff().fillna(pd.Timedelta(days=9)) > pd.Timedelta(hours=24)].copy()
    a["true_alarm"] = a.label == a.flag_mode
    pumps = frame.pump_id.nunique()
    days = max((frame.event_ts.max() - frame.event_ts.min()).days, 1)
    gross = sum(VALUE_PER_CATCH[m] for m in ev[ev.caught].label)
    fa = int((~a.true_alarm).sum())
    out = {"threshold": threshold, "events": len(ev), "caught": int(ev.caught.sum()),
           "recall": float(ev.caught.mean()) if len(ev) else 0.0, "alarms": len(a), "false_alarms": fa,
           "precision": float(a.true_alarm.mean()) if len(a) else 0.0,
           "false_alarms_per_pump_month": fa / pumps / (days / 30.4),
           "median_lead_hrs": float(ev.lead_hrs.median()) if ev.caught.any() else 0.0,
           "net_usd_annualized": (gross - fa * FALSE_ALARM_COST) * 365 / days}
    for m in MODES:
        e = ev[ev.label == m]
        out[f"recall_{m}"] = float(e.caught.mean()) if len(e) else 0.0
        out[f"n_{m}"] = len(e)
    return out, ev, a


def best_threshold(frame, probs, grid=np.round(np.arange(0.2, 0.95, 0.05), 2)):
    rows = [evaluate(frame, probs, t)[0] for t in grid]
    curve = pd.DataFrame(rows)
    return float(curve.loc[curve.net_usd_annualized.idxmax(), "threshold"]), curve

# COMMAND ----------

# MAGIC %md ## Run 1: calendar baseline (current practice)
# MAGIC Risk of valve/seat washout rises with hours since the last valve change. It can't see packing or power end failures at all.

# COMMAND ----------

def calendar_probs(frame, k):
    p = np.zeros((len(frame), 4))
    p[:, 1] = 1 / (1 + np.exp(-(frame.hrs_since_valve_change.values - k) / 6.0))
    p[:, 0] = 1 - p[:, 1]
    return p

with mlflow.start_run(run_name="calendar_baseline") as base_run:
    grid = [(k, evaluate(val, calendar_probs(val, k), 0.5)[0]["net_usd_annualized"]) for k in range(50, 110, 5)]
    k_best = max(grid, key=lambda x: x[1])[0]
    base_metrics, base_events, _ = evaluate(test, calendar_probs(test, k_best), 0.5)
    mlflow.log_params({"rule": "valve change due when hrs_since_valve_change > k", "k_hours": k_best})
    mlflow.log_metrics({k: float(v) for k, v in base_metrics.items() if isinstance(v, (int, float, np.floating))})
print(json.dumps({k: (round(v, 3) if isinstance(v, float) else v) for k, v in base_metrics.items()}, indent=1))

# COMMAND ----------

# MAGIC %md ## Run 2: LightGBM + isotonic calibration
# MAGIC Healthy hours are down-sampled for training only; evaluation always uses every test hour.

# COMMAND ----------

class FailureModeModel(mlflow.pyfunc.PythonModel):
    """Returns calibrated P(mode within 24 pumping hrs) per class plus the top mode."""
    def __init__(self, clf, features, classes):
        self.clf, self.features, self.classes = clf, features, classes
    def predict(self, context, model_input):
        p = self.clf.predict_proba(model_input[self.features])
        out = pd.DataFrame(p, columns=[f"p_{c}" for c in self.classes])
        out["top_mode"] = [self.classes[1:][i] for i in p[:, 1:].argmax(axis=1)]
        out["risk"] = p[:, 1:].max(axis=1)
        return out

def downsample(frame, healthy_frac=0.08, seed=7):
    pos = frame[frame.label != "healthy"]
    neg = frame[frame.label == "healthy"].sample(frac=healthy_frac, random_state=seed)
    return pd.concat([pos, neg])

params = {"n_estimators": 300, "learning_rate": 0.05, "num_leaves": 31, "min_child_samples": 40,
          "subsample": 0.8, "subsample_freq": 1, "colsample_bytree": 0.8, "class_weight": "balanced", "verbose": -1}
with mlflow.start_run(run_name="lightgbm_calibrated") as run:
    tr = downsample(fit)
    y = tr.label.map({c: i for i, c in enumerate(CLASSES)})
    clf = CalibratedClassifierCV(lgb.LGBMClassifier(**params), method="isotonic", cv=3).fit(tr[FEATURES], y)
    thr, curve = best_threshold(val, clf.predict_proba(val[FEATURES]))
    # refit on all training months, evaluate once on the untouched test months
    tr = downsample(train)
    clf = CalibratedClassifierCV(lgb.LGBMClassifier(**params), method="isotonic", cv=3).fit(
        tr[FEATURES], tr.label.map({c: i for i, c in enumerate(CLASSES)}))
    probs = clf.predict_proba(test[FEATURES])
    metrics, test_events, alarms = evaluate(test, probs, thr)
    brier = float(np.mean(np.sum((probs - np.eye(4)[test.label.map({c: i for i, c in enumerate(CLASSES)})]) ** 2, axis=1)))

    mlflow.log_params({**{f"lgbm_{k}": v for k, v in params.items()}, "calibration": "isotonic cv=3",
                       "threshold": thr, "healthy_downsample": 0.08, "label_horizon_pumping_hrs": 24,
                       "split": f"train < {split_ts:%Y-%m-%d} <= test"})
    mlflow.log_metrics({**{k: float(v) for k, v in metrics.items() if isinstance(v, (int, float, np.floating))},
                        "brier_score": brier,
                        "net_usd_vs_baseline": metrics["net_usd_annualized"] - base_metrics["net_usd_annualized"]})
    imp = pd.DataFrame({"feature": FEATURES, "gain": np.mean(
        [c.estimator.booster_.feature_importance("gain") for c in clf.calibrated_classifiers_], axis=0)}
    ).sort_values("gain", ascending=False)
    mlflow.log_text(imp.head(20).to_markdown(index=False), "feature_importance_top20.md")
    mlflow.log_text(curve.round(3).to_markdown(index=False), "threshold_curve_validation.md")
    mlflow.log_text(test_events.to_markdown(index=False), "test_events.md")

    example = test[FEATURES].head(5)
    wrapped = FailureModeModel(clf, FEATURES, CLASSES)
    info = mlflow.pyfunc.log_model(
        name="model", python_model=wrapped, input_example=example,
        signature=infer_signature(example, wrapped.predict(None, example)),
        pip_requirements=["lightgbm==4.5.0", "scikit-learn", "pandas", "numpy"],
        registered_model_name=MODEL_NAME)
    run_id = run.info.run_id

# COMMAND ----------

from mlflow import MlflowClient
client = MlflowClient()
version = info.registered_model_version
client.set_registered_model_alias(MODEL_NAME, "champion", version)
client.set_model_version_tag(MODEL_NAME, version, "threshold", str(thr))
client.update_model_version(MODEL_NAME, version, description=(
    f"Calibrated LightGBM, threshold {thr}. Test recall {metrics['recall']:.0%}, precision {metrics['precision']:.0%}, "
    f"net ${metrics['net_usd_annualized']/1e6:.2f}M/yr annualized vs calendar baseline ${base_metrics['net_usd_annualized']/1e6:.2f}M/yr."))

summary = pd.DataFrame([{"run": "calendar_baseline", **base_metrics}, {"run": "lightgbm_calibrated", **metrics}]).set_index("run").T
spark.createDataFrame(summary.reset_index().rename(columns={"index": "metric"}).astype(str)) \
    .write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{FQ}.ml_model_comparison")
print(f"Registered {MODEL_NAME} v{version} as @champion (run {run_id}), threshold {thr}")
print(summary.to_string())

# COMMAND ----------

# MAGIC %md ## Honest model: one miss and one false alarm (from the test period)

# COMMAND ----------

miss = test_events[(test_events.pump_id == "F11-P05")]
print("Scripted miss (valve/seat washout with no precursor):")
print(miss.to_string(index=False))
fa = alarms[(alarms.pump_id == "F02-P17") & (~alarms.true_alarm)]
print("\nScripted false alarm (benign valve-impact transient):")
print(fa[["pump_id", "event_ts", "flag_mode"]].to_string(index=False))
print(f"\nAll test misses: {int((~test_events.caught).sum())} of {len(test_events)}; false alarms: {metrics['false_alarms']}")

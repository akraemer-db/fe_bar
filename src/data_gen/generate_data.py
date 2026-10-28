# Databricks notebook source
# MAGIC %md
# MAGIC # Synthetic frac pump data: Mesa Ridge Pressure Pumping (fictional)
# MAGIC
# MAGIC Simulates 12 months of **hourly edge-aggregated pump features** for 15 fleets (300 active pumps), plus the CMMS
# MAGIC history and reference tables, and lands them as raw files in the `raw_landing` volume for Auto Loader.
# MAGIC
# MAGIC Physics-informed, not random noise:
# MAGIC * **Valve/seat washout:** cylinder-local valve impact energy and discharge pulsation ramp 2-10 pumping hrs before failure. Hazard rises with hours since the last calendar valve change, so the calendar rule has real (but limited) skill.
# MAGIC * **Packing failure:** packing temperature climbs and lube delivery pressure sags 4-20 hrs ahead.
# MAGIC * **Power end bearing:** low-frequency crank vibration, lube oil temperature, and falling lube pressure drift 20-100 hrs ahead.
# MAGIC * **Cavitation:** low suction at high rate raises kurtosis (feeds the fluid-end-life lever, not the classifier).
# MAGIC * **Realism:** false precursors (benign transients), sensor dropouts, a few corrupt rows (caught by pipeline expectations), and ~10% of failures with no precursor (seeded misses).
# MAGIC
# MAGIC Event counts are **calibrated** to `value_model.py` (152 valve/seat, 82 packing, 45 power end per year). Calibration, not validation.

# COMMAND ----------

dbutils.widgets.text("catalog", "production_forecasting_catalog")
dbutils.widgets.text("schema", "frac_pump_pdm")
CATALOG = dbutils.widgets.get("catalog")
SCHEMA = dbutils.widgets.get("schema")
ROOT = f"/Volumes/{CATALOG}/{SCHEMA}/raw_landing"

import json, os, shutil
import numpy as np
import pandas as pd

rng = np.random.default_rng(42)
NOW = pd.Timestamp("2026-10-28 12:00:00")       # demo "now"
START = NOW - pd.Timedelta(days=365)
HOURS = pd.date_range(START, NOW, freq="h", inclusive="left")
H = len(HOURS)
N_FLEETS, ACTIVE, STANDBY = 15, 20, 4
EVENTS_PER_YEAR = {"valve_seat_washout": 152, "packing_failure": 82, "power_end_bearing": 45}
LEAD_HRS = {"valve_seat_washout": (2, 10), "packing_failure": (4, 20), "power_end_bearing": (20, 100)}
MISS_SHARE = 0.10
print(f"Window {START} -> {NOW}, {H} hours; landing to {ROOT}")

# COMMAND ----------

# MAGIC %md ## Reference data: fleets, pumps, technicians, parts, procedures, stage schedule

# COMMAND ----------

fleets = pd.DataFrame({
    "fleet_id": [f"F{i:02d}" for i in range(1, N_FLEETS + 1)],
    "basin": ["Midland" if i % 3 else "Delaware" for i in range(1, N_FLEETS + 1)],
    "region": ["Permian North" if i <= 8 else "Permian South" for i in range(1, N_FLEETS + 1)],
    "fleet_type": "dual-fuel",
    "customer_pad": [f"Pad {chr(64 + i)}-{rng.integers(10, 99)}" for i in range(1, N_FLEETS + 1)],
})

pump_rows = []
for f in fleets.fleet_id:
    for p in range(1, ACTIVE + STANDBY + 1):
        pump_rows.append({
            "pump_id": f"{f}-P{p:02d}", "fleet_id": f, "role": "active" if p <= ACTIVE else "standby",
            "pump_model": "QX-2500 quintuplex", "hhp": 2500, "fluid_end_type": "stainless",
            "install_year": int(rng.integers(2018, 2025)),
            "hour_meter_start": int(rng.integers(2_000, 25_000)),
        })
pumps = pd.DataFrame(pump_rows)
active = pumps[pumps.role == "active"].reset_index(drop=True)

first = ["Ray", "Luis", "Jesse", "Tanya", "Cody", "Maria", "Dale", "Erin", "Hector", "Kim", "Wade", "Rosa",
         "Trent", "Alma", "Brent", "Gina", "Shane", "Lupe", "Clay", "Nina"]
last = ["Gomez", "Pruitt", "Okafor", "Vance", "Delgado", "Hale", "Ibarra", "Steele", "Moreno", "Quinn",
        "Rios", "Talley", "Banks", "Cortez", "Fry", "Lowe"]
skills = ["fluid end", "fluid end", "power end", "fluid end + power end"]
techs = []
for i, f in enumerate(fleets.fleet_id):
    for k in range(4):
        n = i * 4 + k
        techs.append({"tech_id": f"T{n + 1:03d}", "name": f"{first[n % 20][0]}. {last[(n * 7) % 16]}",
                      "home_fleet_id": f, "skill": skills[k], "shift": "day" if k < 2 else "night",
                      "phone": f"432-555-{1000 + n:04d}"})
technicians = pd.DataFrame(techs)
technicians.loc[technicians.home_fleet_id == "F07", "name"] = ["R. Gomez", "J. Pruitt", "T. Okafor", "C. Vance"]

parts_catalog = pd.DataFrame([
    ("VS-KIT-5", "valve_seat_washout", "Valve + seat kit, 5 cylinders (suction + discharge)", 4200, 2.0),
    ("VS-KIT-1", "valve_seat_washout", "Valve + seat kit, single cylinder", 950, 0.75),
    ("PK-SET-5", "packing_failure", "Packing set + header ring, 5 plungers", 2400, 1.5),
    ("PK-SET-1", "packing_failure", "Packing set, single plunger", 520, 0.5),
    ("PL-1", "packing_failure", "Plunger (replace if scored)", 1800, 0.5),
    ("PE-BRG-SET", "power_end_bearing", "Crankshaft main + rod bearing set", 7600, 6.0),
    ("PE-LUBE-SVC", "power_end_bearing", "Lube oil, filters, and sample kit", 900, 1.0),
    ("SUC-HOSE", "suction_cavitation", "Suction hose + boost check", 1400, 1.0),
], columns=["part_no", "failure_mode", "description", "cost_usd", "labor_hrs"])

procedure_library = pd.DataFrame([
    ("PROC-FE-101", "valve_seat_washout", "Valve and seat replacement (stage gap)",
     "1. Confirm standby pump online and spread rate stable. 2. Isolate pump: close suction and discharge valves, LOTO the engine and transmission per site procedure. "
     "3. Bleed to zero and verify zero energy. 4. Remove suction and discharge covers on the flagged cylinder; inspect seat deck for washout cuts. "
     "5. Replace valve, seat, spring, and insert as a kit; do not reuse seats. 6. If seat deck erosion is visible, tag the fluid end for shop NDE. "
     "7. Reinstall covers to OEM torque spec (see OEM manual, not this card). 8. Pressure test per site procedure before returning to the line."),
    ("PROC-FE-205", "packing_failure", "Packing replacement and lube line check",
     "1. Swap to standby and isolate as in PROC-FE-101. 2. Inspect plunger for scoring; replace if grooved. 3. Replace packing set and header ring. "
     "4. Verify lube delivery at the packing point (not just header pressure). 5. Adjust per OEM procedure; avoid over-tightening. 6. Run-in and monitor packing temperature for 2 hrs."),
    ("PROC-PE-310", "power_end_bearing", "Power end bearing inspection and shop swap",
     "1. Pull the unit at the next safe window and bring a standby online. 2. Take a lube oil sample (iron ppm) before draining. "
     "3. Do not run to failure: crank and rod bearing failure can damage the crankshaft. 4. Swap the power end assembly or send the unit to the shop for a bearing overhaul. "
     "5. Record bearing condition photos for the reliability team."),
    ("PROC-SUC-120", "suction_cavitation", "Suction-side cavitation check",
     "1. Owner: blender / suction crew, not the pump tech. 2. Check boost pressure at the pump inlet against the minimum for the current rate. "
     "3. Inspect suction hoses for collapse and the dampener charge. 4. Reduce rate on the affected pump or rebalance HHP across the fleet until suction is restored."),
    ("PROC-SAF-001", "all", "Isolation and zero-energy verification",
     "Follow site lockout/tagout. High-pressure iron: verify zero pressure with two independent gauges before breaking any connection. No one in the red zone while pressurized."),
], columns=["procedure_id", "failure_mode", "title", "steps"])
procedure_library["is_synthetic"] = True

# next 48 hrs of stage windows per fleet (for dispatch timeline)
sched = []
for f in fleets.fleet_id:
    t = NOW + pd.Timedelta(minutes=int(rng.integers(5, 60)))
    s = 1
    while t < NOW + pd.Timedelta(hours=48):
        dur = pd.Timedelta(minutes=int(rng.integers(100, 150)))
        gap = pd.Timedelta(minutes=int(rng.integers(35, 70)))
        sched.append({"fleet_id": f, "stage_no": s, "stage_start": t, "stage_end": t + dur,
                      "gap_start": t + dur, "gap_end": t + dur + gap})
        t, s = t + dur + gap, s + 1
stage_schedule = pd.DataFrame(sched)
print(len(fleets), "fleets |", len(pumps), "pumps |", len(technicians), "techs |", len(stage_schedule), "upcoming stages")

# COMMAND ----------

# MAGIC %md ## Fleet pumping schedule (pads and pad moves, ~5,000 pumping hrs/yr)

# COMMAND ----------

def fleet_schedule():
    on = np.zeros(H, dtype=bool)
    t = int(rng.integers(0, 48))
    while t < H:
        pad = int(rng.normal(8, 2) * 24)                  # pad length (hrs)
        day = np.arange(t, min(t + pad, H))
        on[day] = rng.random(len(day)) < 0.875             # ~21 pumping hrs per on-pad day
        t += pad + int(rng.uniform(1.5, 6.5) * 24)         # pad move
    return on

fleet_on = {f: fleet_schedule() for f in fleets.fleet_id}
for f in ["F07", "F03"]:                                   # hero fleets are pumping right now
    fleet_on[f][-60:] = True
print("Mean pumping hrs/fleet:", int(np.mean([v.sum() for v in fleet_on.values()])))

# COMMAND ----------

# MAGIC %md ## Simulate each active pump: baseline physics, calendar valve changes, failures, precursors

# COMMAND ----------

def ramp(n):
    return (np.arange(1, n + 1) / n) ** 1.5

frames, events = [], []
eid = 0
hero = {"F07-P09": ("power_end_bearing", 55, 45, None), "F07-P14": ("valve_seat_washout", 8, 6, 2),
        "F03-P02": ("packing_failure", 16, 9, None)}
demo_cases = {"miss": "F11-P05", "false_alarm": "F02-P17"}
test_start = HOURS[int(H * 0.75)]

# distribute the year's unplanned failures across pumps
fail_plan = []
for mode, n in EVENTS_PER_YEAR.items():
    for _ in range(n):
        fail_plan.append((mode, int(rng.integers(0, len(active)))))
# move one valve washout onto the scripted miss pump (keeps the 152 total)
miss_idx = int(active.index[active.pump_id == demo_cases["miss"]][0])
k = next(j for j, (m, _) in enumerate(fail_plan) if m == "valve_seat_washout")
fail_plan[k] = ("valve_seat_washout", miss_idx)
by_pump = {}
for mode, i in fail_plan:
    by_pump.setdefault(i, []).append(mode)

for i, row in active.iterrows():
    pid, fid = row.pump_id, row.fleet_id
    idx = np.flatnonzero(fleet_on[fid])                     # hours this pump pumps
    n = len(idx)
    meter = row.hour_meter_start + np.arange(n)
    rate = np.clip(rng.normal(4.7, 0.25, n), 3.8, 5.4)      # bpm per pump (fleet ~95 bpm)
    ppa = np.clip(rng.normal(1.8, 0.6, n), 0, 3.5)
    rpm = rate / 4.7 * 220 + rng.normal(0, 4, n)
    discharge = np.clip(rng.normal(9200, 450, n) + 300 * (ppa - 1.8), 6500, 12500)
    suction = np.clip(rng.normal(95, 10, n), 40, 140)
    load = np.clip(55 + 8 * (rate - 4.7) + 0.004 * (discharge - 9200) + rng.normal(0, 3, n), 30, 98)
    impact = ((rate / 4.7) ** 1.2 * (1 + 0.04 * ppa))[:, None] * rng.normal(1.0, 0.07, (n, 5))
    pulsation = rng.normal(150, 12, n) * (rate / 4.7)
    pe_vib = rng.normal(0.25, 0.02, n)
    kurt = rng.normal(3.0, 0.25, n)
    pack_t = rng.normal(140, 4, n) + 2 * (rate - 4.7)
    lube_t = rng.normal(150, 3, n)
    lube_p = rng.normal(60, 1.5, n)

    # cavitation episodes: low suction at high rate
    for _ in range(int(rng.integers(1, 4))):
        s = int(rng.integers(0, max(n - 12, 1))); L = int(rng.integers(3, 12))
        suction[s:s + L] = rng.normal(48, 6, len(suction[s:s + L]))
        kurt[s:s + L] += rng.normal(1.5, 0.3, len(kurt[s:s + L]))

    # calendar valve changes every 40-100 pumping hrs -> CMMS + hazard clock
    changes = []
    t = int(rng.integers(0, 60))
    while t < n:
        changes.append(t)
        eid += 1
        events.append((f"E{eid:06d}", pid, fid, HOURS[idx[t]], int(meter[t]), "calendar_valve_change", None,
                       "valves + seats", 4200, 2.0, 0.0, True))
        t += int(rng.integers(40, 100))
    marker = np.zeros(n, dtype=int)
    marker[changes] = np.array(changes)
    last_change = np.maximum.accumulate(marker)
    since_valve = np.arange(n) - last_change + np.where(np.arange(n) < (changes[0] if changes else n), int(rng.integers(0, 40)), 0)

    # planned fluid end changes at end of life
    fe_age = int(rng.integers(0, 1600)); t = 0
    while True:
        life = int(np.clip(rng.normal(1600, 250), 900, 2400))
        t += life - fe_age; fe_age = 0
        if t >= n:
            break
        eid += 1
        events.append((f"E{eid:06d}", pid, fid, HOURS[idx[t]], int(meter[t]), "planned_fluid_end_change", None,
                       "fluid end", 65000, 6.0, 0.0, True))

    def apply(mode, lo, hi, cyl, r):
        if mode == "valve_seat_washout":
            impact[lo:hi, cyl] *= 1 + 2.1 * r
            pulsation[lo:hi] *= 1 + 0.4 * r
        elif mode == "packing_failure":
            pack_t[lo:hi] += 32 * r
            lube_p[lo:hi] -= 3 * r
        elif mode == "power_end_bearing":
            pe_vib[lo:hi] *= 1 + 0.9 * r
            lube_t[lo:hi] += 12 * r
            lube_p[lo:hi] -= 7 * r

    # unplanned failures with precursors
    for mode in by_pump.get(i, []):
        if mode == "valve_seat_washout":                  # hazard grows with hours since valve change
            w = (since_valve / 60.0) ** 3; w = w / w.sum()
            t = int(rng.choice(n, p=w))
        else:
            t = int(rng.integers(120, n))
        if HOURS[idx[t]] > NOW - pd.Timedelta(hours=30):   # keep the live window clean for hero pumps
            t = int(rng.integers(120, n - 60))
        miss = rng.random() < MISS_SHARE
        if pid == demo_cases["miss"] and mode == "valve_seat_washout":
            miss = True                                    # no precursor, lands in the test window
            t = int(np.searchsorted(HOURS[idx], test_start + pd.Timedelta(days=55)))
        lead = int(rng.integers(*LEAD_HRS[mode]))
        cyl = int(rng.integers(0, 5))
        if not miss:
            lo = max(t - lead, 0)
            apply(mode, lo, t, cyl, ramp(t - lo))
        eid += 1
        npt = {"valve_seat_washout": 2.5, "packing_failure": 2.0, "power_end_bearing": 4.0}[mode] * (rng.random() < 0.5)
        cost = {"valve_seat_washout": 26000 + 4200, "packing_failure": 15000 + 2400, "power_end_bearing": 70000}[mode]
        events.append((f"E{eid:06d}", pid, fid, HOURS[idx[t]], int(meter[t]), "unplanned_failure", mode,
                       {"valve_seat_washout": "valves + seats + seat deck", "packing_failure": "packing + bore",
                        "power_end_bearing": "power end bearings"}[mode], cost, 8.0, float(npt), False))

    # false precursors: benign transients that fade without a failure
    for _ in range(int(rng.poisson(0.9))):
        mode = rng.choice(list(LEAD_HRS)); L = int(rng.integers(3, 10)); s = int(rng.integers(0, n - L))
        apply(mode, s, s + L, int(rng.integers(0, 5)), np.sin(np.linspace(0.2, np.pi, L)) * 0.8)
    if pid == demo_cases["false_alarm"]:
        s = int(np.searchsorted(HOURS[idx], test_start + pd.Timedelta(days=40)))
        apply("valve_seat_washout", s, s + 6, 1, np.sin(np.linspace(0.2, np.pi, 6)))

    # hero pumps: live precursors at NOW, no failure yet
    if pid in hero:
        mode, lead, elapsed, cyl = hero[pid]
        r = ramp(lead)[:elapsed]
        apply(mode, n - elapsed, n, cyl if cyl is not None else 0, r)

    df = pd.DataFrame({
        "event_ts": HOURS[idx], "pump_id": pid, "fleet_id": fid, "pump_hour_meter": meter,
        "rate_bpm_theoretical": rate.round(2), "pump_rpm": rpm.round(1), "engine_load_pct": load.round(1),
        "suction_psi": suction.round(1), "discharge_psi": discharge.round(0), "proppant_ppa": ppa.round(2),
        **{f"valve_impact_c{c + 1}": impact[:, c].round(3) for c in range(5)},
        "pulsation_psi_pp": pulsation.round(1), "pe_vib_lf_ips": pe_vib.round(3), "vib_kurtosis": kurt.round(2),
        "packing_temp_f": pack_t.round(1), "lube_oil_temp_f": lube_t.round(1), "lube_oil_psi": lube_p.round(1),
    })
    frames.append(df)

telemetry = pd.concat(frames, ignore_index=True)

# sensor dropouts and a few corrupt rows (pipeline expectations should catch these)
drop = rng.random(len(telemetry)) < 0.004
telemetry.loc[drop, ["packing_temp_f", "lube_oil_temp_f"]] = np.nan
bad = rng.choice(len(telemetry), 250, replace=False)
telemetry.loc[bad[:150], "discharge_psi"] = -1.0
telemetry.loc[bad[150:], "pump_rpm"] = -5.0

maintenance = pd.DataFrame(events, columns=["event_id", "pump_id", "fleet_id", "event_ts", "pump_hour_meter",
                                            "event_type", "failure_mode", "component", "parts_cost_usd",
                                            "labor_hrs", "spread_npt_hrs", "planned"])
print(f"telemetry rows: {len(telemetry):,}  | pumping hrs/pump: {len(telemetry) / len(active):,.0f}")
print(maintenance.groupby(["event_type", "failure_mode"], dropna=False).size().to_string())

# COMMAND ----------

# MAGIC %md ## Land raw files in the volume (JSON per day for telemetry, CSV for CMMS and reference data)

# COMMAND ----------

for sub in ["telemetry", "maintenance", "reference"]:
    path = f"{ROOT}/{sub}"
    if os.path.exists(path):
        shutil.rmtree(path)
    os.makedirs(path, exist_ok=True)

telemetry["day"] = telemetry.event_ts.dt.strftime("%Y-%m-%d")
for day, g in telemetry.groupby("day"):
    g.drop(columns="day").to_json(f"{ROOT}/telemetry/edge_{day}.json", orient="records", lines=True, date_format="iso")

maintenance.to_csv(f"{ROOT}/maintenance/cmms_export_{NOW:%Y%m%d}.csv", index=False)
for name, df in {"fleets": fleets, "pumps": pumps, "technicians": technicians, "parts_catalog": parts_catalog,
                 "procedure_library": procedure_library, "stage_schedule": stage_schedule}.items():
    df.to_csv(f"{ROOT}/reference/{name}.csv", index=False)

print("telemetry files:", len(os.listdir(f"{ROOT}/telemetry")))
print("reference files:", sorted(os.listdir(f"{ROOT}/reference")))

# COMMAND ----------

# MAGIC %md ## Calibration check against the value model (calibration, not validation)

# COMMAND ----------

unpl = maintenance[maintenance.event_type == "unplanned_failure"]
summary = {
    "active_pumps": int(len(active)),
    "telemetry_rows": int(len(telemetry)),
    "pumping_hrs_per_pump": round(len(telemetry) / len(active)),
    "planned_fluid_end_changes": int((maintenance.event_type == "planned_fluid_end_change").sum()),
    "calendar_valve_changes": int((maintenance.event_type == "calendar_valve_change").sum()),
    "unplanned_by_mode": unpl.failure_mode.value_counts().to_dict(),
    "unplanned_total": int(len(unpl)),
    "pump_caused_spread_npt_hrs": float(unpl.spread_npt_hrs.sum()),
    "hero_pumps": {k: v[0] for k, v in hero.items()},
    "demo_miss_pump": demo_cases["miss"], "demo_false_alarm_pump": demo_cases["false_alarm"],
    "value_model_targets": {"valve_seat_washout": 152, "packing_failure": 82, "power_end_bearing": 45,
                            "pump_npt_hrs": 362, "fluid_end_changes": 938},
}
print(json.dumps(summary, indent=2))

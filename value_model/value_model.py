"""Value model v3: frac pump predictive maintenance for Mesa Ridge Pressure Pumping (fictional).

Single source of truth for every dollar and hour figure in the deck, app, and Genie.
`decide_action()` is the same three-option pricing the scoring job and app use (imported, not copied).

Run: python3 value_model.py   (prints scenarios + sensitivity, writes CSVs + value_model_output.txt)

Levers
  1. ML-attributable: unplanned valve/seat, packing and power end failures caught a stage ahead.
     Measured in the POC backtest.
  2. Program: fluid end life extension. Mechanism: the same telemetry flags cavitation and
     operating-envelope abuse (low suction at high HHP, pressure spikes). Fixing the suction side
     extends fluid end life, which is the root cause behind Evolution Well Services' +63%.
     It's analytics on the same platform, not the 24-hr classifier. Measured in the pilot.
  3. Program: condition-based consumables, replacing valves/seats/packing on condition, not hours.
     Measured in the pilot.

All outputs are MODELED ESTIMATES. Tags: SOURCED (public source), ESTIMATE (our estimate),
VALIDATE (replaced with customer data in the POC).
"""
import csv
import os

# key: (value, unit, source, tag)
ASSUMPTIONS = {
    # sizing
    "fleets":                   (15, "fleets", "Fictional company sizing", "ESTIMATE"),
    "active_pumps_per_fleet":   (20, "pumps", "Typical 20-24 units incl. standby (ProPetro 50-80k HHP / 2,500 HHP units)", "SOURCED"),
    "standby_pumps_per_fleet":  (4, "pumps", "Same as above", "SOURCED"),
    "revenue_per_fleet":        (75e6, "$/yr", "ProPetro 2025 frac revenue / active fleets = $70-80M", "SOURCED"),
    "ebitda_per_fleet":         (18e6, "$/yr", "ProPetro 2025 frac adj. EBITDA / fleet $15-21M (ProFrac margins lower)", "SOURCED"),
    "operating_days":           (300, "days/yr", "Planning assumption", "VALIDATE"),
    "pumping_hrs_per_pump":     (5000, "pumping hrs/yr per active pump", "Patterson-UTI: ~21-22 pumping hrs per on-pad day (fleet level); allow pad moves + rotation", "VALIDATE"),
    "contribution_margin":      (0.35, "share of lost revenue", "Between ProPetro EBITDA margin (~22-25%) and incremental margin", "VALIDATE"),
    # failure base
    "fluid_end_life_hrs":       (1600, "pumping hrs", "SPM: stainless fluid end industry average", "SOURCED"),
    "fluid_end_cost":           (65_000, "$", "Kerr/SPM $40-90k; planning $65k", "SOURCED"),
    "unplanned_fe_share":       (0.25, "share of fluid end changes", "Replace with CMMS planned/unplanned flag", "VALIDATE"),
    "fe_mix_valve_seat":        (0.65, "share of unplanned FE events", "Estimate; valve/seat dominant", "VALIDATE"),
    "fe_mix_packing":           (0.35, "share of unplanned FE events", "Estimate", "VALIDATE"),
    "pe_failures_per_pump":     (0.15, "per active pump per yr", "Replace with CMMS", "VALIDATE"),
    "share_events_causing_npt": (0.50, "share", "Standby pumps absorb the rest; replace with NPT log", "VALIDATE"),
    "expedite_cost":            (8_000, "$/event", "Hot-shot parts, overtime; replace with AP", "VALIDATE"),
    # per-mode
    "valve_seat_npt_hrs":       (2.5, "spread hrs if it stops the spread", "Estimate", "VALIDATE"),
    "valve_seat_fe_damage":     (0.40, "share of fluid end value destroyed by washout", "Estimate: some seat decks are repairable, some retire the block. Sensitivity 0.2-1.0", "VALIDATE"),
    "valve_seat_planned_fix":   (5_000, "$", "Supplier QPA2500 consumables overhaul $3.3-5.2k incl. labor", "SOURCED"),
    "packing_npt_hrs":          (2.0, "spread hrs", "Estimate", "VALIDATE"),
    "packing_bore_repair":      (15_000, "$", "Estimate: packing bore repair/sleeve", "VALIDATE"),
    "packing_planned_fix":      (3_000, "$", "Estimate", "VALIDATE"),
    "power_end_npt_hrs":        (4.0, "spread hrs", "Estimate", "VALIDATE"),
    "power_end_rebuild":        (70_000, "$", "FTSI $45k (2020) to $100k major rebuild; planning $70k", "SOURCED"),
    "power_end_planned_fix":    (10_000, "$", "Supplier limited power end overhaul $6-10k", "SOURCED"),
    # decision
    "risk_horizon_hrs":         (24, "pumping hrs", "Model label window (~3 stages)", "ESTIMATE"),
    "hrs_to_next_gap":          (1.5, "pumping hrs", "Typical time to next stage gap", "ESTIMATE"),
    "pull_now_npt_hrs":         (0.75, "spread hrs", "Unscheduled stop to isolate and swap", "ESTIMATE"),
    # model operating points (from the same threshold curve)
    "precision_conservative":   (0.50, "share", "Operating point at 25% catch (higher threshold)", "VALIDATE"),
    "precision_target":         (0.35, "share", "Operating point at 50% catch (lower threshold)", "VALIDATE"),
    "false_alarm_cost":         (4_000, "$/alarm", "Standby swap + teardown inspection + consumables replaced while open", "ESTIMATE"),
    # costs
    "implementation_one_time":  (750_000, "$", "Services + customer team + edge config", "ESTIMATE"),
    "sensor_retrofit_allowance": (3_000_000, "$", "~$10k/pump x 300 if sensors are missing; $0 if already instrumented", "VALIDATE"),
    "platform_run_rate":        (600_000, "$/yr", "Databricks consumption, 15 fleets", "ESTIMATE"),
    # program levers
    "fe_life_extension":        (0.10, "share", "Conservative vs Evolution +63% (cavitation root cause fixed)", "SOURCED"),
    "consumables_per_fleet":    (1.2e6, "$/yr", "Valves, seats, packing, plungers; replace with AP", "VALIDATE"),
    "consumables_reduction":    (0.10, "share", "Conservative vs Baker Hughes +27% valve life with condition monitoring", "SOURCED"),
    "stages_per_day":           (9.5, "stages/day", "AADE 2025: 8.9-9.8 continuous pumping", "SOURCED"),
}


def v(a, k):
    return a[k][0]


def revenue_per_spread_hr(a):
    return v(a, "revenue_per_fleet") / (v(a, "operating_days") * 24)  # ~$10.4k, matches SLB 2015 pumping share


def mode_params(a):
    npt_val = v(a, "share_events_causing_npt") * revenue_per_spread_hr(a) * v(a, "contribution_margin")
    return {
        "valve_seat_washout": dict(npt_hrs=v(a, "valve_seat_npt_hrs"), damage=v(a, "valve_seat_fe_damage") * v(a, "fluid_end_cost"),
                                   planned_fix=v(a, "valve_seat_planned_fix"), owner="Pump tech", npt_val=npt_val),
        "packing_failure":    dict(npt_hrs=v(a, "packing_npt_hrs"), damage=v(a, "packing_bore_repair"),
                                   planned_fix=v(a, "packing_planned_fix"), owner="Pump tech", npt_val=npt_val),
        "power_end_bearing":  dict(npt_hrs=v(a, "power_end_npt_hrs"), damage=v(a, "power_end_rebuild"),
                                   planned_fix=v(a, "power_end_planned_fix"), owner="Shop (swap to standby)", npt_val=npt_val),
    }


def cost_if_failed(a, mode):
    m = mode_params(a)[mode]
    return m["npt_hrs"] * m["npt_val"] + m["damage"] + v(a, "expedite_cost")


def decide_action(risk, mode, standby_available=True, a=ASSUMPTIONS):
    """Price three options for one at-risk pump. Values are expected cost (negative = cost).

    risk: calibrated P(failure of `mode` within risk_horizon_hrs pumping hours).
    expected_savings is a one-time, per-decision value (not annualized).
    """
    cif = cost_if_failed(a, mode)
    fix = mode_params(a)[mode]["planned_fix"]
    hourly_margin = revenue_per_spread_hr(a) * v(a, "contribution_margin")
    residual = risk * v(a, "hrs_to_next_gap") / v(a, "risk_horizon_hrs")  # chance it fails before the gap
    # Pulling with a standby free costs a short unscheduled stop; without one, the spread loses the
    # full repair window (same spread hrs as the failure itself, conservative).
    pull_hrs = v(a, "pull_now_npt_hrs") if standby_available else mode_params(a)[mode]["npt_hrs"]
    options = {"keep_running": -risk * cif,
               "pull_now": -fix - pull_hrs * hourly_margin}
    if standby_available:
        options["swap_at_next_gap"] = -fix - residual * cif
    best = max(options, key=options.get)
    return dict(mode=mode, risk=risk, cost_if_failed=round(cif), planned_fix=fix, standby_available=standby_available,
                options={k: round(x) for k, x in options.items()}, best_action=best,
                expected_savings=round(options[best] - options["keep_running"]))


def run(scenario, a=ASSUMPTIONS):
    catch, precision = {"conservative": (0.25, v(a, "precision_conservative")),
                        "target": (0.50, v(a, "precision_target"))}[scenario]
    pumps = v(a, "fleets") * v(a, "active_pumps_per_fleet")
    fe_changes = pumps * v(a, "pumping_hrs_per_pump") / v(a, "fluid_end_life_hrs")
    fe_unplanned = fe_changes * v(a, "unplanned_fe_share")
    events = {"valve_seat_washout": fe_unplanned * v(a, "fe_mix_valve_seat"),
              "packing_failure": fe_unplanned * v(a, "fe_mix_packing"),
              "power_end_bearing": pumps * v(a, "pe_failures_per_pump")}
    mp = mode_params(a)

    baseline = sum(n * cost_if_failed(a, m) for m, n in events.items())
    npt_hrs = sum(n * v(a, "share_events_causing_npt") * mp[m]["npt_hrs"] for m, n in events.items())
    gross = catch * sum(n * (cost_if_failed(a, m) - mp[m]["planned_fix"]) for m, n in events.items())
    caught = catch * sum(events.values())
    false_alarms = caught * (1 - precision) / precision
    lever1 = gross - false_alarms * v(a, "false_alarm_cost") - v(a, "platform_run_rate")

    fe_spend = fe_changes * v(a, "fluid_end_cost")
    lever2 = (fe_changes - fe_changes / (1 + v(a, "fe_life_extension"))) * v(a, "fluid_end_cost")
    lever3 = v(a, "fleets") * v(a, "consumables_per_fleet") * v(a, "consumables_reduction")
    program = lever1 + lever2 + lever3
    one_time = v(a, "implementation_one_time")
    one_time_w_sensors = one_time + v(a, "sensor_retrofit_allowance")
    f = v(a, "fleets")

    return dict(
        catch_rate=catch, precision=precision,
        active_pumps=pumps,
        fluid_end_changes=fe_changes, fluid_end_spend=fe_spend, fluid_end_spend_per_fleet=fe_spend / f,
        unplanned_events=sum(events.values()),
        events_by_mode={m: round(n, 1) for m, n in events.items()},
        baseline_failure_cost=baseline,
        baseline_pump_npt_hrs=npt_hrs, baseline_pump_npt_hrs_per_fleet=npt_hrs / f,
        events_caught=caught, avg_value_per_catch=gross / caught,
        false_alarms_per_yr=false_alarms, false_alarms_per_pump_month=false_alarms / pumps / 12,
        break_even_precision=v(a, "false_alarm_cost") / (gross / caught + v(a, "false_alarm_cost")),
        lever1_ml=lever1, lever1_per_fleet=lever1 / f,
        lever2_fe_life=lever2, lever3_consumables=lever3,
        program_total=program, program_per_fleet=program / f,
        program_pct_fleet_ebitda=program / f / v(a, "ebitda_per_fleet"),
        lever1_pct_fleet_ebitda=lever1 / f / v(a, "ebitda_per_fleet"),
        spread_hrs_recovered=catch * npt_hrs,
        stages_capacity=catch * npt_hrs / 24 * v(a, "stages_per_day"),
        payback_months_lever1=12 * one_time / lever1,
        payback_months_lever1_w_sensors=12 * one_time_w_sensors / lever1,
        payback_months_program=12 * one_time / program,
        payback_months_program_w_sensors=12 * one_time_w_sensors / program,
    )


HEROES = [("F07-P09", 0.72, "power_end_bearing", "quiet: lube oil +9F, crank LF vibration creeping"),
          ("F07-P14", 0.86, "valve_seat_washout", "loud: cylinder 3 valve impact energy rising"),
          ("F03-P02", 0.55, "packing_failure", "packing temp rising, lube delivery dropping")]


def fmt(x):
    if isinstance(x, (dict, str)):
        return x
    return f"{x:,.3f}" if abs(x) < 10 else f"{x:,.0f}"


def sensitivity(key, lo, hi, metric="lever1_ml", scenario="conservative"):
    out = []
    for val in (lo, hi):
        a2 = dict(ASSUMPTIONS)
        a2[key] = (val,) + ASSUMPTIONS[key][1:]
        out.append(run(scenario, a2)[metric] / 1e6)
    return out


def report():
    lines = []
    p = lines.append
    for s in ("conservative", "target"):
        p(f"\n== {s.upper()} ==")
        for k, val in run(s).items():
            p(f"{k:>34}: {fmt(val)}")
    p("\n== Mode costs (EBITDA basis) ==")
    p(f"revenue_per_spread_hr (derived): ${revenue_per_spread_hr(ASSUMPTIONS):,.0f}")
    for m, d in mode_params(ASSUMPTIONS).items():
        p(f"{m:>20}: cost if failed ${cost_if_failed(ASSUMPTIONS, m):,.0f} | planned fix ${d['planned_fix']:,} | owner {d['owner']}")
    p("\n== Hero ranked actions (decide_action) ==")
    for pump, risk, mode, why in sorted(HEROES, key=lambda h: -decide_action(h[1], h[2])["expected_savings"]):
        p(f"{pump} ({why}): {decide_action(risk, mode)}")
    p(f"F07-P09 with NO standby free: {decide_action(0.72, 'power_end_bearing', standby_available=False)}")
    p("\n== Sensitivity (conservative) ==")
    for key, lo, hi, metric in [
        ("share_events_causing_npt", 0.0, 1.0, "lever1_ml"), ("unplanned_fe_share", 0.10, 0.35, "lever1_ml"),
        ("pe_failures_per_pump", 0.05, 0.25, "lever1_ml"), ("pumping_hrs_per_pump", 3600, 6000, "lever1_ml"),
        ("contribution_margin", 0.25, 0.50, "lever1_ml"), ("precision_conservative", 0.25, 0.75, "lever1_ml"),
        ("valve_seat_fe_damage", 0.20, 1.00, "lever1_ml"),
        ("fe_life_extension", 0.05, 0.20, "program_total"), ("consumables_reduction", 0.05, 0.20, "program_total")]:
        lo_v, hi_v = sensitivity(key, lo, hi, metric)
        p(f"{key:>26} {lo} -> {hi}: {metric} ${lo_v:.1f}M -> ${hi_v:.1f}M")
    a2 = dict(ASSUMPTIONS); a2["valve_seat_fe_damage"] = (1.0,) + ASSUMPTIONS["valve_seat_fe_damage"][1:]
    p(f"Hero check at valve_seat_fe_damage=1.0: F07-P14 {decide_action(0.86, 'valve_seat_washout', a=a2)['expected_savings']:,} "
      f"vs F07-P09 {decide_action(0.72, 'power_end_bearing', a=a2)['expected_savings']:,}")
    return "\n".join(lines)


if __name__ == "__main__":
    out = report()
    print(out)
    here = os.path.dirname(os.path.abspath(__file__))
    open(os.path.join(here, "value_model_output.txt"), "w").write(out + "\n")
    with open(os.path.join(here, "value_assumptions.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["key", "value", "unit", "source", "tag"])
        for k, row in ASSUMPTIONS.items():
            w.writerow([k, *row])
    with open(os.path.join(here, "mode_costs.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["failure_mode", "npt_hrs_if_stops_spread", "damage_cost", "planned_fix", "owner", "cost_if_failed"])
        for m, d in mode_params(ASSUMPTIONS).items():
            w.writerow([m, d["npt_hrs"], d["damage"], d["planned_fix"], d["owner"], round(cost_if_failed(ASSUMPTIONS, m))])

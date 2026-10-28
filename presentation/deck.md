# Fleet Reliability Command Center
### Fix the right frac pump in the next stage gap
Mesa Ridge Pressure Pumping (fictional company, synthetic data) x Databricks | Deck v4: app-delivered value only. Numbers come from `value_model/value_model_output.md` and refresh from the build.

---

## Slide 1 (TELL): The value

# $1.7-3.6M a year (est.)
**added EBITDA from catching pump failures before they happen**

# 22-44% less
**spent on unplanned pump failures: today ~$11.9M a year**

# 70-140 of ~280
**breakdowns a year prevented, giving back 90-180 hours of spread time**

> Your pumps already signal trouble before they fail. We turn those signals into a ranked, priced list of what to fix in the next stage gap.

*Footnote: Modeled from public benchmarks (SPM, Patterson-UTI, ProPetro, SLB, McKinsey). Net of false alarms and the $0.6M/yr platform run rate; steady state after a $0.75M implementation. The POC replaces every assumption with your CMMS, AP, and pump-hour data.*

*Speaker notes: Every number on this slide is something the app does: it predicts the failure, prices the fix, and dispatches the tech. Dana hears the first number, Marcus the second and third. Pays back in 3-5 months if the pumps are already instrumented.*

---

## Slide 2 (TELL): What unplanned pump failures cost today (modeled)

| What happens | Est. per yr | Cost if run to failure (EBITDA basis) | If caught in a stage gap |
|---|---|---|---|
| Valve/seat washout erodes the seat deck | ~152 | ~$39k: lost spread time + early fluid end retirement + hot-shot parts | ~$5k valve/seat change |
| Packing failure erodes the bore | ~82 | ~$27k | ~$3k |
| Power end bearing failure | ~45 | ~$85k: $70k rebuild + lost spread time + $8k expedite | ~$10k overhaul |
| **Total unplanned** | **~279** | **~$11.9M** and ~362 hrs of pump-caused spread downtime (~24 per fleet) | **Each catch is worth ~$37k net** |

*Speaker notes: Lost spread time is valued at 35% contribution margin, not revenue, and only half of failures are assumed to stop the spread, since standby pumps absorb the rest. 24 hrs per fleet is deliberately conservative against Patterson-UTI's 8-12% non-pumping time. Your NPT log replaces it in week 1.*

---

## Slide 3 (TELL): What changes for each leader

| | **Dana Ortiz, VP Operations** (exec sponsor) | **Marcus Lee, Director of Fleet Reliability** (domain owner) |
|---|---|---|
| Today | ~279 unplanned pump repairs a year, explained to E&P customers after the fact | Calendar maintenance, firefighting, no way to rank risks by $ |
| With the Command Center | **+$1.7-3.6M EBITDA a year**, 90-180 spread hours back, 70-140 fewer unplanned red-zone repairs | **A dollar-ranked list** of which pump to fix, which option (keep, swap at gap, pull now), and who's free |
| KPIs, modeled baseline to target | Unplanned failure cost $11.9M/yr, -22-44%. Pump NPT 24 hrs/fleet, -25-50% | Unplanned failures 279/yr, -70-140. MTBF per mode (valve/seat ~10k pumping hrs today). False alarms under 0.1 per pump-month |

**Industry Outcome Map:** Energy, *Optimize Operations*, Predictive Maintenance / Asset Reliability (asset uptime, MTBF, MTTR).

---

## Slide 4 (TELL): How it works

Pump edge sensors, then **Lakeflow** ingest, then the **Unity Catalog** governed lakehouse, then an **MLflow model** (risk of each failure mode in the next 24 pumping hours), then **Lakebase** (live ops: work orders, crews, schedules), then the **Databricks App** (ranked actions, dispatch, AI work orders), with a **Genie Agent** for questions in plain English.

One platform from sensor to work order, governed in one place. It works alongside your CMMS, and doesn't replace it.

---

## Slide 5 (SHOW): The loud pump vs the expensive pump

*[Live: Ranked Actions. Evidence: `evidence/10_ranked_actions.txt`]*

| Rank | Pump | Predicted mode | 24-hr risk | Best option | Expected $ protected |
|---|---|---|---|---|---|
| 1 | F07-P09 | Power end bearing. Quiet: lube oil +9°F, crank vibration creeping | 0.72 | Pull now, standby online | ~$49k |
| 2 | F07-P14 | Valve/seat washout. Loud: cylinder 3 valve impact rising | 0.86 | Swap at next stage gap | ~$26k |
| 3 | F03-P02 | Packing failure | 0.55 | Swap at next stage gap | ~$11k |

**Your techs would chase the loud one. The money is in the quiet one.**

*Each option is priced: keep running = risk x cost if failed; swap at gap = fix + risk of failing before the gap; pull now = fix + lost spread time. If a washout retires your whole fluid end, F07-P14 jumps to #1 at ~$59k. Marcus owns that cost table. Synthetic data; hero pumps scripted.*

---

## Slide 6 (SHOW): From prediction to wrench time

*[Live: drawer, then dispatch. Evidence: `evidence/09_dispatch_timeline.txt`, `evidence/06_ai_workorder.json`]*

- The sensor trend shows the precursor building, plus the three priced options
- AI drafts the work order from your procedure library: it cites the procedure, lists the parts kit and safety steps, and invents no torque or pressure values. A human approves it
- Assign R. Gomez to the 14:20 stage gap, and the timeline and the Lakebase work order update live

---

## Slide 7 (SHOW): Ask the business a question

*[Live: Ask Genie panel. Evidence: `evidence/07_genie_transcript.md`]*

- "What's the expected $ protected by this week's work orders, by fleet?"
- "Which fleets had the most pump-caused NPT last quarter?"
- "What's MTBF by failure mode?"

Genie shows its SQL on governed data, and returns the same numbers as the app, because they come from the same tables.

---

## Slide 8 (SHOW): Under the hood, and an honest model

| Stage | Built | Proof (text in repo) |
|---|---|---|
| Lakeflow | Auto Loader + declarative pipeline, bronze to gold, data quality rules | Pipeline run + expectation metrics |
| Unity Catalog | Lineage, comments, tags, column mask, grants | `DESCRIBE`, grants, lineage rows |
| ML | Calendar-rule baseline vs LightGBM, calibrated, in MLflow; UC `@champion`; serving endpoint | Run metrics, model version, endpoint JSON |
| Lakebase | Synced risk + ranked actions; native work orders, crews, schedule | psql output |
| GenAI | Grounded AI work orders, traced in MLflow | Trace JSON |
| Genie Agent | Natural language over KPIs + work orders | Benchmark results |
| App | React + FastAPI on Databricks Apps | API output |
| **End to end** | One sensor file traced to a work order to a Genie answer | `evidence/11_end_to_end_trace.txt` |

**What the model gets wrong:** one missed failure (no precursor) and one false alarm (a benign pressure transient), with root cause for each. *Metrics on synthetic data prove the pipeline works, not the value. Your data proves the value.*

---

## Slide 9 (TELL): The value, in your KPIs

| What the app delivers | Conservative | Target |
|---|---|---|
| Unplanned failures caught at least a stage ahead | 70 of ~280 (25%) | 140 of ~280 (50%) |
| Precision / false alarms per pump-month | 50% / 0.02 | 35% / 0.07 |
| Failure cost avoided (gross) | $2.6M | $5.2M |
| Less: false-alarm inspections ($4k each) | -$0.3M | -$1.0M |
| Less: platform run rate | -$0.6M | -$0.6M |
| **Added EBITDA (est.)** | **$1.7M** | **$3.6M** |
| Unplanned failure cost reduction | 22% | 44% |
| Per fleet / % of fleet EBITDA | $115k / 0.6% | $239k / 1.3% |
| Spread hours recovered | 91 | 181 |
| Return on platform run rate | 3.9x | 7.0x |
| Payback on $0.75M implementation (sensors in place / +$3M sensor retrofit) | 5 / 26 months | 2.5 / 13 months |

**What moves the number most:** how often a washout destroys the fluid end (damage factor 0.2-1.0 gives $1.2-3.2M conservative) and the share of fluid end events that are unplanned (10-35% gives $0.8-2.3M). Both get measured in week 1 of the POC.

*The conservative catch rate sits inside McKinsey's 20-30% unplanned downtime reduction for upstream O&G predictive maintenance.*

---

## Slide 10 (TELL): Why Databricks

- **One platform, sensor to work order:** ingest, govern, predict, serve, act, and ask, with no five-tool integration project
- **Governed end to end:** Unity Catalog covers the telemetry, the model, and the operational database
- **Built for frac telemetry:** raw waveforms run up to ~1 TB/day per fleet; the edge computes features, and the lakehouse keeps the history. Beusa Energy, a frac services company, streams 1 Hz telemetry from 6,000+ devices on ~250 assets (~22M rows/day) into Delta in ~3 seconds with Zerobus Ingest, at over 99% lower ingestion cost than its prior SQL-API path ([public customer story](https://www.databricks.com/customers/beusa-energy/zerobus-ingest))
- **Open:** Delta, MLflow, and Postgres, so nothing is locked in

---

## Slide 11 (TELL): What we validate together

1. **Share of pump failures that actually stop the spread**, from your NPT log
2. Unplanned vs planned events by mode, from 12 months of CMMS (with an agreed definition of "unplanned")
3. How often a washout retires the fluid end vs a repairable seat deck, the biggest swing in the value
4. Pump-hour meters and sensors installed per fleet, which decides whether a sensor retrofit is needed
5. Expedite and hot-shot spend from AP

---

## Slide 12 (TELL): Next step, a 6-week POC with a Document of Completion

| Week | Deliverable |
|---|---|
| 1 | Connect 2 fleets of historical telemetry + 12 months of CMMS. **Go/no-go data gate:** per-pump sensor data, pump-hour meters, CMMS timestamps. Baseline signed |
| 2-3 | Backtest: calendar rule vs model on your real failures; Marcus sets the threshold from the curve |
| 4-5 | Ranked actions + dispatch app on 1 fleet in **shadow mode**; CMMS read integration |
| 6 | Readout + DOC sign-off, with a recommendation for a 6-12 month pilot on a control fleet to measure realized savings |

**Success criteria (in the POC doc), all from one threshold curve:**
- Backtest: **lower 95% CI bound of catch rate at least 25%** for unplanned fluid end + power end failures at least 1 stage ahead (per mode reported, descriptive), and beats the calendar rule on annualized $
- **Precision at that threshold at least 30%** (break-even is about 10%: a catch is worth about $37k net, a false alarm costs about $4k for the standby swap and teardown inspection)
- Backtested lever 1 value of **at least $0.10M per fleet per year**, EBITDA basis
- Shadow mode: **at least 80% of flagged pumps get a documented supervisor decision within one stage gap**

**Expansion upside, not in this demo:** the same telemetry can flag cavitation and pumps run outside their envelope (longer fluid end life), and replace valves and seats on condition instead of hours. Sized at roughly $7M a year more across 15 fleets, against ~$61M of fluid end spend and ~$18M of consumables. We'd scope it after the pilot.

**The ask:** Dana as sponsor, Marcus as domain owner, 2 fleets of data, a 30-minute weekly check-in. Databricks brings the SA and solution engineering team and a production consumption estimate.

# FE Bar Build: Task List

See `PROJECT_PLAN.md` for specs. Every item needs a text evidence artifact before it's checked.

## Phase 0: Plan
- [x] Clarifying questions (workspace, customer, data, app stack, ingestion, serving, GenAI)
- [x] Industry research with sources (`research/industry_research.md`)
- [x] Workspace capability check (no blockers)
- [x] Value model (`value_model/value_model.py`)
- [x] Project plan v1 + deck v1
- [x] Critique cycle 1 (FE Bar evaluator + pressure pumping buyer), then v2
- [x] Critique cycle 2 (consistency, logic, feasibility), then v3 (value model v3 with `decide_action()`)
- [x] Critique cycle 3 (number tie-out: 0 mismatches), then v3.1 logic fixes (standby pricing, false alarm cost, slide 1 framing)
- [ ] Re-auth Glean/Confluence and pull the FE Bar rubric + POC/DOC template
- [x] Repo location: personal public GitHub (Q1)
- [x] Beusa citation verified (Q4)
- [x] Fictional names kept (Q3)
- [ ] User review of plan + deck v3.1 (in progress)
- [ ] User sign-off, then start phase 1

## Phase 1: Bundle skeleton + data (1.0 hr)
- [ ] Repo init + first commit (user identity); commit at the end of every phase
- [ ] Platform bundle: schema, volume, experiment, registered model, Lakebase project + catalog, job `build_demo`
- [ ] **Smoke test (hard gate):** bundle-deploy a postgres project + one synced table + a genie space, then destroy
- [ ] Data gen notebook (hourly, 12 months, hero pumps, seeded miss and false alarm)

## Phase 2: Pipeline + governance (0.5 hr)
- [ ] SDP: 2 bronze, 1 silver (expectations), 3 gold, with comments
- [ ] Governance SQL task (mask, tags)

## Phase 3: ML (0.75 hr)
- [ ] Calendar baseline vs calibrated LightGBM in MLflow; register `@champion`
- [ ] Batch score + `gold_ranked_actions` via `decide_action()`

## Phase 4: Serve bundle (0.5 hr)
- [ ] Synced tables, serving endpoint (`model_version` var), Genie space from `genie/space.json`

## Phase 5: App (1.25 hr)
- [ ] FastAPI routes first (curl), then React: Ranked Actions + drawer + Dispatch modal (AI work order), Timeline, Genie panel
- [ ] App deployed by the serve bundle

## Phase 6: Package (0.5 hr)
- [ ] Makefile: up / down / redeploy / evidence
- [ ] `collect_evidence.py` writes 8 evidence .md files; E2E trace
- [ ] README (master evidence map) + DECISIONS.md, each <9k chars; plan/research to docs/; deck <9k
- [ ] docs/roleplay_prep.md
- [ ] Full down/up rehearsal from a clean slate
- [ ] Scrub check + push to personal public repo; name evidence paths in the submission box

## First-pass review (2026-10-28)
Working end to end on fevm-production-forecasting:
- Platform bundle: schema, volume, experiment, UC model, Lakebase project, SDP pipeline, build_demo job
- Data: 1,552,280 telemetry rows; 279 unplanned failures (152/82/45) calibrated to the value model
- Pipeline: 250 corrupt rows dropped by expectations; gold features + labels; fleet KPIs
- Governance: governed tags (tag policy enforced), phone column mask, class.phone_number tag
- ML: calibrated LightGBM v1 @champion. Test: 58/66 caught (88%), precision 54%, 0.05 false alarms/pump-month
- Ranked actions: F07-P09 power end #1 ($72.6k), F07-P14 valve #2, F03-P02 packing #3
- Serve bundle: 3 synced tables online, endpoint (267 ms), Genie space from JSON, app live
- Lakehouse Sync: ops work orders stream back to UC; ops_work_orders view feeds Genie
- App: all 11 routes tested through the live URL (curl)

## Second pass (next)
- [ ] Make the data harder: target recall 55-70%, calibrated risk < 0.95, 6-8 at-risk pumps incl. one false alarm
- [ ] Calendar baseline: report variants (k = 60/70/80/90) instead of "never alarm"
- [ ] Notebooks end with dbutils.notebook.exit(summary) so evidence pulls real outputs
- [ ] collect_evidence.py + check_evidence.sh + E2E trace
- [ ] README (master evidence map) + DECISIONS.md; plan/research to docs/; deck refresh with real model numbers; deck <9k
- [ ] Full make down && make up rehearsal


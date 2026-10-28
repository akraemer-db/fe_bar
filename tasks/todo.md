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

## Phase 1: Data
- [ ] git init + first commit (user identity); commit at the end of every phase
- [ ] **Lakebase smoke test (hard gate)**: synced table, OAuth write, UC catalog registration
- [ ] Schema `frac_pump_pdm`, volume `raw_landing`
- [ ] Synthetic generator (pumps, fleets, telemetry, stages, CMMS, techs, parts)
- [ ] Hero pumps F07-P09, F07-P14, F03-P02 scripted + seeded miss and false alarm
- [ ] Replay job
- [ ] Evidence: row counts, label distribution

## Phase 2: Pipeline + governance
- [ ] SDP bronze/silver/gold with expectations
- [ ] Comments, tags, mask, row filter, grants
- [ ] Evidence: pipeline run, lineage, grants

## Phase 3: ML
- [ ] Train + MLflow + UC registry @champion
- [ ] Batch scoring + ranked actions
- [ ] Serving endpoint
- [ ] Evidence: metrics, $ captured, endpoint response

## Phase 4: Lakebase
- [ ] Project, synced tables, native OLTP tables, seed data
- [ ] Register as UC catalog
- [ ] Evidence: psql output

## Phase 5: App
- [ ] APX scaffold, pages 1-6
- [ ] AI work order + MLflow tracing
- [ ] Genie embed
- [ ] Deploy + evidence (curl)

## Phase 6: Genie
- [ ] Space, instructions, sample questions, benchmarks

## Phase 7: Package
- [ ] README master evidence map + DECISIONS.md (each <9k chars)
- [ ] Move plan/research to docs/; deck <9k (speaker notes to docs/)
- [ ] docs/roleplay_prep.md (business + technical persona Q&A)
- [ ] check_evidence.sh: char budgets (<9k/file, <85k total) + notebook outputs
- [ ] Name evidence paths in the submission decisions text box
- [ ] E2E trace `scripts/trace_e2e.py` to `evidence/11_end_to_end_trace.txt`
- [ ] Export notebooks with outputs, evidence index, README
- [ ] Refresh deck numbers from the build
- [ ] Repo scrub + push

## Review
(filled in at the end)

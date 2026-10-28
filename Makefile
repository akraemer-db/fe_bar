# Fleet Reliability Command Center: one-command lifecycle.
#   make up         deploy everything from scratch (platform -> build job -> Lakebase ops -> serve -> grants -> start app)
#   make down       tear everything down (serve, Lakehouse Sync, platform incl. Lakebase project purge)
#   make redeploy   down + up
#   make rebuild    rerun the build job on existing infra and refresh the synced tables
#   make reset      clear work orders dispatched during a demo (seeded history stays)
#   make evidence   regenerate evidence/*.md from the live workspace
PROFILE ?= fe-vm-production-forecasting
export DATABRICKS_CONFIG_PROFILE := $(PROFILE)
PY := python3

.PHONY: reset up down redeploy rebuild platform build ops frontend serve grants start evidence check

up: platform build ops frontend serve grants start

platform:
	cd bundles/platform && databricks bundle deploy

build:
	cd bundles/platform && databricks bundle run build_demo

ops:
	$(PY) scripts/deploy_helpers.py ops-sync

frontend:
	cd src/app/frontend && npm ci --silent && npm run build

serve:
	cd bundles/serve && databricks bundle deploy $$($(PY) ../../scripts/deploy_helpers.py resolve)

grants:
	$(PY) scripts/deploy_helpers.py grant-app

start:
	cd bundles/serve && databricks bundle run frac_reliability_center $$($(PY) ../../scripts/deploy_helpers.py resolve)

rebuild: build
	$(PY) scripts/deploy_helpers.py refresh-sync
	cd bundles/serve && databricks bundle deploy $$($(PY) ../../scripts/deploy_helpers.py resolve)

down:
	-cd bundles/serve && databricks bundle destroy --auto-approve $$($(PY) ../../scripts/deploy_helpers.py resolve)
	-$(PY) scripts/deploy_helpers.py delete-ops-sync
	cd bundles/platform && databricks bundle destroy --auto-approve

redeploy: down up

reset:
	scripts/lakebase_psql.sh -c "DELETE FROM ops.wo_events WHERE wo_id IN (SELECT wo_id FROM ops.work_orders WHERE NOT is_synthetic_seed); DELETE FROM ops.work_orders WHERE NOT is_synthetic_seed;"

evidence:
	$(PY) scripts/collect_evidence.py
	scripts/check_evidence.sh

check:
	scripts/check_evidence.sh

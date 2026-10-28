#!/usr/bin/env bash
# Run psql against the demo's Lakebase primary endpoint as the current Databricks user (OAuth token, 1 hr).
# usage: scripts/lakebase_psql.sh -c "SELECT 1"      |   scripts/lakebase_psql.sh -f scripts/lakebase_ops_ddl.sql
set -euo pipefail
PROFILE="${DATABRICKS_CONFIG_PROFILE:-fe-vm-production-forecasting}"
PROJECT="${LAKEBASE_PROJECT:-frac-pump-pdm}"
EP="projects/${PROJECT}/branches/production/endpoints/primary"
json() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }
HOST=$(databricks postgres get-endpoint "$EP" -p "$PROFILE" -o json | json "['status']['hosts']['host']")
TOKEN=$(databricks postgres generate-database-credential "$EP" -p "$PROFILE" -o json | json "['token']")
USER_NAME=$(databricks current-user me -p "$PROFILE" -o json | json "['userName']")
PGPASSWORD="$TOKEN" psql "host=$HOST user=$USER_NAME dbname=databricks_postgres sslmode=require" -v ON_ERROR_STOP=1 "$@"

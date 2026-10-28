"""Deploy-time glue that bundles can't express yet. Called by the Makefile; uses only the Databricks CLI.

  resolve            print model_version and experiment_id for the serve bundle
  ops-sync           Lakebase ops schema -> UC via Lakehouse Sync (CDC), seed history, create ops_work_orders view
  grant-app          give the app's service principal DML on ops.* and SELECT on the synced tables (Postgres),
                     plus USE/SELECT in Unity Catalog
  refresh-sync       re-run the snapshot synced tables after a new build
  delete-ops-sync    remove the CDF config (part of make down)
"""
import json
import os
import subprocess
import sys
import time

PROFILE = os.getenv("DATABRICKS_CONFIG_PROFILE", "fe-vm-production-forecasting")
CATALOG, SCHEMA = "production_forecasting_catalog", "frac_pump_pdm"
FQ = f"{CATALOG}.{SCHEMA}"
PROJECT = "frac-pump-pdm"
DB = f"projects/{PROJECT}/branches/production/databases/databricks-postgres"
CDF = f"{DB}/cdf-configs/ops_to_uc"
WAREHOUSE = "6f1ac903576b114a"
HERE = os.path.dirname(os.path.abspath(__file__))


def cli(*args, check=True):
    r = subprocess.run(["databricks", *args, "-p", PROFILE, "-o", "json"], capture_output=True, text=True)
    if check and r.returncode:
        sys.exit(f"databricks {' '.join(args)} failed: {r.stderr.strip()}")
    return json.loads(r.stdout) if r.stdout.strip() else {}


def sql(statement):
    body = json.dumps({"warehouse_id": WAREHOUSE, "statement": statement, "wait_timeout": "50s"})
    r = cli("api", "post", "/api/2.0/sql/statements", "--json", body)
    if r["status"]["state"] != "SUCCEEDED":
        sys.exit(f"SQL failed: {r['status']}\n{statement}")
    return r.get("result", {}).get("data_array", [])


def psql(*args):
    subprocess.run([f"{HERE}/lakebase_psql.sh", *args], check=True)


def resolve():
    m = cli("registered-models", "get", f"{FQ}.frac_pump_failure_model", "--include-aliases")
    v = next(a["version_num"] for a in m["aliases"] if a["alias_name"] == "champion")
    me = cli("current-user", "me")["userName"]
    e = cli("experiments", "get-by-name", f"/Users/{me}/frac_pump_pdm")["experiment"]["experiment_id"]
    print(f"--var model_version={v} --var experiment_id={e}")


def ops_sync():
    psql("-f", f"{HERE}/lakebase_ops_ddl.sql")
    configs = cli("postgres", "list-cdf-configs", DB, check=False) or []
    if not any(c.get("cdf_config_id") == "ops_to_uc" for c in configs):
        cli("postgres", "create-cdf-config", DB, CATALOG, SCHEMA, "ops", "--cdf-config-id", "ops_to_uc")
    # Lakehouse Sync discovers a table on its first write and captures that write, so seed right away
    psql("-f", f"{HERE}/lakebase_ops_seed.sql")
    for _ in range(60):
        names = {r[1] for r in sql(f"SHOW TABLES IN {FQ} LIKE 'lb_*_history'")}
        if {"lb_work_orders_history", "lb_wo_events_history"} <= names:
            break
        time.sleep(10)
    else:
        sys.exit("history tables never appeared")
    # current state of each work order from the SCD2 change history
    sql(f"""CREATE OR REPLACE VIEW {FQ}.ops_work_orders
            COMMENT 'Work orders created in the dispatch app (Lakebase), streamed to UC by Lakehouse Sync. Latest state per wo_id.'
            AS SELECT * EXCEPT (_pg_change_type, _pg_lsn, _pg_xid, _timestamp, _sort_by, rn) FROM (
                 SELECT *, row_number() OVER (PARTITION BY wo_id ORDER BY _sort_by DESC, _pg_lsn DESC) AS rn
                 FROM {FQ}.lb_work_orders_history WHERE _pg_change_type <> 'update_preimage')
               WHERE rn = 1 AND _pg_change_type <> 'delete'""")
    print("ops_work_orders:", sql(f"SELECT count(*) FROM {FQ}.ops_work_orders")[0][0], "rows")


def grant_app():
    app = cli("apps", "get", "frac-reliability-center")
    sp = app["service_principal_client_id"]
    psql("-c", f'''GRANT USAGE ON SCHEMA ops TO "{sp}";
                   GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA ops TO "{sp}";
                   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ops TO "{sp}";
                   GRANT USAGE ON SCHEMA {SCHEMA} TO "{sp}";
                   GRANT SELECT ON ALL TABLES IN SCHEMA {SCHEMA} TO "{sp}";''')
    sql(f"GRANT USE CATALOG ON CATALOG {CATALOG} TO `{sp}`")
    sql(f"GRANT USE SCHEMA, SELECT ON SCHEMA {FQ} TO `{sp}`")
    print("granted app SP", sp)


def refresh_sync():
    for t in ["lb_ranked_actions", "lb_technicians", "lb_stage_schedule"]:
        st = cli("postgres", "get-synced-table", f"synced_tables/{FQ}.{t}")
        cli("pipelines", "start-update", st["status"]["pipeline_id"])
        print("refresh started:", t)


def delete_ops_sync():
    cli("postgres", "delete-cdf-config", CDF, check=False)
    print("CDF config removed")


if __name__ == "__main__":
    {"resolve": resolve, "ops-sync": ops_sync, "grant-app": grant_app, "refresh-sync": refresh_sync,
     "delete-ops-sync": delete_ops_sync}[sys.argv[1]]()

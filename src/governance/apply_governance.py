# Databricks notebook source
# MAGIC %md
# MAGIC # Unity Catalog governance
# MAGIC Contact data is the only sensitive field in this demo. It never leaves UC unmasked:
# MAGIC * `dim_technician_contacts` holds phone numbers behind a **column mask** (full value only for `reliability_admins`).
# MAGIC * The pipeline's `dim_technicians` drops the phone column, and that is what syncs to Lakebase and the app.
# MAGIC * Governed tags (the workspace tag policy only allows approved `domain` values) mark the operations domain and the sensitive table.

# COMMAND ----------

dbutils.widgets.text("catalog", "production_forecasting_catalog")
dbutils.widgets.text("schema", "frac_pump_pdm")
C, S = dbutils.widgets.get("catalog"), dbutils.widgets.get("schema")
FQ = f"{C}.{S}"

spark.sql(f"""
CREATE OR REPLACE FUNCTION {FQ}.mask_phone(phone STRING)
RETURNS STRING
COMMENT 'Shows full phone numbers only to reliability_admins; everyone else sees the last 4 digits.'
RETURN CASE WHEN is_account_group_member('reliability_admins') THEN phone
            ELSE concat('***-***-', right(phone, 4)) END
""")

spark.sql(f"""
CREATE OR REPLACE TABLE {FQ}.dim_technician_contacts
COMMENT 'Technician contact details. phone is column-masked; not synced to Lakebase.'
AS SELECT tech_id, name, home_fleet_id, phone
FROM read_files('/Volumes/{C}/{S}/raw_landing/reference/technicians.csv', format => 'csv', header => true)
""")
spark.sql(f"ALTER TABLE {FQ}.dim_technician_contacts ALTER COLUMN phone SET MASK {FQ}.mask_phone")
spark.sql(f"ALTER TABLE {FQ}.dim_technician_contacts SET TAGS ('domain' = 'operations', 'sensitivity' = 'pii')")
spark.sql(f"ALTER TABLE {FQ}.dim_technician_contacts ALTER COLUMN phone SET TAGS ('class.phone_number')")
for t in ["gold_pump_features", "gold_fleet_kpis_daily", "silver_telemetry", "bronze_telemetry"]:
    spark.sql(f"ALTER TABLE {FQ}.{t} SET TAGS ('domain' = 'operations', 'environment' = 'demo')")

# COMMAND ----------

display(spark.sql(f"SELECT tech_id, name, phone FROM {FQ}.dim_technician_contacts ORDER BY tech_id LIMIT 5"))
print("Mask applied as", spark.sql("SELECT current_user()").first()[0])

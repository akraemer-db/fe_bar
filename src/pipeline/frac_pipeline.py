"""Lakeflow Spark Declarative Pipeline: raw pump telemetry + CMMS -> governed gold tables.

bronze  : Auto Loader over the raw_landing volume (edge JSON, CMMS CSV, reference CSV)
silver  : typed, deduped, data quality expectations
gold    : hourly pump features with rolling windows + 24-pumping-hour failure labels, daily fleet KPIs
"""
from pyspark import pipelines as dp
from pyspark.sql import Window
from pyspark.sql import functions as F

ROOT = spark.conf.get("landing_root")  # /Volumes/<catalog>/<schema>/raw_landing
SIGNALS = ["valve_impact_max", "cyl_imbalance", "pulsation_psi_pp", "pe_vib_lf_ips", "vib_kurtosis",
           "packing_temp_f", "lube_oil_temp_f", "lube_oil_psi", "suction_psi"]


# ---------- bronze ----------
@dp.table(comment="Raw hourly edge-gateway pump features (JSON), ingested incrementally with Auto Loader.")
def bronze_telemetry():
    return (spark.readStream.format("cloudFiles")
            .option("cloudFiles.format", "json")
            .option("cloudFiles.inferColumnTypes", "true")
            .option("cloudFiles.schemaHints", "event_ts TIMESTAMP, pump_hour_meter BIGINT")
            .load(f"{ROOT}/telemetry")
            .withColumn("_source_file", F.col("_metadata.file_path"))
            .withColumn("_ingested_at", F.current_timestamp()))


@dp.table(comment="Raw CMMS maintenance export (CSV): calendar valve changes, fluid end changes, unplanned failures.")
def bronze_maintenance():
    return (spark.readStream.format("cloudFiles")
            .option("cloudFiles.format", "csv")
            .option("header", "true")
            .option("cloudFiles.inferColumnTypes", "true")
            .load(f"{ROOT}/maintenance")
            .withColumn("_source_file", F.col("_metadata.file_path")))


def _ref(name):
    return spark.read.option("header", "true").option("inferSchema", "true").csv(f"{ROOT}/reference/{name}.csv")


@dp.materialized_view(comment="Fleet dimension: 15 dual-fuel frac fleets (fictional).")
def dim_fleets():
    return _ref("fleets")


@dp.materialized_view(comment="Pump dimension: 20 active + 4 standby quintuplex pumps per fleet.")
def dim_pumps():
    return _ref("pumps")


@dp.materialized_view(comment="Field technicians WITHOUT contact details (safe to sync to Lakebase / show in the app).")
def dim_technicians():
    return _ref("technicians").drop("phone")


@dp.materialized_view(comment="Parts kits per failure mode with cost and labor hours.")
def dim_parts_catalog():
    return _ref("parts_catalog")


@dp.materialized_view(comment="Maintenance procedures used to ground AI-drafted work orders (synthetic, OEM-style).")
def dim_procedure_library():
    return _ref("procedure_library")


@dp.materialized_view(comment="Upcoming stage and stage-gap windows per fleet (next 48 hrs), used for dispatch.")
def dim_stage_schedule():
    return _ref("stage_schedule")


# ---------- silver ----------
@dp.table(comment="Cleaned pump telemetry. Corrupt pressure/RPM readings are dropped; sensor dropouts are kept and counted.")
@dp.expect_or_drop("valid_discharge_psi", "discharge_psi BETWEEN 0 AND 15000")
@dp.expect_or_drop("valid_pump_rpm", "pump_rpm >= 0")
@dp.expect("packing_temp_present", "packing_temp_f IS NOT NULL")
def silver_telemetry():
    impacts = [F.col(f"valve_impact_c{i}") for i in range(1, 6)]
    return (spark.readStream.table("bronze_telemetry")
            .withColumn("valve_impact_max", F.greatest(*impacts))
            .withColumn("valve_impact_worst_cyl",
                        F.array_position(F.array(*impacts), F.greatest(*impacts)).cast("int"))
            # worst cylinder vs the mean of the other four: a washout is cylinder-local
            .withColumn("cyl_imbalance", F.greatest(*impacts) / ((sum(impacts) - F.greatest(*impacts)) / 4))
            .drop("_rescued_data")
            .dropDuplicates(["pump_id", "event_ts"]))


@dp.materialized_view(comment="Typed CMMS events.")
def silver_maintenance():
    return (spark.read.table("bronze_maintenance")
            .withColumn("event_ts", F.to_timestamp("event_ts"))
            .withColumn("planned", F.col("planned").cast("boolean"))
            .drop("_rescued_data", "_source_file"))


# ---------- gold ----------
@dp.materialized_view(
    comment=("Hourly pump features (rolling 6/24 pumping-hour windows, hrs since last valve change) with the training "
             "label: failure mode of the next unplanned failure within 24 pumping hours, else 'healthy'."))
def gold_pump_features():
    tel = spark.read.table("silver_telemetry")
    ev = spark.read.table("silver_maintenance")

    resets = (ev.where("event_type IN ('calendar_valve_change','planned_fluid_end_change') OR "
                       "failure_mode IN ('valve_seat_washout','packing_failure')")
              .select("pump_id", F.col("pump_hour_meter").alias("m"), F.col("pump_hour_meter").alias("reset_m")))
    fails = (ev.where("event_type = 'unplanned_failure'")
             .select("pump_id", F.col("pump_hour_meter").alias("m"),
                     F.struct(F.col("pump_hour_meter").alias("fail_m"), F.col("failure_mode").alias("mode")).alias("fail")))

    base = tel.select("pump_id", "fleet_id", "event_ts", F.col("pump_hour_meter").alias("m"),
                      "rate_bpm_theoretical", "discharge_psi", "proppant_ppa", "valve_impact_worst_cyl", *SIGNALS)
    u = (base.withColumn("is_row", F.lit(1))
         .unionByName(resets.withColumn("is_row", F.lit(0)), allowMissingColumns=True)
         .unionByName(fails.withColumn("is_row", F.lit(2)), allowMissingColumns=True))
    back = Window.partitionBy("pump_id").orderBy("m", "is_row").rowsBetween(Window.unboundedPreceding, 0)
    fwd = Window.partitionBy("pump_id").orderBy("m", "is_row").rowsBetween(0, Window.unboundedFollowing)
    u = (u.withColumn("last_reset_m", F.last("reset_m", ignorenulls=True).over(back))
          .withColumn("next_fail", F.first("fail", ignorenulls=True).over(fwd))
          .where("is_row = 1"))

    w6 = Window.partitionBy("pump_id").orderBy("m").rowsBetween(-5, 0)
    w24 = Window.partitionBy("pump_id").orderBy("m").rowsBetween(-23, 0)
    for s in SIGNALS:
        u = (u.withColumn(f"{s}_avg6", F.avg(s).over(w6))
              .withColumn(f"{s}_avg24", F.avg(s).over(w24))
              .withColumn(f"{s}_max6", F.max(s).over(w6))
              .withColumn(f"{s}_trend", F.col(f"{s}_avg6") - F.col(f"{s}_avg24")))
    hrs_to_fail = F.col("next_fail.fail_m") - F.col("m")
    return (u.withColumn("hrs_since_valve_change", F.coalesce(F.col("m") - F.col("last_reset_m"), F.lit(50)).cast("double"))
             .withColumn("hrs_to_next_failure", hrs_to_fail.cast("double"))
             .withColumn("label", F.when((hrs_to_fail >= 0) & (hrs_to_fail <= 24), F.col("next_fail.mode")).otherwise("healthy"))
             .withColumnRenamed("m", "pump_hour_meter")
             .drop("is_row", "reset_m", "fail", "last_reset_m", "next_fail"))


@dp.materialized_view(comment="Daily fleet reliability KPIs: pumping hours, unplanned failures, pump-caused spread NPT, maintenance $.")
def gold_fleet_kpis_daily():
    hrs = (spark.read.table("silver_telemetry")
           .groupBy("fleet_id", F.to_date("event_ts").alias("day"))
           .agg(F.count("*").alias("pump_hours"), F.countDistinct("pump_id").alias("pumps_running"),
                F.avg("suction_psi").alias("avg_suction_psi")))
    ev = (spark.read.table("silver_maintenance")
          .groupBy("fleet_id", F.to_date("event_ts").alias("day"))
          .agg(F.sum(F.when(F.col("event_type") == "unplanned_failure", 1).otherwise(0)).alias("unplanned_failures"),
               F.sum("spread_npt_hrs").alias("pump_caused_npt_hrs"),
               F.sum("parts_cost_usd").alias("maintenance_cost_usd"),
               F.sum(F.when(F.col("event_type") == "planned_fluid_end_change", 1).otherwise(0)).alias("fluid_end_changes")))
    return (hrs.join(ev, ["fleet_id", "day"], "left")
               .fillna(0, ["unplanned_failures", "pump_caused_npt_hrs", "maintenance_cost_usd", "fluid_end_changes"]))

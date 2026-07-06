#!/usr/bin/env bash
# Synced tables: recon Delta (CDF) -> Lakebase Postgres for the reconciliation
# dashboard's ms reads (ADR-007). Autoscaling synced tables are not supported by
# DABs yet — this script is the sanctioned path. Idempotent-ish: create fails on
# existing tables; delete first to recreate.
set -euo pipefail

DBX="${DBX:-databricks}"
PROJECT="projects/pipeline-factory"
BRANCH="$PROJECT/branches/production"
CATALOG="pf_lakebase"     # UC catalog registered over the Lakebase database
STORAGE_CATALOG="workspace"
STORAGE_SCHEMA="ctl"

# one-time: register the Lakebase database as a UC catalog
$DBX postgres create-catalog "$CATALOG" --json "{\"spec\":{\"branch\":\"$BRANCH\",\"postgres_database\":\"databricks_postgres\"}}" || true

create() {
  local table="$1" source="$2" pks="$3"
  $DBX postgres create-synced-table "$CATALOG.recon.$table" --json "{
    \"spec\": {
      \"source_table_full_name\": \"$source\",
      \"primary_key_columns\": $pks,
      \"scheduling_policy\": \"TRIGGERED\",
      \"branch\": \"$BRANCH\",
      \"postgres_database\": \"databricks_postgres\",
      \"create_database_objects_if_missing\": true,
      \"new_pipeline_spec\": {\"storage_catalog\": \"$STORAGE_CATALOG\", \"storage_schema\": \"$STORAGE_SCHEMA\"}
    }
  }" --no-wait
}

create recon_runs          workspace.ctl.recon_runs          '["recon_id"]'
create recon_entity_result workspace.ctl.recon_entity_result '["recon_id","entity"]'
create recon_record_diff   workspace.ctl.recon_record_diff   '["recon_id","entity","key_value","column_name"]'

echo "Synced tables creating (async). Status:"
echo "  $DBX postgres get-synced-table synced_tables/$CATALOG.recon.recon_runs"

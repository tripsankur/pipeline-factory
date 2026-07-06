/**
 * Registry DDL — the single source of truth (hard constraint #6).
 * All state lives in `{catalog}.{schema}` Delta tables; the app is stateless.
 * Idempotent: run at every server boot.
 */

export interface RegistryConfig {
  catalog: string;
  schema: string;
}

const TAG_PROPS = `TBLPROPERTIES ('generated_by' = 'pipeline_factory')`;
const CDF_PROPS = `TBLPROPERTIES ('generated_by' = 'pipeline_factory', 'delta.enableChangeDataFeed' = 'true')`;

export function fq(cfg: RegistryConfig, table: string): string {
  return `\`${cfg.catalog}\`.\`${cfg.schema}\`.\`${table}\``;
}

export function registryDdl(cfg: RegistryConfig): string[] {
  const t = (name: string) => fq(cfg, name);
  return [
    `CREATE SCHEMA IF NOT EXISTS \`${cfg.catalog}\`.\`${cfg.schema}\``,

    `CREATE TABLE IF NOT EXISTS ${t("spec_registry")} (
      spec_id STRING NOT NULL,
      entity STRING NOT NULL,
      status STRING NOT NULL,
      current_version INT NOT NULL,
      source_system STRING,
      target_system STRING,
      created_at TIMESTAMP NOT NULL,
      updated_at TIMESTAMP NOT NULL,
      created_by STRING,
      approved_by STRING,
      approved_at TIMESTAMP
    ) ${TAG_PROPS}`,

    `CREATE TABLE IF NOT EXISTS ${t("spec_versions")} (
      spec_id STRING NOT NULL,
      spec_version INT NOT NULL,
      spec_json STRING NOT NULL,
      change_reason STRING,
      created_at TIMESTAMP NOT NULL,
      created_by STRING
    ) ${TAG_PROPS}`,

    `CREATE TABLE IF NOT EXISTS ${t("build_runs")} (
      run_id STRING NOT NULL,
      spec_id STRING NOT NULL,
      spec_version INT NOT NULL,
      phase STRING NOT NULL,
      status STRING NOT NULL,
      fix_iteration INT NOT NULL,
      branch STRING,
      pr_url STRING,
      detail STRING,
      started_at TIMESTAMP NOT NULL,
      finished_at TIMESTAMP
    ) ${TAG_PROPS}`,

    // CDF on the recon tables: they sync into Lakebase (triggered synced tables)
    // for the reconciliation dashboard's ms-latency reads (ADR-007).
    `CREATE TABLE IF NOT EXISTS ${t("recon_runs")} (
      recon_id STRING NOT NULL,
      run_id STRING NOT NULL,
      spec_id STRING NOT NULL,
      spec_version INT NOT NULL,
      status STRING NOT NULL,
      started_at TIMESTAMP NOT NULL,
      finished_at TIMESTAMP
    ) ${CDF_PROPS}`,

    `CREATE TABLE IF NOT EXISTS ${t("recon_entity_result")} (
      recon_id STRING NOT NULL,
      entity STRING NOT NULL,
      source_count BIGINT,
      target_count BIGINT,
      key_match_rate DOUBLE,
      row_match_rate DOUBLE,
      attr_match_rate DOUBLE,
      created_at TIMESTAMP NOT NULL
    ) ${CDF_PROPS}`,

    `CREATE TABLE IF NOT EXISTS ${t("recon_record_diff")} (
      recon_id STRING NOT NULL,
      entity STRING NOT NULL,
      key_value STRING NOT NULL,
      column_name STRING NOT NULL,
      source_value STRING,
      target_value STRING,
      created_at TIMESTAMP NOT NULL
    ) ${CDF_PROPS}`,

    `CREATE TABLE IF NOT EXISTS ${t("llm_calls")} (
      call_id STRING NOT NULL,
      spec_id STRING,
      purpose STRING NOT NULL,
      endpoint STRING NOT NULL,
      request_chars BIGINT,
      response_chars BIGINT,
      prompt_tokens BIGINT,
      completion_tokens BIGINT,
      latency_ms BIGINT,
      status STRING NOT NULL,
      created_at TIMESTAMP NOT NULL
    ) ${TAG_PROPS}`,

    `CREATE TABLE IF NOT EXISTS ${t("feature_events")} (
      event_id STRING NOT NULL,
      feature STRING NOT NULL,
      user_email STRING,
      created_at TIMESTAMP NOT NULL
    ) ${TAG_PROPS}`,

    `CREATE TABLE IF NOT EXISTS ${t("staged_artifacts")} (
      spec_id STRING NOT NULL,
      spec_version INT NOT NULL,
      path STRING NOT NULL,
      content STRING NOT NULL,
      sha256 STRING,
      staged_at TIMESTAMP NOT NULL
    ) ${TAG_PROPS}`,

    // The metadata plane (ADR-008): one row per entity; executed by the
    // framework's generic SDP engine. Tombstoned via is_active — never deleted
    // (ADR-010: SDP drops managed datasets that vanish from its graph).
    `CREATE TABLE IF NOT EXISTS ${t("dataflow_spec")} (
      dataflow_id STRING NOT NULL,
      dataflow_group STRING NOT NULL,
      entity STRING NOT NULL,
      spec_version INT NOT NULL,
      source_format STRING NOT NULL,
      source_details MAP<STRING,STRING>,
      reader_config_options MAP<STRING,STRING>,
      target_details MAP<STRING,STRING>,
      select_columns ARRAY<STRING>,
      crosswalk_keys STRING,
      column_transforms STRING,
      cdc_apply_changes STRING,
      data_quality_expectations STRING,
      table_properties MAP<STRING,STRING>,
      cluster_by ARRAY<STRING>,
      is_active BOOLEAN NOT NULL,
      framework_min_version STRING,
      created_at TIMESTAMP NOT NULL,
      updated_at TIMESTAMP NOT NULL,
      created_by STRING
    ) ${CDF_PROPS}`,
  ];
}

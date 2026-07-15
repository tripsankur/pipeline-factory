import { batchId, ingestMode } from "./batches.js";
import { fq, type RegistryConfig } from "./registry.js";
import type { ColumnMapping, Spec } from "./spec.js";

/**
 * DataflowSpec — the metadata plane (ADR-008). One row per entity in
 * `{catalog}.{schema}.dataflow_spec`; the framework's generic engine executes
 * exactly what these rows say. Rows are tombstoned (is_active=false), never
 * deleted (ADR-010: SDP drops managed datasets that vanish from the graph).
 */

export interface DataflowSpecRow {
  dataflow_id: string;
  dataflow_group: string;
  entity: string;
  spec_version: number;
  /** lakeflow_connect = bronze landed by a managed ingestion pipeline;
   *  delta = bronze pre-exists as a Delta table; cloudfiles = engine-owned Auto Loader */
  source_format: "lakeflow_connect" | "delta" | "cloudfiles";
  source_details: Record<string, string>;
  reader_config_options: Record<string, string>;
  target_details: Record<string, string>;
  select_columns: string[];
  primary_keys: string; // JSON [{source, target}]
  column_transforms: string; // JSON [{name, target, type, transform, compare}]
  cdc_apply_changes: string | null; // JSON {keys, sequence_by, scd_type} | null
  data_quality_expectations: string; // JSON {expect, expect_or_drop, expect_or_fail}
  table_properties: Record<string, string>;
  cluster_by: string[];
  is_active: boolean;
  framework_min_version: string;
  created_by: string;
}

export interface DataflowRowOptions {
  /** UC connection name backing the managed ingestion pipeline (SaaS sources) */
  connectionName?: string;
  /** framework engine version floor this spec requires */
  frameworkMinVersion?: string;
  /** override the derived source format */
  sourceFormat?: DataflowSpecRow["source_format"];
  createdBy?: string;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** Fold an enumerated value_map into the column's transform expression so the
 *  engine (and recon) see ONE SQL expression per column. */
export function effectiveTransform(c: ColumnMapping): string | null {
  const base = c.transform ?? `src.\`${c.name}\``;
  if (c.value_map.length === 0) return c.transform;
  const whens = c.value_map
    .map((m) => `WHEN '${m.from.replaceAll("'", "''")}' THEN '${m.to.replaceAll("'", "''")}'`)
    .join(" ");
  return `CASE ${base} ${whens} ELSE ${base} END`;
}

/** Pure spec -> DataflowSpec row mapping. Deterministic; golden-tested. */
export function specToDataflowRow(spec: Spec, opts: DataflowRowOptions = {}): DataflowSpecRow {
  const group = slug(spec.source.system);
  const sourceFormat =
    opts.sourceFormat ?? (spec.ingestion.transport === "lakeflow_connect" && opts.connectionName ? "lakeflow_connect" : "delta");

  const transforms = spec.columns.map((c) => ({
    name: c.name,
    target: c.target,
    type: c.type,
    transform: effectiveTransform(c),
    compare: c.compare,
  }));

  const dq: { expect: Record<string, string>; expect_or_drop: Record<string, string>; expect_or_fail: Record<string, string> } = {
    expect: {},
    expect_or_drop: {},
    expect_or_fail: {},
  };
  for (const e of spec.expectations) {
    const bucket = e.action === "fail" ? dq.expect_or_fail : e.action === "drop" ? dq.expect_or_drop : dq.expect;
    bucket[e.name] = e.constraint;
  }

  const cdc =
    spec.ingestion.mode === "cdc"
      ? JSON.stringify({
          keys: spec.primary_keys.map((k) => k.source),
          sequence_by: spec.ingestion.cursor_column,
          scd_type: 1,
        })
      : null;

  return {
    dataflow_id: spec.spec_id,
    dataflow_group: group,
    entity: spec.entity,
    spec_version: spec.spec_version,
    source_format: sourceFormat,
    source_details: {
      source_object: spec.ingestion.source_object,
      mode: spec.ingestion.mode,
      ...(spec.ingestion.cursor_column ? { cursor_column: spec.ingestion.cursor_column } : {}),
      ...(opts.connectionName ? { connection: opts.connectionName } : {}),
    },
    reader_config_options: {},
    target_details: {
      bronze_table: spec.source.entity,
      silver_table: spec.target.entity,
      batch: batchId(spec.source.system, ingestMode(spec)),
    },
    select_columns: spec.columns.map((c) => c.name),
    primary_keys: JSON.stringify(spec.primary_keys),
    column_transforms: JSON.stringify(transforms),
    cdc_apply_changes: cdc,
    data_quality_expectations: JSON.stringify(dq),
    table_properties: {},
    cluster_by: [],
    is_active: true,
    framework_min_version: opts.frameworkMinVersion ?? "1.0.0",
    created_by: opts.createdBy ?? "pipeline_factory",
  };
}

function sqlStr(v: string | null): string {
  return v === null ? "NULL" : `'${v.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function sqlMap(m: Record<string, string>): string {
  const entries = Object.entries(m);
  if (entries.length === 0) return "map()";
  return `map(${entries.map(([k, v]) => `${sqlStr(k)}, ${sqlStr(v)}`).join(", ")})`;
}

function sqlArr(a: string[]): string {
  if (a.length === 0) return "array()";
  return `array(${a.map((v) => sqlStr(v)).join(", ")})`;
}

/** Idempotent MERGE upsert for a dataflow row. Reactivates tombstoned rows on
 *  rebuild (an explicit build IS the human intent to have the dataset). */
export function dataflowSpecMergeSql(cfg: RegistryConfig, r: DataflowSpecRow): string {
  const t = fq(cfg, "dataflow_spec");
  const common = [
    `dataflow_group = ${sqlStr(r.dataflow_group)}`,
    `entity = ${sqlStr(r.entity)}`,
    `spec_version = ${r.spec_version}`,
    `source_format = ${sqlStr(r.source_format)}`,
    `source_details = ${sqlMap(r.source_details)}`,
    `reader_config_options = ${sqlMap(r.reader_config_options)}`,
    `target_details = ${sqlMap(r.target_details)}`,
    `select_columns = ${sqlArr(r.select_columns)}`,
    `primary_keys = ${sqlStr(r.primary_keys)}`,
    `column_transforms = ${sqlStr(r.column_transforms)}`,
    `cdc_apply_changes = ${sqlStr(r.cdc_apply_changes)}`,
    `data_quality_expectations = ${sqlStr(r.data_quality_expectations)}`,
    `table_properties = ${sqlMap(r.table_properties)}`,
    `cluster_by = ${sqlArr(r.cluster_by)}`,
    `is_active = ${r.is_active}`,
    `framework_min_version = ${sqlStr(r.framework_min_version)}`,
    `updated_at = current_timestamp()`,
  ].join(",\n    ");
  return `MERGE INTO ${t} t
USING (SELECT ${sqlStr(r.dataflow_id)} AS dataflow_id) s
ON t.dataflow_id = s.dataflow_id
WHEN MATCHED THEN UPDATE SET
    ${common}
WHEN NOT MATCHED THEN INSERT (
  dataflow_id, dataflow_group, entity, spec_version, source_format,
  source_details, reader_config_options, target_details, select_columns,
  primary_keys, column_transforms, cdc_apply_changes, data_quality_expectations,
  table_properties, cluster_by, is_active, framework_min_version,
  created_at, updated_at, created_by
) VALUES (
  ${sqlStr(r.dataflow_id)}, ${sqlStr(r.dataflow_group)}, ${sqlStr(r.entity)}, ${r.spec_version}, ${sqlStr(r.source_format)},
  ${sqlMap(r.source_details)}, ${sqlMap(r.reader_config_options)}, ${sqlMap(r.target_details)}, ${sqlArr(r.select_columns)},
  ${sqlStr(r.primary_keys)}, ${sqlStr(r.column_transforms)}, ${sqlStr(r.cdc_apply_changes)}, ${sqlStr(r.data_quality_expectations)},
  ${sqlMap(r.table_properties)}, ${sqlArr(r.cluster_by)}, ${r.is_active}, ${sqlStr(r.framework_min_version)},
  current_timestamp(), current_timestamp(), ${sqlStr(r.created_by)}
)`;
}

/** Tombstone (ADR-010): never DELETE — deactivate with audit trail. */
export function dataflowSpecTombstoneSql(cfg: RegistryConfig, dataflowId: string): string {
  return `UPDATE ${fq(cfg, "dataflow_spec")}
SET is_active = false, updated_at = current_timestamp()
WHERE dataflow_id = ${sqlStr(dataflowId)}`;
}

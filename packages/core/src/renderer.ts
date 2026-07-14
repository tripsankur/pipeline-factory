import nunjucks from "nunjucks";
import { createHash } from "node:crypto";
import { batchId, ingestMode } from "./batches.js";
import { specToDataflowRow, type DataflowRowOptions, type DataflowSpecRow } from "./dataflow-spec.js";
import type { Spec } from "./spec.js";

/**
 * The renderer — sole producer of files (hard constraint #1, ADR-001/008).
 * v2: rendered files are declarative METADATA, never code. The framework repo
 * owns all executable code; a PR to the pipelines repo is a metadata diff.
 * Pure function: (spec, opts) -> files[]; golden tests enforce byte-stability.
 */

export interface RenderedFile {
  path: string;
  content: string;
  sha256: string;
}

export interface RenderResult {
  files: RenderedFile[];
  spec: Spec;
  row: DataflowSpecRow;
}

/** Sibling ingestion objects for the source (incl. the current entity) so the
 *  per-SOURCE resources file always lists every active entity. */
export interface SourceObject {
  entity: string;
  source_object: string;
  destination_catalog: string;
  destination_schema: string;
  destination_table: string;
  primary_keys: string[];
  include_columns: string[];
  scd_type: "SCD_TYPE_1" | "SCD_TYPE_2";
}

export interface RenderOptions extends DataflowRowOptions {
  /** all active objects of this source (defaults to just the current spec's) */
  sourceObjects?: SourceObject[];
  /** quartz cron from the interface contract */
  batchSchedule?: string;
  /** workspace path of the deployed framework engine files */
  engineGlob?: string;
}

export interface RendererOptions {
  templatesDir: string;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function threePartToParts(entity: string): { catalog: string; schema: string; table: string } {
  const parts = entity.split(".").map((p) => p.replaceAll("`", ""));
  if (parts.length === 3) {
    return { catalog: parts[0] ?? "workspace", schema: parts[1] ?? "bronze", table: parts[2] ?? entity };
  }
  return { catalog: "workspace", schema: "bronze", table: parts[parts.length - 1] ?? entity };
}

/** Columns the managed Salesforce connector refuses to run without: its
 *  incremental cursor and soft-delete marker (CANNOT_FILTER_OUT_REQUIRED_COLUMN).
 *  They land in bronze but never flow to silver unless the contract selects them. */
export const SFDC_REQUIRED_COLUMNS = ["SystemModstamp", "IsDeleted"];

export function withConnectorRequiredColumns(system: string, cols: string[]): string[] {
  if (system !== "sfdc") return cols;
  return [...cols, ...SFDC_REQUIRED_COLUMNS.filter((c) => !cols.includes(c))];
}

/** Default source-object descriptor for a lone spec. */
export function specSourceObject(spec: Spec): SourceObject {
  const dest = threePartToParts(spec.source.entity);
  return {
    entity: spec.entity,
    source_object: spec.ingestion.source_object,
    destination_catalog: dest.catalog,
    destination_schema: dest.schema,
    destination_table: dest.table,
    primary_keys: spec.crosswalk.keys.map((k) => k.source),
    include_columns: withConnectorRequiredColumns(
      spec.source.system,
      spec.columns.map((c) => c.name),
    ),
    scd_type: "SCD_TYPE_1",
  };
}

const TEMPLATES: { template: string; out: (s: Spec, source: string) => string }[] = [
  { template: "dataflow.yml.njk", out: (s, source) => `metadata/${source}/${s.entity}/dataflow.yml` },
  { template: "source_pipeline.yml.njk", out: (_s, source) => `resources/${source}.pipeline.yml` },
];

export function createRenderer(opts: RendererOptions) {
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(opts.templatesDir), {
    autoescape: false,
    throwOnUndefined: true,
    trimBlocks: true,
    lstripBlocks: true,
  });

  env.addFilter("sqlIdent", (v: string) => `\`${String(v).replaceAll("`", "")}\``);
  env.addFilter("yamlStr", (v: unknown) => JSON.stringify(String(v)));
  env.addFilter("jsonPretty", (v: unknown) =>
    JSON.stringify(typeof v === "string" ? JSON.parse(v) : v, null, 2),
  );

  return function render(spec: Spec, renderOpts: RenderOptions = {}): RenderResult {
    const row = specToDataflowRow(spec, renderOpts);
    const source = row.dataflow_group;
    const mode = ingestMode(spec);
    const objects = renderOpts.sourceObjects ?? [specSourceObject(spec)];
    const silverParts = threePartToParts(spec.target.entity);
    const ctx = {
      spec,
      row,
      source,
      target: { catalog: silverParts.catalog, silver_schema: silverParts.schema },
      objects: [...objects].sort((a, b) => a.entity.localeCompare(b.entity)),
      connection: renderOpts.connectionName ?? null,
      schedule: renderOpts.batchSchedule ?? "0 0 3 * * ?",
      engine_glob: renderOpts.engineGlob ?? "${var.framework_engine_path}/engine/**",
      ingest: {
        mode,
        batch: batchId(spec.source.system, mode),
      },
      tag: {
        generated_by: "pipeline_factory",
        spec_id: spec.spec_id,
        spec_version: spec.spec_version,
      },
    };
    const files = TEMPLATES.map(({ template, out }) => {
      const content = normalize(env.render(template, ctx));
      return { path: out(spec, source), content, sha256: sha256(content) };
    });
    return { files, spec, row };
  };
}

/** LF endings + exactly one trailing newline — byte-stable across platforms. */
function normalize(s: string): string {
  return s.replaceAll("\r\n", "\n").replace(/\n*$/, "\n");
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Commit message for rendered metadata (constraint #5 tagging). */
export function commitMessage(spec: Spec): string {
  return [
    `feat(${spec.entity}): dataflow metadata`,
    "",
    `generated_by: pipeline_factory`,
    `spec_id: ${spec.spec_id}`,
    `spec_version: ${spec.spec_version}`,
  ].join("\n");
}

/** Branch name for a spec build. */
export function branchName(spec: Spec): string {
  return `feat/${spec.entity}-ingestion-v${spec.spec_version}`;
}

/** Evidence path inside the metadata repo. */
export function evidencePath(spec: Spec): string {
  return `metadata/${slug(spec.source.system)}/${spec.entity}/EVIDENCE.md`;
}

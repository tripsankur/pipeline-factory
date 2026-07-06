import type { DbxClient } from "@pf/dbx";
import { fq, type Spec, type SourceObject } from "@pf/core";
import type { AppConfig } from "../config.js";

/**
 * Standard-asset provisioner (ADR-009): per source the app owns exactly three
 * Lakeflow assets, idempotent by name —
 *   brnz_{source}_ingest   Lakeflow Connect managed ingestion pipeline (SaaS sources)
 *   slvr_{source}_etl      SDP declarative pipeline running the framework engine
 *   {source}_workflow      Lakeflow Job: pipeline_task(ingest) -> pipeline_task(etl)
 * Recon runs as a separate framework job triggered by the build executor.
 */

export interface ProvisionResult {
  ingestionPipelineId: string | null;
  etlPipelineId: string;
  workflowJobId: number;
}

export interface ProvisionInput {
  source: string; // slug (dataflow_group)
  spec: Spec;
  connectionName: string | null; // UC connection for managed ingestion (null = engine-owned bronze)
  sourceObjects: SourceObject[]; // ALL active entities of the source
  batchSchedule: string | null; // quartz cron from the contract
}

const TAGS = { generated_by: "pipeline_factory" };

async function findPipelineByName(dbx: DbxClient, name: string): Promise<string | null> {
  const r = await dbx.pipelineList(name);
  const hit = (r.statuses ?? []).find((s) => s.name === name);
  return hit?.pipeline_id ?? null;
}

export async function ensureIngestionPipeline(
  dbx: DbxClient,
  input: ProvisionInput,
  log: (t: string) => void,
): Promise<string | null> {
  if (!input.connectionName) return null;
  const name = `brnz_${input.source}_ingest`;
  const body = {
    name,
    serverless: true,
    continuous: false,
    channel: "PREVIEW",
    ingestion_definition: {
      connection_name: input.connectionName,
      objects: input.sourceObjects.map((o) => ({
        table: {
          source_schema: "objects",
          source_table: o.source_object,
          destination_catalog: o.destination_catalog,
          destination_schema: o.destination_schema,
          destination_table: o.destination_table,
          table_configuration: {
            scd_type: o.scd_type,
            primary_keys: o.primary_keys,
            include_columns: o.include_columns,
          },
        },
      })),
    },
    tags: TAGS,
  };
  const existing = await findPipelineByName(dbx, name);
  if (existing) {
    await dbx.pipelineUpdate(existing, body);
    log(`▸ provision: ingestion pipeline ${name} updated (${input.sourceObjects.length} objects)`);
    return existing;
  }
  const { pipeline_id } = await dbx.pipelineCreate(body);
  log(`▸ provision: ingestion pipeline ${name} created (${pipeline_id})`);
  return pipeline_id;
}

export async function ensureEtlPipeline(
  dbx: DbxClient,
  cfg: AppConfig,
  input: ProvisionInput,
  log: (t: string) => void,
): Promise<string> {
  const name = `slvr_${input.source}_etl`;
  const [catalog, silverSchema] = input.spec.target.entity.split(".");
  const body = {
    name,
    catalog: catalog ?? cfg.PF_CATALOG,
    schema: silverSchema ?? "silver",
    serverless: true,
    continuous: false,
    development: cfg.PF_TARGET === "dev",
    libraries: [{ glob: { include: `${cfg.PF_FRAMEWORK_ENGINE_PATH}/ingest_pipeline.py` } }],
    configuration: {
      "pf.source": input.source,
      "pf.spec_table": `${cfg.PF_CATALOG}.${cfg.PF_SCHEMA}.dataflow_spec`,
      "pf.env": cfg.PF_TARGET,
      "pf.engine_dir": cfg.PF_FRAMEWORK_ENGINE_PATH,
    },
    tags: TAGS,
  };
  const existing = await findPipelineByName(dbx, name);
  if (existing) {
    await dbx.pipelineUpdate(existing, body);
    log(`▸ provision: ETL pipeline ${name} updated`);
    return existing;
  }
  const { pipeline_id } = await dbx.pipelineCreate(body);
  log(`▸ provision: ETL pipeline ${name} created (${pipeline_id})`);
  return pipeline_id;
}

export async function ensureWorkflow(
  dbx: DbxClient,
  input: ProvisionInput,
  ingestionPipelineId: string | null,
  etlPipelineId: string,
  log: (t: string) => void,
): Promise<number> {
  const name = `${input.source}_workflow`;
  const tasks: Record<string, unknown>[] = [];
  if (ingestionPipelineId) {
    tasks.push({
      task_key: "ingest",
      pipeline_task: { pipeline_id: ingestionPipelineId, full_refresh: false },
    });
  }
  tasks.push({
    task_key: "etl",
    ...(ingestionPipelineId ? { depends_on: [{ task_key: "ingest" }] } : {}),
    pipeline_task: { pipeline_id: etlPipelineId, full_refresh: false },
  });
  const settings: Record<string, unknown> = {
    name,
    tags: TAGS,
    tasks,
    ...(input.batchSchedule
      ? {
          schedule: {
            quartz_cron_expression: input.batchSchedule,
            timezone_id: "America/New_York",
            pause_status: "UNPAUSED",
          },
        }
      : {}),
  };
  const r = await dbx.jobsList(name);
  const existing = (r.jobs ?? []).find((j) => j.settings?.name === name);
  if (existing) {
    await dbx.jobReset(existing.job_id, settings);
    log(`▸ provision: workflow ${name} updated (job ${existing.job_id})`);
    return existing.job_id;
  }
  const { job_id } = await dbx.jobCreate(settings);
  log(`▸ provision: workflow ${name} created (job ${job_id})`);
  return job_id;
}

/**
 * Drop-guard (ADR-010): SDP drops managed datasets missing from the graph.
 * Before any run, the active spec set for the source must cover every entity
 * previously provisioned — unless a human explicitly confirmed decommission.
 */
export async function assertNoImplicitDrops(
  dbx: DbxClient,
  cfg: AppConfig,
  source: string,
  activeEntities: string[],
): Promise<void> {
  const rows = await dbx.sqlRows(
    `SELECT entity, is_active FROM ${fq(cfg.registry, "dataflow_spec")} WHERE dataflow_group = '${source.replaceAll("'", "")}'`,
    cfg.DATABRICKS_WAREHOUSE_ID,
  );
  const previouslyActive = rows.filter((r) => String(r.is_active) === "true").map((r) => r.entity as string);
  const missing = previouslyActive.filter((e) => !activeEntities.includes(e));
  if (missing.length > 0) {
    throw new Error(
      `drop-guard: entities [${missing.join(", ")}] are active in dataflow_spec but absent from this build's active set — ` +
        `running now would DROP their managed tables. Decommission explicitly (tombstone) or include them.`,
    );
  }
}

export async function findReconJobId(dbx: DbxClient, jobName: string): Promise<number | null> {
  // dev-mode bundles prefix job names ("[dev user] pf-framework-recon") — match by suffix
  const r = await dbx.jobsList();
  const hit = (r.jobs ?? []).find((j) => j.settings?.name?.endsWith(jobName));
  return hit?.job_id ?? null;
}

export async function ensureConnectionExists(dbx: DbxClient, connectionName: string): Promise<boolean> {
  const r = await dbx.connectionsList();
  return (r.connections ?? []).some((c) => c.name === connectionName);
}

export async function waitPipelineUpdate(
  dbx: DbxClient,
  pipelineId: string,
  updateId: string,
  log: (t: string) => void,
  label: string,
  timeoutMs = 30 * 60_000,
): Promise<{ ok: boolean; state: string }> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  for (;;) {
    if (Date.now() > deadline) return { ok: false, state: "TIMEOUT" };
    await new Promise((r) => setTimeout(r, 8000));
    const u = await dbx.pipelineGetUpdate(pipelineId, updateId);
    const state = u.update?.state ?? "UNKNOWN";
    if (state !== last) {
      last = state;
      log(`▸ ${label}: ${state.toLowerCase()}`);
    }
    if (["COMPLETED", "FAILED", "CANCELED"].includes(state)) {
      return { ok: state === "COMPLETED", state };
    }
  }
}

/** Pull expectation metrics + errors from the ETL pipeline's event log —
 *  scoped to the LATEST update only (the log keeps events from old failed
 *  updates; counting those would fail healthy builds). */
export async function collectDqFromEvents(
  dbx: DbxClient,
  pipelineId: string,
): Promise<{ summary: string; failures: string[] }> {
  const p = await dbx.pipelineGet(pipelineId);
  const latestUpdate = p.latest_updates?.[0]?.update_id ?? null;
  const r = await dbx.pipelineEvents(pipelineId, 200);
  const failures: string[] = [];
  let passed = 0;
  let failedRows = 0;
  for (const e of r.events ?? []) {
    const origin = (e as { origin?: { update_id?: string } }).origin;
    if (latestUpdate && origin?.update_id && origin.update_id !== latestUpdate) continue;
    if (e.level === "ERROR" && e.message) failures.push(e.message.slice(0, 300));
    const det = e.details as { flow_progress?: { data_quality?: { expectations?: { name: string; passed_records: number; failed_records: number }[] } } } | undefined;
    const exps = det?.flow_progress?.data_quality?.expectations ?? [];
    for (const ex of exps) {
      passed += ex.passed_records;
      failedRows += ex.failed_records;
      if (ex.failed_records > 0) failures.push(`expectation ${ex.name}: ${ex.failed_records} failed records`);
    }
  }
  const summary = `expectations: ${passed} passed rows · ${failedRows} failed rows`;
  return { summary, failures };
}

import { randomUUID } from "node:crypto";
import {
  applyDelta,
  branchName,
  buildEvidenceMarkdown,
  buildManifest,
  commitMessage,
  dataflowSpecMergeSql,
  evidencePath,
  fq,
  specSourceObject,
  SpecDeltaSchema,
  type RenderOptions,
  type RenderResult,
  type SourceObject,
  type Spec,
} from "@pf/core";
import {
  FIX_SYSTEM_PROMPT,
  buildFixUserPrompt,
  type CicdAdapter,
  type CommitFile,
  type FmapiClient,
} from "@pf/adapters";
import type { DbxClient } from "@pf/dbx";
import type { RegistryStore } from "./store/types.js";
import type { AppConfig } from "../config.js";
import {
  assertNoImplicitDrops,
  collectDqFromEvents,
  ensureConnectionExists,
  ensureEtlPipeline,
  ensureIngestionPipeline,
  ensureWorkflow,
  findReconJobId,
  type ProvisionInput,
} from "./pipelines.js";

function lit(v: string | null): string {
  return v === null ? "NULL" : `'${v.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** Step ids match the design stepper (v2: standard Lakeflow assets, ADR-009). */
export const BUILD_STEPS = [
  "render",
  "branch",
  "spec_upsert",
  "provision",
  "workflow_run",
  "dq",
  "recon",
  "pr",
] as const;
export type BuildStep = (typeof BUILD_STEPS)[number];

export interface BuildEvent {
  type: "step" | "log" | "fix" | "done" | "error";
  step?: BuildStep;
  status?: "running" | "done" | "deferred" | "failed";
  meta?: string;
  text?: string;
  iteration?: number;
  maxIterations?: number;
  pr?: { url: string; number: number };
  run_id?: string;
}

export type BuildEmitter = (e: BuildEvent) => void;

export interface BuildDeps {
  registry: RegistryStore;
  dbx: DbxClient;
  cfg: AppConfig;
  cicd: CicdAdapter;
  render: (spec: Spec, opts?: RenderOptions) => RenderResult;
  fmapi: FmapiClient;
}

const TERMINAL = ["TERMINATED", "SKIPPED", "INTERNAL_ERROR"];

async function runJobAndWait(
  dbx: DbxClient,
  jobId: number,
  params: Record<string, string>,
  log: (t: string) => void,
  label: string,
  timeoutMs = 30 * 60_000,
): Promise<{ ok: boolean; state: string; message: string }> {
  const { run_id } = await dbx.jobRunNow(jobId, params);
  log(`▸ ${label}: job run ${run_id} submitted`);
  const deadline = Date.now() + timeoutMs;
  let last = "";
  for (;;) {
    if (Date.now() > deadline) return { ok: false, state: "TIMEOUT", message: "job timed out" };
    await new Promise((r) => setTimeout(r, 8000));
    const run = await dbx.jobGetRun(run_id);
    const lc = run.state.life_cycle_state;
    if (lc !== last) {
      last = lc;
      log(`▸ ${label}: ${lc.toLowerCase()}`);
    }
    if (TERMINAL.includes(lc)) {
      const ok = run.state.result_state === "SUCCESS";
      let message = run.state.state_message ?? "";
      if (!ok) {
        // surface the real task error — state_message is just "Workload failed"
        for (const task of run.tasks ?? []) {
          try {
            const out = await dbx.jobGetRunOutput(task.run_id);
            if (out.error) {
              message = `${out.error}\n${(out.error_trace ?? "").split("\n").slice(-6).join("\n")}`.slice(0, 1500);
              break;
            }
          } catch {
            // keep state_message
          }
        }
      }
      return { ok, state: run.state.result_state ?? lc, message };
    }
  }
}

interface AttemptOutcome {
  ok: boolean;
  failedStep?: BuildStep;
  evidence?: string;
  testsMeta?: string;
  recon?: { keyMatchRate: number | null; rowMatchRate: number | null; attrMatchRate: number | null } | null;
}

/** Contract facts carried through spec.evidence (batch schedule, UC connection). */
function contractFacts(spec: Spec): { schedule: string | null; connection: string | null } {
  const c = (spec.evidence as Record<string, unknown>)?.contract as
    | { batch_schedule?: string; dev_secret_scope?: string }
    | undefined;
  const scope = c?.dev_secret_scope ?? "";
  return {
    schedule: c?.batch_schedule ?? null,
    connection: scope.startsWith("uc:") ? scope.slice(3) : null,
  };
}

/**
 * Full build with the bounded fix loop (hard constraint #2): on failure the LLM
 * produces a spec DELTA — never file edits — the spec re-renders, re-upserts,
 * re-runs. MAX_FIX_ITERATIONS exhausted → needs_human.
 *
 * v2 (ADR-008/009): render = metadata files; execution = standard Lakeflow
 * assets (managed ingestion pipeline + SDP ETL pipeline + workflow) against the
 * static framework engine; per-source behavior comes from ctl.dataflow_spec.
 */
export async function executeBuild(deps: BuildDeps, specId: string, emit: BuildEmitter): Promise<{ runId: string; prUrl: string }> {
  const { registry, dbx, cfg, cicd, render, fmapi } = deps;
  const now = () => new Date().toISOString().slice(11, 19);
  const log = (text: string) => emit({ type: "log", text: `${now()} ${text}` });
  const warehouse = cfg.DATABRICKS_WAREHOUSE_ID;

  let spec = await registry.getSpec(specId);
  if (!spec) throw new Error("spec not found");
  const reg = await registry.getRegistryRow(specId);
  if (!reg || (reg.status !== "approved" && reg.status !== "pr_open")) {
    throw new Error(`spec must be approved to build (status: ${reg?.status ?? "missing"})`);
  }

  const runId = randomUUID();
  const branch = branchName(spec); // fixed at build start; fix commits land on it
  const fixIterations: { iteration: number; reason: string }[] = [];
  const source = slug(spec.source.system);
  const facts = contractFacts(spec);
  log(`▸ build ${runId.slice(0, 8)} started (adapter: ${cicd.kind}, source: ${source}, max fix iterations: ${cfg.MAX_FIX_ITERATIONS})`);

  await registry.insertBuildRun({
    runId,
    specId: spec.spec_id,
    specVersion: spec.spec_version,
    branch,
    detail: `adapter=${cicd.kind}`,
  });

  const recordFailure = async (detail: string, needsHuman: boolean): Promise<never> => {
    await registry.failBuildRun(runId, fixIterations.length, detail);
    if (needsHuman) await registry.setStatus(specId, "needs_human");
    emit({ type: "error", text: detail.slice(0, 500) });
    throw new Error(detail.slice(0, 500));
  };

  /** All active sibling objects of this source (for the per-source resources file
   *  and the managed ingestion pipeline's objects list). */
  const collectSourceObjects = async (): Promise<SourceObject[]> => {
    const rows = await dbx.sqlRows(
      `SELECT entity, source_details, target_details, select_columns, crosswalk_keys
       FROM ${fq(cfg.registry, "dataflow_spec")}
       WHERE dataflow_group = ${lit(source)} AND is_active = true AND entity != ${lit(spec!.entity)}`,
      warehouse,
    );
    const siblings: SourceObject[] = [];
    for (const r of rows) {
      try {
        const src = JSON.parse(r.source_details ?? "{}") as Record<string, string>;
        const tgt = JSON.parse(r.target_details ?? "{}") as Record<string, string>;
        const cols = JSON.parse(r.select_columns ?? "[]") as string[];
        const keys = JSON.parse(r.crosswalk_keys ?? "[]") as { source: string }[];
        const [dc, ds, dt] = (tgt.bronze_table ?? "..").split(".");
        siblings.push({
          entity: r.entity as string,
          source_object: src.source_object ?? (r.entity as string),
          destination_catalog: dc ?? cfg.PF_CATALOG,
          destination_schema: ds ?? "bronze",
          destination_table: dt ?? (r.entity as string),
          primary_keys: keys.map((k) => k.source),
          include_columns: cols,
          scd_type: "SCD_TYPE_1",
        });
      } catch {
        // malformed sibling row — skip rather than block the build
      }
    }
    return [...siblings, specSourceObject(spec!)];
  };

  // render + commit current spec state to the branch
  const renderAndCommit = async (message: string, sourceObjects: SourceObject[]): Promise<RenderResult> => {
    emit({ type: "step", step: "render", status: "running" });
    // engineGlob deliberately NOT set: the rendered resources yml keeps the
    // ${var.framework_engine_path} variable so any target can promote it
    // (Codex P1 on PR #5); the provisioner uses the concrete path separately.
    const result = render(spec!, {
      ...(facts.connection ? { connectionName: facts.connection } : {}),
      ...(facts.schedule ? { batchSchedule: facts.schedule } : {}),
      frameworkMinVersion: cfg.PF_FRAMEWORK_MIN_VERSION,
      sourceObjects,
    });
    emit({ type: "step", step: "render", status: "done", meta: `${result.files.length} metadata files · v${spec!.spec_version}` });

    emit({ type: "step", step: "branch", status: "running" });
    const commitFiles: CommitFile[] = [
      ...result.files.map((f) => ({ path: f.path, content: f.content })),
      { path: "factory.manifest.yml", content: buildManifest(spec!, result.files) },
    ];
    await cicd.createBranch(branch);
    await cicd.commitFiles(branch, commitFiles, message);
    emit({ type: "step", step: "branch", status: "done", meta: branch });
    log(`▸ git: ${commitFiles.length} files committed (${message.split("\n")[0]})`);
    return result;
  };

  /** MERGE the dataflow row (the executable metadata) + audit copy to staged_artifacts. */
  const upsertSpec = async (result: RenderResult): Promise<void> => {
    emit({ type: "step", step: "spec_upsert", status: "running" });
    await dbx.sql(dataflowSpecMergeSql(cfg.registry, result.row), warehouse);
    const staged = fq(cfg.registry, "staged_artifacts");
    await dbx.sql(
      `DELETE FROM ${staged} WHERE spec_id = ${lit(spec!.spec_id)} AND spec_version = ${spec!.spec_version}`,
      warehouse,
    );
    const stagedFiles = [
      ...result.files.map((f) => ({ path: f.path, content: f.content, sha256: f.sha256 as string | null })),
      { path: "spec.json", content: JSON.stringify(spec), sha256: null },
    ];
    for (const f of stagedFiles) {
      await dbx.sql(
        `INSERT INTO ${staged} (spec_id, spec_version, path, content, sha256, staged_at)
         VALUES (${lit(spec!.spec_id)}, ${spec!.spec_version}, ${lit(f.path)}, ${lit(f.content)}, ${lit(f.sha256)}, current_timestamp())`,
        warehouse,
      );
    }
    emit({ type: "step", step: "spec_upsert", status: "done", meta: `dataflow_spec MERGE · v${spec!.spec_version}` });
    log(`▸ metadata: dataflow_spec row merged (${spec!.spec_id} v${spec!.spec_version})`);
  };

  /** Ensure the three standard assets exist (idempotent), with drop-guard. */
  const provision = async (sourceObjects: SourceObject[]): Promise<{ ingestionId: string | null; etlId: string; workflowJobId: number }> => {
    emit({ type: "step", step: "provision", status: "running" });
    if (facts.connection) {
      const exists = await ensureConnectionExists(dbx, facts.connection);
      if (!exists) {
        emit({ type: "step", step: "provision", status: "failed", meta: `connection ${facts.connection} missing` });
        await recordFailure(
          `UC connection '${facts.connection}' not found. The managed Salesforce connector requires a one-time ` +
            `OAuth consent in Catalog Explorer (Settings → Connections shows status). Authorize it, then rebuild.`,
          true,
        );
      }
    }
    await assertNoImplicitDrops(dbx, cfg, source, sourceObjects.map((o) => o.entity));
    const input: ProvisionInput = {
      source,
      spec: spec!,
      connectionName: facts.connection,
      sourceObjects,
      batchSchedule: facts.schedule,
    };
    const ingestionId = await ensureIngestionPipeline(dbx, input, log);
    const etlId = await ensureEtlPipeline(dbx, cfg, input, log);
    const workflowJobId = await ensureWorkflow(dbx, input, ingestionId, etlId, log);
    emit({
      type: "step",
      step: "provision",
      status: "done",
      meta: `${ingestionId ? "ingest + " : ""}etl + workflow (job ${workflowJobId})`,
    });
    return { ingestionId, etlId, workflowJobId };
  };

  /** One workflow(ingest→etl) → dq → recon pass. */
  const attempt = async (assets: { ingestionId: string | null; etlId: string; workflowJobId: number }): Promise<AttemptOutcome> => {
    emit({ type: "step", step: "workflow_run", status: "running" });
    const wfRes = await runJobAndWait(dbx, assets.workflowJobId, {}, log, "workflow");
    if (!wfRes.ok) {
      // enrich with ETL pipeline event errors — the real failure usually lives there
      const dq = await collectDqFromEvents(dbx, assets.etlId).catch(() => ({ summary: "", failures: [] as string[] }));
      emit({ type: "step", step: "workflow_run", status: "failed", meta: wfRes.state });
      return {
        ok: false,
        failedStep: "workflow_run",
        evidence: `workflow failed: ${wfRes.state} ${wfRes.message}\npipeline events: ${dq.failures.slice(0, 5).join(" | ")}`,
      };
    }
    emit({ type: "step", step: "workflow_run", status: "done", meta: `ingest → etl (${spec!.target.entity})` });

    emit({ type: "step", step: "dq", status: "running" });
    const dq = await collectDqFromEvents(dbx, assets.etlId);
    const dqFailed = dq.failures.length > 0;
    emit({ type: "step", step: "dq", status: dqFailed ? "failed" : "done", meta: dq.summary });
    log(`${dqFailed ? "✗" : "✓"} dq: ${dq.summary}`);
    if (dqFailed) {
      return { ok: false, failedStep: "dq", evidence: `data-quality failures: ${dq.failures.slice(0, 8).join(" | ")}`, testsMeta: dq.summary };
    }

    emit({ type: "step", step: "recon", status: "running" });
    const reconJobId = await findReconJobId(dbx, cfg.PF_FRAMEWORK_RECON_JOB_NAME);
    if (!reconJobId) {
      emit({ type: "step", step: "recon", status: "deferred", meta: "framework recon job not found" });
      log("▸ recon: pf-framework-recon job not found — deploy the ingestion-framework bundle");
      return { ok: true, recon: null, testsMeta: dq.summary };
    }
    const reconId = randomUUID();
    const reconRes = await runJobAndWait(
      dbx,
      reconJobId,
      {
        source,
        entity: spec!.entity,
        spec_table: `${cfg.PF_CATALOG}.${cfg.PF_SCHEMA}.dataflow_spec`,
        recon_id: reconId,
        run_id: runId,
        catalog: cfg.PF_CATALOG,
        schema: cfg.PF_SCHEMA,
      },
      log,
      "recon",
    );
    if (!reconRes.ok) {
      emit({ type: "step", step: "recon", status: "failed", meta: reconRes.state });
      return { ok: false, failedStep: "recon", evidence: `recon job failed: ${reconRes.state} ${reconRes.message}`, testsMeta: dq.summary };
    }
    const reconRows = await dbx.sqlRows(
      `SELECT key_match_rate, row_match_rate, attr_match_rate
       FROM ${fq(cfg.registry, "recon_entity_result")} WHERE recon_id = ${lit(reconId)} LIMIT 1`,
      warehouse,
    );
    const rr = reconRows[0];
    const recon = rr
      ? {
          keyMatchRate: rr.key_match_rate === null ? null : Number(rr.key_match_rate),
          rowMatchRate: rr.row_match_rate === null ? null : Number(rr.row_match_rate),
          attrMatchRate: rr.attr_match_rate === null ? null : Number(rr.attr_match_rate),
        }
      : null;
    const pct = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(2)}%`);

    const belowThreshold =
      recon !== null &&
      ((recon.keyMatchRate ?? 1) < cfg.PF_RECON_MIN_KEY || (recon.attrMatchRate ?? 1) < cfg.PF_RECON_MIN_ATTR);
    if (belowThreshold) {
      emit({ type: "step", step: "recon", status: "failed", meta: `key ${pct(recon!.keyMatchRate)} · attr ${pct(recon!.attrMatchRate)} below threshold` });
      const diffs = await dbx.sqlRows(
        `SELECT key_value, column_name, source_value, target_value FROM ${fq(cfg.registry, "recon_record_diff")}
         WHERE recon_id = ${lit(reconId)} LIMIT 10`,
        warehouse,
      );
      return {
        ok: false,
        failedStep: "recon",
        evidence:
          `recon below threshold (key ${pct(recon!.keyMatchRate)} < ${cfg.PF_RECON_MIN_KEY} or attr ${pct(recon!.attrMatchRate)} < ${cfg.PF_RECON_MIN_ATTR}).\n` +
          `Sample mismatched records: ${JSON.stringify(diffs)}`,
        testsMeta: dq.summary,
        recon,
      };
    }
    emit({ type: "step", step: "recon", status: "done", meta: `key ${pct(recon?.keyMatchRate)} · attr ${pct(recon?.attrMatchRate)}` });
    log(`✓ recon: key ${pct(recon?.keyMatchRate)} row ${pct(recon?.rowMatchRate)} attr ${pct(recon?.attrMatchRate)}`);
    return { ok: true, recon, testsMeta: dq.summary };
  };

  try {
    let sourceObjects = await collectSourceObjects();
    let result = await renderAndCommit(commitMessage(spec), sourceObjects);
    await upsertSpec(result);
    const assets = await provision(sourceObjects);
    let outcome = await attempt(assets);

    // ---- bounded fix loop (constraint #2: spec deltas only) ----
    while (!outcome.ok) {
      if (fixIterations.length >= cfg.MAX_FIX_ITERATIONS) {
        await recordFailure(
          `fix loop exhausted after ${cfg.MAX_FIX_ITERATIONS} iterations — needs human. Last failure: ${outcome.evidence?.slice(0, 200)}`,
          true,
        );
      }
      const iteration = fixIterations.length + 1;
      log(`▸ fix loop: attempt ${iteration} of ${cfg.MAX_FIX_ITERATIONS} — asking LLM for a spec delta`);
      const delta = await fmapi.structured({
        purpose: "fix_loop_delta",
        system: FIX_SYSTEM_PROMPT,
        user: buildFixUserPrompt(JSON.stringify(spec), outcome.evidence ?? "unknown failure"),
        schema: SpecDeltaSchema,
        schemaName: "spec_delta",
      });
      if (delta.columns.length === 0 && delta.expectations.length === 0) {
        await recordFailure(`fix loop: LLM judged failure unfixable by spec change — ${delta.reason}`, true);
      }
      fixIterations.push({ iteration, reason: delta.reason });
      emit({ type: "fix", iteration, maxIterations: cfg.MAX_FIX_ITERATIONS, meta: delta.reason });
      log(`▸ fix ${iteration}: ${delta.reason}`);

      spec = applyDelta(spec, delta);
      await registry.insertVersion(spec, `fix-loop ${iteration}: ${delta.reason}`, "fix-loop");
      sourceObjects = await collectSourceObjects();
      result = await renderAndCommit(
        `fix(${spec.entity}): iteration ${iteration} — ${delta.reason.slice(0, 60)}\n\nspec_id: ${spec.spec_id}\nspec_version: ${spec.spec_version}\ngenerated_by: pipeline_factory`,
        sourceObjects,
      );
      await upsertSpec(result);
      outcome = await attempt(assets);
    }

    // ---- PR with evidence (human gate #2 — merge is never automated) ----
    emit({ type: "step", step: "pr", status: "running" });
    const evidence = buildEvidenceMarkdown({
      spec,
      files: result.files,
      approvedBy: reg.approved_by ?? null,
      buildRunId: runId,
      fixIterations,
      recon: outcome.recon ?? null,
    });
    await cicd.commitFiles(
      branch,
      [{ path: evidencePath(spec), content: evidence }],
      `docs(${spec.entity}): build evidence\n\nspec_id: ${spec.spec_id}\nspec_version: ${spec.spec_version}`,
    );
    const pr = await cicd.openPullRequest(
      branch,
      `[pipeline-factory] ${spec.entity} ingestion metadata (spec ${spec.spec_id} v${spec.spec_version})`,
      evidence,
    );
    emit({ type: "step", step: "pr", status: "done", meta: `#${pr.number}` });
    log(`✓ PR ${pr.url}`);

    await registry.completeBuildRun(runId, fixIterations.length, pr.url);
    await registry.setStatus(specId, "pr_open");
    emit({ type: "done", pr: { url: pr.url, number: pr.number }, run_id: runId });
    return { runId, prUrl: pr.url };
  } catch (err) {
    // recordFailure already handled bookkeeping for controlled failures
    if (!(err instanceof Error && err.message.startsWith("fix loop"))) {
      await registry.failRunningBuildRun(runId, String(err));
    }
    throw err;
  }
}

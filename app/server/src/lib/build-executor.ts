import { randomUUID } from "node:crypto";
import {
  applyDelta,
  branchName,
  buildEvidenceMarkdown,
  buildManifest,
  commitMessage,
  fq,
  SpecDeltaSchema,
  type RenderResult,
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
import type { RegistryClient } from "./registry-client.js";
import type { AppConfig } from "../config.js";

function lit(v: string | null): string {
  return v === null ? "NULL" : `'${v.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

/** Step ids match the design stepper. */
export const BUILD_STEPS = ["render", "branch", "deploy_dev", "pipeline_run", "tests", "recon", "pr"] as const;
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
  registry: RegistryClient;
  dbx: DbxClient;
  cfg: AppConfig;
  cicd: CicdAdapter;
  render: (spec: Spec) => RenderResult;
  fmapi: FmapiClient;
}

const TERMINAL = ["TERMINATED", "SKIPPED", "INTERNAL_ERROR"];

async function runJobAndWait(
  dbx: DbxClient,
  jobId: number,
  params: Record<string, string>,
  log: (t: string) => void,
  label: string,
  timeoutMs = 20 * 60_000,
): Promise<{ ok: boolean; state: string; message: string }> {
  const { run_id } = await dbx.jobRunNow(jobId, params);
  log(`▸ ${label}: job run ${run_id} submitted`);
  const deadline = Date.now() + timeoutMs;
  let last = "";
  for (;;) {
    if (Date.now() > deadline) return { ok: false, state: "TIMEOUT", message: "job timed out" };
    await new Promise((r) => setTimeout(r, 6000));
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

/**
 * Full build with the bounded fix loop (hard constraint #2): on runner failure
 * the LLM produces a spec DELTA — never file edits — the spec re-renders,
 * re-stages, re-runs. MAX_FIX_ITERATIONS exhausted → needs_human.
 */
export async function executeBuild(deps: BuildDeps, specId: string, emit: BuildEmitter): Promise<{ runId: string; prUrl: string }> {
  const { registry, dbx, cfg, cicd, render, fmapi } = deps;
  const now = () => new Date().toISOString().slice(11, 19);
  const log = (text: string) => emit({ type: "log", text: `${now()} ${text}` });
  const warehouse = cfg.DATABRICKS_WAREHOUSE_ID;

  let spec = await registry.getSpec(specId);
  if (!spec) throw new Error("spec not found");
  const rows = await dbx.sqlRows(
    `SELECT status, approved_by FROM ${fq(cfg.registry, "spec_registry")} WHERE spec_id = ${lit(specId)}`,
    warehouse,
  );
  const reg = rows[0];
  if (!reg || (reg.status !== "approved" && reg.status !== "pr_open")) {
    throw new Error(`spec must be approved to build (status: ${reg?.status ?? "missing"})`);
  }

  const runId = randomUUID();
  const branch = branchName(spec); // fixed at build start; fix commits land on it
  const fixIterations: { iteration: number; reason: string }[] = [];
  log(`▸ build ${runId.slice(0, 8)} started (adapter: ${cicd.kind}, max fix iterations: ${cfg.MAX_FIX_ITERATIONS})`);

  await dbx.sql(
    `INSERT INTO ${fq(cfg.registry, "build_runs")}
     (run_id, spec_id, spec_version, phase, status, fix_iteration, branch, pr_url, detail, started_at, finished_at)
     VALUES (${lit(runId)}, ${lit(spec.spec_id)}, ${spec.spec_version}, 'render', 'running', 0,
             ${lit(branch)}, NULL, ${lit(`adapter=${cicd.kind}`)}, current_timestamp(), NULL)`,
    warehouse,
  );

  const recordFailure = async (detail: string, needsHuman: boolean): Promise<never> => {
    await dbx.sql(
      `UPDATE ${fq(cfg.registry, "build_runs")}
       SET status = 'failed', fix_iteration = ${fixIterations.length}, detail = ${lit(detail.slice(0, 500))}, finished_at = current_timestamp()
       WHERE run_id = ${lit(runId)}`,
      warehouse,
    );
    if (needsHuman) await registry.setStatus(specId, "needs_human");
    emit({ type: "error", text: detail.slice(0, 500) });
    throw new Error(detail.slice(0, 500));
  };

  // render + commit current spec state to the branch
  const renderAndCommit = async (message: string): Promise<RenderResult> => {
    emit({ type: "step", step: "render", status: "running" });
    const result = render(spec!);
    emit({ type: "step", step: "render", status: "done", meta: `${result.files.length} artifacts · v${spec!.spec_version}` });

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

  const stage = async (files: RenderResult["files"]): Promise<void> => {
    emit({ type: "step", step: "deploy_dev", status: "running" });
    const staged = fq(cfg.registry, "staged_artifacts");
    await dbx.sql(
      `DELETE FROM ${staged} WHERE spec_id = ${lit(spec!.spec_id)} AND spec_version = ${spec!.spec_version}`,
      warehouse,
    );
    const stagedFiles = [
      ...files.map((f) => ({ path: f.path, content: f.content, sha256: f.sha256 as string | null })),
      { path: "spec.json", content: JSON.stringify(spec), sha256: null },
    ];
    for (const f of stagedFiles) {
      await dbx.sql(
        `INSERT INTO ${staged} (spec_id, spec_version, path, content, sha256, staged_at)
         VALUES (${lit(spec!.spec_id)}, ${spec!.spec_version}, ${lit(f.path)}, ${lit(f.content)}, ${lit(f.sha256)}, current_timestamp())`,
        warehouse,
      );
    }
    emit({ type: "step", step: "deploy_dev", status: "done", meta: `staged v${spec!.spec_version} → ctl.staged_artifacts` });
    log(`▸ deploy: ${stagedFiles.length} files staged (v${spec!.spec_version})`);
  };

  /** One pipeline→tests→recon pass against the currently staged spec version. */
  const attempt = async (): Promise<AttemptOutcome> => {
    const pipelineJob = Number(cfg.PF_JOB_PIPELINE_RUNNER);
    const reconJob = Number(cfg.PF_JOB_RECON_RUNNER);
    if (!pipelineJob || !reconJob) {
      for (const step of ["pipeline_run", "tests", "recon"] as const) {
        emit({ type: "step", step, status: "deferred", meta: "runner jobs not configured" });
      }
      log("▸ pipeline/tests/recon: runner job ids not configured — steps deferred");
      return { ok: true, recon: null, testsMeta: "" };
    }
    const jobParams = { spec_id: spec!.spec_id, spec_version: String(spec!.spec_version), run_id: runId };

    emit({ type: "step", step: "pipeline_run", status: "running" });
    const pipeRes = await runJobAndWait(dbx, pipelineJob, jobParams, log, "pipeline");

    // tests detail row is written by the runner even on failure paths that reach it
    const testsRows = await dbx.sqlRows(
      `SELECT status, detail FROM ${fq(cfg.registry, "build_runs")}
       WHERE run_id = ${lit(runId)} AND phase = 'tests' ORDER BY started_at DESC LIMIT 1`,
      warehouse,
    );
    const testsRow = testsRows[0];
    let testsMeta = "";
    try {
      const d = JSON.parse(testsRow?.detail ?? "{}") as { pass?: number; total?: number; rows?: number };
      testsMeta = `${d.pass ?? "?"}/${d.total ?? "?"} pass · ${d.rows ?? "?"} rows`;
    } catch {
      testsMeta = testsRow?.status ?? "no result";
    }

    if (!pipeRes.ok) {
      const failedOnTests = testsRow?.status === "failed";
      const step: BuildStep = failedOnTests ? "tests" : "pipeline_run";
      emit({ type: "step", step, status: "failed", meta: failedOnTests ? testsMeta : pipeRes.state });
      return {
        ok: false,
        failedStep: step,
        evidence: `${step} failed. Job state: ${pipeRes.state} ${pipeRes.message}\nTests detail: ${testsRow?.detail ?? "n/a"}`,
        testsMeta,
      };
    }
    emit({ type: "step", step: "pipeline_run", status: "done", meta: spec!.target.entity });
    emit({ type: "step", step: "tests", status: "done", meta: testsMeta });
    log(`✓ tests: ${testsMeta}`);

    emit({ type: "step", step: "recon", status: "running" });
    const reconId = randomUUID();
    const reconRes = await runJobAndWait(dbx, reconJob, { ...jobParams, recon_id: reconId }, log, "recon");
    if (!reconRes.ok) {
      emit({ type: "step", step: "recon", status: "failed", meta: reconRes.state });
      return { ok: false, failedStep: "recon", evidence: `recon job failed: ${reconRes.state} ${reconRes.message}`, testsMeta };
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
        `SELECT key_value, column_name FROM ${fq(cfg.registry, "recon_record_diff")}
         WHERE recon_id = ${lit(reconId)} LIMIT 10`,
        warehouse,
      );
      return {
        ok: false,
        failedStep: "recon",
        evidence:
          `recon below threshold (key ${pct(recon!.keyMatchRate)} < ${cfg.PF_RECON_MIN_KEY} or attr ${pct(recon!.attrMatchRate)} < ${cfg.PF_RECON_MIN_ATTR}).\n` +
          `Sample mismatched records: ${JSON.stringify(diffs)}`,
        testsMeta,
        recon,
      };
    }
    emit({ type: "step", step: "recon", status: "done", meta: `key ${pct(recon?.keyMatchRate)} · attr ${pct(recon?.attrMatchRate)}` });
    log(`✓ recon: key ${pct(recon?.keyMatchRate)} row ${pct(recon?.rowMatchRate)} attr ${pct(recon?.attrMatchRate)}`);
    return { ok: true, recon, testsMeta };
  };

  try {
    let result = await renderAndCommit(commitMessage(spec));
    await stage(result.files);
    let outcome = await attempt();

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
      result = await renderAndCommit(
        `fix(${spec.entity}): iteration ${iteration} — ${delta.reason.slice(0, 60)}\n\nspec_id: ${spec.spec_id}\nspec_version: ${spec.spec_version}\ngenerated_by: pipeline_factory`,
      );
      await stage(result.files);
      outcome = await attempt();
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
      [{ path: `pipelines/${spec.entity}/EVIDENCE.md`, content: evidence }],
      `docs(${spec.entity}): build evidence\n\nspec_id: ${spec.spec_id}\nspec_version: ${spec.spec_version}`,
    );
    const pr = await cicd.openPullRequest(
      branch,
      `[pipeline-factory] ${spec.entity} ingestion (spec ${spec.spec_id} v${spec.spec_version})`,
      evidence,
    );
    emit({ type: "step", step: "pr", status: "done", meta: `#${pr.number}` });
    log(`✓ PR ${pr.url}`);

    await dbx.sql(
      `UPDATE ${fq(cfg.registry, "build_runs")}
       SET phase = 'pr_open', status = 'succeeded', fix_iteration = ${fixIterations.length},
           pr_url = ${lit(pr.url)}, finished_at = current_timestamp()
       WHERE run_id = ${lit(runId)}`,
      warehouse,
    );
    await registry.setStatus(specId, "pr_open");
    emit({ type: "done", pr: { url: pr.url, number: pr.number }, run_id: runId });
    return { runId, prUrl: pr.url };
  } catch (err) {
    // recordFailure already handled bookkeeping for controlled failures
    if (!(err instanceof Error && err.message.startsWith("fix loop"))) {
      await dbx.sql(
        `UPDATE ${fq(cfg.registry, "build_runs")}
         SET status = 'failed', detail = ${lit(String(err).slice(0, 500))}, finished_at = current_timestamp()
         WHERE run_id = ${lit(runId)} AND status = 'running'`,
        warehouse,
      );
    }
    throw err;
  }
}

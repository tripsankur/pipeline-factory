import { randomUUID } from "node:crypto";
import {
  branchName,
  buildEvidenceMarkdown,
  buildManifest,
  commitMessage,
  fq,
  type RenderResult,
  type Spec,
} from "@pf/core";
import type { CicdAdapter, CommitFile } from "@pf/adapters";
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
  type: "step" | "log" | "done" | "error";
  step?: BuildStep;
  status?: "running" | "done" | "deferred" | "failed";
  meta?: string;
  text?: string;
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
}

const TERMINAL = ["TERMINATED", "SKIPPED", "INTERNAL_ERROR"];

async function runJobAndWait(
  dbx: DbxClient,
  jobId: number,
  params: Record<string, string>,
  log: (t: string) => void,
  label: string,
  timeoutMs = 20 * 60_000,
): Promise<{ ok: boolean; state: string; url?: string }> {
  const { run_id } = await dbx.jobRunNow(jobId, params);
  log(`▸ ${label}: job run ${run_id} submitted`);
  const deadline = Date.now() + timeoutMs;
  let last = "";
  for (;;) {
    if (Date.now() > deadline) return { ok: false, state: "TIMEOUT" };
    await new Promise((r) => setTimeout(r, 6000));
    const run = await dbx.jobGetRun(run_id);
    const lc = run.state.life_cycle_state;
    if (lc !== last) {
      last = lc;
      log(`▸ ${label}: ${lc.toLowerCase()}${run.state.state_message ? ` — ${run.state.state_message}` : ""}`);
    }
    if (TERMINAL.includes(lc)) {
      const ok = run.state.result_state === "SUCCESS";
      return { ok, state: run.state.result_state ?? lc, ...(run.run_page_url ? { url: run.run_page_url } : {}) };
    }
  }
}

/**
 * Full build: render → branch/commit → stage to volume → pipeline_runner job →
 * expectations → recon_runner job → PR with recon-bearing evidence.
 * Runner steps only report `deferred` when runner job ids are not configured.
 */
export async function executeBuild(deps: BuildDeps, specId: string, emit: BuildEmitter): Promise<{ runId: string; prUrl: string }> {
  const { registry, dbx, cfg, cicd, render } = deps;
  const now = () => new Date().toISOString().slice(11, 19);
  const log = (text: string) => emit({ type: "log", text: `${now()} ${text}` });
  const warehouse = cfg.DATABRICKS_WAREHOUSE_ID;

  const spec = await registry.getSpec(specId);
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
  const branch = branchName(spec);
  log(`▸ build ${runId.slice(0, 8)} started (adapter: ${cicd.kind})`);

  await dbx.sql(
    `INSERT INTO ${fq(cfg.registry, "build_runs")}
     (run_id, spec_id, spec_version, phase, status, fix_iteration, branch, pr_url, detail, started_at, finished_at)
     VALUES (${lit(runId)}, ${lit(spec.spec_id)}, ${spec.spec_version}, 'render', 'running', 0,
             ${lit(branch)}, NULL, ${lit(`adapter=${cicd.kind}`)}, current_timestamp(), NULL)`,
    warehouse,
  );

  const fail = async (step: BuildStep, detail: string): Promise<never> => {
    emit({ type: "step", step, status: "failed", meta: detail.slice(0, 120) });
    await dbx.sql(
      `UPDATE ${fq(cfg.registry, "build_runs")}
       SET status = 'failed', detail = ${lit(detail.slice(0, 500))}, finished_at = current_timestamp()
       WHERE run_id = ${lit(runId)}`,
      warehouse,
    );
    emit({ type: "error", text: detail.slice(0, 500) });
    throw new Error(detail.slice(0, 500));
  };

  try {
    // 1. render
    emit({ type: "step", step: "render", status: "running" });
    const t0 = Date.now();
    const { files } = render(spec);
    emit({ type: "step", step: "render", status: "done", meta: `${files.length} artifacts · ${((Date.now() - t0) / 1000).toFixed(1)}s` });
    log(`▸ render: ${files.length} artifacts materialized`);

    // 2. branch + commit artifacts + manifest (evidence committed after recon)
    emit({ type: "step", step: "branch", status: "running" });
    const manifest = buildManifest(spec, files);
    const commitFiles: CommitFile[] = [
      ...files.map((f) => ({ path: f.path, content: f.content })),
      { path: "factory.manifest.yml", content: manifest },
    ];
    await cicd.createBranch(branch);
    await cicd.commitFiles(branch, commitFiles, commitMessage(spec));
    emit({ type: "step", step: "branch", status: "done", meta: branch });
    log(`▸ git: branch ${branch}, ${commitFiles.length} files committed`);

    // 3. stage artifacts + spec into ctl.staged_artifacts (runner input — Delta,
    // not a volume: table ACLs already work for both the app SP and the runner
    // identity, no extra grants required; see ADR-006)
    emit({ type: "step", step: "deploy_dev", status: "running" });
    const staged = fq(cfg.registry, "staged_artifacts");
    await dbx.sql(
      `DELETE FROM ${staged} WHERE spec_id = ${lit(spec.spec_id)} AND spec_version = ${spec.spec_version}`,
      warehouse,
    );
    const stagedFiles = [
      ...files.map((f) => ({ path: f.path, content: f.content, sha256: f.sha256 as string | null })),
      { path: "spec.json", content: JSON.stringify(spec), sha256: null },
    ];
    for (const f of stagedFiles) {
      await dbx.sql(
        `INSERT INTO ${staged} (spec_id, spec_version, path, content, sha256, staged_at)
         VALUES (${lit(spec.spec_id)}, ${spec.spec_version}, ${lit(f.path)}, ${lit(f.content)}, ${lit(f.sha256)}, current_timestamp())`,
        warehouse,
      );
    }
    emit({ type: "step", step: "deploy_dev", status: "done", meta: `staged ${stagedFiles.length} files → ctl.staged_artifacts` });
    log(`▸ deploy: ${stagedFiles.length} files staged to ${cfg.registry.schema}.staged_artifacts v${spec.spec_version}`);

    // 4–6. runner jobs (real when configured, deferred otherwise)
    const pipelineJob = Number(cfg.PF_JOB_PIPELINE_RUNNER);
    const reconJob = Number(cfg.PF_JOB_RECON_RUNNER);
    let recon: { keyMatchRate: number | null; rowMatchRate: number | null; attrMatchRate: number | null } | null = null;
    let testsMeta = "";

    if (!pipelineJob || !reconJob) {
      for (const step of ["pipeline_run", "tests", "recon"] as const) {
        emit({ type: "step", step, status: "deferred", meta: "runner jobs not configured" });
      }
      log("▸ pipeline/tests/recon: runner job ids not configured — steps deferred");
    } else {
      const jobParams = {
        spec_id: spec.spec_id,
        spec_version: String(spec.spec_version),
        run_id: runId,
      };

      emit({ type: "step", step: "pipeline_run", status: "running" });
      const pipeRes = await runJobAndWait(dbx, pipelineJob, jobParams, log, "pipeline");
      if (!pipeRes.ok) await fail("pipeline_run", `pipeline_runner ${pipeRes.state}${pipeRes.url ? ` (${pipeRes.url})` : ""}`);
      emit({ type: "step", step: "pipeline_run", status: "done", meta: spec.target.entity });

      emit({ type: "step", step: "tests", status: "running" });
      const testsRows = await dbx.sqlRows(
        `SELECT status, detail FROM ${fq(cfg.registry, "build_runs")}
         WHERE run_id = ${lit(runId)} AND phase = 'tests' ORDER BY started_at DESC LIMIT 1`,
        warehouse,
      );
      const testsRow = testsRows[0];
      try {
        const d = JSON.parse(testsRow?.detail ?? "{}") as { pass?: number; total?: number; rows?: number };
        testsMeta = `${d.pass ?? "?"}/${d.total ?? "?"} pass · ${d.rows ?? "?"} rows`;
      } catch {
        testsMeta = testsRow?.status ?? "unknown";
      }
      if (testsRow?.status === "failed") await fail("tests", `expectations failed: ${testsMeta}`);
      emit({ type: "step", step: "tests", status: "done", meta: testsMeta });
      log(`✓ tests: ${testsMeta}`);

      emit({ type: "step", step: "recon", status: "running" });
      const reconId = randomUUID();
      const reconRes = await runJobAndWait(dbx, reconJob, { ...jobParams, recon_id: reconId }, log, "recon");
      if (!reconRes.ok) await fail("recon", `recon_runner ${reconRes.state}${reconRes.url ? ` (${reconRes.url})` : ""}`);
      const reconRows = await dbx.sqlRows(
        `SELECT key_match_rate, row_match_rate, attr_match_rate
         FROM ${fq(cfg.registry, "recon_entity_result")} WHERE recon_id = ${lit(reconId)} LIMIT 1`,
        warehouse,
      );
      const rr = reconRows[0];
      recon = rr
        ? {
            keyMatchRate: rr.key_match_rate === null ? null : Number(rr.key_match_rate),
            rowMatchRate: rr.row_match_rate === null ? null : Number(rr.row_match_rate),
            attrMatchRate: rr.attr_match_rate === null ? null : Number(rr.attr_match_rate),
          }
        : null;
      const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(2)}%`);
      emit({
        type: "step",
        step: "recon",
        status: "done",
        meta: recon ? `key ${pct(recon.keyMatchRate)} · attr ${pct(recon.attrMatchRate)}` : "no result row",
      });
      log(`✓ recon: key ${pct(recon?.keyMatchRate ?? null)} row ${pct(recon?.rowMatchRate ?? null)} attr ${pct(recon?.attrMatchRate ?? null)}`);
    }

    // 7. PR with evidence (recon-bearing when runners ran)
    emit({ type: "step", step: "pr", status: "running" });
    const evidence = buildEvidenceMarkdown({
      spec,
      files,
      approvedBy: reg.approved_by ?? null,
      buildRunId: runId,
      fixIterations: [],
      recon,
    });
    await cicd.commitFiles(branch, [{ path: `pipelines/${spec.entity}/EVIDENCE.md`, content: evidence }], `docs(${spec.entity}): build evidence\n\nspec_id: ${spec.spec_id}\nspec_version: ${spec.spec_version}`);
    const pr = await cicd.openPullRequest(
      branch,
      `[pipeline-factory] ${spec.entity} ingestion (spec ${spec.spec_id} v${spec.spec_version})`,
      evidence,
    );
    emit({ type: "step", step: "pr", status: "done", meta: `#${pr.number}` });
    log(`✓ PR ${pr.url}`);

    await dbx.sql(
      `UPDATE ${fq(cfg.registry, "build_runs")}
       SET phase = 'pr_open', status = 'succeeded', pr_url = ${lit(pr.url)}, finished_at = current_timestamp()
       WHERE run_id = ${lit(runId)}`,
      warehouse,
    );
    await registry.setStatus(specId, "pr_open");
    emit({ type: "done", pr: { url: pr.url, number: pr.number }, run_id: runId });
    return { runId, prUrl: pr.url };
  } catch (err) {
    // fail() already recorded step-level failures; record unexpected ones
    if (!(err instanceof Error && err.message.length < 501)) {
      await dbx.sql(
        `UPDATE ${fq(cfg.registry, "build_runs")}
         SET status = 'failed', detail = ${lit(String(err).slice(0, 500))}, finished_at = current_timestamp()
         WHERE run_id = ${lit(runId)}`,
        warehouse,
      );
      emit({ type: "error", text: String(err).slice(0, 500) });
    }
    throw err;
  }
}

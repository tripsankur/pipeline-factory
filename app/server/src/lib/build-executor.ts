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

/** Step ids match the design stepper. Runner-backed steps report `deferred` until M4. */
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

/**
 * W3 build: render → branch → commit → manifest+evidence → PR, streaming
 * progress events. Runner steps (deploy/run/tests/recon) emit `deferred`
 * until the M4 runner jobs land — shown as pending in the console, never faked.
 */
export async function executeBuild(deps: BuildDeps, specId: string, emit: BuildEmitter): Promise<{ runId: string; prUrl: string }> {
  const { registry, dbx, cfg, cicd, render } = deps;
  const now = () => new Date().toISOString().slice(11, 19);
  const log = (text: string) => emit({ type: "log", text: `${now()} ${text}` });

  const spec = await registry.getSpec(specId);
  if (!spec) throw new Error("spec not found");
  const rows = await dbx.sqlRows(
    `SELECT status, approved_by FROM ${fq(cfg.registry, "spec_registry")} WHERE spec_id = ${lit(specId)}`,
    cfg.DATABRICKS_WAREHOUSE_ID,
  );
  const reg = rows[0];
  if (!reg || (reg.status !== "approved" && reg.status !== "pr_open")) {
    throw new Error(`spec must be approved to build (status: ${reg?.status ?? "missing"})`);
  }

  const runId = randomUUID();
  const branch = branchName(spec);
  emit({ type: "log", text: `${now()} ▸ build ${runId.slice(0, 8)} started (adapter: ${cicd.kind})` });

  await dbx.sql(
    `INSERT INTO ${fq(cfg.registry, "build_runs")}
     (run_id, spec_id, spec_version, phase, status, fix_iteration, branch, pr_url, detail, started_at, finished_at)
     VALUES (${lit(runId)}, ${lit(spec.spec_id)}, ${spec.spec_version}, 'render', 'running', 0,
             ${lit(branch)}, NULL, ${lit(`adapter=${cicd.kind}`)}, current_timestamp(), NULL)`,
    cfg.DATABRICKS_WAREHOUSE_ID,
  );

  try {
    emit({ type: "step", step: "render", status: "running" });
    const t0 = Date.now();
    const { files } = render(spec);
    emit({ type: "step", step: "render", status: "done", meta: `${files.length} templates · ${((Date.now() - t0) / 1000).toFixed(1)}s` });
    log(`▸ render: ${files.length} artifacts materialized`);

    const evidence = buildEvidenceMarkdown({
      spec,
      files,
      approvedBy: reg.approved_by ?? null,
      buildRunId: runId,
      fixIterations: [],
      recon: null,
    });
    const manifest = buildManifest(spec, files);
    const commitFiles: CommitFile[] = [
      ...files.map((f) => ({ path: f.path, content: f.content })),
      { path: "factory.manifest.yml", content: manifest },
      { path: `pipelines/${spec.entity}/EVIDENCE.md`, content: evidence },
    ];

    emit({ type: "step", step: "branch", status: "running" });
    await cicd.createBranch(branch);
    await cicd.commitFiles(branch, commitFiles, commitMessage(spec));
    emit({ type: "step", step: "branch", status: "done", meta: branch });
    log(`▸ git: branch ${branch}, ${commitFiles.length} files committed`);

    for (const [step, why] of [
      ["deploy_dev", "runner job lands in M4"],
      ["pipeline_run", "runner job lands in M4"],
      ["tests", "runner job lands in M4"],
      ["recon", "runner job lands in M4"],
    ] as const) {
      emit({ type: "step", step, status: "deferred", meta: why });
    }
    log("▸ deploy/run/tests/recon: deferred to runner jobs (M4) — PR carries render evidence only");

    emit({ type: "step", step: "pr", status: "running" });
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
      cfg.DATABRICKS_WAREHOUSE_ID,
    );
    await registry.setStatus(specId, "pr_open");
    emit({ type: "done", pr: { url: pr.url, number: pr.number }, run_id: runId });
    return { runId, prUrl: pr.url };
  } catch (err) {
    await dbx.sql(
      `UPDATE ${fq(cfg.registry, "build_runs")}
       SET status = 'failed', detail = ${lit(String(err).slice(0, 500))}, finished_at = current_timestamp()
       WHERE run_id = ${lit(runId)}`,
      cfg.DATABRICKS_WAREHOUSE_ID,
    );
    emit({ type: "error", text: String(err).slice(0, 500) });
    throw err;
  }
}

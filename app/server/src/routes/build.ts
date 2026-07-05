import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import {
  branchName,
  buildEvidenceMarkdown,
  buildManifest,
  commitMessage,
  createRenderer,
  fq,
} from "@pf/core";
import {
  GitHubCicdAdapter,
  MockCicdAdapter,
  type CicdAdapter,
  type CommitFile,
} from "@pf/adapters";
import type { DbxClient } from "@pf/dbx";
import type { RegistryClient } from "../lib/registry-client.js";
import { identityFrom } from "../lib/identity.js";
import { resolveTemplatesDir } from "./render.js";
import type { AppConfig } from "../config.js";

function lit(v: string | null): string {
  return v === null ? "NULL" : `'${v.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

export function makeCicdAdapter(cfg: AppConfig): CicdAdapter {
  const token = process.env.GITHUB_TOKEN ?? "";
  if (cfg.PF_GITHUB_REPO && token) {
    return new GitHubCicdAdapter({ repo: cfg.PF_GITHUB_REPO, token });
  }
  return new MockCicdAdapter(join(tmpdir(), "pipeline-factory-mock-cicd"));
}

/**
 * W3: approved spec -> branch -> commit artifacts + manifest + evidence -> PR.
 * PR merge is human gate #2 — no auto-merge code path exists (constraint #7).
 */
export function registerBuildRoutes(
  app: FastifyInstance,
  registry: RegistryClient,
  dbx: DbxClient,
  cfg: AppConfig,
): void {
  const render = createRenderer({ templatesDir: resolveTemplatesDir() });
  const cicd = makeCicdAdapter(cfg);

  app.post("/api/specs/:id/build", async (req, reply) => {
    const { id } = req.params as { id: string };
    const spec = await registry.getSpec(id);
    if (!spec) return reply.code(404).send({ error: "spec not found" });

    const rows = await dbx.sqlRows(
      `SELECT status, approved_by FROM ${fq(cfg.registry, "spec_registry")} WHERE spec_id = ${lit(id)}`,
      cfg.DATABRICKS_WAREHOUSE_ID,
    );
    const reg = rows[0];
    if (!reg || reg.status !== "approved") {
      return reply.code(409).send({ error: `spec must be approved to build (status: ${reg?.status ?? "missing"})` });
    }

    const user = identityFrom(req, cfg.PF_DEV_USER_EMAIL);
    const runId = randomUUID();
    const branch = branchName(spec);

    await dbx.sql(
      `INSERT INTO ${fq(cfg.registry, "build_runs")}
       (run_id, spec_id, spec_version, phase, status, fix_iteration, branch, pr_url, detail, started_at, finished_at)
       VALUES (${lit(runId)}, ${lit(spec.spec_id)}, ${spec.spec_version}, 'render', 'running', 0,
               ${lit(branch)}, NULL, ${lit(`adapter=${cicd.kind}`)}, current_timestamp(), NULL)`,
      cfg.DATABRICKS_WAREHOUSE_ID,
    );

    try {
      // 1. render (sole file producer — constraint #1)
      const { files } = render(spec);
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

      // 2. branch + commit + PR via the adapter boundary
      await cicd.createBranch(branch);
      await cicd.commitFiles(branch, commitFiles, commitMessage(spec));
      const pr = await cicd.openPullRequest(
        branch,
        `[pipeline-factory] ${spec.entity} ingestion (spec ${spec.spec_id} v${spec.spec_version})`,
        evidence,
      );

      await dbx.sql(
        `UPDATE ${fq(cfg.registry, "build_runs")}
         SET phase = 'pr_open', status = 'succeeded', pr_url = ${lit(pr.url)}, finished_at = current_timestamp()
         WHERE run_id = ${lit(runId)}`,
        cfg.DATABRICKS_WAREHOUSE_ID,
      );
      await registry.setStatus(id, "pr_open");

      return {
        run_id: runId,
        branch,
        pr,
        adapter: cicd.kind,
        files: commitFiles.map((f) => f.path),
        requested_by: user.email,
      };
    } catch (err) {
      await dbx.sql(
        `UPDATE ${fq(cfg.registry, "build_runs")}
         SET status = 'failed', detail = ${lit(String(err).slice(0, 500))}, finished_at = current_timestamp()
         WHERE run_id = ${lit(runId)}`,
        cfg.DATABRICKS_WAREHOUSE_ID,
      );
      throw err;
    }
  });

  app.get("/api/specs/:id/builds", async (req) => {
    const { id } = req.params as { id: string };
    const rows = await dbx.sqlRows(
      `SELECT run_id, phase, status, fix_iteration, branch, pr_url, detail,
              CAST(started_at AS STRING) AS started_at, CAST(finished_at AS STRING) AS finished_at
       FROM ${fq(cfg.registry, "build_runs")} WHERE spec_id = ${lit(id)} ORDER BY started_at DESC LIMIT 50`,
      cfg.DATABRICKS_WAREHOUSE_ID,
    );
    return { builds: rows };
  });
}

import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { createRenderer, fq } from "@pf/core";
import { GitHubCicdAdapter, MockCicdAdapter, type CicdAdapter, type FmapiClient } from "@pf/adapters";
import type { DbxClient } from "@pf/dbx";
import type { RegistryClient } from "../lib/registry-client.js";
import { executeBuild, type BuildEvent } from "../lib/build-executor.js";
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
 * W3 build routes. PR merge is human gate #2 — no auto-merge path (constraint #7).
 */
export function registerBuildRoutes(
  app: FastifyInstance,
  registry: RegistryClient,
  dbx: DbxClient,
  cfg: AppConfig,
  fmapi: FmapiClient,
): void {
  const render = createRenderer({ templatesDir: resolveTemplatesDir() });
  const cicd = makeCicdAdapter(cfg);
  const deps = { registry, dbx, cfg, cicd, render, fmapi };

  /** One-shot build (JSON response). */
  app.post("/api/specs/:id/build", async (req, reply) => {
    const { id } = req.params as { id: string };
    const events: BuildEvent[] = [];
    try {
      const { runId, prUrl } = await executeBuild(deps, id, (e) => events.push(e));
      const done = events.find((e) => e.type === "done");
      return {
        run_id: runId,
        pr: done?.pr ?? { url: prUrl, number: 0 },
        adapter: cicd.kind,
        logs: events.filter((e) => e.type === "log").map((e) => e.text),
      };
    } catch (err) {
      const msg = String(err);
      const code = msg.includes("must be approved") ? 409 : msg.includes("not found") ? 404 : 500;
      return reply.code(code).send({ error: msg.slice(0, 500) });
    }
  });

  /** Live build over SSE — the build console's data source. */
  app.get("/api/specs/:id/build/stream", async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (e: BuildEvent) => {
      reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    try {
      await executeBuild(deps, id, send);
    } catch {
      // error event already emitted by executeBuild
    }
    reply.raw.end();
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

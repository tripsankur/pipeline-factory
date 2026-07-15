import type { FastifyInstance } from "fastify";
import { fq } from "@pf/core";
import type { DbxClient } from "@pf/dbx";
import type { AppConfig } from "../config.js";
import { identityFrom } from "../lib/identity.js";

/**
 * User integration + Databricks deep links (design pass):
 *  - GET /api/me      — the authenticated user, as forwarded by the Apps proxy
 *  - GET /api/links/:source — every Databricks asset the factory manages for a
 *    source, as clickable workspace URLs (jobs, pipelines, tables, connection)
 */

export function registerLinkRoutes(app: FastifyInstance, dbx: DbxClient, cfg: AppConfig): void {
  const host = cfg.DATABRICKS_HOST.replace(/\/$/, "");

  app.get("/api/me", async (req) => {
    const user = identityFrom(req, cfg.PF_DEV_USER_EMAIL);
    return { email: user.email, workspace_url: host };
  });

  app.get("/api/links/:source", async (req) => {
    const { source } = req.params as { source: string };
    const safe = source.replaceAll("'", "");
    const links: { label: string; kind: string; url: string }[] = [];

    // workflow job
    const jr = await dbx.jobsList(`${safe}_workflow`).catch(() => ({ jobs: [] as { job_id: number; settings?: { name?: string } }[] }));
    const job = (jr.jobs ?? []).find((j) => j.settings?.name === `${safe}_workflow`);
    if (job) links.push({ label: `${safe}_workflow`, kind: "workflow", url: `${host}/jobs/${job.job_id}` });

    // pipelines
    for (const name of [`brnz_${safe}_ingest`, `slvr_${safe}_etl`]) {
      const pr = await dbx.pipelineList(name).catch(() => ({ statuses: [] as { pipeline_id: string; name: string }[] }));
      const hit = (pr.statuses ?? []).find((p) => p.name === name);
      if (hit) {
        links.push({
          label: name,
          kind: name.startsWith("brnz") ? "ingestion_pipeline" : "etl_pipeline",
          url: `${host}/pipelines/${hit.pipeline_id}`,
        });
      }
    }

    // tables from active dataflow rows
    const rows = await dbx
      .sqlRows(
        `SELECT target_details FROM ${fq(cfg.registry, "dataflow_spec")}
         WHERE dataflow_group = '${safe}' AND is_active = true`,
        cfg.DATABRICKS_WAREHOUSE_ID,
      )
      .catch(() => [] as Record<string, string | null>[]);
    const tables = new Set<string>();
    for (const r of rows) {
      try {
        const t = JSON.parse(r.target_details ?? "{}") as Record<string, string>;
        for (const k of ["bronze_table", "silver_table"]) if (t[k]) tables.add(t[k]!);
      } catch {
        /* skip malformed */
      }
    }
    for (const t of tables) {
      links.push({ label: t, kind: "table", url: `${host}/explore/data/${t.split(".").join("/")}` });
    }

    // control-plane tables + connection (static, always useful)
    links.push({ label: `${cfg.registry.catalog}.${cfg.registry.schema} (control plane)`, kind: "schema", url: `${host}/explore/data/${cfg.registry.catalog}/${cfg.registry.schema}` });
    links.push({ label: "UC connections", kind: "connection", url: `${host}/explore/connections` });
    return { workspace_url: host, links };
  });

  /** Direct run URL helper for dashboards: /api/links/run/:source/:runId */
  app.get("/api/links/run/:source/:runId", async (req, reply) => {
    const { source, runId } = req.params as { source: string; runId: string };
    const jr = await dbx.jobsList(`${source.replaceAll("'", "")}_workflow`).catch(() => ({ jobs: [] as { job_id: number; settings?: { name?: string } }[] }));
    const job = (jr.jobs ?? []).find((j) => j.settings?.name === `${source}_workflow`);
    if (!job) return reply.code(404).send({ error: "workflow not found" });
    return { url: `${host}/jobs/${job.job_id}/runs/${runId}` };
  });
}

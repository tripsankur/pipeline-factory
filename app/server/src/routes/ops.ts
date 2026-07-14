import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dataflowSpecTombstoneSql, fq } from "@pf/core";
import type { DbxClient } from "@pf/dbx";
import type { AppConfig } from "../config.js";
import type { PgStore } from "../lib/store/pg-store.js";
import type { RegistryStore } from "../lib/store/types.js";

/**
 * Operational endpoints (audit gaps #2 and #4):
 *  - full refresh / backfill: reset watermarks + full-refresh both pipelines
 *  - decommission: explicit tombstone gate (ADR-010, the third human gate)
 *  - lineage detail: the traceable graph for one entity
 */

function lit(v: string): string {
  return `'${v.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

export function registerOpsRoutes(
  app: FastifyInstance,
  dbx: DbxClient,
  cfg: AppConfig,
  registry: RegistryStore,
  pg: PgStore | null,
): void {
  /** Demo / practice reset: tear down EVERYTHING the factory created for one
   *  source — jobs, pipelines, managed tables, control-plane rows, registry
   *  state — so a demo can rebuild from a blank slate. Framework bundle,
   *  UC connections and secret scopes are deliberately untouched.
   *  Typed confirmation `reset {source}` required. */
  app.post("/api/ops/demo-reset/:source", async (req, reply) => {
    const { source } = req.params as { source: string };
    const body = z.object({ confirm: z.string() }).safeParse(req.body);
    if (!body.success || body.data.confirm !== `reset ${source}`) {
      return reply.code(400).send({ error: `confirm must be exactly 'reset ${source}'` });
    }
    const wh = cfg.DATABRICKS_WAREHOUSE_ID;
    const deleted: Record<string, unknown> = { jobs: [], pipelines: [], tables: [], specs: [] };

    // capture target tables + spec ids BEFORE deleting the metadata that names them
    const rows = await dbx.sqlRows(
      `SELECT dataflow_id, target_details FROM ${fq(cfg.registry, "dataflow_spec")}
       WHERE dataflow_group = ${lit(source)}`,
      wh,
    );
    const specIds = rows.map((r) => String(r.dataflow_id));
    const tables = new Set<string>();
    for (const r of rows) {
      try {
        const t = JSON.parse(r.target_details ?? "{}") as Record<string, string>;
        for (const k of ["bronze_table", "silver_table", "crosswalk_table"]) if (t[k]) tables.add(t[k]!);
      } catch {
        /* ignore malformed rows */
      }
    }

    // 1. workflow job
    const jr = await dbx.jobsList(`${source}_workflow`);
    for (const j of jr.jobs ?? []) {
      if (j.settings?.name === `${source}_workflow`) {
        await dbx.jobDelete(j.job_id);
        (deleted.jobs as unknown[]).push(j.job_id);
      }
    }
    // 2. pipelines (ingest + etl; sync pipelines are shared infra — kept)
    for (const name of [`brnz_${source}_ingest`, `slvr_${source}_etl`]) {
      const pr = await dbx.pipelineList(name);
      for (const p of (pr.statuses ?? []).filter((s) => s.name === name)) {
        await dbx.pipelineDelete(p.pipeline_id);
        (deleted.pipelines as unknown[]).push(p.pipeline_id);
      }
    }
    // 3. managed tables
    for (const t of tables) {
      await dbx.sql(`DROP TABLE IF EXISTS ${t}`, wh).catch(() => undefined);
      (deleted.tables as unknown[]).push(t);
    }
    // 4. control-plane + observability rows (Delta; CDF propagates deletes to synced tables)
    const bySource = ["dataflow_spec:dataflow_group", "ingestion_runs:source", "watermarks:source", "drift_events:source", "batch_config:source", "job_config:source"];
    for (const spec of bySource) {
      const [table, col] = spec.split(":") as [string, string];
      await dbx.sql(`DELETE FROM ${fq(cfg.registry, table)} WHERE ${col} = ${lit(source)}`, wh).catch(() => undefined);
    }
    if (specIds.length > 0) {
      const idList = specIds.map(lit).join(", ");
      for (const t of ["recon_runs", "spec_registry", "spec_versions", "staged_artifacts", "build_runs", "llm_calls"]) {
        await dbx.sql(`DELETE FROM ${fq(cfg.registry, t)} WHERE spec_id IN (${idList})`, wh).catch(() => undefined);
      }
      // recon entity/diff rows key on recon_id — clean orphans
      await dbx
        .sql(`DELETE FROM ${fq(cfg.registry, "recon_entity_result")} WHERE recon_id NOT IN (SELECT recon_id FROM ${fq(cfg.registry, "recon_runs")})`, wh)
        .catch(() => undefined);
      await dbx
        .sql(`DELETE FROM ${fq(cfg.registry, "recon_record_diff")} WHERE recon_id NOT IN (SELECT recon_id FROM ${fq(cfg.registry, "recon_runs")})`, wh)
        .catch(() => undefined);
      // 5. pg registry (the authority the UI reads) — same scope
      if (pg) {
        for (const t of ["spec_versions", "staged_artifacts", "build_runs", "llm_calls", "spec_registry"]) {
          await pg.query(`DELETE FROM pipeline_factory.${t} WHERE spec_id = ANY($1)`, [specIds]).catch(() => undefined);
        }
      }
      deleted.specs = specIds;
    }
    const user = (req.headers["x-forwarded-email"] as string) || cfg.PF_DEV_USER_EMAIL || "operator";
    await registry.logFeatureEvent(`demo_reset:${source}`, user).catch(() => undefined);
    return {
      reset: source,
      deleted,
      kept: ["framework bundle + engine", "UC connections", "secret scopes", "sync pipelines", "Lakebase project"],
      next: "re-ingest the interface contract on the Intake page to rebuild from scratch",
    };
  });

  /** Full refresh / backfill (gap #2): watermark reset + full_refresh updates on
   *  the source's pipelines. Next workflow run re-logs and re-reconciles. */
  app.post("/api/ops/full-refresh/:source", async (req, reply) => {
    const { source } = req.params as { source: string };
    const body = z.object({ confirm: z.string() }).safeParse(req.body);
    if (!body.success || body.data.confirm !== source) {
      return reply.code(400).send({ error: `confirm must equal the source name '${source}'` });
    }
    await dbx.sql(
      `DELETE FROM ${fq(cfg.registry, "watermarks")} WHERE source = ${lit(source)}`,
      cfg.DATABRICKS_WAREHOUSE_ID,
    );
    const started: Record<string, string> = {};
    for (const name of [`brnz_${source}_ingest`, `slvr_${source}_etl`]) {
      const r = await dbx.pipelineList(name);
      const hit = (r.statuses ?? []).find((s) => s.name === name);
      if (hit) {
        const { update_id } = await dbx.pipelineStartUpdate(hit.pipeline_id, { full_refresh: true });
        started[name] = update_id;
      }
    }
    if (Object.keys(started).length === 0) {
      return reply.code(404).send({ error: `no pipelines found for source '${source}'` });
    }
    return {
      source,
      watermarks_reset: true,
      full_refresh_updates: started,
      note: "run the workflow (or wait for cron) afterwards to log + reconcile the refreshed data",
    };
  });

  /** Decommission (gap #4): tombstone the entity's dataflow row with an explicit
   *  typed confirmation; audit lands in feature_events + registry status. */
  app.post("/api/specs/:id/decommission", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ confirm_entity: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "confirm_entity required" });

    const spec = await registry.getSpec(id);
    if (!spec) return reply.code(404).send({ error: "spec not found" });
    if (body.data.confirm_entity !== spec.entity) {
      return reply.code(400).send({
        error: `confirmation mismatch: type the entity name '${spec.entity}' to decommission`,
      });
    }
    const user = (req.headers["x-forwarded-email"] as string) || cfg.PF_DEV_USER_EMAIL || "operator";
    await dbx.sql(dataflowSpecTombstoneSql(cfg.registry, id), cfg.DATABRICKS_WAREHOUSE_ID);
    await registry.setStatus(id, "done");
    await registry.logFeatureEvent(`decommission:${spec.entity}`, user);
    return {
      decommissioned: spec.entity,
      spec_id: id,
      by: user,
      note:
        "dataflow row tombstoned (is_active=false, never deleted). The engine drops the managed " +
        "datasets deliberately on the next pipeline update; re-activation = rebuild the spec.",
    };
  });

  /** Lineage detail (gap #6): the full traceable graph for one entity. */
  app.get("/api/lineage/:source/:entity", async (req, reply) => {
    const { source, entity } = req.params as { source: string; entity: string };
    const rows = await dbx.sqlRows(
      `SELECT dataflow_id, spec_version, source_format, source_details, target_details,
              select_columns, is_active, framework_min_version, CAST(updated_at AS STRING) AS updated_at
       FROM ${fq(cfg.registry, "dataflow_spec")}
       WHERE dataflow_group = ${lit(source)} AND entity = ${lit(entity)}`,
      cfg.DATABRICKS_WAREHOUSE_ID,
    );
    if (!rows[0]) return reply.code(404).send({ error: "no dataflow for that source/entity" });
    const r = rows[0];
    const parse = (v: string | null) => {
      try {
        return v ? (JSON.parse(v) as Record<string, string>) : {};
      } catch {
        return {};
      }
    };
    const src = parse(r.source_details ?? null);
    const tgt = parse(r.target_details ?? null);
    const lastRun = await dbx.sqlRows(
      `SELECT run_id, trigger_type, state, bronze_count, silver_count, CAST(finished_at AS STRING) AS finished_at
       FROM ${fq(cfg.registry, "ingestion_runs")}
       WHERE source = ${lit(source)} AND entity = ${lit(entity)} ORDER BY started_at DESC LIMIT 1`,
      cfg.DATABRICKS_WAREHOUSE_ID,
    );
    return {
      spec_id: r.dataflow_id,
      spec_version: Number(r.spec_version ?? 0),
      is_active: String(r.is_active) === "true",
      framework_min_version: r.framework_min_version,
      graph: [
        { node: "source", system: source, object: src.source_object ?? null, connection: src.connection ?? null },
        { node: "ingestion_pipeline", name: `brnz_${source}_ingest`, kind: "lakeflow_connect" },
        { node: "bronze", table: tgt.bronze_table ?? null },
        { node: "etl_pipeline", name: `slvr_${source}_etl`, kind: "sdp_engine" },
        { node: "silver", table: tgt.silver_table ?? null, crosswalk: tgt.crosswalk_table ?? null },
        { node: "workflow", name: `${source}_workflow` },
      ],
      columns: JSON.parse(r.select_columns ?? "[]") as string[],
      last_run: lastRun[0] ?? null,
    };
  });
}

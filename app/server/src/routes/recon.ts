import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { fq } from "@pf/core";
import type { DbxClient } from "@pf/dbx";
import type { AppConfig } from "../config.js";
import type { PgStore } from "../lib/store/pg-store.js";

/**
 * Reconciliation dashboard API (ask #9 / ADR-007): fleet-wide loaded counts and
 * match rates. Reads the Lakebase synced tables (`recon.*`, ms latency) and
 * falls back to the warehouse over the same Delta data when pg is absent.
 */

const RunsQuery = z.object({
  source: z.string().optional(),
  entity: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const DiffsQuery = z.object({
  recon_id: z.string().min(1),
  entity: z.string().optional(),
  column: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

interface ReconRow {
  recon_id: string;
  run_id: string | null;
  spec_id: string | null;
  entity: string | null;
  status: string | null;
  started_at: string | null;
  finished_at: string | null;
  source_count: number | null;
  target_count: number | null;
  key_match_rate: number | null;
  row_match_rate: number | null;
  attr_match_rate: number | null;
}

export function registerReconRoutes(
  app: FastifyInstance,
  dbx: DbxClient,
  cfg: AppConfig,
  pg: PgStore | null,
): void {
  const t = (name: string) => fq(cfg.registry, name);

  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

  /** Joined run+entity rows, newest first. */
  async function loadRuns(limit: number, entity?: string): Promise<ReconRow[]> {
    if (pg) {
      const r = await pg.query(
        `SELECT rr.recon_id, rr.run_id, rr.spec_id, e.entity, rr.status,
                rr.started_at::text AS started_at, rr.finished_at::text AS finished_at,
                e.source_count, e.target_count, e.key_match_rate, e.row_match_rate, e.attr_match_rate
         FROM recon.recon_runs rr
         LEFT JOIN recon.recon_entity_result e ON e.recon_id = rr.recon_id
         ${entity ? "WHERE e.entity = $2" : ""}
         ORDER BY rr.started_at DESC LIMIT $1`,
        entity ? [limit, entity] : [limit],
      );
      return r.rows.map(mapRow);
    }
    const rows = await dbx.sqlRows(
      `SELECT rr.recon_id, rr.run_id, rr.spec_id, e.entity, rr.status,
              CAST(rr.started_at AS STRING) AS started_at, CAST(rr.finished_at AS STRING) AS finished_at,
              e.source_count, e.target_count, e.key_match_rate, e.row_match_rate, e.attr_match_rate
       FROM ${t("recon_runs")} rr
       LEFT JOIN ${t("recon_entity_result")} e ON e.recon_id = rr.recon_id
       ${entity ? `WHERE e.entity = '${entity.replaceAll("'", "")}'` : ""}
       ORDER BY rr.started_at DESC LIMIT ${limit}`,
      cfg.DATABRICKS_WAREHOUSE_ID,
    );
    return rows.map(mapRow);
  }

  function mapRow(x: Record<string, unknown>): ReconRow {
    return {
      recon_id: String(x.recon_id ?? ""),
      run_id: (x.run_id as string | null) ?? null,
      spec_id: (x.spec_id as string | null) ?? null,
      entity: (x.entity as string | null) ?? null,
      status: (x.status as string | null) ?? null,
      started_at: (x.started_at as string | null) ?? null,
      finished_at: (x.finished_at as string | null) ?? null,
      source_count: num(x.source_count),
      target_count: num(x.target_count),
      key_match_rate: num(x.key_match_rate),
      row_match_rate: num(x.row_match_rate),
      attr_match_rate: num(x.attr_match_rate),
    };
  }

  app.get("/api/recon/summary", async () => {
    const rows = await loadRuns(200);
    const withEntity = rows.filter((r) => r.entity !== null);
    const entities = new Map<string, ReconRow[]>();
    for (const r of withEntity) {
      const list = entities.get(r.entity as string) ?? [];
      list.push(r);
      entities.set(r.entity as string, list);
    }

    const sevenDays = Date.now() - 7 * 86_400_000;
    const inWindow = rows.filter((r) => r.started_at && Date.parse(r.started_at) >= sevenDays);
    const latestPer = [...entities.values()].map((list) => list[0]!);
    const avg = (vals: (number | null)[]): number | null => {
      const xs = vals.filter((v): v is number => v !== null);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    };

    return {
      thresholds: { key: cfg.PF_RECON_MIN_KEY, attr: cfg.PF_RECON_MIN_ATTR },
      backend: pg ? "lakebase" : "warehouse",
      kpis: {
        entities: entities.size,
        runs_7d: inWindow.length,
        failed_runs_7d: inWindow.filter((r) => r.status === "failed").length,
        rows_loaded_last_batch: latestPer.reduce((a, r) => a + (r.target_count ?? 0), 0),
        avg_key_rate: avg(latestPer.map((r) => r.key_match_rate)),
        avg_row_rate: avg(latestPer.map((r) => r.row_match_rate)),
        avg_attr_rate: avg(latestPer.map((r) => r.attr_match_rate)),
        below_threshold: latestPer.filter(
          (r) =>
            (r.key_match_rate ?? 1) < cfg.PF_RECON_MIN_KEY ||
            (r.attr_match_rate ?? 1) < cfg.PF_RECON_MIN_ATTR,
        ).length,
      },
      entities: [...entities.entries()]
        .map(([entity, list]) => ({
          entity,
          latest: list[0],
          trend: list.slice(0, 14).reverse(),
        }))
        .sort((a, b) => a.entity.localeCompare(b.entity)),
    };
  });

  app.get("/api/recon/runs", async (req, reply) => {
    const q = RunsQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid query", detail: q.error.issues });
    const runs = await loadRuns(q.data.limit, q.data.entity);
    return { runs };
  });

  /** Ingestion run log (ADR-011): every workflow run — build, schedule, manual —
   *  with per-entity counts and derived rows-ingested deltas. */
  app.get("/api/recon/ingestion", async (req, reply) => {
    const q = RunsQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid query", detail: q.error.issues });
    const { limit, entity } = q.data;

    const mapIng = (x: Record<string, unknown>) => ({
      run_id: String(x.run_id ?? ""),
      source: (x.source as string | null) ?? null,
      entity: (x.entity as string | null) ?? null,
      trigger_type: (x.trigger_type as string | null) ?? null,
      state: (x.state as string | null) ?? null,
      bronze_count: num(x.bronze_count),
      silver_count: num(x.silver_count),
      rows_delta: x.rows_delta === null || x.rows_delta === undefined ? null : Number(x.rows_delta),
      started_at: (x.started_at as string | null) ?? null,
      finished_at: (x.finished_at as string | null) ?? null,
      detail: (x.detail as string | null) ?? null,
    });

    if (pg) {
      const r = await pg.query(
        `SELECT run_id, source, entity, trigger_type, state, bronze_table, silver_table,
                bronze_count, silver_count,
                bronze_count - LAG(bronze_count) OVER (PARTITION BY source, entity ORDER BY started_at) AS rows_delta,
                started_at::text AS started_at, finished_at::text AS finished_at, detail
         FROM recon.ingestion_runs
         ${entity ? "WHERE entity = $2" : ""}
         ORDER BY started_at DESC LIMIT $1`,
        entity ? [limit, entity] : [limit],
      );
      return { runs: r.rows.map(mapIng), backend: "lakebase" };
    }
    const rows = await dbx.sqlRows(
      `SELECT run_id, source, entity, trigger_type, state, bronze_table, silver_table,
              bronze_count, silver_count,
              bronze_count - LAG(bronze_count) OVER (PARTITION BY source, entity ORDER BY started_at) AS rows_delta,
              CAST(started_at AS STRING) AS started_at, CAST(finished_at AS STRING) AS finished_at, detail
       FROM ${t("ingestion_runs")}
       ${entity ? `WHERE entity = '${entity.replaceAll("'", "")}'` : ""}
       ORDER BY started_at DESC LIMIT ${limit}`,
      cfg.DATABRICKS_WAREHOUSE_ID,
    );
    return { runs: rows.map(mapIng), backend: "warehouse" };
  });

  app.get("/api/recon/diffs", async (req, reply) => {
    const q = DiffsQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid query", detail: q.error.issues });
    const { recon_id, entity, column, limit } = q.data;

    if (pg) {
      const conds = ["recon_id = $1"];
      const params: unknown[] = [recon_id];
      if (entity) {
        params.push(entity);
        conds.push(`entity = $${params.length}`);
      }
      if (column) {
        params.push(column);
        conds.push(`column_name = $${params.length}`);
      }
      params.push(limit);
      const r = await pg.query(
        `SELECT entity, key_value, column_name, source_value, target_value, created_at::text AS created_at
         FROM recon.recon_record_diff WHERE ${conds.join(" AND ")}
         ORDER BY created_at DESC LIMIT $${params.length}`,
        params,
      );
      return { diffs: r.rows };
    }
    const safe = (s: string) => s.replaceAll("'", "");
    const rows = await dbx.sqlRows(
      `SELECT entity, key_value, column_name, source_value, target_value, CAST(created_at AS STRING) AS created_at
       FROM ${t("recon_record_diff")}
       WHERE recon_id = '${safe(recon_id)}'
       ${entity ? `AND entity = '${safe(entity)}'` : ""}
       ${column ? `AND column_name = '${safe(column)}'` : ""}
       ORDER BY created_at DESC LIMIT ${limit}`,
      cfg.DATABRICKS_WAREHOUSE_ID,
    );
    return { diffs: rows };
  });
}

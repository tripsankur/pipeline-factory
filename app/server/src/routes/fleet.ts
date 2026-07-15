import type { FastifyInstance } from "fastify";
import { FEATURES, SpecSchema, deriveBatches, fq, type Spec } from "@pf/core";
import type { DbxClient } from "@pf/dbx";
import type { RegistryStore } from "../lib/store/types.js";
import type { AppConfig } from "../config.js";

function lit(v: string): string {
  return `'${v.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

/** Fleet dashboard + evidence + feature-catalog data, all from the registry. */
export function registerFleetRoutes(
  app: FastifyInstance,
  registry: RegistryStore,
  dbx: DbxClient,
  cfg: AppConfig,
): void {
  const t = (name: string) => fq(cfg.registry, name);

  app.get("/api/fleet", async () => {
    const rows = await registry.fleet();

    const specs = rows.map((r) => {
      let confidence: number | null = null;
      let source: string | null = null;
      let lowCount = 0;
      let columnCount = 0;
      if (r.spec_json) {
        try {
          const spec = SpecSchema.parse(JSON.parse(r.spec_json));
          columnCount = spec.columns.length;
          confidence = spec.columns.reduce((a, c) => a + c.confidence, 0) / spec.columns.length;
          lowCount = spec.columns.filter((c) => c.confidence < 0.8).length;
          source = spec.source.entity;
        } catch {
          // stale/incompatible version json: leave enrichment null
        }
      }
      return {
        spec_id: r.spec_id,
        entity: r.entity,
        status: r.status,
        current_version: Number(r.current_version ?? 1),
        approved_by: r.approved_by ?? null,
        updated_at: r.updated_at ?? null,
        source,
        confidence,
        low_confidence_count: lowCount,
        column_count: columnCount,
        last_build_status: r.build_status ?? null,
        last_pr_url: r.pr_url ?? null,
      };
    });

    const total = specs.length;
    const approvedOrBeyond = specs.filter((s) => ["approved", "building", "pr_open", "done"].includes(s.status ?? "")).length;
    const prOpen = specs.filter((s) => s.status === "pr_open").length;
    const needsHuman = specs.filter((s) => s.status === "needs_human").length;
    const awaitingReview = specs.filter((s) => s.status === "generated").length;

    return {
      specs,
      kpis: { total, approved: approvedOrBeyond, pr_open: prOpen, needs_human: needsHuman, awaiting_review: awaitingReview },
    };
  });

  /** Everything the evidence screen needs, from the registry (constraint #6). */
  app.get("/api/specs/:id/evidence", async (req, reply) => {
    const { id } = req.params as { id: string };
    const spec = await registry.getSpec(id);
    if (!spec) return reply.code(404).send({ error: "spec not found" });

    const builds = await registry.listBuilds(id, 20);

    const recon = await dbx.sqlRows(
      `SELECT e.source_count, e.target_count, e.key_match_rate, e.row_match_rate, e.attr_match_rate,
              CAST(e.created_at AS STRING) AS created_at
       FROM ${t("recon_entity_result")} e
       INNER JOIN ${t("recon_runs")} rr ON rr.recon_id = e.recon_id
       WHERE rr.spec_id = ${lit(id)}
       ORDER BY e.created_at DESC LIMIT 1`,
      cfg.DATABRICKS_WAREHOUSE_ID,
    );

    const fixes = Object.entries(spec.evidence)
      .filter(([k]) => k.startsWith("fix_v"))
      .map(([k, v]) => ({ version: k.replace("fix_", ""), reason: String(v) }));

    return {
      spec,
      builds,
      recon: recon[0] ?? null,
      fixes,
      expectations: spec.expectations,
      approvals: await registry.listVersions(id),
    };
  });

  /** Feature catalog for the coming-soon panels (single source: @pf/core FEATURES). */
  app.get("/api/features", async () => ({ features: FEATURES }));

  /**
   * Lineage — the single source of truth for what flows from where.
   * Derived live from the registry's current spec versions: source system →
   * ingestion batch (one per source) → bronze table → silver transform (rulesets)
   * → target table.
   */
  app.get("/api/lineage", async () => {
    const jsons = await registry.listSpecJson();
    const specs: Spec[] = [];
    for (const j of jsons) {
      try {
        specs.push(SpecSchema.parse(JSON.parse(j)));
      } catch {
        // skip unparseable historical versions
      }
    }
    const batches = deriveBatches(specs);
    return {
      batches,
      entities: specs.map((s) => ({
        spec_id: s.spec_id,
        spec_version: s.spec_version,
        entity: s.entity,
        source_system: s.source.system,
        source_object: s.ingestion.source_object,
        bronze_table: s.source.entity,
        primary_keys: s.primary_keys.map((k) => k.target),
        target_table: s.target.entity,
        target_system: s.target.system,
        mode: s.ingestion.mode,
        column_count: s.columns.length,
      })),
    };
  });
}
